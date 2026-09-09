# Campaign QR Integration Contract

Read-only integration-contract audit for `SmartFlood-V3.2`.

No secrets, real QR tokens, session cookies, passwords, personal resident information, or deployment credentials are included.

## 1. Correct Endpoint

### Campaign QR lookup

- **Route:** `POST /api/emergency/campaigns/history`
- **Source:** `Backend/api/src/app/api/emergency/campaigns/history/route.ts`
- **Helpers:** `getDashboardViewer`, `resolveCampaignBatchIdByQrToken`, `listCampaignsForViewer`
- **Database:** `emergency_allocation_batches.qr_token_hash`
- **Response:** `data.campaigns`

Call chain:

```text
POST /api/emergency/campaigns/history
  -> getDashboardViewer()
  -> resolveCampaignBatchIdByQrToken()
  -> SHA-256(raw QR token)
  -> emergency_allocation_batches.qr_token_hash lookup
  -> listCampaignsForViewer()
  -> campaign/allocation-item queries
  -> data.campaigns
```

This endpoint is **not** the correct endpoint for mobile beneficiary verification. It resolves a campaign and returns campaign history. It does not resolve an authenticated resident, family eligibility, or resident identity.

### Existing beneficiary verification

- **Route:** `POST /api/emergency/distribution/verify`
- **Source:** `Backend/api/src/app/api/emergency/distribution/verify/route.ts`
- **Helper:** `resolveDistributionContext`
- **Source:** `Backend/api/src/lib/emergencyDistribution.ts`

Call chain:

```text
POST /api/emergency/distribution/verify
  -> getDashboardViewer()
  -> resolveDistributionContext()
  -> resolveCampaignBatchId()
  -> resolveCampaignBatchIdByQrToken()
  -> SHA-256 token lookup
  -> getCampaign()
  -> campaign expiration/readiness reconciliation
  -> resolveBeneficiary()
  -> residents_v3 or families lookup
  -> barangay validation
  -> allocation lookup
  -> previous distribution lookup
  -> response
```

This is the existing endpoint that consumes the campaign token for distribution verification. It requires a separate resident or family identifier and an authenticated barangay dashboard session.

## 2. Authentication

### Credential

The backend uses:

- Email and password
- `bcrypt.compare`
- A signed HTTP-only cookie named `smartflood_dashboard_session`

It does not use a Bearer token, JWT access token, Supabase Auth session, resident session, or mobile authentication token.

Relevant files:

- `Backend/api/src/app/api/auth/login/route.ts`
- `Backend/api/src/lib/dashboardSession.ts`
- `Backend/api/src/lib/dashboardViewer.ts`
- `Backend/api/src/app/api/auth/logout/route.ts`

### Login endpoint

`POST /api/auth/login`

The endpoint loads an account from `app_users`, verifies `password_hash` with bcrypt, rejects inactive or blocked accounts, tracks failed attempts, and creates the dashboard session cookie.

After three failed attempts, the account is marked blocked for fifteen minutes.

### Session creation

`setDashboardSession()` creates a signed payload containing:

```json
{
  "userId": "<APP_USER_ID>",
  "expiresAt": "<TIMESTAMP>"
}
```

The cookie is HTTP-only, `SameSite=Strict`, secure in production, and valid for 12 hours.

The signing secret is read from `SMARTFLOOD_SESSION_SECRET`, falling back to `SUPABASE_SERVICE_ROLE_KEY`.

### Session validation

`getDashboardViewer()`:

1. Reads the dashboard cookie.
2. Verifies the HMAC signature.
3. Checks expiration.
4. Loads the user from `app_users`.
5. Requires `status = active`.
6. Derives role and barangay assignment.

### Refresh

No refresh endpoint or refresh-token mechanism exists.

### Logout

`POST /api/auth/logout` clears the dashboard cookie and writes a logout audit event when possible.

### Mobile compatibility

The mobile app currently stores a local resident profile. That profile does not create or prove a valid `app_users` session.

The campaign verification endpoints only accept the dashboard cookie. The `Authorization` header is permitted by CORS configuration but is not used for authentication.

**MOBILE RESIDENT AUTHENTICATION IS NOT CURRENTLY SUPPORTED BY THIS ENDPOINT.**

## 3. Resident Identity Resolution

The current backend resolves:

```text
request resident_id/family_id
  -> residents_v3 or families lookup
  -> family_id
  -> family barangay_id
```

