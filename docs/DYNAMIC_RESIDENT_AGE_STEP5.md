# Dynamic Resident Age — Step 5 Design and Investigation

## Status

**Design only.** Step 5 does not create a table, migration, backfill, or
integration with family aggregates, AHP, AI, or ILP.

## 1. Current household data model

`families` is the household/family-cluster record. It stores the family
identity, address and barangay, family-head references, total member count, and
stored vulnerability aggregates such as `infant_count`, `toddler_count`, and
`elderly_count`.

`residents_v3` is the resident/account-holder record. Its rows have a
`family_id`; the current application creates one row for an approved family
head and one row for each separately approved non-family-head application.
Being linked to a family does not prove that every household member has a
resident row.

The connected-residents view is therefore a view over `residents_v3` rows
sharing `family_id`. It cannot display members represented only by family
aggregates or application arrays.

## 2. Current approval and application relationships

Family-head approval currently:

1. inserts the applicant into `residents_v3`;
2. creates one `families` row;
3. copies aggregate vulnerability fields into that family;
4. links the resident row to the new family.

Non-family-head approval requires a selected/existing family ID and inserts one
resident row linked to that family. It does not create rows for other people
listed in the application.

The application’s `elderly_full_names[]`, `elderly_birth_dates[]`,
`infant_full_names[]`, `infant_birth_dates[]`, `toddler_full_names[]`, and
related fields remain on `resident_applications`. The approval route does not
persist those arrays into a member-level table or additional `residents_v3`
rows.

## 3. Evidence from live data

Read-only verification found:

- 53 `residents_v3` rows, all linked to a `family_id`;
- 54 `families` rows;
- 31 resident rows with DOB and 22 with NULL DOB;
- 8 families without resident rows;
- 3 families whose declared total members exceed resident-row coverage;
- 17 families whose stored infant/toddler/elderly totals exceed resident-row
  coverage;
- 34 resident applications, including 29 approved applications;
- only 3 applications with non-empty household-member array data.

Some application arrays are not guaranteed to have matching lengths. There is
no stable member ID in the current arrays, so equal-looking positions cannot be
treated as identity relationships.

## 4. Safe, incomplete, and ambiguous source data

### Safe in principle

- Existing `residents_v3` rows can be represented as household-member records
  using their explicit `resident_id` and `family_id`.
- Their current DOB can be copied exactly when non-null; the 22 NULL DOBs must
  remain unknown.
- An optional source application reference can preserve provenance when the
  resident’s `application_id` is present.

### Partially complete

- A household member may have a name but no DOB, or a DOB array value without a
  reliably paired name. Such data can be retained as review/incomplete source
  data, but cannot support authoritative demographic classification.
- Family aggregate counts identify quantities, not individual member records.

### Ambiguous and unsafe

- Parallel name/DOB arrays without a stable member identifier.
- Mismatched arrays requiring positional pairing.
- Any record requiring matching by name, phone, address, timestamp, or stored
  age.
- Aggregate counts treated as proof of specific people.

Category C data must not be automatically migrated.

## 5. Existing schema evaluation

No existing `family_members` table or equivalent member-level model was found
in the repository. The existing code and migrations show relationships from
family and resident IDs, but no reusable household-member table exists.

The smallest appropriate normalized model is therefore a proposed
`family_members` table. It should not be created until its key types and base
table foreign-key metadata are confirmed through a reviewed schema migration.

### Proposed minimum fields

- `member_id` — UUID primary key;
- `family_id` — required foreign key to `families.family_id`;
- `resident_id` — nullable foreign key to `residents_v3.resident_id` for a
  member who is also an existing resident; this must not create an account;
- `source_application_id` — nullable provenance reference to the application
  that supplied the member;
- `full_name` — required for a complete displayable member record;
- `birth_date` — nullable date; NULL means demographic age is unavailable;
- `created_at` and `updated_at` timestamps.

`relationship_to_head`, sex, phone, address, and account/authentication fields
are not required for the age/classification objective and should not be added
without a separate requirement.

### Relationships and integrity

- `family_id` owns the member record and should use restrictive deletion
  behavior unless family deletion policy is separately approved.
- `resident_id` is nullable and should be unique only when present, preventing
  duplicate linkage without turning every member into a resident account.
- `source_application_id` is provenance, not a uniqueness key because one
  application can describe multiple members.
