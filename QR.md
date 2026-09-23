# SmartFlood V3.2 — QR System Reviewer

## 1. What the QR System Does

SmartFlood uses a QR code to represent an **emergency relief campaign**, not a resident account. When an authorized AI relief plan is accepted, the server generates a random campaign token. A barangay official can display or download that token as a QR image and use it while verifying distributions for that campaign.

The QR reduces manual campaign selection and helps bind verification to the intended allocation batch. It does not contain a name, address, family record, resident record, or relief quantities. A separate family/resident identifier locates the beneficiary. The backend then checks the campaign, barangay, allocation readiness, family, and prior distribution before an official can confirm receipt.

The implemented users are authenticated barangay dashboard officials. Super and CSWDD users may view scoped campaign history, but the QR-token retrieval endpoint itself permits only the assigned barangay role.

## 2. QR Architecture

The complete implemented flow is:

```text
authorized plan approval
  -> server generates 32 random bytes as a base64url campaign token
  -> SHA-256 hash stored for lookup
  -> AES-256-GCM encrypted copy stored for authorized re-display
  -> assigned barangay official requests campaign QR token
  -> server decrypts stored copy and returns opaque plaintext token
  -> qrcode.react renders token as SVG (downloadable)
  -> token is supplied to campaign/distribution API
  -> server hashes token and resolves emergency_allocation_batches.batch_id
  -> separate family/resident UUID resolves the beneficiary family
  -> session role + barangay + campaign + allocation + duplicate checks
  -> preview returns ELIGIBLE or a failure state
  -> explicit confirmation repeats checks
  -> relief_distributions row is inserted and an audit event is logged
```

There is no browser camera capture or QR-decoding library in the current repository. The UI displays/downloads the campaign QR and accepts a text identifier. A physical scanner that types decoded text could feed that field, but that hardware integration is not implemented or guaranteed by this code.

## 3. QR Generation

**Server token generation**

- File: `Backend/api/src/lib/emergencyWorkflow.ts`
- Function: `createAcceptedWorkflowBatch()`
- Lines: 122-197

The backend generates `randomBytes(32).toString("base64url")`. It stores the SHA-256 hash in `qr_token_hash`, stores an AES-256-GCM encrypted copy in `qr_token_encrypted`, and returns the plaintext token in the accepted-workflow response. The token is opaque: it is not a URL, UUID, JSON object, resident record, or family record.

**Frontend QR rendering**

- File: `Frontend/src/components/emergency/CampaignQrCode.tsx`
- Functions: `CampaignQrCode()`, `downloadCampaignQr()`
- Lines: 6-19

`QRCodeSVG` from `qrcode.react` encodes the token directly into an SVG with error-correction level `M`. The download helper serializes that SVG and downloads `smartflood-{batchId}-qr.svg`.

Sensitive beneficiary information is not encoded directly. The value is nevertheless a bearer-style campaign token and should not be published casually.

## 4. QR Payload

The actual QR payload is one base64url string:

```text
<opaque random campaign token>
```

It has no separately addressable fields. Its meaning is established only by hashing it on the server and matching `emergency_allocation_batches.qr_token_hash`.

Do not confuse three representations:

| Representation | Purpose | Stored/displayed |
|---|---|---|
| Plain random token | Actual QR value and API credential | Rendered after authorized retrieval; returned at initial creation |
| SHA-256 token hash | One-way campaign lookup | Stored in `emergency_allocation_batches.qr_token_hash` |
| AES-256-GCM envelope `v1.iv.authTag.ciphertext` | Recoverable database copy for QR re-display | Stored in `qr_token_encrypted`; not encoded in the QR |

The encryption/decryption envelope is implemented in `Backend/api/src/lib/campaignQrCrypto.ts`, lines 3-57. The hash lookup is implemented in `Backend/api/src/lib/emergencyCampaigns.ts`, lines 37-49.

## 5. QR Scanning

The repository does **not** implement camera scanning or client-side QR decoding. There is therefore no honest code path of camera image -> decoded payload inside SmartFlood.

What actually exists is:

1. The barangay dashboard fetches the campaign token using `useCampaignQrToken()` (`Frontend/src/components/emergency/useCampaignQrToken.ts`, lines 6-20).
2. `CampaignQrCode()` renders it for display or printing (`CampaignQrCode.tsx`, lines 6-8).
3. The distribution form accepts a family/resident identifier as text (`ReliefDistributionPanel.tsx`, lines 411-439).
4. `handleVerify()` submits that identifier plus the selected campaign batch and campaign QR token (`ReliefDistributionPanel.tsx`, lines 240-278).
5. `verifyReliefDistribution()` calls `POST /api/emergency/distribution/verify` (`Frontend/src/services/emergencyService.ts`, lines 57-64).
6. The server validates the session and resolves campaign and beneficiary (`verify/route.ts`, lines 5-38; `emergencyDistribution.ts`, lines 45-175).
7. A successful preview returns `ELIGIBLE`; the official must still confirm.