It does not resolve:

```text
authenticated identity
  -> residents_v3
```

### `app_users`

`getDashboardViewer()` loads:

```text
app_users.id
app_users.role_id
app_users.barangay_id
```

No `app_users.resident_id` mapping is queried or defined in the relevant backend code.

### `residents_v3`

`getResident()` queries:

```text
residents_v3.resident_id
residents_v3.family_id
residents_v3.barangay_id
residents_v3.is_family_head
residents_v3.status
```

### `families`

`getFamily()` queries:

```text
families.family_id
families.family_head_id
families.barangay_id
families.family_head_name
```

### `barangays`

The emergency schema uses:

```text
barangays.barangay_id
```

Verified relationships:

```text
residents_v3.family_id -> families.family_id
residents_v3.barangay_id -> barangays.barangay_id
families.family_head_id -> residents_v3.resident_id
families.barangay_id -> barangays.barangay_id
app_users.barangay_id -> barangays.barangay_id
```

The verification endpoint accepts client-provided `resident_id` and `family_id`. These are lookup inputs, not authentication.

**The current backend cannot derive resident identity from authenticated credentials. A client-supplied resident ID must not be treated as authentication.**

## 4. Campaign Verification

| Check | Source | Function | Behavior |
|---|---|---|---|
| Raw token hashing | `Backend/api/src/lib/emergencyCampaigns.ts` | `resolveCampaignBatchIdByQrToken` | SHA-256 hashes the raw token as UTF-8 |
| Token lookup | `Backend/api/src/lib/emergencyCampaigns.ts` | `resolveCampaignBatchIdByQrToken` | Looks up `emergency_allocation_batches.qr_token_hash` |
| Token uniqueness | `supabase/migrations/20260906000000_add_campaign_qr_token_hash.sql` | Partial unique index | Non-null token hashes are unique |
| Token encryption | `Backend/api/src/lib/campaignQrCrypto.ts` | `decryptCampaignQrToken` | AES-256-GCM decrypts the stored token |
| Token retrieval | `Backend/api/src/app/api/emergency/campaigns/[batchId]/qr/route.ts` | `GET` | Returns the decrypted token to authorized barangay staff |
| Campaign lookup | `Backend/api/src/lib/emergencyCampaigns.ts` | `getCampaign` | Reads `emergency_allocation_batches` |
| Campaign expiration | `Backend/api/src/lib/emergencyCampaigns.ts` | `refreshCampaignExpiration` | Changes expired `in_distribution` campaigns to `expired` |
| Campaign readiness | `Backend/api/src/lib/emergencyCampaigns.ts` | `reconcileCampaignDistributionReadiness` | Changes `barangays_notified` to `in_distribution` when an allocation is ready |
| Active campaign status | `Backend/api/src/lib/emergencyDistribution.ts` | `resolveDistributionContext` | Requires effective status `in_distribution` |
| Resident lookup | `Backend/api/src/lib/emergencyDistribution.ts` | `getResident` | Finds an active or null-status resident |
| Family lookup | `Backend/api/src/lib/emergencyDistribution.ts` | `getFamily` | Finds a family by `family_id` |
| Resident-to-family resolution | `Backend/api/src/lib/emergencyDistribution.ts` | `resolveBeneficiary` | Uses `resident.family_id` to load the family |
| Barangay validation | `Backend/api/src/lib/emergencyDistribution.ts` | `resolveDistributionContext` | Compares family barangay with authenticated staff barangay |
| Allocation lookup | `Backend/api/src/lib/emergencyDistribution.ts` | `findAllocationItem` | Requires matching batch/barangay and normally `family_heads_notified` |
| Previous distribution | `Backend/api/src/lib/emergencyDistribution.ts` | `getExistingDistribution` | Looks for `(batch_id, family_id)` |
| Duplicate protection | `supabase/migrations/20260813010000_create_relief_distributions.sql` | Database constraint | Unique `(batch_id, family_id)` |
| Family-head eligibility | `Backend/api/src/app/api/emergency/allocation-items/[itemId]/notify-family-heads/route.ts` | `getEligibleFamilies` | Requires a family-head ID or active resident with `is_family_head = true` |
| Scanned resident eligibility | `Backend/api/src/lib/emergencyDistribution.ts` | `resolveBeneficiary` | Any active resident linked to the family can resolve it; family-head status is not required |
| Individual eligibility | `Backend/api/src/lib/emergencyDistribution.ts` | `resolveBeneficiary` | No individual eligibility decision is performed |