- No uniqueness rule should be based only on name or DOB; it could collapse
  distinct household members.
- A future structured application payload needs a stable member key for
  idempotent inserts. An array position is not such a key.

### Indexes and rollback

At minimum, index `family_id`; index `resident_id` if the partial uniqueness
constraint does not provide the required lookup path. A later migration should
be additive, transactionally create the table/constraints/indexes, and be
rollback-reviewed without deleting current applications or changing family
aggregates. No migration is proposed or applied in Step 5.

## 6. Account holder versus household member

The recommended model is:

```text
families
├── residents_v3       resident/account records
└── family_members     household demographic records
```

An existing resident can be linked through `resident_id`. A household member
without a resident account remains only a `family_members` row. Approval must
not create resident authentication accounts for household members merely to
obtain DOBs.

## 7. Legacy and NULL-DOB strategy

- Preserve all existing family aggregates unchanged.
- Represent known resident rows as member records only after the model is
  approved; retain NULL DOB for the 22 legacy residents.
- Keep families with missing member rows or unknown DOBs explicitly incomplete
  in the calculation result. Prefer computed coverage metadata over a new
  persisted status column until its operational use is approved.
- For incomplete families, future dynamic-count integration must preserve the
  existing stored infant/toddler/elderly counts rather than silently replacing
  them with partial counts.
- Families become eligible for fully dynamic counts only when the authoritative
  member set and required DOB coverage are complete and validated.

## 8. Existing-family migration strategy

No automatic migration should consume the vulnerable-member arrays. A reviewed
future migration may create member rows for existing `residents_v3` identities
using deterministic IDs, family links, names, and exact DOB values. It must
leave the 22 unknown DOBs NULL and must not claim complete family coverage.

Application-only members should remain unmigrated until the source contract
provides explicit structured member identity. Ambiguous records must be
reported for manual review, not converted by positional or indirect matching.

## 9. New-application persistence strategy

The future approval flow should, after the family ID is known:

1. preserve the existing applicant-to-`residents_v3` approval behavior;
2. accept household members as structured records with an explicit stable
   member identifier, full name, and optional DOB;
3. insert those records into `family_members` with family and application
   provenance;
4. reject or flag malformed/mismatched member records instead of guessing;
5. calculate coverage metadata without changing stored family aggregates.

This requires a separately reviewed application payload change. It is not
implemented in Step 5.

## 10. Future dynamic-count flow

Once authoritative member coverage exists:

```text
family_members
  → exact birth_date values
  → calculateCurrentAge() using Asia/Manila date
  → classifyCurrentAge() using approved policy
  → dynamic infant/toddler/elderly counts
  → coverage-aware AHP input adapter
```

Preschool, child, teen, and adult categories may be reported by the adapter,
but should not be added to AHP merely because they exist in the policy.

## 11. Later AHP integration

The later integration must preserve the existing AHP input contract:
`infant_count`, `toddler_count`, `elderly_count`, `pwd_count`,
`pregnant_count`, `lactating_count`, `four_ps_count`, and
`total_family_members`.

Only the three age-derived counts should be candidates for dynamic replacement,
and only for complete authoritative families. Other vulnerability dimensions,
AHP weights, formulas, strategy generation, and ILP optimization must remain
unchanged. Incomplete families must retain stored counts until an approved
policy defines a safe merge rule.

## 12. Risks and limitations

- Current application arrays cannot safely establish individual identity.
- `residents_v3` does not cover all members represented by family aggregates.
- NULL DOBs prevent complete dynamic classification.
- Replacing stored counts now would risk undercounting relief-priority
  populations.
- A member table introduces a new source of truth and requires idempotency,
  provenance, permissions, and deletion policies.
- No live schema metadata was changed or assumed beyond relationships observed
  in application code and read-only data inspection.

## 13. Recommended Step 6 implementation plan

1. Approve the distinction between resident accounts and household members.
2. Confirm base-table key types, foreign keys, RLS, permissions, and deletion
   rules through a reviewed schema inspection.
3. Approve the minimum `family_members` schema and stable member-key contract.
4. Add additive migration/tests only after that approval; do not backfill
   ambiguous arrays.
5. Persist structured members for newly approved applications with idempotent
   server-side validation.
6. Produce coverage-aware dynamic count previews and compare them against
   stored family aggregates without changing AHP inputs.
7. Only after comparison and policy approval, implement the later AHP adapter.
