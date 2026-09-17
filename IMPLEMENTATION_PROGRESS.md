# Resident Relief Request Workflow — Implementation Handoff

## System Logs UI — APPLIED — 2026-09-10

- **STATUS:** `SYSTEM LOGS UI APPLIED`
- **Files modified:** `Frontend/src/components/logs/SystemLogs/SystemLogs.tsx`, `Frontend/src/components/logs/SystemLogs/SystemLogs.module.css`, and this document.
- Applied the native five-column System Logs table blueprint with fixed widths, responsive CSS-grid toolbar, ellipsis handling, action badges, and the blue Log Details modal header.
- Preserved the existing `useQuery`, `getAuditLogs`, filtering/pagination state, shared `Modal` import, and `setPreviewLog(log)` Preview trigger.
- Implemented the modal payload as a two-column definition-list grid with a full-width Description field and metadata section.
- Validation: `npx tsc --noEmit --incremental false` passed. `git diff` could not run because the workspace is not initialized as a Git repository; source invariants were verified directly.

## Account Management UI — APPLIED — 2026-09-10

- **STATUS:** `ACCOUNT MGMT UI APPLIED`
- **Files modified and styled:** `Frontend/src/components/logs/AccountManagement/AccountManagement.tsx`, `Frontend/src/components/logs/AccountManagement/AccountManagement.module.css`, and this document.
- Updated the Account Management toolbar to use the blueprint’s search, department/role/status filters, Export action, and Add New action while retaining the existing account data mapping.
- Preserved all existing `useQuery`, `useEffect`, state variables, pagination calculations, API endpoints, mutation handlers, and modal workflows. The export action only serializes the already-filtered `displayedUsers` array in the browser.
- `DataTable.tsx`, `DataTable.module.css`, and `Pagination` were inspected but did not require changes; the existing components support the requested layout.
- Validation: `npx tsc --noEmit --incremental false` passed.

## UI Design Audit — READ-ONLY COMPARISON — 2026-09-10

- **Purpose:** Perform 100% READ-ONLY frontend design audit comparing reference repository `SmartFlood-V3.2rey` against target `SmartFlood-V3.2`
- **Reference:** `SmartFlood-V3.2rey` is the DESIGN SOURCE OF TRUTH for fonts, colors, text labels, navigation naming, and modal styling
- **Scope:** READ-ONLY inspection of `Frontend/` and styling configurations in both repositories
- **Output:** Created comprehensive `UI_AUDIT_REPORT.md` documenting all design differences
- **Key Findings:**
  - 8 navigation label/text differences identified across user roles
  - 2 accessibility improvements in V3.2 (not in reference design)
  - 1 additional provider component in reference (CampaignQrTokenProvider - missing in V3.2)
  - 1 enhanced sidebar profile dropdown in V3.2 (not in reference)
  - 2 additional page copy entries in reference (weatherForecast, notifications - missing in V3.2)
  - Core design tokens (colors, fonts, shadows) are IDENTICAL between repositories
  - Modal and button components are IDENTICAL between repositories
  - Module and stat cards are IDENTICAL between repositories
- **Files Created:** `UI_AUDIT_REPORT.md` (comprehensive 420-line audit report)
- **Files Modified:** `IMPLEMENTATION_PROGRESS.md` (this entry)
- **Validation:** READ-ONLY inspection only - no code changes, no modifications, no database changes
- **Next Steps:** Review audit report with stakeholders to determine alignment strategy
- **Status:** COMPLETED - Audit report available for review

## Resident Relief Request Endorsement — FRONTEND HIDDEN — 2026-09-09

- Intentionally removed the Resident Relief Request Endorsement entries from
  the rendered CSWDD and Barangay Relief Management module grids.
- The underlying frontend component/view and backend/API remain intact; no
  database or migration changes were made.
- AI-Optimized Relief Recommendation, Recommendation History, and Relief
  Distribution List remain visible in the CSWDD Relief Management grid. The
  other Barangay Relief Management entries remain visible.
- Files changed: `Frontend/src/components/relief/ReliefPanel/ReliefPanel.tsx`,
  `Frontend/src/components/relief/BarangayReliefPanel/BarangayReliefPanel.tsx`,
  and this document.
- Validation: frontend TypeScript passed; presentation tests passed (19/19);
  frontend production build passed; `git diff --check` passed. The existing
  `relief-feedback.test.cjs` remains unchanged and has one pre-existing
  harness expectation mismatch because the component supplies its optional
  `barangayScope` argument.

## FRONTEND TERMINOLOGY AUDIT — 2026-09-08

