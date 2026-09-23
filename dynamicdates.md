# SmartFlood Dynamic Dates Reviewer

## A. Dynamic resident age

### Defense answer

SmartFlood stores the stable fact—`birth_date`—and calculates current age whenever data is returned. The calculation uses the current `Asia/Manila` calendar date and checks whether this year's birthday has occurred. The legacy `residents_v3.age` remains only for compatibility when DOB is absent.

```text
residents_v3.birth_date
  -> calculateCurrentAge()
  -> residentWithCurrentAge()
  -> resident API response age + age_source
  -> RBI frontend
```

### Source

- Timezone constant: `Backend/api/src/lib/dateUtils.ts`, line 1
- `calculateCurrentAge()`: lines 84-98
- `residentWithCurrentAge()`: lines 235-260
- `GET /api/residents`: `Backend/api/src/app/api/residents/route.ts`, lines 9-35
- Resident create/update responses also call the same enrichment: `residents/route.ts`, lines 37-156; `residents/[id]/route.ts`, lines 37-154

### Exact calculation

Input: a valid `YYYY-MM-DD` string or `Date`, plus optional `asOf` for deterministic tests.

Processing:

1. Parse and validate the DOB.
2. Convert `asOf` to a Manila calendar date.
3. Start with `today.year - birth.year`.
4. Subtract one when today's month/day is before the birthday.
5. Return `null` for malformed or future dates.

Example:

```text
DOB 2000-09-18
As of 2026-09-17 Manila -> 25
As of 2026-09-18 Manila -> 26
```

This is why `currentYear - birthYear` is insufficient.

### Legacy behavior

If `birth_date` exists, `residentWithCurrentAge()` replaces response `age` with the calculated value and returns `age_source: "birth_date"`. If DOB is absent, it preserves the stored legacy age and returns `age_source: "legacy"` plus unknown classification. Missing DOB is never inferred.

The migration that added DOB is `supabase/migrations/20260917000000_add_resident_birth_date.sql`, lines 1-14. Its backfill requires an exact approved application relationship; unmatched rows remain NULL.

## B. Dynamic age classification

### Approved policy

| Classification | Boundary |
|---|---|
| Infant | birth through exactly 12 months inclusive |
| Toddler | after 12 months and under 4 years |
| Preschool / Young Child | 4-6 years |
| Child | 7-12 years |
| Teen / Adolescent | 13-17 years |
| Adult | 18-59 years |
| Senior Citizen / Elderly | 60+ |

Policy constants: `APPROVED_DEMOGRAPHIC_AGE_POLICY`, `Backend/api/src/lib/dateUtils.ts`, lines 61-72.

Flow:

```text
birth_date -> calculateCurrentAge() -> classifyCurrentAge()
           + DOB/asOf context for the 12-month boundary
```

`classifyCurrentAge()` is at lines 126-157. Approved life-stage handling is `classifyApprovedLifeStage()` at lines 159-217.

### Why DOB context is required at age one

Whole-year age is `1` both on the first birthday and afterward. The policy says exactly 12 months is still Infant, while the next calendar day is Toddler. Lines 195-209 compare the Manila date to the first anniversary. If DOB/as-of context is unavailable at this boundary, classification is explicitly `unknown` with reason `boundary_context_unavailable`.

### Unknown behavior

- missing/invalid/future DOB -> age unavailable -> unknown classification;
- pending policy -> `policy_unconfigured`;
- invalid thresholds -> `invalid_policy`;
- no legacy age is silently promoted into authoritative classification.

### Family-level preview

`buildFamilyDemographicComparison()` in `Backend/api/src/lib/familyMembers.ts`, lines 469-536, calculates infant/toddler/elderly preview counts only when family coverage is complete. `calculateDynamicCounts()` is lines 539-560. It does not overwrite `families` and does not feed AHP.

## C. Dynamic pregnancy weeks

### Defense answer

SmartFlood stores a baseline number of weeks and the timestamp when that baseline became authoritative. It derives the current number by adding complete Manila calendar weeks elapsed. It does not update every row weekly.

Stored facts:

- `family_members.pregnancy_weeks`
- `family_members.pregnancy_baseline_at`
- `family_members.is_pregnant`

Derived fact:

- `current_pregnancy_weeks`

Schema: `supabase/migrations/20260917000002_add_family_member_vulnerabilities.sql`, lines 5-34. Its check requires pregnant members to have weeks 0-42 and a timestamp; non-pregnant members must have both fields NULL.

### Source and formula

`calculateCurrentPregnancyWeeks()` is in `Backend/api/src/lib/dateUtils.ts`, lines 104-119.

```text
elapsed_days = ManilaCalendarDay(today) - ManilaCalendarDay(baseline_at)
current_weeks = baseline_weeks + floor(elapsed_days / 7)
```

It returns `null` for a non-integer/negative baseline, missing/invalid timestamp, or future baseline date.

Example:

