# Dynamic Resident Age — Step 7

## Status

**Complete for structured member persistence and read-only coverage preview.**
No AHP, AI, ILP, family aggregate, resident age, or database migration change
was made in Step 7. The Step 6 `family_members` migration is treated as
already applied in the current project state; no new migration was created or
applied.

## 1. Structured member contract

The approval endpoint accepts an optional `household_members` property:

```json
{
  "household_members": [
    {
      "member_id": "stable-uuid",
      "full_name": "Household Member",
      "birth_date": "2000-01-01",
      "resident_id": null
    }
  ]
}
```

The server contract requires:

- `member_id`: UUID, required, and producer-owned;
- `full_name`: trimmed text from 1 to 120 characters without control
  characters;
- `birth_date`: either NULL or an exact valid, non-future `YYYY-MM-DD` date;
- `resident_id`: optional UUID or NULL.

The payload does not accept family, barangay, application provenance, reviewer,
or authorization fields for persistence. An empty array is accepted as an
explicit absence of structured member rows, but it cannot make a family
coverage-complete.

## 2. Stable identifier and idempotency

The structured-member producer must create and retain a UUID for each member
across retries. Array positions, names, DOBs, and generated-per-retry IDs are
not identity keys.

The UUID is also the existing `family_members.member_id` primary key. The
server derives `family_id` from the approved workflow and
`source_application_id` from the route application ID. Before upsert, the
server rejects an existing member UUID associated with another family or
application. Reusing the same UUID for the same family/application updates the
same logical row instead of creating a duplicate.

Resident links are checked against actual `residents_v3` rows, must belong to
the trusted target family, and cannot already be linked to another member.
There is no name-plus-DOB identity rule.

## 3. Persistence location and workflow

Persistence is implemented in `Backend/api/src/lib/familyMembers.ts` and is
called by the existing approval route:

`Backend/api/src/app/api/resident-applications/[id]/review/route.ts`

For family-head approval, the route first creates and links the family, then
persists validated structured members using that server-known family ID. For
non-family-head approval, the route verifies that the selected family exists
and matches the application's barangay before creating the resident and
persisting members.

Only approved applications persist `household_members`. Rejected applications
and requests without the optional property retain their existing behavior.
Legacy parallel name/DOB arrays are not read or converted.

## 4. Validation

Validation is server-side and rejects malformed member arrays, invalid or
duplicate member UUIDs, missing/overlong names, invalid calendar dates, future
dates, invalid resident UUIDs, duplicate resident links, missing residents,
cross-family resident links, and conflicting existing member provenance.

The server never trusts client-supplied family or barangay ownership for the
new records. Application ID, family ID, and application barangay are obtained
or verified from server-side records.

## 5. Authorization and scoping

The existing `getDashboardViewer()` and `dashboardViewerRole()` checks remain
in use. Approval continues to allow only the existing `super`, `cswdd`, and
`barangay` roles. Barangay users are restricted through
`assignedBarangayForUser()` and `isSameBarangayForUser()`.

The coverage endpoint uses the same roles and barangay scope. Database access
continues through the existing service-role server client; the Step 6 RLS and
direct-table permission boundary was not changed.

## 6. Read-only coverage preview

The new endpoint is:

`GET /api/family-members/coverage`

It reports per family:

- `family_id`;
- stored `total_family_members`;
- resident row count;
- `family_members` row count;
- DOB-known and DOB-unknown member counts;
- `coverage_complete`;
- explicit `coverage_reasons`.

It also returns aggregate totals for family count, complete/incomplete family
count, resident rows, member rows, and DOB coverage.

A family is complete only when its declared member count is valid and positive,
the authoritative member-row count exactly matches it, every member has a
usable DOB, and resident-row coverage does not exceed the declared count.
Resident accounts are not required for every member, because a household
member may validly have `resident_id = NULL`.

The preview distinguishes:

- `complete`;
- `member_rows_missing`;
- `member_count_exceeds_declared_total`;
- `resident_rows_exceed_declared_total`;
- `birth_date_missing`;
- `no_resident_or_member_coverage`;
- `declared_member_count_invalid`.

The preview is informational only. It never replaces stored family counts or
feeds AHP.

## 7. Age and NULL-DOB behavior

DOB usability is checked through the existing `calculateCurrentAge()` path.
Missing, invalid, or future DOBs are not dynamically classifiable. The
existing `classifyCurrentAge()` adapter remains separate and is not connected
to AHP or family aggregates in this step.

No stored `residents_v3.age` value is used as a substitute for a missing DOB.
No DOB is inferred from names, arrays, timestamps, addresses, or stored age.

## 8. Database and production-data status

- Step 7 migration created: **NO**;
- Step 7 migration applied: **NO**;
- Step 6 `family_members` migration: treated as already applied in the current
  project state;
- backfill: **NO**;
- production data changed by Step 7: **NO**;
- family aggregates changed: **NO**;
- `residents_v3.age` or `birth_date` changed: **NO**.

## 9. Known limitations

- The current frontend review panel does not collect structured member rows,
  so it continues sending no `household_members` property. A future trusted
  application producer must persist stable member UUIDs and send the contract.
- Existing application arrays remain ambiguous and are intentionally excluded.
- The current approval route still has its pre-existing multi-write workflow;
  Step 7 adds member-row idempotency but does not redesign that workflow as a
  database transaction.
- Coverage completeness is a data-quality preview, not approval to replace
  family aggregates.

## 10. Exact Step 8 recommendation

Do not integrate dynamic counts into AHP yet. First review the structured-member
payload and run the coverage endpoint against the applied table. Then design a
separate, coverage-aware comparison that preserves stored aggregates for every
incomplete or NULL-DOB family. Only after that comparison, policy review, and
regression testing should a separate Step 8 task consider adapting the three
age-derived AHP inputs.

