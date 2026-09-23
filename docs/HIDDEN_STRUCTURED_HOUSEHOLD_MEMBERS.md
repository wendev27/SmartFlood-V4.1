# Structured Household Members — Restoration Record

## Status

The structured household-member UI has been restored after the active
Supabase database applied:

`supabase/migrations/20260917000002_add_family_member_vulnerabilities.sql`

Before that migration, the family-member API returned errors such as:

`column family_members.is_pwd does not exist`

## Restored UI

The shared frontend flag
`Frontend/src/lib/featureFlags.ts` now enables structured household-member
features in these modals:

- RBI Add Resident: structured household-member editor;
- RBI Edit Resident: structured household-member editor, Add Member, Remove,
  and related API error output;
- RBI Resident View: structured household-member table;
- RBI Family Cluster View: structured household-member table and dynamic
  member-coverage notice;
- Resident Account Registration Review: structured `household_members` panel.

These panels now issue the existing authorized `family_members` and coverage
requests.

## Preserved Behavior

- RBI resident and family details;
- existing stored family vulnerability aggregate counts;
- connected residents;
- read-only Submitted Application Details in RBI;
- legacy Submitted Member Details in Account Registration Review;
- Approve, Reject, and admin feedback behavior.

Legacy names and birth-date arrays remain separate and are not converted or
paired by position.

## Data and Backend Impact

- Migration `00002` was applied by the user.
- 55 existing `residents_v3` identities were safely represented as linked
  `family_members` rows.
- 33 exact resident DOBs were preserved and 22 unknown DOBs remained NULL.
- No vulnerability status was inferred; all imported PWD, pregnant, lactating,
  and 4Ps flags remain false, with pregnancy baseline fields NULL.
- Family-member backend routes and persistence code remain available.
- Authentication, RBAC, barangay scoping, AHP, AI, and ILP are unchanged.

## Completed Restore Checklist

1. Review and manually apply
   `20260917000002_add_family_member_vulnerabilities.sql` to the active
   Supabase project.
2. Verify the `family_members` vulnerability columns,
   `pregnancy_baseline_at`, and `resident_applications.household_members`
   exist.
3. Verify the family-member GET/POST/PATCH/DELETE routes in a controlled test.
4. Change `SHOW_STRUCTURED_HOUSEHOLD_MEMBERS` to `true`. **Completed.**
5. Run frontend/backend typechecks, builds, focused family-member tests, and
   `git diff --check` before deployment.

Historical Submitted Application Details remain read-only. Administrators use
the restored Household Members editor for authoritative member updates; legacy
parallel arrays are not rewritten or positionally paired.