### Database functions, triggers, policies, and constraints

The inspected migrations prove:

- `set_emergency_workflow_updated_at()` trigger function
- Updated-at triggers on campaign, allocation-item, and distribution tables
- Foreign keys for emergency allocation and distribution tables
- Unique `(batch_id, family_id)` distribution constraint
- Campaign status checks
- Allocation-item status checks

No Supabase RPC is called by campaign token verification.

No relevant RLS policy is defined in the inspected repository migrations. Backend queries use the Supabase service-role client.

## 5. Database Effects

### A. QR scan / verification

`POST /api/emergency/distribution/verify` performs reads of:

- Campaign by QR hash
- Campaign record
- Allocation items
- Resident or family
- Existing distribution

However, it may also:

- Update `emergency_allocation_batches.status`
- Insert lifecycle events into `audit_logs`

This happens through `refreshCampaignExpiration()` and `reconcileCampaignDistributionReadiness()`.

Verification does not:

- Insert into `relief_distributions`
- Update `relief_distributions`
- Mark a resident as received
- Mark a family as received
- Confirm distribution

Therefore verification is not strictly read-only at the database level because campaign lifecycle reconciliation may write campaign state and audit logs.

### B. Staff-authorized distribution confirmation

`POST /api/emergency/distribution/confirm`:

1. Requires an authenticated dashboard viewer.
2. Requires role `barangay`.
3. Re-runs `resolveDistributionContext`.
4. Inserts a `relief_distributions` row with status `received`.
5. Sets `verified_by` to the authenticated `app_users.id`.
6. Writes `RELIEF_DISTRIBUTION_CONFIRMED` to `audit_logs`.
7. Returns HTTP `201`.

This is the mutation endpoint and must remain separate from mobile scanning.

## 6. Distribution Confirmation

- **Endpoint:** `POST /api/emergency/distribution/confirm`
- **Source:** `Backend/api/src/app/api/emergency/distribution/confirm/route.ts`
- **Authorization:** Active dashboard session with role `barangay`
- **Mutation:** Inserts into `relief_distributions`
- **Audit:** Inserts `RELIEF_DISTRIBUTION_CONFIRMED` into `audit_logs`
- **Duplicate behavior:** Unique `(batch_id, family_id)` constraint; duplicate confirmation returns HTTP `409`

The scanner must not call this endpoint.

## 7. Exact Request Contract

### Campaign history QR lookup

- **Base URL:** `<SMARTFLOOD_BACKEND_BASE_URL>`
- **Method:** `POST`
- **Route:** `/api/emergency/campaigns/history`
- **Authentication:** `smartflood_dashboard_session` cookie
- **Headers:** `Content-Type: application/json`
- **Body:**

```json
{
  "qrToken": "<RAW_CAMPAIGN_QR_TOKEN>",
  "batchId": "<OPTIONAL_BATCH_ID>"
}
```

`qrToken` is required. `batchId` is optional and must match the token-resolved campaign when supplied.

### Beneficiary verification

- **Base URL:** `<SMARTFLOOD_BACKEND_BASE_URL>`
- **Method:** `POST`
- **Route:** `/api/emergency/distribution/verify`
- **Authentication:** Active dashboard session cookie for a barangay official
- **Headers:** `Content-Type: application/json`
- **Body fields:**

```json
{
  "qr_token": "<RAW_CAMPAIGN_QR_TOKEN>",
  "resident_id": "<RESIDENT_ID>",
  "family_id": "<OPTIONAL_FAMILY_ID>",
  "batch_id": "<OPTIONAL_BATCH_ID>",
  "allocation_item_id": "<OPTIONAL_ALLOCATION_ITEM_ID>"
}
```

Accepted aliases include:

```text
qrToken -> qr_token
batchId -> batch_id
identifier or qr_identifier -> resident/family identifier
```

A campaign token alone is insufficient. A resident or family identifier is also required.

## 8. Exact Response Contract

### Success / eligible

HTTP `200`:

