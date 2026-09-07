# Resident Relief Request Workflow — Implementation Handoff

## 1. Feature purpose

Mobile-created resident relief requests are reviewed by the assigned barangay,
endorsed to CSWDD, then approved with a release schedule or rejected with
feedback. No resident web submission, mobile API, or new authentication was
added.

## 2. Current implementation status

**IMPLEMENTED — PARTIALLY VERIFIED — PENDING DATABASE MIGRATION**

Backend routes, authorization logic, frontend queue/review UI, and audit calls
exist. TypeScript, production builds, existing emergency tests, and diff checks
pass. The migration is unapplied; focused relief security and authenticated E2E
tests remain pending.

## 3. Architecture

`relief_requests → Backend route → reliefRequests service → dashboard session/RBAC → Supabase update → audit_logs → existing relief UI`.

The frontend uses `fetchJson` and the existing `/api/*` rewrite. The backend
uses `supabaseServer`, `getDashboardViewer()`, existing scope helpers, and
`logAuditEvent()`.

## 4. File inventory

Created:

- `Backend/api/src/lib/reliefRequests.ts`
- `Backend/api/src/app/api/relief-requests/route.ts`
- `Backend/api/src/app/api/relief-requests/[id]/route.ts`
- `Backend/api/src/app/api/relief-requests/[id]/endorse/route.ts`
- `Backend/api/src/app/api/relief-requests/[id]/review/route.ts`
- `supabase/migrations/20260907000000_create_resident_relief_requests_workflow.sql`
- `IMPLEMENTATION_PROGRESS.md`

Modified:

- `Frontend/src/types/relief.ts`
- `Frontend/src/services/reliefService.ts`
- `Frontend/src/components/relief/ReliefEndorsement/ReliefEndorsement.tsx`
- `Frontend/src/components/relief/ReliefEndorsement/ReliefEndorsement.module.css`
- `Frontend/src/components/relief/BarangayReliefPanel/BarangayReliefPanel.tsx`

No standalone files were deleted. `Backend/api/next-env.d.ts` was temporarily
changed by build generation and restored. No generated or unrelated changes
remain. AI, QR, emergency allocation/distribution, auth/session, resident
registration, mobile, notification, and unrelated dashboard modules are untouched.

## 5. API contract

- `GET /api/relief-requests`: Barangay receives only joined residents in its
  assigned barangay; CSWDD receives Endorsed/Approved/Rejected rows across
  barangays; Super receives all under existing service behavior.
- `GET /api/relief-requests/[id]`: same scope; CSWDD cannot open Pending rows.
- `POST /api/relief-requests/[id]/endorse`: Barangay only, no body, requires
  assigned-barangay Pending row, sets Endorsed/endorsed_by/endorsed_at, audits
  `RELIEF_REQUEST_ENDORSED`.
- `POST /api/relief-requests/[id]/review`: CSWDD/Super only. `approve` requires
  release date/time and optionally details; `reject` requires feedback. Reviewer
  and timestamp are session-derived; audit actions are APPROVED/REJECTED.

All failures use existing `{ success, error }` envelopes and conditional
updates return `409` for stale/duplicate actions.

## 6. Status machine

Allowed only: `Pending → Endorsed`, `Endorsed → Approved`, and
`Endorsed → Rejected`. All other transitions and duplicates fail server-side.
Legacy `Completed` remains allowed by the migration check for compatibility but
is not used by this workflow.

## 7. Authorization matrix

| Role | View | Endorse | Approve | Reject |
|---|---|---|---|---|
| Barangay | Own assigned barangay | Own Pending | No | No |
| CSWDD | All endorsed/processed | No | Endorsed only | Endorsed only |
| Super | All under service behavior | No route access | Yes | Yes |
| CDRRMO/other | No | No | No | No |

Session identity is loaded by `getDashboardViewer()`, role by
`dashboardViewerRole()`, and barangay assignment by
`assignedBarangayForUser()`. Client identity fields do not authorize access.

