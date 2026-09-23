# Dynamic Pregnancy Weeks

## Status

Implementation is complete in source code. Migration
`20260917000002_add_family_member_vulnerabilities.sql` has been applied to the
active Supabase project.

The structured household-member UI is enabled through
`SHOW_STRUCTURED_HOUSEHOLD_MEMBERS = true` after live schema verification.

## Authoritative model

- `pregnancy_weeks` is the stored baseline number of weeks.
- `pregnancy_baseline_at` is the server-trusted time when that baseline was
  recorded.
- `current_pregnancy_weeks` is response-only and is never persisted.

For pregnant members, both stored baseline fields are required. For
non-pregnant members, both fields must be NULL.

## Calculation

`calculateCurrentPregnancyWeeks()` uses Asia/Manila calendar dates:

```text
current = baseline pregnancy_weeks
        + floor(calendar days since pregnancy_baseline_at / 7)
```

Missing, malformed, or future baselines return NULL. The result is not capped
at 40 or 42 weeks and does not automatically alter pregnancy status.

Example: a 24-week baseline recorded September 17 remains 24 through
September 23 and becomes 25 on September 24.

## Write behavior

- Application approval uses `resident_applications.submitted_at`. It never
  falls back to `created_at`.
- Manual RBI member creation uses the current server timestamp.
- Editing unrelated member fields preserves `pregnancy_baseline_at`.
- Changing the stored baseline weeks resets the timestamp to current server
  time.
- Disabling pregnancy clears both baseline fields.
- Enabling pregnancy without valid baseline weeks is rejected.

## Read behavior

Structured member API responses include:

```json
{
  "is_pregnant": true,
  "pregnancy_weeks": 24,
  "pregnancy_baseline_at": "2026-09-17T04:00:00.000Z",
  "current_pregnancy_weeks": 25
}
```

Accounts review remains read-only. RBI View, Edit, and Family Cluster display
the backend-derived current value while keeping baseline weeks distinct. The
frontend never submits `current_pregnancy_weeks`.

Legacy `pregnant_full_names[]` and `pregnancy_weeks[]` are displayed as
separate submitted lists. They are not paired by array position or converted
to structured member identities.

## Deployment status

The schema and structured UI are restored. The completed data preparation was:

1. Migration `00002` was manually applied by the user.
2. `pregnancy_baseline_at` and the vulnerability columns were verified live.
3. Existing resident identities were inserted as 55 linked member records:
   33 with exact DOBs and 22 with NULL DOBs.
4. No vulnerability or pregnancy state was inferred from legacy arrays.
5. `SHOW_STRUCTURED_HOUSEHOLD_MEMBERS` was enabled.

No legacy-array conversion, synthetic pregnancy record, AHP/AI/ILP change,
family aggregate change, or authentication/RBAC change was performed.