- Reference note: `SmartFlood Modules.docx` was not present inside `SmartFlood-V3.2`; the approved terminology specification supplied in the task was used as the source of truth.
- MUST CHANGE: `Emergency History` -> `Emergency Report History` in `Frontend/src/components/emergency/EmergencyReportPanel/EmergencyReportPanel.tsx`.
- MUST CHANGE: `Alert Level` -> `Alert Level Management` in `Frontend/src/components/monitoring/MonitoringPanel/MonitoringPanel.tsx`.
- MUST CHANGE: `Flood Monitoring Management` -> `Flood Monitoring Module` in `Frontend/src/data/pageCopy.ts`.
- MUST CHANGE: `Sensor history records` -> `Flood history records` in the web Flood History empty state in `Frontend/src/components/monitoring/MonitoringPanel/MonitoringPanel.tsx`; the mobile Sensor History terminology remains unchanged.
- ALREADY CORRECT: visible `CDRRMO Command Center`, CSWDD group (`Relief Management`, `Resident Information`), Barangay groups, `Flood Heatmap`, `Flood History`, `System Logs`, `Relief Distribution List`, `Distribution History`, `Resident Relief Request Endorsement`, and the PAGASA/DOST URL.
- DO NOT CHANGE: `Sensor History` wording where it represents the mobile concept; hidden web navigation entries for Sensor History, Relief Audit Reports, and Emergency Relief Management; role enum labels such as `Super Admin`; current CSWDD feedback-only workflow; and context-specific Relief Management wording.
- Files changed for this audit: `Frontend/src/components/emergency/EmergencyReportPanel/EmergencyReportPanel.tsx`, `Frontend/src/components/monitoring/MonitoringPanel/MonitoringPanel.tsx`, `Frontend/src/data/pageCopy.ts`, and this document. No backend, API, auth, RBAC, database, service, or business logic changes were made.
- Validation: frontend TypeScript passed; presentation tests passed (19/19); weather tests passed (6/6); frontend production build passed; `git diff --check` passed. The presentation expectation for the corrected `Emergency Report History` wording was updated.

## RELIEF ALLOCATION NOTIFICATION CONTEXTUAL RBAC FIX — 2026-09-08

- Root cause: `DashboardPage` passed the selected Barangay scope into `BarangayReliefPanel`, but the panel dropped it when rendering `EmergencyNotificationsPanel`. The service therefore called the global `/api/emergency/notifications` request, and the Super Admin contextual view received all notifications.
- Frontend fix: `BarangayReliefPanel` now passes `barangayScope` to the allocation inbox. `EmergencyNotificationsPanel` resolves that existing context with `barangayIdForName()`, requests the optional `barangay_id`, and uses a scoped React Query key so Tanong/Catmon/Potrero results cannot be reused across contexts. The existing global notification key remains unchanged.
- Backend fix: `GET /api/emergency/notifications` keeps authenticated Barangay users bound to `assignedBarangayForUser(viewer)`. For existing Super Admin/CSWDD admin views, an optional selected `barangay_id` is accepted only after validating it against the existing `barangays.barangay_id` table, then filters `notifications.target_barangay_id`. Missing scope preserves global admin visibility; malformed/nonexistent scopes are rejected.
- Existing notification detail/action protections remain server-side. The list is the only detail source for View Allocation; read/accept/reject/receipt actions retain their existing item/notification Barangay checks. Emergency Report Management was not modified and was used only as an RBAC reference.
- Files changed for this fix: `Frontend/src/components/relief/BarangayReliefPanel/BarangayReliefPanel.tsx`, `Frontend/src/components/emergency/EmergencyNotificationsPanel/EmergencyNotificationsPanel.tsx`, `Frontend/src/services/emergencyService.ts`, `Frontend/src/lib/queryKeys.ts`, `Backend/api/src/app/api/emergency/notifications/route.ts`, `Backend/api/tests/emergency-notifications.test.cjs`, and this document.
- Database: existing `notifications.target_barangay_id`, `emergency_allocation_items.barangay_id`, and `barangays.barangay_id` relationships reused. No schema change, migration, or production data modification.
- Validation: focused notification RBAC tests passed (4/4); relief tests passed (9/9); emergency tests passed (22/22); frontend presentation tests passed (19/19); backend/frontend TypeScript passed; backend/frontend production builds passed; `git diff --check` passed.

## RELIEF ALLOCATION NOTIFICATION RBAC — VERIFIED 2026-09-08

- Investigation traced `BarangayReliefPanel` -> `EmergencyNotificationsPanel` -> `getEmergencyNotifications()` -> `GET /api/emergency/notifications`.
- The existing backend already enforces the required Barangay boundary with `getDashboardViewer()`, `dashboardViewerRole()`, `assignedBarangayForUser()`, and `notifications.target_barangay_id`. Barangay users receive only notifications for their authenticated assigned Barangay; CSWDD and Super retain existing global visibility.
- Allocation details are attached server-side from `emergency_allocation_items` using notification source IDs. The frontend View Allocation modal does not perform a separate unscoped fetch.
- Barangay read, accept, reject, and receipt-confirmation endpoints independently validate the authenticated assignment against `target_barangay_id` or `emergency_allocation_items.barangay_id`. Client-supplied role or Barangay scope is not trusted.
- No production code change was necessary because the requested server-side filter and action checks are already present in the current tree. Emergency Report Management was inspected only as a reference and was not modified. Allocation generation, quantities, statuses, database schema, migrations, and production data were untouched.
- Existing validation passed: focused relief tests 9/9, emergency RBAC tests 22/22, frontend presentation tests 19/19, backend/frontend TypeScript, backend/frontend production builds, and `git diff --check`.
- Remaining limitation: no live authenticated database/browser session was available in this environment, so the reported multi-Barangay display could not be reproduced against production data. If it persists, capture the actual `GET /api/emergency/notifications` response and authenticated viewer role; the current source should return a server-filtered list.

## RELIEF MANAGEMENT RBAC FIX — VERIFIED 2026-09-08

