# Temporarily Hidden Structured Household Members

## Status

The structured household-member UI is temporarily hidden because the active
Supabase database has not yet applied:

`supabase/migrations/20260917000002_add_family_member_vulnerabilities.sql`

Without that migration, the family-member API returns errors such as:

`column family_members.is_pwd does not exist`

## Hidden UI

The shared frontend flag
`Frontend/src/lib/featureFlags.ts` currently hides structured household-member
features from these modals:

- RBI Add Resident: structured household-member editor;
- RBI Edit Resident: structured household-member editor, Add Member, Remove,
  and related API error output;
- RBI Resident View: structured household-member table;
- RBI Family Cluster View: structured household-member table and dynamic
  member-coverage notice;
- Resident Account Registration Review: structured `household_members` panel.

The disabled panels do not issue `family_members` or family-member coverage
requests. This prevents the unapplied-column error from appearing.

## Still Visible

- RBI resident and family details;
- existing stored family vulnerability aggregate counts;
- connected residents;
- read-only Submitted Application Details in RBI;
- legacy Submitted Member Details in Account Registration Review;
- Approve, Reject, and admin feedback behavior.

Legacy names and birth-date arrays remain separate and are not converted or
paired by position.

## Data and Backend Impact

- No database migration was applied.
- No database records were changed.
- No household-member rows were created, updated, or deleted.
- Family-member backend routes and persistence code remain available.
- Authentication, RBAC, barangay scoping, AHP, AI, and ILP are unchanged.

## Restore Checklist

1. Review and manually apply
   `20260917000002_add_family_member_vulnerabilities.sql` to the active
   Supabase project.
2. Verify the `family_members` vulnerability columns,
   `pregnancy_baseline_at`, and `resident_applications.household_members`
   exist.
3. Verify the family-member GET/POST/PATCH/DELETE routes in a controlled test.
4. Change `SHOW_STRUCTURED_HOUSEHOLD_MEMBERS` to `true`.
5. Run frontend/backend typechecks, builds, focused family-member tests, and
   `git diff --check` before deployment.

The hidden structured panels already support dynamic pregnancy-week display.
They must not be restored until the baseline timestamp column and pregnancy
integrity constraint from migration `00002` are present in the active schema.