`Frontend/src/app/dashboard/reliefDistribution/scan/page.tsx`, lines 12-82, is named “scan” but displays the selected campaign QR. It does not access a camera or decode QR images.

## 6. QR + Resident/Family Identification

The campaign QR and beneficiary identifier are independent inputs:

```text
campaign token -> emergency_allocation_batches.batch_id
family/resident identifier -> families.family_id
```

`resolveDistributionContext()` coordinates both paths (`Backend/api/src/lib/emergencyDistribution.ts`, lines 45-152). `resolveCampaignBatchId()` hashes and resolves the token and rejects a token/batch mismatch (lines 154-175). `resolveBeneficiary()` accepts a family UUID, resident UUID, or supported prefixes such as `family:`, `fam:`, `resident:`, and `res:` (lines 264-285 and 451-475). A resident must link to an existing family.

- **Identification:** the UUID lookup locates a resident/family; the token locates a campaign.
- **Authentication:** the dashboard session identifies the official using the API.
- **Authorization:** role and assigned-barangay checks decide whether that official may perform distribution.

The QR does not authenticate a resident and does not prove that the person presenting it is a particular beneficiary.

## 7. QR + Relief Distribution

### Verification

- Frontend: `ReliefDistributionPanel.tsx`, `handleVerify()`, lines 240-278
- Service: `Frontend/src/services/emergencyService.ts`, `verifyReliefDistribution()`, lines 57-64
- API: `Backend/api/src/app/api/emergency/distribution/verify/route.ts`, `POST()`, lines 5-38
- Business logic: `Backend/api/src/lib/emergencyDistribution.ts`, `resolveDistributionContext()`, lines 45-152

The backend verifies an authenticated barangay role, assigned barangay, valid active campaign, valid family/resident identifier, same-barangay ownership, a ready allocation item, and absence of a prior distribution for that family and batch. Verification is read-only.

### Confirmation

- Frontend: `ReliefDistributionPanel.tsx`, `handleConfirm()`, lines 280-309
- Service: `emergencyService.ts`, `confirmReliefDistribution()`, lines 66-73
- API: `Backend/api/src/app/api/emergency/distribution/confirm/route.ts`, `POST()`, lines 7-110

Confirmation repeats the server checks, inserts a `relief_distributions` row with batch, allocation item, family, family head, barangay, `received` status, verifier, and timestamp, then logs `RELIEF_DISTRIBUTION_CONFIRMED`. The database uniqueness rule `(batch_id, family_id)` provides the race-safe duplicate barrier.

## 8. Security / Validation

| Protection | File / function / lines | What it prevents |
|---|---|---|
| 256-bit random token | `emergencyWorkflow.ts`, `createAcceptedWorkflowBatch()`, 122-145 | Predictable campaign QR values |
| SHA-256 lookup | `emergencyCampaigns.ts`, `resolveCampaignBatchIdByQrToken()`, 37-49 | Storing/querying the plaintext lookup token |
| AES-256-GCM stored copy | `campaignQrCrypto.ts`, encryption/decryption, 3-57 | Plaintext database storage for the recoverable display copy; auth tag detects tampering |
| Unique token-hash index | `supabase/migrations/20260906000000_add_campaign_qr_token_hash.sql`, 1-6 | Duplicate non-null campaign token hashes |
| Authenticated QR retrieval | `campaigns/[batchId]/qr/route.ts`, `GET()`, 25-67 | Anonymous token retrieval |
| Barangay role and scope | same route, 30-48 | Other roles or unassigned/foreign barangays retrieving that QR |
| No-store response | same route, 18-23 | Normal intermediary/browser caching of token responses |
| Campaign hash lookup and mismatch check | `emergencyDistribution.ts`, `resolveCampaignBatchId()`, 154-175 | Unknown tokens and conflicting supplied batch/token pairs |
| UUID and record lookup | same file, `resolveBeneficiary()`, 264-307; `isUuid()`, 474-475 | Malformed IDs and missing/inactive resident records |
| Role and assigned barangay | same file, `resolveDistributionContext()`, 45-56 and 94-105 | Non-barangay operators and cross-barangay beneficiary handling |
| Active/readiness checks | same file, 72-87 and 107-129 | Distribution under inactive/expired/not-ready campaigns |
| Existing-distribution check | same file, 131-141 and 338-347 | Ordinary repeat distribution attempts |
| Database unique constraint | `20260813010000_create_relief_distributions.sql`, 13-34 | Concurrent duplicate family receipt for one batch |
| Confirm-time revalidation | `confirm/route.ts`, 7-39 | Acting on a stale frontend verification result |
| Audit event | same route, 82-91 | Unattributed successful distribution actions |