- Root cause addressed in the current implementation: Barangay relief list scope is derived server-side from `assignedBarangayForUser(viewer)`, while CSWDD retains its existing all-barangay status-filtered queue. Client-supplied `barangay_id` cannot override the Barangay branch.
- Reference implementation: Emergency Report Management uses `getDashboardViewer()`, `dashboardViewerRole()`, and `assignedBarangayForUser()`; Relief Management uses the same authenticated viewer/scope helpers without modifying Emergency Report Management.
- Existing API and database relationship: `GET /api/relief-requests` queries `relief_requests` joined to `residents_v3` and filters `residents_v3.barangay_id` for Barangay users. No schema, migration, or production data change was made.
- Detail security: `getReliefRequest()` applies `assertRequestScope()` so a Barangay user cannot read another Barangay request by ID. Endorsement calls the same scoped detail path and preserves `Pending -> Endorsed`.
- CSWDD behavior: city-wide visibility remains limited to the existing Endorsed/Approved/Rejected workflow. Super Admin keeps the existing global convention.
- Files changed for this verification: `Backend/api/tests/relief-requests.test.cjs` and this document. Emergency Report Management, Resident Information, authentication, AI, QR, notifications, allocation/distribution, and database files were intentionally untouched.
- Validation: focused relief tests passed (9/9, including the client-supplied scope assertion); emergency tests passed (22/22); frontend presentation tests passed (19/19); backend/frontend TypeScript passed; backend/frontend production builds passed; `git diff --check` passed.

## Super Admin CSWDD navigation correction — 2026-09-08

- Changed `Frontend/src/adapters/navigationPresentation.ts` so the Super Admin CSWDD group contains the existing `relief` and `residents` navigation items only.
- Old CSWDD structure: Relief Management (`relief`), Emergency Relief Management (`reliefManagement`), and the hidden/filtered emergency destination.
- New CSWDD structure: Relief Management (`relief`) and Resident Information (`residents`).
- Resident Information reuses the existing `#residents` dashboard route and `ResidentsPanel`; CSWDD does not use Barangay-specific scope or routing. CSWDD Relief Management continues to reuse `ReliefPanel`, including its Resident Relief Request Endorsement workflow.
- Barangay navigation groups and their Relief Management, Emergency Report Management, Resident Information, and account modules were not changed.
- Validation: frontend TypeScript, presentation tests, production build, and `git diff --check` are pending for this correction.

## CSWDD Resident Information data-fetch correction — 2026-09-08

- Root cause: the shared Super Admin sidebar handler tagged every navigation group as `{ role: "barangay", label: group.label }`. CSWDD Resident Information therefore passed `barangayScope="CSWDD"` into `ResidentsPanel`; the global API response was then removed by the frontend Barangay-name filter, producing zero residents and families.
- Changed `Frontend/src/components/layout/Sidebar/Sidebar.tsx` so only groups whose labels start with `Barangay ` receive `AdminViewContext`. CSWDD navigation now passes no Barangay scope and uses the existing city-wide resident fetch.
- Existing API reused: `/api/residents` and `/api/families`. Existing database tables reused: `residents_v3` and `families`, scoped by their existing `barangay_id` columns. No migration or data change was required.
- Authorization remains server-side: Barangay requests use `assignedBarangayForUser(viewer)` regardless of client query parameters; CSWDD requests remain unfiltered across eligible records; Super/CDRRMO behavior follows the existing role branch.
- Barangay Tanong/Catmon/Potrero navigation continues to pass its selected Barangay context and remains isolated. CSWDD uses the existing `ResidentsPanel` and `#residents` route without Barangay-specific filtering.
- Files changed for this correction: `Frontend/src/components/layout/Sidebar/Sidebar.tsx` and this document. AI, QR, relief workflow, emergency allocation/distribution, notifications, authentication, database schema, and production data were intentionally untouched.
- Validation: frontend/backend TypeScript passed; frontend/backend production builds passed; frontend presentation tests passed (19/19); relief tests passed (9/9); emergency tests passed (22/22); `git diff --check` passed.

## Super Admin Barangay scope correction — 2026-09-08

- Reused the existing Barangay navigation groups, `BarangayReliefPanel`, `ReliefEndorsement`, `barangayIdForName`, and emergency-report `barangay_id` request contract.
- Super Admin group selection now persists when opening Emergency Report Management, so the existing `EmergencyReportPanel` receives the selected Barangay scope.
- Relief endorsement receives the same selected scope and requests `/api/relief-requests?barangay_id=...`; Super Admin detail review requests carry the same scope.
- Backend relief queries scope Super Admin selected views through the existing `relief_requests -> residents_v3.barangay_id` relationship. Barangay users still derive scope only from their authenticated assignment.
- Emergency report backend scope remains server-enforced by `emergencyIncidentAuth` and `emergencyIncidentRepository`, which filter through `resident.barangay_id`; the selected query scope is required for Super Admin report views.
- Files changed: `Frontend/src/app/dashboard/page.tsx`, `Frontend/src/components/layout/Sidebar/Sidebar.tsx`, `Frontend/src/components/relief/BarangayReliefPanel/BarangayReliefPanel.tsx`, `Frontend/src/components/relief/ReliefEndorsement/ReliefEndorsement.tsx`, `Frontend/src/services/reliefService.ts`, `Backend/api/src/lib/reliefRequests.ts`, `Backend/api/src/app/api/relief-requests/route.ts`, `Backend/api/src/app/api/relief-requests/[id]/review/route.ts`, `Backend/api/tests/relief-requests.test.cjs`, and this document.
- No database/authentication architecture, migration, production data, CSWDD workflow, AI, QR, notification, allocation, or distribution logic was changed.
- Validation is pending for this correction: run focused TypeScript/tests, production builds, and `git diff --check`; authenticated Tanong/Catmon/Potrero browser verification remains required.

## Barangay isolation hardening — 2026-09-08

- Investigation found the existing list query already scopes Barangay users
  through `residents_v3.barangay_id`, and detail/endorsement checks already
  reject requests outside the authenticated assignment. The remaining
  defense-in-depth gap was that the endorsement update itself matched only
  request ID and `Pending` status.
