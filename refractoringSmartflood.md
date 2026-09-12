# SmartFlood Refactoring Plan: Dynamic Barangay Identity and AI Recommendations

## Executive summary

The current AI recommendation issue is caused by a hardcoded barangay registry in the standalone Python AI service. `Backend/ai/app/engine.py` always scores exactly three entries and defines ID `2` as `Barangay Catmon`. The service reads sensor and family rows, but it does not read the `barangays` master table or otherwise receive the current canonical name. Therefore, changing the database name from Catmon to Longos cannot change the AI output: the generated row is rebuilt with the hardcoded label.

This is not primarily an LLM/prompt problem. The recommendation engine is deterministic AHP/fuzzy/ILP code, and the stale name is introduced before allocation and explanation generation. The safest fix is to make `barangay_id` the stable identity, load the canonical `(barangay_id, barangay_name)` registry from the database, and use names only for display and controlled input normalization.

Backend and AI files are intentionally not changed in this pass because the repository rules require the exact authorization phrase `BACKEND_UNLOCK: wendev27` before modifying `Backend/**`. This document is the implementation plan and audit result.

## Confirmed root cause

Current flow:

```text
Frontend ReliefPanel
  -> POST /api/ai/recommendations/generate (inventory only)
  -> Backend/api proxy route
  -> Backend/ai FastAPI service
       -> read Mongo sensors/readings
       -> read Supabase families
       -> _scored_barangays(...)
            -> iterate hardcoded KNOWN_BARANGAYS
       -> apply AHP/fuzzy scoring and ILP allocation
       -> return barangay_name from KNOWN_BARANGAYS
```

The decisive code is:

- `Backend/ai/app/engine.py:8-25`: hardcoded registry and aliases; ID `2` maps to Catmon.
- `Backend/ai/app/engine.py:102-110`: only `KNOWN_BARANGAYS` are scored, even when database data contains other names.
- `Backend/ai/app/engine.py:153-173`: sensor/family records are normalized against that hardcoded alias table.
- `Backend/ai/app/repositories.py:50-59`: repository reads sensors, families, recommendations, and inventory, but has no `get_barangays()` operation.
- `Backend/ai/app/main.py:50-68`: generation receives inventory but no barangay registry or scope.

Consequences:

1. ID `2` can be correctly changed to Longos in Supabase while AI output remains Catmon.
2. A new barangay cannot participate in recommendations unless source code is edited.
3. Renaming a barangay is unsafe because names are used as aliases and display values in multiple layers.
4. Unknown or differently formatted names may be silently ignored by the AI engine instead of failing visibly.
5. Approved historical recommendation rows retain their original snapshot name, which is useful audit history but must be distinguished from current master data.

## Hardcoded-area audit

### Production or production-adjacent behavior to refactor

| Area | Current behavior | Risk | Planned treatment |
|---|---|---|---|
| AI registry | `KNOWN_BARANGAYS` contains Tanong, Catmon, Potrero and fixed IDs 1/2/3 | Critical: generated recommendation labels and eligibility are stale | Replace with a repository-loaded canonical registry keyed by ID |
| AI aliases | `BARANGAY_ALIASES` maps names, including Catmon, to fixed objects | High: old names can override current names; new names are ignored | Build aliases from the loaded registry; keep old aliases only as explicit, time-bounded compatibility aliases if needed |
| Backend sensor mapping | `Backend/api/src/lib/sensorMapping.ts` maps ID 2 and Catmon to Catmon | High: API sensor output can disagree with database master data | Centralize mapping or query the barangay registry; use sensor `barangay_id` where available |
| Frontend scope mapping | `Frontend/src/lib/barangayScope.ts` maps ID 2 to Catmon | High: scoped screens can display/filter the wrong name after rename | Resolve by ID from a shared API response or session-provided canonical object |
| Frontend sensor mapping | `Frontend/src/lib/sensorMapping.ts` maps ID 2 to Catmon | Medium/high: monitoring and maps may disagree with AI | Remove fixed names from runtime mapping; preserve only parsing/legacy input behavior |
| Frontend relief normalization | `ReliefPanel.tsx:1965+` accepts only IDs 1/2/3 and names Tanong/Catmon/Potrero | High: recommendation display and matching are not data-driven | Match by stable ID first; use canonical name list from API for name fallback |
| Frontend selectors/navigation | Residents, Account Management, and `navigationPresentation.ts` embed three names | Medium/high: UI remains stale even if AI is corrected | Load the master list once and derive options/groups; do not use UI labels as identity |
| Profile asset mapping | `profilePresentation.ts` maps both Longos and Catmon to the Longos seal | Medium: possibly intentional transition workaround, but ambiguous | Confirm asset ownership; use ID-based asset configuration or remove the Catmon alias after migration |