```text
baseline weeks: 24
baseline date: 2026-09-17
2026-09-17 -> 24
2026-09-24 -> 25
2026-10-01 -> 26
```

The function does not cap derived weeks at 42. The input baseline is constrained to 0-42, but time can advance beyond 42 until pregnancy status is corrected. This is an implementation limitation worth stating honestly.

### Application-to-member baseline

```text
resident application household_members / legacy pregnancy_weeks
  + resident_applications.submitted_at
  -> review response derives current weeks
  -> approval validates structured members
  -> family_members.pregnancy_baseline_at = submitted_at
  -> family-member API derives current_pregnancy_weeks
  -> RBI frontend displays it
```

Important functions:

- `residentApplicationWithCurrentPregnancyWeeks()`: `Backend/api/src/lib/familyMembers.ts`, lines 376-406. It uses `submitted_at` as the baseline for structured application members and separate legacy week entries.
- `pregnancyBaselineAtForMembers()`: lines 310-324. Approval requires a valid non-future submission timestamp if any structured member is pregnant.
- `persistStructuredHouseholdMembers()`: lines 192-307. It stores the trusted application baseline with the member.
- Review approval integration: `Backend/api/src/app/api/resident-applications/[id]/review/route.ts`, lines 83-95 and 145-157/208-218.
- `familyMemberWithCurrentPregnancyWeeks()`: `familyMembers.ts`, lines 360-373. It enriches output only.
- Family-member GET: `Backend/api/src/app/api/family-members/route.ts`, lines 11-64.

### Edit behavior

`resolvePregnancyBaselineAtForUpdate()` is `familyMembers.ts`, lines 327-357:

- changing to non-pregnant clears baseline weeks/timestamp;
- starting pregnancy tracking sets timestamp to now;
- explicitly changing baseline weeks sets timestamp to now;
- unrelated edits preserve the prior timestamp;
- an existing pregnant member with a missing/invalid timestamp is rejected instead of guessed.

The member PATCH route applies this behavior at `Backend/api/src/app/api/family-members/[id]/route.ts`, lines 18-82.

## D. Structured household-member path

### Stored model

`family_members` is an authoritative household demographic record distinct from resident accounts:

- migration/table: `supabase/migrations/20260917000001_create_family_members.sql`, lines 4-22;
- one optional resident link per member: unique partial index, lines 31-33;
- family/application provenance: foreign keys, lines 6-17;
- direct anon/authenticated access denied; server service role only, lines 35-49.

The vulnerability extension adds explicit PWD, pregnant, lactating, and 4Ps flags. Infant/toddler/elderly are derived from DOB, not boolean columns.

### Registration and approval

`POST /api/resident-applications` validates and stores the optional structured JSON snapshot. On approval, `PATCH /api/resident-applications/[id]/review` creates/chooses the family, then calls `persistStructuredHouseholdMembers()` with server-known family and application IDs.

Legacy name arrays and birth-date arrays are **not paired by position**. The structured contract requires a stable `member_id`. Validation is `validateStructuredHouseholdMembers()`, `familyMembers.ts`, lines 117-189.

### RBI view/edit

- API read enrichment: `Backend/api/src/app/api/family-members/route.ts`, lines 11-64.
- RBI create/update/delete calls: `Frontend/src/components/residents/ResidentsPanel/ResidentsPanel.tsx`, `syncFamilyMembers()`, lines 1057-1107.
- Historical application lists remain read-only and separate: `SubmittedApplicationDetails()`, lines 1109-1207.
- Structured member read table: `HouseholdMembersReadOnly()`, lines 1229-1294.
- Structured member editor: `HouseholdMemberEditor()`, lines 1296-1402.

The frontend age preview in `Frontend/src/lib/householdMembers.ts`, lines 140-170, is explicitly presentation-only and mirrors the approved server policy. Server API values remain authoritative for persisted data flow.

## E. Dynamic-date design principle

Store facts that do not become stale; derive facts that change with time:

| Stored fact | Derived response fact |
|---|---|
| Birth date | Current age and life-stage classification |
| Pregnancy baseline weeks | Current pregnancy weeks |
| Pregnancy baseline timestamp | Complete weeks elapsed |

Benefits:

- no nightly birthday update job;
- no weekly pregnancy update job;
- consistent Manila boundaries;
- auditable original facts;
- testable calculations using an injected `asOf` date;
- no drift from partially completed scheduled updates.

## F. Limitations and exact claims

- `residents_v3.age` still exists for legacy compatibility and is returned when DOB is NULL.
- Dynamic family counts are preview-only and are not connected to AHP.
- Families with incomplete member/DOB coverage do not receive dynamic comparison counts.
- Frontend contains a presentation mirror of age logic; the server utility is authoritative for APIs.
- Legacy application arrays remain separate and cannot establish member identity.
- Derived pregnancy weeks can exceed 42 until the record is updated to reflect the pregnancy outcome.
