# Dynamic Resident Age — Step 4 Investigation and Stop Report

## Status

**STOPPED before AHP integration.** No Step 4 production-code, database, family
aggregate, AI, AHP, or ILP changes were made.

## Approved demographic policy

The requested non-overlapping policy is:

- Infant: 0–12 months inclusive;
- Toddler: over 12 months and under 4 years;
- Preschool / Young Child: 4–6 years;
- Child: 7–12 years;
- Teen/Adolescent: 13–17 years;
- Adult: 18–59 years;
- Senior Citizen / Elderly: 60 years and above.

Exactly 12 months is infant, not toddler.

## Data-model investigation

- `families` stores `total_family_members`, `infant_count`,
  `toddler_count`, and `elderly_count` as family-level aggregates.
- `residents_v3` stores resident rows linked by `family_id`; it does not
  reliably represent every household member represented by the family
  aggregates.
- Approval persistence carries the application aggregate fields into
  `families`, but the vulnerable-member DOB/name arrays on
  `resident_applications` are not persisted as individual `residents_v3`
  rows.
- The existing AI repository reads the stored family aggregate fields, and the
  AI engine applies the existing AHP weights and ILP allocation logic.
- No positional array matching or indirect identity matching is safe here.

## Live verification

Read-only Supabase inspection found:

- 53 `residents_v3` rows;
- 54 `families` rows;
- all 53 resident rows have a `family_id`;
- 8 families have no resident rows;
- 3 families have `total_family_members` greater than their resident-row
  coverage;
- 4 families have fewer declared total members than resident rows;
- 17 families have stored infant/toddler/elderly totals greater than their
  resident-row count;
- only 30 families have DOBs for every resident row currently attached to them.

These results prove that resident-row aggregation would silently remove or
undercount existing vulnerable household members. The 22 NULL-DOB legacy
residents further prevent complete authoritative classification.

## Why integration is blocked

The desired path is:

`residents_v3.birth_date` → current age → category → family counts → AHP

But the first aggregation step cannot cover all household members from
`residents_v3`. Replacing stored `infant_count`, `toddler_count`, or
`elderly_count` would therefore change existing AHP inputs and could decrease
relief prioritization without evidence that the members ceased to exist.

This meets the explicit stop conditions for incomplete household
representation, undercount risk, and NULL-DOB data loss.

## Safest next step

Do not change the AHP contract or existing family counts yet. First establish a
reviewed authoritative household-member representation, either by persisting
each member’s DOB as a real resident/member record or by adding an explicitly
approved member data model. Then define how NULL-DOB members preserve existing
aggregate counts, derive dynamic counts only for complete families, and expose
coverage/incompleteness metadata. Only after that should a separately reviewed
integration adapt `infant_count`, `toddler_count`, and `elderly_count` into the
existing AHP input contract.

No DOBs should be inferred from age, names, addresses, timestamps, or array
positions.