## 8. Database contract

`public.relief_requests` exists. Verified exposed fields include required
`id uuid`, `user_id uuid`, resident snapshot text fields, `request_kind`,
`relief_type`, `reason`, `status`, and timestamps; nullable family legacy
fields are present. Observed statuses are `Pending` and `Completed`.

Verified relationships:

- `relief_requests.user_id → residents_v3.resident_id`
- `residents_v3.family_id → families.family_id`
- `residents_v3.barangay_id → barangays.barangay_id`
- `families.family_head_id → residents_v3.resident_id`
- `families.barangay_id → barangays.barangay_id`
- `app_users.role_id → roles.role_id`
- `app_users.barangay_id → barangays.barangay_id`
- `audit_logs.actor_user_id → app_users.id`
- `audit_logs.barangay_id → barangays.barangay_id`

The migration adds nullable `endorsed_by`, `endorsed_at`, `reviewed_by`,
`reviewed_at`, `rejection_feedback`, `release_date`, `release_time`, and
`release_details`, plus a workflow status check and three indexes.

Columns/types/defaults/required fields and nested relationships were verified
read-only through PostgREST. Complete PostgreSQL constraint names, checks,
unique constraints, indexes, and triggers remain unverified because catalog
tables are not exposed through the configured API.

## 9. Migration status

- Migration file exists: **YES**
- Migration applied: **NO**
- Production data changed: **NO**
- Schema verified: **PARTIAL**

The migration alters an existing table and assumes `relief_requests` and
`app_users(id)` exist. It uses `ADD COLUMN IF NOT EXISTS`, a guarded status
constraint, and `CREATE INDEX IF NOT EXISTS`. If the table were absent, the
`ALTER TABLE IF EXISTS` would skip columns but later indexes would fail; the
target table was verified to exist.

## 10. Security model

Signed dashboard session and `app_users` lookup are authoritative. Barangay
scope is derived from the resident join and assigned user barangay. CSWDD scope
is role/status enforced server-side. Conditional status predicates prevent
duplicate transitions. Audit actor data comes from the authenticated viewer.

## 11. Validation results

- Backend TypeScript: **PASS** (`npx tsc --noEmit`)
- Frontend TypeScript: **PASS** (`npx tsc --noEmit`)
- Backend build: **PASS** (`npm run build`)
- Frontend build: **PASS** (`npm run build`)
- Existing emergency tests: **PASS**, 22/22 (`npm run test:emergency`)
- `git diff --check`: **PASS**
- Frontend tests: **NOT RUN**; no configured frontend test script.
- Focused relief authorization/transition/audit tests: **NOT RUN**.
- Authenticated relief E2E: **NOT RUN**; migration unapplied/fixtures absent.

## 12. Known issues / warnings / blockers

### BLOCKERS

- Migration is unapplied.
- Full PostgreSQL catalog verification needs a direct read-only SQL connection.
- Focused relief security and authenticated E2E tests remain outstanding.

### WARNINGS

- Migration assumes the existing table; index statements are not table-guarded.
- `Completed` remains for legacy compatibility outside this state machine.
- Opposite review fields are ignored/cleared when an explicit action is sent.
- PostgreSQL `time` may serialize with seconds while HTML inputs use `HH:MM`.
- Queue endpoint has no pagination.

### NONE

No unrelated application modules, production data, migrations, or sibling
repositories were changed.

## 13. Next agent instructions

1. Read this file and inspect `git status`.
2. Preserve all listed feature files and unrelated QR work.
3. Obtain direct read-only PostgreSQL catalog metadata.
4. Review migration assumptions and the index caveat.
5. Apply migration only after explicit approval; keep applied status NO until then.
6. Add focused isolation, transition, duplicate-action, required-field, and
   audit tests; then run authenticated E2E checks.
7. Re-run checks and confirm emergency, QR, AI, auth, and distribution flows.
8. Do not commit, push, or modify sibling repositories.
