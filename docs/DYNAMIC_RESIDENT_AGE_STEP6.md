# Dynamic Resident Age — Step 6

## Status

**Migration created and applied.** Step 6 established only the additive
`family_members` schema. No household members, family aggregates, resident
ages, or applications were modified.

## 1. Verified database schema

Live Supabase OpenAPI metadata was inspected read-only:

- `families.family_id`: UUID primary key, default `gen_random_uuid()`;
- `residents_v3.resident_id`: UUID primary key, default `gen_random_uuid()`;
- `residents_v3.family_id`: nullable UUID foreign key to `families.family_id`;
- `residents_v3.application_id`: nullable UUID;
- `resident_applications.application_id`: UUID primary key, default
  `gen_random_uuid()`;
- relevant existing timestamps: `timestamptz` with `now()` defaults;
- `resident_applications` contains the existing member name/DOB arrays, but no
  stable member identifier.

The repository's existing migrations use UUID keys and restrictive foreign-key
behavior for workflow records. Complete base-table catalog details such as all
RLS policies and grants are not exposed by the OpenAPI metadata.

## 2. Final `family_members` schema

Migration:
`supabase/migrations/20260917000001_create_family_members.sql`

Columns:

- `member_id uuid primary key default gen_random_uuid()`;
- `family_id uuid not null`;
- `resident_id uuid null`;
- `source_application_id uuid null`;
- `full_name text not null`;
- `birth_date date null`;
- `created_at timestamptz not null default now()`;
- `updated_at timestamptz not null default now()`.

No relationship-to-head, sex, phone, address, account, password, or role
fields were added because they are not required for authoritative age
classification.

## 3. Foreign keys and deletion behavior

- `family_id → families.family_id`: `ON UPDATE RESTRICT ON DELETE RESTRICT`.
  A family cannot be removed while authoritative member records depend on it.
- `resident_id → residents_v3.resident_id`: `ON UPDATE RESTRICT ON DELETE SET
  NULL`. Deleting a resident account preserves the household member record.
- `source_application_id → resident_applications.application_id`: `ON UPDATE
  RESTRICT ON DELETE SET NULL`. Removing application history does not remove
  demographic history.

Resident deactivation is an existing status update, so it does not detach the
optional member link.

## 4. Indexes and constraints

- Primary key on `member_id`;
- index on `family_id` for family retrieval;
- partial index on non-null `source_application_id` for provenance lookup;
- partial unique index on non-null `resident_id`, preventing one resident from
  being linked to multiple member records;
- no uniqueness on `full_name`, `birth_date`, or their combination.

The table allows NULL `resident_id`, NULL `source_application_id`, and NULL
`birth_date`. Unknown DOB means age classification is unavailable.

## 5. RLS and permissions

The table enables RLS, revokes direct table privileges from `public`, `anon`,
and `authenticated`, and grants table access only to the existing
`service_role`. A restrictive deny policy is also created for direct
`anon`/`authenticated` access.

The existing dashboard API uses `supabaseServer` with `SUPABASE_SERVICE_ROLE_KEY`
and authenticates viewers through `getDashboardViewer()`,
`dashboardViewerRole()`, and existing barangay scope helpers before querying.
Therefore barangay isolation remains an API authorization responsibility; the
new table does not introduce a new auth model or weaken existing RBAC.

The migration does not modify RLS or permissions for any existing table.

## 6. Resident accounts versus household members

`residents_v3` remains the resident/account model. `family_members` is the
household demographic model. `resident_id` is an optional link only; inserting
a household member must never create an authentication account.

## 7. Intentionally not backfilled

The migration does not backfill:

- resident rows;
- application household-member arrays;
- family aggregate counts;
- legacy household members;
- inferred members or DOBs.

No positional array pairing or matching by name, phone, address, timestamp, or
stored age is permitted.

## 8. Future application persistence location

The current server-side approval entry point is
`Backend/api/src/app/api/resident-applications/[id]/review/route.ts`.

After a family ID is known, a future reviewed change should persist validated,
structured household-member records there or in an extracted server service.
The payload must include a stable member identifier, full name, optional DOB,
family association, and application provenance. That persistence is not part
of Step 6.

## 9. Step 7 data-population strategy

1. Approve a structured member payload and stable idempotency key.
2. Dry-run existing data and classify resident-linked records as safe, while
   leaving unknown DOBs NULL.
3. Exclude ambiguous parallel arrays from automatic migration.
4. Report incomplete families and preserve their stored aggregates.
5. Persist new structured members with server-side validation and API scope
   checks.
6. Add coverage-preview comparisons before changing any AHP input.

## 10. Future dynamic-count strategy

For complete families only:

`family_members.birth_date` → `calculateCurrentAge()` → `classifyCurrentAge()`
→ dynamic demographic counts.

Families with missing member records or unknown DOBs must retain existing stored
age-derived aggregates until an explicit merge policy is approved.

## 11. AHP status

AHP weights, formulas, AI aggregation, ILP, recommendation generation, and
existing family counts remain unchanged. Later integration must preserve the
existing AHP input contract and consider dynamic replacement only for complete,
authoritative families.

## 12. Migration safety

- Migration created: **YES**;
- Migration applied: **YES**;
- Backfill performed: **NO**;
- Live data changed: **NO**;
- Existing application workflow changed: **NO**.

## 13. Validation

- Backend TypeScript check: passed;
- Backend production build: passed;
- Existing emergency tests: passed, 22/22;
- Focused family-members schema test: added but not run because this
  environment has no isolated local PostgreSQL socket. The test refuses to
  connect unless `SF_TEST_PG_SOCKET` points to a `/tmp` socket, so no
  production database was used;
- `git diff --check`: passed.

## 14. Exact Step 7 recommendation

Step 7 should establish the stable structured household-member payload and
idempotency key, then add a separately reviewed, server-validated persistence
path and a read-only coverage preview. It must not backfill ambiguous
application arrays, infer DOBs, or replace family aggregates/AHP inputs until
complete-authority and NULL-DOB policies are approved and tested.