### Test fixtures, demo data, and documentation

These should not be changed by a blind global replace:

- `Backend/ai/tests/test_engine.py` and `test_recommendation_flow.py` intentionally exercise the old Catmon fixture and must be updated to prove ID 2 resolves to Longos after the refactor.
- `Frontend/tests/presentation.test.cjs` contains Catmon fixtures and expectations. Split tests into current-master-data tests and legacy-history tests.
- `Frontend/src/data/relief.mock.ts`, `residents.mock.ts`, `verification.mock.ts`, and `logs.mock.ts` contain prototype/demo Catmon values. Either mark them explicitly as legacy fixtures or update them if these files are still reachable in production builds.
- `Frontend/src/app/sensor-simulator/page.tsx` has a Catmon simulator entry. It should use the dynamic registry, with a test-only fallback only if the simulator is intentionally offline.
- `Backend/ai/README.md` and project audit/progress documents contain Catmon examples. Update examples after behavior is changed, but do not rewrite historical implementation notes.

## Target architecture

### Canonical identity rule

Use this invariant throughout the system:

```text
barangay_id = identity and join key
barangay_name = current display label from barangays master data
historical barangay_name = immutable snapshot on historical records, if audit semantics require it
```

The AI engine should never infer a current name from a numeric ID, and should never use a display name as the primary join key. Every sensor, family, recommendation, allocation item, notification, and user scope should carry the ID where the schema supports it.

### Proposed AI interfaces

Add a repository method conceptually equivalent to:

```python
def get_barangays(self) -> list[dict[str, Any]]: ...
```

The query should select the actual schema columns and return only active/valid rows as defined by the existing database contract. Because the repository currently shows both `id` and `barangay_id` patterns in the TypeScript API, verify the exact canonical key before implementation; do not guess or silently coalesce two different IDs.

Change the engine boundary conceptually to:

```python
generate_recommendations(
    barangays,
    sensors,
    latest_readings,
    families,
    inventory,
)
```

Then:

1. Normalize the registry once into `{stable_id: canonical_name}`.
2. Build optional input aliases from the registry, not from a fixed source-code list.
3. Prefer `barangay_id` fields on sensors/families.
4. Use name matching only for legacy documents that lack an ID.
5. Detect ambiguous/unresolved legacy names and report/metric them; do not silently drop them.
6. Score every active registry row, including rows with no sensor reading, while preserving current no-reading semantics.
7. Pass canonical names into explanations and allocation output.

The AHP weights, fuzzy thresholds, ILP objective functions, constraints, and allocation semantics should remain unchanged in the first refactor. This isolates the identity fix and makes regression comparison possible.

### Proposed API and frontend behavior

Prefer a single canonical barangay endpoint or an existing authorized response that already includes the master list. The frontend should fetch it through the normal authenticated API and cache it under a query key such as `barangays.all`.

The AI generation request does not need a client-supplied barangay list. The AI backend should read the authoritative list server-side; accepting names from the browser would reintroduce stale or tampered identity data.

Frontend presentation should:

- display `barangay_name` returned by the backend for recommendations and allocations;
- use `barangay_id` for filtering, React query keys, and scope checks;
- derive resident/account selectors and super-admin navigation from the canonical list;
- keep hardcoded values only for static design text, known historical fixtures, or explicit offline test data;
- remove parsing branches that equate `Catmon` with ID `2` once the database migration and compatibility window are complete.

