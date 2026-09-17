# Dynamic Resident Age — Step 8

## Status

**Complete as a read-only coverage-aware comparison.** The existing family
aggregate fields remain unchanged and the comparison is not connected to AHP,
AI, ILP, relief allocation, or any write workflow. No migration was created or
applied, and no production row was inserted, updated, deleted, or upserted.

## 1. Objective

The extended `GET /api/family-members/coverage` response compares the existing
stored family demographic aggregates with counts derived from authoritative
`family_members.birth_date` values. It reports which families are complete
enough for a dynamic comparison and keeps dynamic values unavailable for every
incomplete family.

## 2. Existing stored aggregate source

The stored baseline columns are `families.infant_count`,
`families.toddler_count`, and `families.elderly_count`.

Those values originate in the existing `familyVulnerabilityPayload()` helper
in `Backend/api/src/lib/residentPayload.ts`. The helper copies the submitted
application/body vulnerability counts into the existing family-create and
family-update workflows. The approval route uses the same helper when it
creates a family from an approved resident application.

The existing family API and emergency distribution code read those stored
columns. `Backend/ai/app/repositories.py` also selects them, and
`Backend/ai/app/engine.py` maps them into the existing AHP vulnerability
calculation. The Step 8 comparison does not replace or feed any of those
paths.

## 3. Authoritative dynamic source

Only `family_members.birth_date` is used for dynamic age classification. The
calculation path is:

```text
family_members.birth_date
  → calculateCurrentAge()
  → classifyCurrentAge(APPROVED_DEMOGRAPHIC_AGE_POLICY)
  → infant/toddler/elderly counts
```

`residents_v3.age`, stored family counts, names, application array positions,
addresses, phone numbers, timestamps, and inferred dates are not used as
dynamic inputs.

## 4. Coverage rules

A family is dynamically complete only when all of the following are true:

- `total_family_members` is a valid positive integer;
- the `family_members` row count exactly matches the declared total;
- every `family_members` row has a usable, non-future `birth_date`;
- resident-row coverage does not exceed the declared total; and
- no supported coverage contradiction is present.

The existing explicit reasons are preserved: `complete`,
`member_rows_missing`, `member_count_exceeds_declared_total`,
`resident_rows_exceed_declared_total`, `birth_date_missing`,
`no_resident_or_member_coverage`, and `declared_member_count_invalid`.
Multiple reasons remain visible when multiple conditions apply.

## 5. Age-classification policy

`APPROVED_DEMOGRAPHIC_AGE_POLICY` in
`Backend/api/src/lib/dateUtils.ts` represents the approved policy:

- infant: 0–12 months inclusive;
- toddler: over 12 months and under 4 years;
- preschool / young child: 4–6 years;
- child: 7–12 years;
- teen/adolescent: 13–17 years;
- adult: 18–59 years;
- elderly/senior citizen: 60 years and above.

The existing `calculateCurrentAge()` utility remains the single calendar-age
calculation path and continues to use the `Asia/Manila` calendar date. The
existing `classifyCurrentAge()` adapter now accepts the approved life-stage
policy and the DOB/as-of context needed for the one-year boundary. Therefore,
the date of the first birthday is still infant, while the following calendar
date is toddler. The previous threshold-only behavior remains available for
legacy callers.

## 6. Dynamic counting methodology

For complete families, the comparison iterates only over the exact
`family_members` rows for that family. Each usable DOB is passed through
`calculateCurrentAge()` and then `classifyCurrentAge()`.

The comparison counts at least infant, toddler, and elderly classifications.
Preschool, child, teen, and adult are classified by the same adapter but are
not added to the existing AHP contract. The dynamic member count is the
authoritative `family_members` row count for a complete family.

For incomplete families, `dynamic_member_count`, all three dynamic category
counts, and all three differences are `null`.

## 7. Stored vs dynamic comparison

Each family row includes:

- coverage fields from Step 7;
- `stored_infant_count`, `stored_toddler_count`, and
  `stored_elderly_count`;
- `dynamic_member_count`;
- `dynamic_infant_count`, `dynamic_toddler_count`, and
  `dynamic_elderly_count`; and
- `infant_difference`, `toddler_difference`, and `elderly_difference`.

Each difference is calculated as `dynamic count - stored count`, and is only
calculated when the family is complete and the stored baseline is numeric.

## 8. Complete families

Complete families are the only families included in the dynamic aggregate
totals. The summary reports complete-only stored totals, complete-only dynamic
totals, and per-category family match/difference counts.

For example, a complete test fixture with six authoritative members can report
stored counts of infant `0`, toddler `1`, elderly `2` against dynamic counts of
infant `1`, toddler `2`, elderly `1`, producing differences of `+1`, `+1`, and
`-1`. This is comparison evidence only; it does not update the family row.

## 9. Incomplete families

Incomplete families remain visible with their stored counts and explicit
coverage reasons. Their dynamic counts and differences are `null`, so a
partial member set cannot be presented as a complete demographic replacement.
NULL or unusable DOBs never fall back to `residents_v3.age`.

## 10. Aggregate comparison results

The response summary includes total, complete, and incomplete family counts;
families with missing DOBs; families with missing member rows; families with
contradictory resident coverage; total authoritative member rows; and total
DOB-known/unknown member counts. It also includes complete-only stored versus
dynamic totals and match/difference counts for infant, toddler, and elderly.

Read-only live verification on 2026-09-17 found:

- 55 families;
- 0 complete and 55 incomplete families;
- 54 resident rows;
- 0 `family_members` rows;
- 0 DOB-known and 0 DOB-unknown authoritative member rows;
- 47 families with missing member rows;
- 4 families with contradictory resident coverage;
- 0 families with missing DOB within a member row;
- 0 complete-only stored or dynamic category totals, because no family is
  currently complete.

The live verification used SELECT-only reads and did not change production
data. The absence of `family_members` rows means the current live dataset
cannot yet produce a complete-family dynamic comparison.

## 11. AHP impact analysis

There is no Step 8 AHP impact applied to decision-making. The comparison
reveals no complete families in the live snapshot, so there are no eligible
dynamic AHP replacements. Existing stored family counts continue to be the
only values consumed by the current AHP/AI path.

## 12. Why AHP was NOT changed

Changing AHP inputs would be unsafe while authoritative member coverage is
empty/incomplete. Replacing stored counts with partial DOB-derived counts
could undercount household vulnerability. Step 8 therefore adds only a pure
comparison helper and read-only API response fields; it does not alter AHP
weights, formulas, input construction, strategy selection, AI aggregation,
ILP optimization, recommendations, relief allocation, or family aggregates.

## 13. Known limitations

- The current frontend does not need a new screen and was not changed.
- The live `family_members` table currently has no rows, so dynamic counts are
  unavailable for all current families.
- Existing resident/application data does not prove complete household-member
  coverage.
- Legacy parallel application arrays remain excluded because they lack safe
  stable identity and may have mismatched lengths.
- The comparison is diagnostic; it does not establish a replacement source of
  truth or persist coverage status.

## 14. Exact recommendation for Step 9

Keep AHP on the existing stored family aggregates. First populate
`family_members` only through the reviewed structured-member contract, rerun
the comparison, and review complete-family coverage and stored-vs-dynamic
differences. Step 9 may then design a separately approved coverage-aware AHP
adapter that replaces only the three age-derived counts for complete families
and preserves stored counts for every incomplete or NULL-DOB family. No AHP
integration should be implemented until that evidence and merge policy are
approved.