- Added the authenticated request `user_id` predicate to the endorsement
  update and enforced the Barangay role inside the service, in addition to the
  route guard. CSWDD list/detail/review behavior remains city-wide.
- Expanded `Backend/api/tests/relief-requests.test.cjs` with Tanong/Catmon list
  isolation, cross-Barangay detail/endorsement rejection, Catmon endorsement,
  CSWDD multi-Barangay access, and non-Barangay endorsement rejection cases.
- Exact files changed for this correction: `Backend/api/src/lib/reliefRequests.ts`,
  `Backend/api/tests/relief-requests.test.cjs`, and this handoff document.
- No migration was created or applied, no production data was changed, and no
  frontend/UI changes were made for this security correction.
- Focused relief tests pass (8/8), Backend TypeScript passes, Frontend
  TypeScript passes, emergency regressions pass (22/22), frontend presentation
  tests pass (19/19), frontend relief tests pass (3/3), both production builds
  pass, and `git diff --check` passes.

## CSWDD sidebar correction — 2026-09-08

- Removed only `reliefManagement` from the existing `role === 'cswdd'` branch
  of `navigationItemsForRole`. Welfare Admin/CSWDD retains Home, Flood Monitoring,
  Relief Management, Resident Information, and CSWDD System Logs.
- Emergency Relief Management still exists; its pages/routes and Super Admin
  navigation remain unchanged. No new roles or authorization logic were added.
- Updated existing presentation expectations. Frontend TypeScript passed
  (`npx tsc --noEmit --incremental false`); presentation tests passed (19/19);
  `git diff --check` passed.
- Frontend production build attempted twice: compilation succeeded, but Next.js
  failed with `Could not parse output from TypeScript's --showConfig.` Direct
  `tsc --showConfig` produced valid JSON. Build remains unverified; tooling was
  not changed for this navigation correction.
- Restored build-generated next-env changes. No backend, database, migration,
  authentication, module/page, or unrelated navigation changes in this follow-up.
  Earlier authorized backend changes remain in the working tree unchanged.
- Files changed in this follow-up: `Frontend/src/data/navigation.ts`,
  `Frontend/tests/presentation.test.cjs`, and `IMPLEMENTATION_PROGRESS.md`.
  No commit or push.
- Sensor History navigation entries are now removed globally from the shared
  and role-specific navigation definitions. The Sensor History route,
  component, services, and sensor functionality remain intact. No backend,
  database, or migration changes were made for this correction.
- Validation: Frontend TypeScript passed, presentation tests passed (19/19),
  production build passed, and `git diff --check` passed. Files changed for
  this correction: `Frontend/src/data/navigation.ts`,
  `Frontend/tests/presentation.test.cjs`, and this handoff document.
- CSWDD navigation now retains only `relief` among its relief modules;
  `Emergency Relief Management` and `Relief Audit Reports` remain implemented
  but are hidden from the CSWDD sidebar. Barangay navigation and its separate
  relief/report modules are unchanged. Sensor History remains globally hidden.
- CSWDD correction validation: Frontend TypeScript passed, presentation tests
  passed (19/19), production build passed, and `git diff --check` passed.
- Super Admin CSWDD group now hides `Relief Audit Reports` while retaining
  `Relief Management` and `Emergency Relief Management`; Barangay report
  navigation and the underlying audit module remain unchanged.

## Final corrections update — 2026-09-08

This update supersedes the historical implementation details below.

- Backend access authorized for the feedback correction.
- Workflow: Pending → Barangay endorsement → Endorsed → CSWDD feedback.
  Feedback preserves Endorsed status. The request detail displays saved feedback
  and its timestamp. Approval/rejection and release inputs are removed.
- Existing POST review route now accepts `action: "feedback"` and nonempty string
  `rejection_feedback`. Old approve/reject actions return 400; the frontend caller
  was updated together with the backend. Response envelope remains unchanged.
- Existing authenticated dashboard viewer and CSWDD/Super role checks remain.
  Reviewer identity is server-derived. Client identity/role/barangay fields cannot
  override it. Existing Barangay scope and endorsement behavior remain unchanged.
- Reuses `rejection_feedback`, `reviewed_by`, and `reviewed_at`. Conditional updates
  require Endorsed and unset review fields, so duplicate/concurrent submissions
  cannot overwrite saved feedback. Existing review data is read-only in this UI.
- Feedback audit action is `RELIEF_REQUEST_FEEDBACK_PROVIDED`, with the trusted
  actor, request ID, and request barangay. Existing audit logger is preserved.
- No schema change needed, migration created/applied/rerun, or production data
  changed. Existing migration is already applied per user; live schema was not
  independently rechecked. Legacy columns/statuses remain intact.
- Earlier UI corrections retained: CDRRMO Command Center sidebar/profile label;
  Sensor History hidden across role navigation; Relief Audit Reports hidden;
  Emergency Relief Management retained; PAGASA source restored from `efd6130`
  using existing CSS and exact URL `https://www.pagasa.dost.gov.ph/`.
- PASS: backend and frontend `npx tsc --noEmit --incremental false`.
- PASS: backend and frontend `npm run build` (compiled successfully).
- PASS: 6 backend feedback tests (`node tests/relief-requests.test.cjs`),
  22 existing backend emergency tests (`npm run test:emergency`),
  3 frontend feedback tests (`node tests/relief-feedback.test.cjs`), and both
  existing frontend presentation/weather test files (`node --test
tests/presentation.test.cjs tests/weather.test.cjs`).
- PASS: `git diff --check`. Complete tracked diff and new test files reviewed.
  Generated next-env changes restored; existing multiple-lockfile build warning
  remains. No dependency or lint tooling changes.