## Safe implementation sequence

### Phase 0 — verify current data and contracts (read-only)

Before editing code, confirm in the target environment:

- the exact `barangays` columns and which column is the stable foreign-key target;
- active rows and current values for IDs 1, 2, and 3;
- whether sensors contain a stable `barangay_id` or only a text `barangayName`;
- whether families, users, allocation items, and recommendation history contain both ID and name;
- whether any pending/accepted workflow depends on the old Catmon text;
- whether Longos is a rename of ID 2 or a new row with a different ID.

Do not update historical recommendation or allocation rows merely to make the UI look current. Decide explicitly whether names in history are snapshots or live labels.

### Phase 1 — introduce a canonical registry abstraction

Implement the repository read and a small typed registry/normalization module. Add unit tests for:

- ID 2 returns the current database label Longos;
- name variants resolve to the correct current ID;
- an unknown name is rejected or surfaced as unresolved;
- duplicate normalized names are detected;
- inactive rows are excluded consistently;
- numeric IDs are not confused with a display-name column.

At this stage, keep the existing endpoint shapes and preserve old function overloads/adapters if needed. Avoid changing scoring logic.

### Phase 2 — switch AI generation to the registry

Load the registry alongside sensors and families in the FastAPI generation route and pass it into the engine. Replace only the hardcoded iteration and alias construction. Preserve the existing recommendation response fields and audit events.

Add a temporary diagnostic field or structured log/metric outside the public response if operationally acceptable:

- registry row count;
- input rows by barangay ID;
- unresolved sensor/family names;
- generated IDs and canonical names.

Do not log resident personal data or secrets.

### Phase 3 — align backend API mappings

Update `sensorMapping.ts` and any other backend mapping helpers to use the same source of truth or to pass through already-associated IDs. Add endpoint tests proving that the sensor/latest and sensor/history APIs label ID 2 as Longos after the master-data change.

### Phase 4 — align frontend identity and selectors

Create one frontend `BarangayOption` type and query path. Update scope, sensor, resident, account, relief, navigation, and simulator code to consume it. Make React Query keys include a stable scope ID where a query is barangay-specific.

Keep UI formatting (`Barangay ` prefix, capitalization, accent handling) separate from identity resolution. Never use a formatted label as a security boundary.

### Phase 5 — compatibility cleanup

After production verification confirms all active data has IDs:

- remove fixed ID/name tables from runtime code;
- remove Catmon aliases from current-data paths;
- retain a documented legacy-history formatter only if old records need to remain readable;
- update fixtures and documentation;
- decide whether the old Catmon seal mapping is still valid.

## Regression and acceptance tests

### AI service

Add or update tests to verify:

1. Given registry `{2: "Barangay Longos"}` and family/sensor rows with ID `2`, every generated plan and explanation says Longos.
2. No generated row says Catmon unless the supplied registry itself says Catmon.
3. The number of output barangays equals the active registry rows, not a hardcoded count of three.
4. A newly added registry row is scored without source changes.
5. Sensor and family records join by ID even when their names differ in case, accents, or spelling.
6. Unresolved legacy text is visible in diagnostics and does not get assigned to the wrong barangay.
7. Existing AHP values, fuzzy classifications, ILP constraints, integer allocations, inventory ceilings, and no-reading behavior remain unchanged for a fixed fixture.
8. Approval still saves the same allocation fields and preserves authorization/audit behavior.

### API and frontend

Test that:

- recommendation GET returns persisted history without relabeling historical snapshots unexpectedly;
- recommendation generation returns Longos for current ID 2;
- sensor latest/history and scope endpoints agree on ID/name;
- a Longos user sees only ID 2 records;
- a Catmon legacy record cannot grant access to a Longos user through name matching;
- selectors and navigation update when the master list changes;
- query caches do not reuse another barangay's data;
- offline/demo fixtures are not used by the production recommendation path.

### Manual smoke test

Use a non-production environment with a database backup or snapshot:

