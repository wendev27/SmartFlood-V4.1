# Dynamic Resident Age — Step 3

## Objective

Provide a reusable server-side adapter for:

`authoritative current age` → `demographic classification policy` →
`infant | toddler | elderly | other | unknown`

This step does not integrate classifications into family aggregates, AHP, or
AI recommendations.

## Investigation findings

- No explicit infant, toddler, or elderly age thresholds exist in the current
  repository or its relevant documentation.
- `resident_applications` and the resident form carry age-related values, but
  the existing persisted `elderly_count`, `infant_count`, and `toddler_count`
  values are family-level aggregates.
- `familyVulnerabilityPayload()` preserves those aggregates when families are
  created; the Residents panel reads them from `/api/families` for family
  cluster displays.
- The AI service reads `families.*_count` fields and applies its existing AHP
  weights and ILP allocation logic. It does not classify individual residents
  from age.
- No individual resident classification consumer was found that can safely be
  redirected in this step.

## Adapter design

`classifyCurrentAge()` in `Backend/api/src/lib/dateUtils.ts` accepts an
authoritative current age and an explicitly injected policy. The policy has:

- `infantMaxAge`
- `toddlerMaxAge`
- `elderlyMinAge`

The exported `PENDING_DEMOGRAPHIC_AGE_POLICY` contains no thresholds. Calling
the adapter without an approved configured policy returns
`classification: "unknown"` with `reason: "policy_unconfigured"`.

Configured policies return `infant`, `toddler`, `elderly`, or `other` according
to their injected boundaries. Invalid or overlapping policies return
`classification: "unknown"` with `reason: "invalid_policy"`.

The adapter does not calculate age itself. Callers must first use the existing
`calculateCurrentAge()` path; this prevents stored legacy `age` from silently
becoming the source for new classifications.

## NULL-DOB behavior

`calculateCurrentAge()` returns `null` for missing or invalid DOB input. Passing
that unavailable age to `classifyCurrentAge()` returns
`classification: "unknown"` with `reason: "age_unavailable"`.

The stored legacy age remains available for compatibility but is not used by
this adapter when DOB-backed current age is unavailable.

## Intentionally unchanged

- family aggregate counts;
- AHP weights, scoring, and ILP optimization;
- AI aggregation and recommendation generation;
- pregnancy, lactation, PWD, and 4Ps logic;
- resident application workflow and database schema;
- authentication, RBAC, and RLS;
- frontend UI behavior and unrelated modules.

## Validation

- Focused date/classification tests: passed, 8/8 test cases.
- Backend TypeScript: passed.
- Frontend TypeScript: passed; no frontend source changed.
- Existing emergency tests: passed, 22/22.
- Backend build: passed.
- `git diff --check`: passed.

## Limitations and Step 4

Final demographic thresholds still require product/policy approval. Step 4 is a
separate integration task: derive dynamic demographic counts from DOB-backed
resident ages and connect them to the existing family/AHP pipeline with an
explicit NULL-DOB policy. Step 4 must preserve the current stored aggregates
until that integration is separately approved and tested.