- Verification limit: tests use in-memory database/session fixtures and rendered
  components. Live PostgreSQL concurrency, authenticated browser/E2E workflows,
  and production audit persistence were not exercised. Human acceptance testing
  of the authenticated flow remains before claiming production readiness.
- No QR, AI, authentication/session architecture, emergency allocation/distribution,
  notifications, migration, mobile, or sensor-logic changes. No commit or push.

Files changed across this task:

- Backend/api/src/lib/reliefRequests.ts
- Backend/api/src/app/api/relief-requests/[id]/review/route.ts
- Backend/api/tests/relief-requests.test.cjs (new)
- Frontend/src/components/relief/ReliefEndorsement/ReliefEndorsement.tsx
- Frontend/src/components/layout/Sidebar/Sidebar.tsx
- Frontend/src/components/monitoring/MonitoringPanel/MonitoringPanel.tsx
- Frontend/src/data/navigation.ts
- Frontend/tests/presentation.test.cjs
- Frontend/tests/relief-feedback.test.cjs (new)
- IMPLEMENTATION_PROGRESS.md

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

| Role         | View                       | Endorse         | Approve       | Reject        |
| ------------ | -------------------------- | --------------- | ------------- | ------------- |
| Barangay     | Own assigned barangay      | Own Pending     | No            | No            |
| CSWDD        | All endorsed/processed     | No              | Endorsed only | Endorsed only |
| Super        | All under service behavior | No route access | Yes           | Yes           |
| CDRRMO/other | No                         | No              | No            | No            |

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

## Dynamic Resident Age — Step 1

- **Files:** Added `supabase/migrations/20260917000000_add_resident_birth_date.sql`,
  `Backend/api/src/lib/dateUtils.ts`, and
  `Backend/api/tests/date-utils.test.mjs`; updated
  `Backend/api/src/lib/residentPayload.ts` and
  `Backend/api/src/app/api/residents/route.ts`.
- **Migration:** Adds nullable `residents_v3.birth_date` with
  `ADD COLUMN IF NOT EXISTS`; the migration was subsequently applied and live
  verification reports 53 residents, 31 with DOB, and 22 still NULL.
- **Persistence:** The shared `pickResidentPayload` allowlist now includes
  `birth_date`, so the existing family-head and non-family-head approval
  inserts carry `resident_applications.birth_date` into `residents_v3`.
- **Utility:** `Backend/api/src/lib/dateUtils.ts` provides
  `calculateCurrentAge` using the current `Asia/Manila` calendar date and
  birthday-boundary-safe calculation.
- **Backfill:** The migration safely backfills exact approved
  `application_id` matches with non-null source DOBs. Read-only inspection
  identified 31 eligible rows; live verification confirms 22 remain NULL
  because they lack a usable application/DOB relationship.
- **Limitations:** Legacy `age` remains unchanged; no classifications,
  family aggregates, AI/AHP logic, pregnancy/lactation logic, UI behavior,
  authentication, or RBAC were changed. See
  `docs/DYNAMIC_RESIDENT_AGE_STEP1.md` for the implementation handoff.
- **Tests:** Focused date utility tests passed 3/3; backend and frontend
  TypeScript checks passed; existing emergency tests passed 22/22; both
  production builds passed; `git diff --check` passed.
- **Next step:** Review and explicitly approve any future wiring of dynamic age
  into resident displays or classifications; do not infer DOB for unmatched
  legacy rows.

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

## Dynamic Resident Age — Step 2

- **Files:** Added `Backend/api/src/lib/residentPayload.ts` response helper
  usage through the resident list/create and resident update/deactivate API
  routes, added focused coverage to
  `Backend/api/tests/date-utils.test.mjs`, and created
  `docs/DYNAMIC_RESIDENT_AGE_STEP2.md`.
- **Authoritative path:** When `residents_v3.birth_date` exists, resident API
  responses now calculate `age` through `calculateCurrentAge()` using the
  server-side `Asia/Manila` calendar date. Responses include
  `age_source: "birth_date"` to make the source explicit.
- **NULL DOB:** When `birth_date` is NULL/empty, the existing stored `age` is
  retained only as a compatibility fallback and responses include
  `age_source: "legacy"`. No DOBs were inferred and no stored ages were
  mass-updated.
- **Legacy usage:** The database column and existing resident form/update
  contract remain unchanged. The frontend already consumes the API `age`
  field, so no frontend source change was needed.
- **Deferred:** AHP weights/scoring/ILP, AI aggregation, family vulnerability
  counts, vulnerable-person classification thresholds, pregnancy/lactation,
  PWD, 4Ps, authentication, RBAC, RLS, application workflow, QR/campaign,
  relief, and unrelated frontend features were intentionally untouched.
- **Validation:** Backend/frontend TypeScript checks passed; focused age tests
  passed 5/5; emergency tests passed 22/22; backend/frontend production builds
  passed; `git diff --check` passed.
- **Limitations:** 22 legacy residents remain without DOB and therefore use
  explicitly marked legacy age in responses. Step 3 should define any
  classification-specific handling for NULL-DOB residents before changing
  demographic or AHP consumers.
- **Next step:** Design a separate, policy-reviewed classification adapter
  around the authoritative dynamic-age helper; do not modify family aggregates
  or AHP/AI logic as part of Step 2.

## Dynamic Resident Age — Step 3

