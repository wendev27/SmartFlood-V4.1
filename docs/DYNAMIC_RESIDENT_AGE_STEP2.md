# Dynamic Resident Age — Step 2

## Objective

Establish one server-side path for the current age exposed by resident API
responses:

`residents_v3.birth_date` → `calculateCurrentAge()` → response `age`

The stored `residents_v3.age` column remains available for compatibility.

## Investigation findings

- `GET /api/residents` is the backend source consumed by
  `Frontend/src/components/residents/ResidentsPanel/ResidentsPanel.tsx`.
- The panel already renders the response `age` field in the resident list,
  details modal, and connected-residents table, so no frontend contract or UI
  change was required.
- Resident create, update, and deactivate endpoints also return resident rows;
  those responses now use the same server-side age helper.
- Family API responses expose family vulnerability aggregates, not individual
  resident ages. Those aggregates were intentionally left unchanged.
- AI/AHP code consumes stored family vulnerability counts and does not safely
  belong in this step.
- The resident application review modal displays application data and is not a
  `residents_v3.age` consumer for this wiring.

## Implemented behavior

`residentWithCurrentAge()` in
`Backend/api/src/lib/dateUtils.ts` is the shared response helper.

- If `birth_date` is present, it replaces response `age` with
  `calculateCurrentAge(birth_date)` using the server-side `Asia/Manila`
  calendar date and adds `age_source: "birth_date"`.
- If `birth_date` is NULL or empty, the stored `age` is preserved and the
  response adds `age_source: "legacy"`.
- No missing DOB is inferred, and no database `age` values are mass-updated.

The helper is used by the resident list/create endpoint and the resident
update/deactivate endpoint. Database writes still preserve the existing
stored `age` behavior.

## Deferred systems

The following were deliberately not changed:

- vulnerable-person classifications and thresholds;
- family aggregate counts, including elderly/infant/toddler counts;
- AHP weights, scoring, ILP optimization, and AI recommendation aggregation;
- pregnancy, lactation, PWD, and 4Ps logic;
- authentication, RBAC, RLS, resident application workflow, QR/campaign,
  relief, and unrelated frontend modules.

## Validation

- Backend TypeScript: passed.
- Frontend TypeScript: passed; no frontend source changed.
- Focused age tests: passed, including DOB-backed and NULL-DOB response cases.
- Existing emergency tests: passed, 22/22.
- Backend build: passed.
- Frontend build: passed.
- `git diff --check`: passed.

## Limitations and Step 3 direction

Legacy rows without `birth_date` continue to expose their stored age, clearly
marked as legacy. They must not be treated as dynamically verified. Step 3
should define and test any individual demographic classification adapter using
the authoritative response/helper path, with explicit policy decisions for
NULL-DOB residents; it should not alter AHP or family aggregates without a
separate approved scope.