```json
{
  "success": true,
  "result": "ELIGIBLE",
  "reason": null,
  "data": {
    "beneficiary": {
      "family_id": "<FAMILY_ID>",
      "family_name": "<FAMILY_NAME>",
      "family_head_id": "<RESIDENT_ID>",
      "family_head_name": "<NAME>",
      "barangay_id": "<BARANGAY_ID>",
      "barangay_name": "<BARANGAY_NAME>",
      "total_family_members": 0,
      "address": "<ADDRESS>",
      "scanned_resident_name": "<NAME>",
      "vulnerability": {}
    },
    "allocation": {
      "item_id": "<ITEM_ID>",
      "batch_id": "<BATCH_ID>",
      "barangay_id": "<BARANGAY_ID>",
      "barangay_name": "<BARANGAY_NAME>",
      "barangay_status": "family_heads_notified",
      "family_food_packs": 0,
      "individual_relief_goods": 0,
      "emergency_kits": 0,
      "batch": {}
    },
    "existing_distribution": null
  }
}
```

### Invalid QR token

HTTP `400` from `/api/emergency/distribution/verify`:

```json
{
  "success": false,
  "result": "CAMPAIGN_NOT_ACTIVE",
  "error": "Campaign QR token was not found.",
  "data": {
    "beneficiary": null,
    "allocation": null,
    "existing_distribution": null
  }
}
```

### Expired campaign

HTTP `200`:

```json
{
  "success": true,
  "result": "CAMPAIGN_NOT_ACTIVE",
  "reason": "Selected relief campaign is expired and cannot accept distributions.",
  "data": {
    "beneficiary": null,
    "allocation": {},
    "existing_distribution": null
  }
}
```

### Not eligible

HTTP `200`:

```json
{
  "success": true,
  "result": "NOT_ELIGIBLE",
  "reason": "<IMPLEMENTATION_REASON>",
  "data": {
    "beneficiary": {},
    "allocation": {},
    "existing_distribution": null
  }
}
```

### Wrong barangay

HTTP `200`:

```json
{
  "success": true,
  "result": "WRONG_BARANGAY",
  "reason": "Beneficiary does not belong to your barangay.",
  "data": {
    "beneficiary": {},
    "allocation": {},
    "existing_distribution": null
  }
}
```

### Already received

HTTP `200` during verification:

```json
{
  "success": true,
  "result": "ALREADY_RECEIVED",
  "reason": "This family has already received relief for this emergency allocation.",
  "data": {
    "beneficiary": {},
    "allocation": {},
    "existing_distribution": {}
  }
}
```

### Missing authentication

HTTP `401`:

```json
{
  "success": false,
  "result": "UNAUTHORIZED",
  "error": "Unauthorized."
}
```

### Expired authentication

HTTP `401` with the same response shape. Expired or invalid cookies are treated as unauthenticated.

## 9. HTTP Status Matrix

| Scenario | HTTP | result/reason | Notes |
|---|---:|---|---|
| Eligible verification | 200 | `ELIGIBLE` | Business success |
| Invalid QR token | 400 | `CAMPAIGN_NOT_ACTIVE`; `Campaign QR token was not found.` | Request error |
| Expired campaign | 200 | `CAMPAIGN_NOT_ACTIVE` | Business-level failure uses HTTP 200 |
| Campaign not ready, closed, or completed | 200 | `CAMPAIGN_NOT_ACTIVE` | Business-level failure |
| Not eligible allocation | 200 | `NOT_ELIGIBLE` | Business-level failure |
| Wrong barangay | 200 | `WRONG_BARANGAY` | Barangay scope mismatch |
| Already received during verification | 200 | `ALREADY_RECEIVED` | Existing record is returned |
| Missing resident/family identifier | 200 | `INVALID_IDENTIFIER` | Reason: `QR identifier is required.` |
| Missing authentication | 401 | `UNAUTHORIZED` | No valid dashboard cookie |
| Expired authentication | 401 | `UNAUTHORIZED` | Expired cookie is rejected |
| Non-barangay staff verification | 403 | `UNAUTHORIZED` | Verification requires barangay role |
| Distribution confirmation success | 201 | `RECEIVED` | Inserts `relief_distributions` |
| Distribution confirmation duplicate | 409 | `ALREADY_RECEIVED` | Unique database constraint |

For `POST /api/emergency/campaigns/history`, an invalid token returns HTTP `404`:

```json
{
  "success": false,
  "error": "Campaign was not found."
}
```

That endpoint does not return `result`, `reason`, or beneficiary data.

## 10. Mobile Compatibility

### Currently Supported

- Reuse of the existing campaign QR token format
- SHA-256 token verification against `qr_token_hash`
- Existing staff campaign verification
- Campaign status, allocation, barangay, family, and previous-receipt checks
- Separate staff distribution confirmation workflow