Campaign expiry is implemented through `emergency_allocation_batches.expires_at`; `refreshCampaignExpiration()` changes an elapsed `in_distribution` campaign to `expired` (`emergencyCampaigns.ts`, lines 51-79). There is no separate expiry embedded in the QR token and no token rotation or one-time-use mechanism.

## 9. QR Failure Cases

| Case | Actual behavior |
|---|---|
| QR image cannot be decoded | Not explicitly handled; SmartFlood has no camera/decoder implementation |
| Empty campaign token | API rejects it as required or reports campaign selection unavailable |
| Random/malformed token | Hash lookup finds no batch; response reports campaign token/campaign not found |
| Token and supplied batch disagree | Request rejected with “batchId and qrToken refer to different campaigns” |
| Empty or malformed beneficiary ID | `INVALID_IDENTIFIER`; UUID validation fails |
| Resident does not exist/inactive | `INVALID_IDENTIFIER`; resident/family was not found |
| Family does not exist | `INVALID_IDENTIFIER`; family was not found |
| Resident has no family | `INVALID_IDENTIFIER`; resident is not linked to a family |
| Unauthenticated request | HTTP 401 at the API route |
| Wrong role or no barangay assignment | `UNAUTHORIZED`, generally HTTP 403 |
| Beneficiary belongs to another barangay | `WRONG_BARANGAY` |
| Campaign inactive or expired | `CAMPAIGN_NOT_ACTIVE` |
| Allocation not ready | `NOT_ELIGIBLE` |
| Family already received | `ALREADY_RECEIVED`; confirm race returns HTTP 409 |
| Network/API failure | Frontend catches and displays the returned/general error; no offline queue exists |
| Copied QR | No copy protection. Possession alone still does not bypass login, role, scope, campaign, beneficiary, or duplicate checks |

## 10. Defense Explanation

“SmartFlood creates one opaque random token when an authorized relief plan is accepted. The server stores a SHA-256 hash for campaign lookup and an AES-GCM encrypted copy so an assigned barangay official can retrieve and display it later. The frontend renders that token as an SVG QR; it does not put resident personal data in the code. During distribution, the campaign token identifies the allocation batch, while a separate resident or family UUID identifies the beneficiary. The backend checks the official’s session, barangay, campaign status, allocation readiness, and previous receipt. After an explicit confirmation, it records the distribution and audit event. The present repository displays QR codes and accepts decoded values, but does not include browser-camera scanning.”

## 11. Likely Panel Questions

**1. Why did you use QR?**

To carry an opaque campaign reference conveniently between display/print and the distribution workflow, reducing manual campaign-selection errors.

**2. What information is inside the QR?**

Only a random base64url campaign token. It is not JSON, a URL, or resident/family data.

**3. Does the QR contain personal information?**

No. Names, addresses, UUIDs, and relief details are not directly encoded.

**4. Is the QR an authentication mechanism?**

No. The dashboard session authenticates the official; the QR identifies a campaign.

**5. How is the QR generated?**

The backend generates 32 cryptographically random bytes. The frontend’s `qrcode.react` library renders the returned token as SVG.

**6. Is the QR payload encrypted?**

No. The displayed QR contains the plaintext opaque token. An encrypted copy is stored in the database for authorized re-display.

**7. Why store both a hash and encrypted copy?**

The hash supports token lookup without plaintext storage. The encrypted copy is recoverable because the official must display/download the same token later.

**8. How does the system know which resident or family it belongs to?**

It does not derive a beneficiary from the campaign QR. A separate family or resident UUID is resolved to the family.

**9. Where is QR validation performed?**

Campaign-token lookup is in `emergencyCampaigns.ts`; complete campaign and beneficiary checks are in `emergencyDistribution.ts`.

**10. What happens if someone copies the QR?**

The copy contains the same reusable campaign token. There is no anti-copy mechanism, but use still requires an authorized barangay session and all backend checks.

**11. Can a QR be reused?**

Yes, to identify the same campaign while usable. It is not a one-time token; duplicate distribution is controlled per family and batch.

**12. What happens if it is scanned twice?**

Scanning/decoding itself is not tracked. If the same family is confirmed twice, the existing-record check or database unique constraint returns `ALREADY_RECEIVED`.

**13. How do you prevent unauthorized use?**

The API requires an authenticated dashboard viewer, barangay role, assigned barangay, campaign allocation, and same-barangay beneficiary.

**14. What happens when the QR is invalid?**

Its hash matches no campaign, so the request fails with a campaign-not-found/token-not-found result.

**15. Does SmartFlood scan using the phone camera?**

Not in the current repository. It renders QR codes and accepts identifiers/tokens through API/UI paths, but no camera decoder is implemented.

**16. How does QR integrate with relief distribution?**

