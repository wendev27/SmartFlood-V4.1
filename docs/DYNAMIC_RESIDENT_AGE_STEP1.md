# Dynamic Resident Age — Step 1

## Purpose

This step preserves the source date of birth for approved residents while
keeping the existing `residents_v3.age` column unchanged for compatibility.
It does not change resident-age classifications, family counts, AI/AHP logic,
pregnancy/lactation logic, authentication, or RBAC.

## Implemented files

- `supabase/migrations/20260917000000_add_resident_birth_date.sql`
  - Adds nullable `public.residents_v3.birth_date` if absent.
  - Backfills only deterministic matches through `application_id` where the
    source application is approved and has a non-null `birth_date`.
- `Backend/api/src/lib/residentPayload.ts`
  - Adds `birth_date` to the shared resident payload field allowlist. This is
    used by both family-head and non-family-head approval inserts.
- `Backend/api/src/app/api/residents/route.ts`
  - Adds `birth_date` to the explicit resident GET selection.
- `Backend/api/src/lib/dateUtils.ts`
  - Adds `calculateCurrentAge`, a server-safe utility that uses the current
    `Asia/Manila` calendar date and handles the birthday boundary correctly.
- `Backend/api/tests/date-utils.test.mjs`
  - Covers before/on-birthday behavior, the Manila midnight boundary, and
    invalid/future dates.

## Approval persistence

The existing approval route constructs a resident payload from the approved
application and passes it through `pickResidentPayload` in both branches:

1. Family-head approval inserts the resident into `residents_v3` before
   creating/linking the family.
2. Non-family-head approval inserts the resident into `residents_v3` using the
   existing family ID.

Because `birth_date` is now in the shared allowlist, the application
`birth_date` is persisted to `residents_v3.birth_date` in both cases. No
approval workflow or status behavior was otherwise changed.

## Backfill status

The migration has been applied successfully to live Supabase. Live verification
found 53 existing `residents_v3` rows, including 31 with a deterministic exact
`application_id` match to an approved application with a non-null DOB. The
remaining 22 are intentionally left untouched:

- 14 have no `application_id`.
- 8 have a matching application whose `birth_date` is null.

No additional live data was modified during the later Step 2 implementation.

## Scope and limitations

- `age` remains present and is not globally replaced.
- No frontend UI behavior was changed; existing resident frontend state does
  not require a new field to compile.
- The utility is reusable but is not wired into classifications or displays in
  this step.
- No safe deterministic DOB inference was made for rows outside the migration
  predicate.

## Validation

- Backend TypeScript check: passed (`npx tsc --noEmit --incremental false`).
- Frontend TypeScript check: passed (`npx tsc --noEmit --incremental false`).
- Focused date utility tests: passed (3/3).
- Existing emergency tests: passed (22/22).
- Backend build: passed (`npm run build`).
- Frontend build: passed (`npm run build`).
- `git diff --check`: passed.