### Not Currently Supported

- Resident mobile authentication
- A mobile-verifiable resident session
- Authenticated identity resolution to `residents_v3`
- Mobile campaign verification using only a campaign token
- Server-side derivation of resident identity from the mobile profile
- Strictly read-only verification, because lifecycle reconciliation can update campaign state and audit logs

### Blockers

- The backend only authenticates `app_users`.
- Authentication is dashboard-cookie based.
- No resident login, JWT, Supabase Auth session, refresh token, or resident-to-`app_users` mapping exists.
- Verification requires a client-supplied resident or family identifier.
- Client-supplied identity is not authentication.
- Verification is restricted to barangay dashboard staff.

### Smallest Required Change

Add a server-verifiable mobile resident authentication mechanism that maps the authenticated resident to:

```text
residents_v3.resident_id
residents_v3.family_id
residents_v3.barangay_id
```

Then add or adapt a read-only verification path that derives resident identity from authenticated context, accepts the existing raw campaign token, and does not call distribution confirmation.

No new QR format or distribution workflow is required.

## 11. Security Findings

- `resident_id` and `family_id` are accepted from the request body and used for lookup. They do not prove ownership or identity.
- Only active `app_users` dashboard sessions are supported.
- A locally stored mobile resident profile cannot authenticate against this backend.
- Authorized barangay staff can retrieve the decrypted raw campaign token through `/api/emergency/campaigns/[batchId]/qr`.
- The campaign QR identifies the emergency allocation batch. It is not a beneficiary QR and does not identify a resident.
- Barangay verification compares the family barangay with the authenticated staff barangay.
- Previous receipt checks use `(batch_id, family_id)`.
- Family notification eligibility requires a family head, but verification accepts any active resident linked to the family.
- No individual vulnerability or individual-benefit eligibility decision is performed by verification.
- Only `/api/emergency/distribution/confirm` inserts a received distribution.
- Verification can update campaign state to `expired` or `in_distribution` and can write lifecycle audit events.
- Emergency tables use foreign keys, status checks, updated-at triggers, and a unique `(batch_id, family_id)` distribution constraint.
- The repository explicitly documents that resident authentication integration is not configured.

## 12. Files Inspected

- `Backend/api/src/app/api/emergency/campaigns/history/route.ts`
- `Backend/api/src/app/api/emergency/campaigns/[batchId]/qr/route.ts`
- `Backend/api/src/app/api/emergency/distribution/verify/route.ts`
- `Backend/api/src/app/api/emergency/distribution/confirm/route.ts`
- `Backend/api/src/app/api/emergency/distribution/history/route.ts`
- `Backend/api/src/app/api/emergency/allocation-items/[itemId]/notify-family-heads/route.ts`
- `Backend/api/src/app/api/emergency/campaigns/[batchId]/start/route.ts`
- `Backend/api/src/app/api/emergency/campaigns/[batchId]/close/route.ts`
- `Backend/api/src/app/api/emergency/allocations/[batchId]/notify-barangays/route.ts`
- `Backend/api/src/lib/emergencyCampaigns.ts`
- `Backend/api/src/lib/emergencyDistribution.ts`
- `Backend/api/src/lib/emergencyWorkflow.ts`
- `Backend/api/src/lib/emergencyReports.ts`
- `Backend/api/src/lib/dashboardSession.ts`
- `Backend/api/src/lib/dashboardViewer.ts`
- `Backend/api/src/lib/appUserMapping.ts`
- `Backend/api/src/lib/authSession.ts`
- `Backend/api/src/lib/campaignQrCrypto.ts`
- `Backend/api/src/lib/auditLogger.ts`
- `Backend/api/src/lib/emergencyIncidentAuth.ts`
- `Backend/api/src/lib/barangayScope.ts`
- `Backend/api/src/proxy.ts`
- `supabase/migrations/20260813000000_create_emergency_relief_allocation_workflow.sql`
- `supabase/migrations/20260813010000_create_relief_distributions.sql`
- `supabase/migrations/20260814000000_extend_emergency_allocation_batches_lifecycle.sql`
- `supabase/migrations/20260906000000_add_campaign_qr_token_hash.sql`
- `supabase/migrations/20260906010000_add_campaign_qr_token_encrypted.sql`
- `IMPLEMENTATION_PROGRESS.md`

## 13. Modification Confirmation

No application code, database records, migrations, QR generation logic, or distribution records were modified.