It selects the campaign context. A separate beneficiary UUID is checked, then the official previews eligibility and explicitly confirms receipt.

**17. How is duplicate distribution prevented?**

The service checks existing receipt first, and PostgreSQL uniquely constrains `(batch_id, family_id)` for race safety.

**18. What happens without internet?**

Verification and confirmation fail because they require API/database access. There is no offline queue or offline validation.

**19. Does the QR expire?**

The token has no embedded expiry. Its usefulness follows campaign state; an elapsed campaign becomes `expired` and cannot accept distributions.

**20. What is the biggest QR security limitation?**

The token can be copied and is reusable, and there is no camera-decoder or presenter-identity proof. Security depends on backend session, scope, campaign, and duplicate controls.

## 12. QR Source Code Cheat Sheet

| QR Component | File | Function | Lines | What I should remember |
|---|---|---|---:|---|
| Token creation | `Backend/api/src/lib/emergencyWorkflow.ts` | `createAcceptedWorkflowBatch()` | 122-197 | Random campaign token; hash + encrypted copy |
| Stored-token crypto | `Backend/api/src/lib/campaignQrCrypto.ts` | encrypt/decrypt | 3-57 | AES-256-GCM protects recoverable DB copy |
| Token hash lookup | `Backend/api/src/lib/emergencyCampaigns.ts` | `resolveCampaignBatchIdByQrToken()` | 37-49 | Token identifies campaign batch only |
| Campaign expiration | same | `refreshCampaignExpiration()` | 51-79 | Campaign state, not token, governs expiry |
| QR retrieval API | `Backend/api/src/app/api/emergency/campaigns/[batchId]/qr/route.ts` | `GET()` | 18-67 | Barangay-only, scoped, no-store response |
| Campaign token API lookup | `Backend/api/src/app/api/emergency/campaigns/history/route.ts` | `POST()` | 21-46 | Authenticated token-to-scoped-campaign lookup |
| QR rendering/download | `Frontend/src/components/emergency/CampaignQrCode.tsx` | component/helpers | 6-19 | `qrcode.react`, raw token -> SVG |
| Token fetch hook | `Frontend/src/components/emergency/useCampaignQrToken.ts` | `useCampaignQrToken()` | 6-20 | Prevents stale selected-campaign token |
| Distribution service | `Frontend/src/services/emergencyService.ts` | verify/confirm/token functions | 57-73, 138-150 | Frontend API calls |
| Distribution UI | `Frontend/src/components/emergency/ReliefDistributionPanel/ReliefDistributionPanel.tsx` | verify/confirm/modal | 240-309, 411-439, 547-557 | Text identifier, preview, confirm, QR modal |
| Display page | `Frontend/src/app/dashboard/reliefDistribution/scan/page.tsx` | page component | 12-82 | Displays QR; no camera decoder |
| Verify endpoint | `Backend/api/src/app/api/emergency/distribution/verify/route.ts` | `POST()` | 5-38 | Read-only eligibility preview |
| Validation core | `Backend/api/src/lib/emergencyDistribution.ts` | context/campaign/beneficiary resolvers | 45-175, 264-347, 451-475 | Auth, scope, IDs, readiness, duplicates |
| Confirm endpoint | `Backend/api/src/app/api/emergency/distribution/confirm/route.ts` | `POST()` | 7-110 | Rechecks, inserts receipt, audits |
| Token hash schema | `supabase/migrations/20260906000000_add_campaign_qr_token_hash.sql` | column/index | 1-6 | Unique non-null lookup hash |
| Encrypted token schema | `supabase/migrations/20260906010000_add_campaign_qr_token_encrypted.sql` | column | 1-2 | Recoverable encrypted copy |
| Distribution schema | `supabase/migrations/20260813010000_create_relief_distributions.sql` | table/constraints | 13-34 | Unique family receipt per batch |

## 13. What NOT to Say

- Do not say “the QR contains the resident profile.” It contains a campaign token.
- Do not say “the QR authenticates the resident.” It does not authenticate anyone.
- Do not say “the QR is encrypted.” The displayed payload is an opaque plaintext token; only the database re-display copy is AES-GCM encrypted.
- Do not say “the QR belongs to one family.” It identifies one campaign.
- Do not say “SmartFlood has built-in camera scanning.” No camera/decoder code was found.
- Do not say “the QR cannot be copied.” It can be copied like any displayed QR.
- Do not say “the QR is single-use.” It can be reused to resolve its campaign.
- Do not say “scanning automatically marks relief received.” Verification is read-only and confirmation is a separate action.
- Do not say “the token expires by itself.” Campaign status/expiry controls distribution; the token has no embedded expiration.
- Do not say “QR alone guarantees secure distribution.” Security depends on authenticated RBAC, barangay scope, server validation, and the database uniqueness constraint.