- **Investigation:** No explicit infant, toddler, or elderly thresholds were
  found. Existing `elderly_count`, `infant_count`, and `toddler_count` values
  originate from family-level stored aggregates and are consumed by family
  views and the existing AI/AHP pipeline; no individual age classifier was
  found to redirect.
- **Files:** Updated `Backend/api/src/lib/dateUtils.ts` and
  `Backend/api/tests/date-utils.test.mjs`; corrected the Step 2 helper location
  in `docs/DYNAMIC_RESIDENT_AGE_STEP2.md`; created
  `docs/DYNAMIC_RESIDENT_AGE_STEP3.md` and this entry. No frontend source,
  schema, family, or AI files were changed.
- **Adapter:** `classifyCurrentAge()` accepts authoritative current age plus
  an explicitly injected threshold policy and returns `infant`, `toddler`,
  `elderly`, `other`, or `unknown`. `PENDING_DEMOGRAPHIC_AGE_POLICY` contains
  no arbitrary thresholds, so unconfigured policy returns `unknown`.
- **NULL DOB:** Missing/invalid dynamic age returns `unknown` with
  `reason: "age_unavailable"`; the legacy stored `age` is never used as a
  source for new classification.
- **Unchanged:** Family aggregate counts, AHP weights/scoring/ILP, AI
  aggregation, pregnancy/lactation/PWD/4Ps, auth/RBAC/RLS, registration,
  database schema, and frontend behavior remain untouched.
- **Validation:** Focused age/classification tests passed 8/8; backend and
  frontend TypeScript checks passed; emergency tests passed 22/22; backend
  build passed; `git diff --check` passed.
- **Limitations:** Thresholds require explicit policy approval. No route or
  family/AHP integration was added, and no existing aggregate was updated.
- **Step 4 requirements:** Separately define approved thresholds and NULL-DOB
  semantics, then integrate DOB-derived demographic counts into the existing
  family/AHP pipeline with regression coverage. Do not implement that
  integration as part of Step 3.

## Dynamic Resident Age — Step 4

- **Status:** STOPPED before AHP input changes. No Step 4 production-code,
  schema, family aggregate, AI, AHP, or ILP changes were made.
- **Data model:** `families` stores family-level `total_family_members`,
  `infant_count`, `toddler_count`, and `elderly_count`; `residents_v3` rows
  linked by `family_id` do not reliably represent every household member.
  Approval copies application aggregates into `families`, while vulnerable
  member DOB/name arrays are not persisted as individual resident rows.
- **Live verification:** Read-only inspection found 53 residents and 54
  families. Eight families have no resident rows, three have declared member
  totals greater than resident-row coverage, and 17 have stored
  infant/toddler/elderly totals greater than their resident-row count. Only 30
  families have DOBs for every attached resident row.
- **Approved policy:** Infant is 0–12 months inclusive; toddler is over 12
  months and under 4 years; preschool is 4–6; child is 7–12;
  teen/adolescent is 13–17; adult is 18–59; senior citizen/elderly is 60+.
  Exactly 12 months remains infant.
- **Stop reason:** Aggregating only `residents_v3` would silently undercount
  existing vulnerable household members and could reduce AHP inputs. The 22
  NULL-DOB legacy residents prevent complete authoritative classification.
  No positional or indirect matching is acceptable.
- **AHP status:** Existing family counts, AHP weights/scoring, AI aggregation,
  and ILP remain unchanged. The integration was not partially implemented.
- **Documentation:** Created `docs/DYNAMIC_RESIDENT_AGE_STEP4.md` with the
  evidence, approved policy, stop conditions, and safe next-step design.
- **Validation:** No code changed in Step 4, so no new code test was required;
  prior Step 3 validation remains valid. Live inspection was read-only and
  `git diff --check` passed.
- **Remaining limitation:** A complete authoritative household-member model is
  required before dynamic family counts can replace or supplement stored
  aggregates.
- **Exact next step:** Establish an approved member-level representation and
  NULL-DOB preservation policy first. Then implement a separately reviewed
  adapter that derives dynamic demographic counts only where coverage is
  complete and preserves stored counts otherwise. Do not alter AHP until that
  adapter is tested.

## Dynamic Resident Age — Step 5

- **Status:** Design/investigation only. No migration, schema, backfill,
  family-count, AHP, AI, ILP, frontend, or workflow changes were made.
- **Data model:** `families` stores household-level totals and vulnerability
  aggregates. `residents_v3` stores resident/account rows linked by
  `family_id`, but does not reliably represent every household member.
  Family-head approval creates one resident and one family, then copies
  aggregate counts; non-family-head approval creates one linked resident.
- **Household-member source:** Vulnerable-member name/DOB arrays remain on
  `resident_applications` and are not persisted as individual residents.
  Parallel arrays may have mismatched lengths and have no stable member ID, so
  positional or indirect matching is unsafe.
- **Live evidence:** 53 residents, 54 families, 31 resident DOBs, and 22
  NULL DOBs; 8 families have no resident rows, 3 exceed resident-row coverage
  by declared total members, and 17 have stored infant/toddler/elderly totals
  above resident-row coverage. Only 3 of 34 applications contain non-empty
  member arrays.
- **Safe data:** Existing resident rows can be represented deterministically
  by `resident_id` and `family_id`, copying exact DOBs and preserving NULLs.
  Application-only array members are incomplete/ambiguous until a stable
  structured member identity exists.
- **Recommended model:** A proposed normalized `family_members` table with a
  family foreign key, optional resident link, application provenance, full
  name, nullable DOB, timestamps, and reviewed uniqueness/RLS rules. The table
  was not created.