1. Record the current recommendation output for a fixed inventory fixture.
2. Confirm the current master row for ID 2 is Longos.
3. Generate a draft and verify all ID/name pairs.
4. Review each plan, approve one, and verify the allocation workflow and notifications.
5. Reload history and confirm the intended snapshot/live-name behavior.
6. Sign in as a barangay-scoped user and verify isolation.
7. Exercise failure cases: registry unavailable, sensor unavailable, family data unavailable, and unknown barangay input.

## Rollout and rollback

Use a feature flag or deployment toggle for the registry-backed generator if the deployment system supports it. During rollout, compare old and new outputs using the same captured inputs, but compare identity by `barangay_id` and allocations by resource—not by name string.

Rollback should be an application deployment rollback, not a database rename rollback. Do not revert the database master name just because an old binary displays Catmon. If a compatibility alias is required, make it read-only and temporary, and ensure it cannot override the canonical ID/name pair.

Before release, take a database backup/snapshot and record the exact master-data mapping. After release, monitor unresolved mappings, output row counts, recommendation generation failures, and approval failures.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Wrong column selected as the canonical ID | Verify foreign keys and existing API joins before implementation; add ID/name contract tests |
| Historical records unexpectedly renamed | Treat historical names as snapshots unless product explicitly requires live joins |
| Sensor documents contain only legacy text | Add an explicit migration/backfill plan or controlled alias table; report unresolved rows |
| Frontend and AI deploy out of order | Keep response fields compatible; deploy registry read/API support before switching consumers |
| New registry row has no family/sensor data | Preserve no-reading/zero-demand output and show an honest explanation |
| Stale browser cache | Invalidate relevant query keys after master-data updates; use ID in keys |
| Security scope regression | Keep authorization based on assigned numeric ID; never broaden access based on display names |
| Static assets still mention Catmon | Classify each asset as current, historical, or prototype before renaming/replacing |

## Recommended change list by file

First implementation pass should likely touch:

- `Backend/ai/app/repositories.py` — add canonical barangay read.
- `Backend/ai/app/engine.py` — accept registry; remove fixed runtime registry and aliases.
- `Backend/ai/app/main.py` — load and pass registry while preserving endpoint contracts.
- `Backend/ai/tests/test_engine.py` and `test_recommendation_flow.py` — registry-driven fixtures and rename regression tests.
- `Backend/api/src/lib/sensorMapping.ts` — remove current-name hardcoding or route it through canonical data.
- `Frontend/src/lib/barangayScope.ts` — ID-first scope resolution.
- `Frontend/src/lib/sensorMapping.ts` — ID-first mapping and dynamic display names.
- `Frontend/src/components/relief/ReliefPanel/ReliefPanel.tsx` — remove fixed ID/name fallback logic.
- `Frontend/src/components/residents/ResidentsPanel/ResidentsPanel.tsx` — dynamic barangay options.
- `Frontend/src/components/logs/AccountManagement/AccountManagement.tsx` — dynamic department/barangay options.
- `Frontend/src/adapters/navigationPresentation.ts` — derive groups from canonical options.
- `Frontend/src/app/sensor-simulator/page.tsx` — dynamic simulator options or explicit test-only data.
- relevant frontend tests and mock fixtures — separate current master-data fixtures from legacy history fixtures.

Do not modify AHP weights, fuzzy thresholds, ILP constraints, auth/RBAC, or database rows in the same first commit. Those are separate concerns and combining them would make a regression difficult to diagnose.

## Definition of done

The refactor is complete when the system can rename ID 2 from Catmon to Longos in the canonical database row and, after normal cache/deployment propagation:

- AI recommendations, explanations, plans, and newly approved allocations use Longos;
- no runtime production path requires editing a source-code barangay list;
- all joins and authorization checks use stable IDs;
- historical display behavior is documented and tested;
- a new barangay can be added through master data without a code change;
- the existing scoring/allocation behavior passes regression tests;
- unknown/ambiguous mappings are observable and fail safely;
- frontend selectors, navigation, maps, sensors, residents, and relief views agree with the same registry.

