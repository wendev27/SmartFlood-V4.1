# Emergency reports: existing-schema integration

The dashboard now reads existing resident reports and performs barangay status updates against the supplied eight-column table. No migration is required. No table, bucket, user, resident, barangay, or live sample record was created. No live report was advanced during testing.

## Source of truth and compatibility

The supplied schema confirms UUID `id`, UUID `user_id` referencing `residents_v3.resident_id`, location (3–300 characters), optional description (1–2000 characters), 1–5 stored image paths, status and created/updated timestamps. The database constraint retains `Pending`, `En Route`, `On Scene`, `Resolved`, `Rejected`, and `Cancelled`.

| Database | API | REY presentation |
| --- | --- | --- |
| Pending | pending | Pending |
| En Route | en_route | En Route |
| On Scene | arrived | Arrived |
| Resolved | resolved | Resolved / Emergency History |

Rejected/Cancelled rows remain unchanged and are excluded from this active/resolved UI. Arrival writes use `On Scene`; the API uses lowercase `arrived` and the UI displays Arrived. The archived `emergency-lifecycle-draft.DO-NOT-APPLY.sql` is an obsolete proposal, moved OUT of `supabase/migrations` to prevent accidental application. It is not required by this integration and must not be executed.

The existing private `emergency-report-images` bucket retains its current configuration and policies. Policy/trigger/index definitions were not supplied or fully exposed by PostgREST; this implementation makes no claim to have changed or audited direct mobile Supabase access.

## Authorization and data flow

Existing REY presentation → `useEmergencyReports` → frontend `emergencyIncidentService` → `/api/emergency-reports` handlers → existing dashboard session + incident service → repository → existing Supabase table/resident relationship/storage.

Dashboard authentication continues to verify the existing signed HttpOnly cookie and active `app_users` record. Only an assigned barangay account can use the new dashboard routes. Reads join `residents_v3!inner` and filter the resident's barangay server-side. Barangay IDs supplied by clients cannot expand access. Detail/photo requests outside scope return 404. Status writes first resolve the scoped row and then predicate the UPDATE on report ID, resident ID and the expected stored status. No client-selected identity or barangay is trusted.

Scope follows the resident's current registry assignment because there is no report-level barangay column. This preserves the existing model. Concurrent administrative reassignment between the scope read and status write is not transactionally locked; historical report assignment or atomic reassignment handling would require a separately reviewed DB operation/schema change.

Allowed stored dashboard changes are Pending → En Route → On Scene (displayed as Arrived). Responses are mapped from persisted database rows, not optimistic React updates. `updated_at` is persisted; dedicated transition timestamp columns do not exist. Arrived stays active. Existing Resolved records appear in history without asserting that resident confirmation/feedback was recorded.

## API contracts

All JSON responses use `{ success: true, data: T }` or `{ success: false, error: string }`. Data/photo responses use private/no-store caching. Definitions are in backend and frontend `src/types/emergencyIncident.ts`.

| Method and path | Request | Result |
| --- | --- | --- |
| GET `/api/emergency-reports` | `status?`, `search?`, `page?`, `limit?`, `barangay_id?` | `{ reports, counts, pagination }` |
| GET `/api/emergency-reports/:id` | UUID | One report |
| PATCH `/api/emergency-reports/:id/status` | `{ status: "en_route" \| "arrived" }` | Persisted report; DB writes En Route / On Scene |
| GET `/api/emergency-reports/:id/photos/:index` | UUID and zero-based index 0–4 | Authorized image bytes |
| POST `/api/emergency-reports` | Multipart location, optional description, repeated photos | Reserved foundation; resident authentication still unavailable |
| POST `/api/emergency-reports/:id/feedback` | `{ confirmed: true, feedback?: string \| null, rating?: number }` | Unavailable until existing mobile identity and feedback schema are integrated |

Report DTO:

```ts
interface EmergencyIncident {
  id: string; user_id: string; barangay_id: number; // barangay derived from resident
  location: string; description: string | null; image_paths: string[];
  status: 'pending' | 'en_route' | 'arrived' | 'resolved';
  created_at: string; updated_at: string;
  en_route_at: string | null; arrived_at: string | null; resolved_at: string | null;
  resident_confirmed: boolean | null; feedback: string | null; rating: number | null;
  resident: { resident_id: string; name: string; phone: string | null };
}
```

Missing lifecycle/confirmation/feedback fields are explicitly null. They are never synthesized from `updated_at` or Resolved status. Name/phone are joined, not copied into reports. The frontend displays timestamps in Asia/Manila and maps indexed authenticated photo routes into the carousel.

`counts` contains pending/en_route/arrived/resolved numbers for the server scope and search, independent of selected tab. `pagination` contains `page`, `limit`, `total`, `total_pages`; defaults are page 1 / limit 7, max limit 50. Search is a case-insensitive literal substring over report ID, location, description, resident name and phone. `active` excludes resolved. Unknown/duplicate parameters are rejected; an explicit barangay filter must match the caller. The repository pages through all server-scoped rows in chunks of 500 before calculating search/count/pagination; it does not truncate at the Supabase response limit. This avoids a schema/RPC dependency but has cost proportional to the barangay's report count. Multiple fetches are not a single database snapshot during concurrent submissions; a future high-volume optimization should move aggregation into a reviewed scoped SQL query.