- **Compatibility:** Existing family aggregates remain authoritative for current
  AHP behavior. Incomplete/unknown families must retain stored counts; no
  automatic array migration or DOB inference is allowed.
- **Future flow:** Persist structured household members after family creation,
  derive age via `calculateCurrentAge()`, classify via `classifyCurrentAge()`,
  calculate coverage-aware dynamic counts, compare with stored counts, then
  separately review AHP integration. Resident accounts must not be created for
  every household member.
- **Documentation:** Created `docs/DYNAMIC_RESIDENT_AGE_STEP5.md` with the
  model, safe/unsafe data classification, proposed schema, migration strategy,
  legacy policy, and Step 6 plan.
- **Validation:** Investigation queries were read-only; no code changed in
  Step 5, and `git diff --check` passed. No migration was created or applied.
- **Exact Step 6 recommendation:** Approve the member/account distinction,
  verify schema/FK/RLS metadata, approve a stable member-key contract, then
  implement an additive member model and coverage-preview tests before any
  AHP input change.

## Dynamic Resident Age — Step 6

- **Status:** Migration created and applied. Schema-only change; no
  backfill, live data modification, family aggregate update, AHP, AI, ILP,
  resident workflow, or frontend change.
- **Verified types:** Live Supabase OpenAPI metadata confirms UUID primary keys
  for `families.family_id`, `residents_v3.resident_id`, and
  `resident_applications.application_id`; `residents_v3.family_id` and the
  optional application/resident links are UUID-compatible. Existing timestamps
  use `timestamptz default now()`.
- **Migration:** Added
  `supabase/migrations/20260917000001_create_family_members.sql` with
  `member_id`, required `family_id`, nullable `resident_id`, nullable
  `source_application_id`, required `full_name`, nullable `birth_date`, and
  created/updated timestamps. No insert/update/backfill statements exist.
- **Foreign keys:** Family uses `ON UPDATE RESTRICT ON DELETE RESTRICT`;
  resident and application provenance use `ON UPDATE RESTRICT ON DELETE SET
  NULL` to preserve member history.
- **Indexes/constraints:** Family and provenance indexes plus a partial unique
  non-null `resident_id` index. No name/DOB uniqueness is enforced.
- **RLS/permissions:** RLS enabled; direct `public`, `anon`, and
  `authenticated` table access revoked/denied; existing `service_role` granted
  table access. Dashboard authentication/RBAC and barangay scoping remain in
  the existing server API and were not changed.
- **Deletion/account policy:** Family deletion is restricted while members
  exist; resident/application deletion preserves member rows through nullable
  links. Household members do not become resident authentication accounts.
- **Backfill:** None. Application arrays, family aggregates, legacy members,
  and inferred identities/DOBs were intentionally not migrated.
- **Future persistence:** The exact existing approval entry point for reviewed
  structured member persistence is
  `Backend/api/src/app/api/resident-applications/[id]/review/route.ts`, after
  family identification/creation. This was documented only.
- **Documentation:** Created `docs/DYNAMIC_RESIDENT_AGE_STEP6.md` covering
  schema, FKs, indexes, RLS, deletion, non-backfill, Step 7, and future counts.
- **Validation:** Backend TypeScript and production build passed; existing
  emergency tests passed 22/22; `git diff --check` passed. A focused local
  PostgreSQL schema test was added but requires `SF_TEST_PG_SOCKET` for an
  isolated `/tmp` PostgreSQL instance and was not run because no such socket
  is available; no production database was used or modified.
- **Remaining limitation:** Step 7 must separately define safe member
  population and incomplete-family coverage handling before any AHP
  integration.
- **Exact Step 7 recommendation:** Establish a stable structured household-member
  payload and idempotency key, add server-validated persistence and a read-only
  coverage preview, and do not backfill ambiguous arrays, infer DOBs, or
  replace family/AHP aggregates until complete-authority and NULL-DOB policies
  are approved and tested.

## Dynamic Resident Age — Step 7

- **Status:** Complete for structured member persistence and read-only coverage
  preview. No AHP, AI, ILP, family aggregate, resident age, or new migration
  change was made. The Step 6 migration is treated as applied in the current
  project state.
- **Files:** Added `Backend/api/src/lib/familyMembers.ts`,
  `Backend/api/src/app/api/family-members/coverage/route.ts`,
  `Backend/api/tests/family-members.test.cjs`, and
  `docs/DYNAMIC_RESIDENT_AGE_STEP7.md`; updated the existing approval route and
  this progress log. No frontend source changed.
- **Contract:** Approval accepts optional `household_members[]` entries with a
  producer-owned UUID `member_id`, trimmed 1–120 character `full_name`,
  nullable valid/non-future `birth_date`, and optional nullable `resident_id`.
  Family, barangay, provenance, reviewer, and authorization fields are not
  client-trusted.
- **Identity/idempotency:** Stable member UUIDs are reused across retries and
  map to the existing `family_members.member_id` primary key. The server sets
  family and application provenance, rejects cross-family/application UUID
  conflicts, validates resident ownership, and prevents conflicting resident
  links. Names, DOBs, and array positions are never identity keys.
- **Persistence:** Validated records persist only during approved application
  review. Family-head approval uses the newly created family ID; non-family-head
  approval first verifies the selected family and application barangay match.
  Legacy arrays and rejected applications are not persisted.
- **Authorization:** Existing `getDashboardViewer()`, role checks,
  `assignedBarangayForUser()`, and `isSameBarangayForUser()` remain the only
  dashboard authorization/scoping path. No new authentication or RBAC was
  introduced.
- **Coverage preview:** Added read-only `GET /api/family-members/coverage`.
  It reports stored totals, resident rows, family-member rows, DOB-known and
  DOB-unknown counts, explicit completeness, reasons, and aggregate totals.
  It never modifies or replaces family/AHP inputs.
- **NULL DOB:** Missing/unusable DOB is reported as unknown and cannot make a
  family complete. Existing stored resident age is not used as a dynamic
  classification fallback.
- **Database/data:** No Step 7 migration was created or applied. No backfill,
  production data change, family aggregate change, resident age change, or
  schema change was performed.
- **Validation:** Backend TypeScript passed; focused date and family-member
  tests passed; existing emergency tests passed 22/22; backend production
  build passed; `git diff --check` passed. The local PostgreSQL schema test
  remains available but was not run because no isolated `SF_TEST_PG_SOCKET` was
  available.
- **Limitations:** The current frontend does not collect structured member
  rows, so existing UI behavior is unchanged. The current approval route's
  pre-existing multi-write workflow was not redesigned as a transaction.
- **Exact Step 8 recommendation:** Review the applied member table and run the
  coverage preview, then compare dynamic age-derived counts against stored
  aggregates while preserving stored values for incomplete/NULL-DOB families.
  Only after policy review and regression testing should a separate task
  consider coverage-aware AHP input adaptation.

## Dynamic Resident Age — Step 8

- **Status:** Complete as a read-only coverage-aware comparison. No AHP, AI,
  ILP, relief allocation, family aggregate, resident age, authentication, RBAC,
  frontend, migration, or database-write behavior was changed.
- **Stored source:** The baseline columns are `families.infant_count`,
  `families.toddler_count`, and `families.elderly_count`. Existing
  `familyVulnerabilityPayload()` copies application/body vulnerability counts
  into family create/update workflows; the family and AI/AHP paths continue
  reading those stored values.
- **Dynamic source:** Only `family_members.birth_date` is used, through the
  existing `calculateCurrentAge()` and `classifyCurrentAge()` utilities. No
  stored resident age, aggregate, name, array position, or inferred DOB is
  used.
- **Policy:** Added the explicit approved life-stage policy: infant through
  exactly 12 months, toddler after 12 months and before 4 years, preschool
  4–6, child 7–12, teen 13–17, adult 18–59, and elderly 60+. The first
  birthday remains infant; the next calendar date is toddler.
- **Coverage:** Dynamic results are produced only when the declared family
  total is positive/valid, member rows exactly match it, every member DOB is
  usable, resident rows do not exceed the declared total, and no supported
  contradiction exists. Incomplete dynamic counts and differences are null.
- **Endpoint:** Extended `GET /api/family-members/coverage` additively with
  stored counts, dynamic counts, per-category differences, and complete-only
  aggregate comparison totals. Existing dashboard authentication, roles, and
  barangay scoping remain in the route.
- **Files:** Updated `Backend/api/src/lib/dateUtils.ts`,
  `Backend/api/src/lib/familyMembers.ts`, and
  `Backend/api/src/app/api/family-members/coverage/route.ts`; added
  `Backend/api/tests/family-demographic-comparison.test.cjs` and
  `docs/DYNAMIC_RESIDENT_AGE_STEP8.md`; updated this progress log. No
  frontend source changed.
- **Live read-only findings:** 55 families, 54 resident rows, 0
  `family_members` rows, 0 complete families, 47 families missing member
  rows, and 4 with contradictory resident coverage. No production rows were
  written or changed.
- **Validation:** Step 8 focused tests passed 11/11; existing Step 7 family
  member tests passed 12/12; existing date/classification tests passed 8/8;
  backend TypeScript passed. Backend build, emergency tests, and final diff
  checks remain required before handoff.
- **AHP status:** Unchanged. No dynamic values are sent to the existing AHP,
  AI, or ILP pipeline. Step 9 must first review populated member coverage and
  then separately design/test any coverage-aware AHP adapter.

## Dynamic Pregnancy Weeks

- **Model:** `family_members.pregnancy_weeks` remains the stored baseline.
  The extended, still-unapplied migration `00002` adds nullable
  `pregnancy_baseline_at timestamptz` and enforces that pregnant members have
  both values while non-pregnant members have neither.
- **Dynamic calculation:** `calculateCurrentPregnancyWeeks()` adds complete
  Asia/Manila calendar weeks since the baseline date. It returns null for
  missing, invalid, or future baselines and never caps or stores the result.
- **Writes:** Application approval uses only
  `resident_applications.submitted_at`; manual RBI member creation uses the
  server recording time. Unrelated member edits preserve the baseline
  timestamp, baseline-week changes reset it to server time, and disabling
  pregnancy clears both fields.
- **Responses/UI:** Structured member responses expose baseline weeks,
  baseline timestamp, and `current_pregnancy_weeks`. Accounts and RBI display
  code distinguishes baseline from current values. Legacy pregnancy names
  and week arrays remain separate read-only lists and are never paired.
- **Deployment state:** Migration `00002` was extended but not applied. The
  structured household-member feature flag remains disabled, so its Accounts
  and RBI panels remain hidden and issue no incompatible live-schema calls.
- **Data:** No backfill, production row update, migration application, or
  controlled synthetic approval was performed. The controlled test remains
  blocked until the migration is manually applied and the feature is restored.
- **Unchanged:** Family `pregnant_count`, AHP, AI, ILP, relief, flood logic,
  DOB/age behavior, authentication, RBAC, and barangay scoping.