Frontend reloads on tab/search/page changes, after persisted updates, window focus, and every 30 seconds while a report view is open. Detail reads refresh the selected modal. Failed/stale requests do not fabricate success. Invalid transitions return 409. Request validation errors use 400/415/413; absent authentication 401; unsupported roles 403; inaccessible records 404; missing capabilities/database availability 503.

## Remaining lifecycle boundary

The supplied schema still does not identify the mobile login → resident relationship or provide feedback, rating, resident confirmation, or resolution timestamp storage. The configured project Auth listing returned no users during inspection. Resident UUIDs must not be guessed from dashboard accounts, phone numbers, request bodies or unverified tokens. Production Authorization-bearing requests fail closed; the UI does not offer barangay resolution. The production repository explicitly rejects attempts to persist unsupported feedback fields.

Before extending the resident lifecycle, supply the current mobile authentication/mapping code and catalog/policy definitions. Reuse that identity and preserve all existing resolved rows with unknown historical confirmation metadata. The pre-existing mobile writer and its current policies remain untouched.

## Verification

- 22 backend service/HTTP/repository tests, including production-repository eight-column updates, On Scene writes and Arrived presentation, foreign-scope rejection and explicit feedback unavailability. Some earlier domain tests use test-only repository doubles to verify prospective resident rules; they are not proof that resident authentication/feedback is live.
- 5 isolated PostgreSQL tests against the supplied eight-column schema: existing rows, On Scene persistence, scoped access, preservation of Resolved records, and existing arrival reads. No migration applied. Local fixtures only; temporary database dropped afterward.
- 19 frontend presentation tests, including adapter/unknown-confirmation handling.
- Live read-only repository checks: Tañong 0 reports; Catmon 5; Potrero 2 (one resolved). Correct scoping, foreign-scope 404s, and actual photo byte retrieval verified. Counts are a point-in-time snapshot, not application constants.
- Browser connection unavailable; rendered screenshot parity and interactive browser verification are not claimed. Existing REY CSS/layout retained.
- Backend and frontend TypeScript checks and production builds passed. Sandbox child-process output capture initially broke Next.js --showConfig parsing; both builds passed outside that sandbox. The existing multiple-lockfile warning remains. Build-generated next-env.d.ts edits were restored.

## Files involved

Backend foundation files (from the ongoing implementation):

- `Backend/api/package.json` (test commands)
- `Backend/api/next.config.ts` (multipart buffer)
- `Backend/api/src/types/emergencyIncident.ts`
- `Backend/api/src/lib/emergencyIncidentAuth.ts`
- `Backend/api/src/lib/emergencyIncidentHttp.ts`
- `Backend/api/src/lib/emergencyIncidentRepository.ts`
- `Backend/api/src/lib/emergencyIncidentRules.ts`
- `Backend/api/src/lib/emergencyIncidentService.ts`
- `Backend/api/src/app/api/emergency-reports/route.ts`
- `Backend/api/src/app/api/emergency-reports/[id]/route.ts`
- `Backend/api/src/app/api/emergency-reports/[id]/status/route.ts`
- `Backend/api/src/app/api/emergency-reports/[id]/feedback/route.ts`
- `Backend/api/src/app/api/emergency-reports/[id]/photos/[index]/route.ts`
- `Backend/api/scripts/inspect-emergency-schema.sql`
- `Backend/api/tests/emergency-incidents.test.cjs`
- `Backend/api/tests/emergency-incidents.postgres.test.cjs`
- `Backend/api/docs/EMERGENCY_REPORTS.md`
- `Backend/api/docs/emergency-lifecycle-draft.DO-NOT-APPLY.sql` (archived obsolete proposal)

Frontend integration:

- `Frontend/src/components/emergency/EmergencyReportPanel/EmergencyReportPanel.tsx`
- `Frontend/src/components/emergency/EmergencyReportPanel/useEmergencyReports.ts`
- `Frontend/src/services/emergencyIncidentService.ts`
- `Frontend/src/types/emergencyIncident.ts`
- `Frontend/src/adapters/emergencyIncidentPresentation.ts`
- `Frontend/tests/presentation.test.cjs`

No existing auth/RBAC helper, relief API/service, AI module, environment file, or live database/storage policy changed. No dependencies installed and no commit/push performed. The user's staged root lockfile remains untouched. New authorization behavior still requires human review before deployment.

## Status rename reverted

The requested database rename has been reverted. The backend writes `On Scene`, the API sends `arrived`, and the REY screen displays **Arrived**. The rename migration was removed from `supabase/migrations`; do not run the previously provided rename SQL. No live database rollback is needed for the original constraint that rejected Arrived.

Files changed for this revert: `Backend/api/src/lib/emergencyIncidentRepository.ts`, both backend emergency test files, this document, the comment in `Frontend/src/types/emergencyIncident.ts`, and removal of `supabase/migrations/20260907010000_rename_emergency_on_scene_to_arrived.sql`.
