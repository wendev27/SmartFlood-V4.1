# How SmartFlood Generates Relief Recommendations

## One request, end to end

### 1. The operator enters inventory

- Directory: `Frontend/src/components/relief/ReliefPanel`
- File: `ReliefPanel.tsx`
- Relevant flow: generation handlers around lines 456-570
- Client function: `Frontend/src/services/reliefService.ts`, `generateReliefRecommendations()`, lines 27-33

Input is whole-unit quantities for family food packs, medicine/emergency kits, and individual relief goods. The frontend sends them to `/api/ai/recommendations/generate` with audit-actor presentation data.

### 2. The Next.js API normalizes and proxies the request

- File: `Backend/api/src/app/api/ai/recommendations/generate/route.ts`
- Function: `POST()`
- Lines: 14-59

`toWholeNumber()` floors positive finite values and maps other values to zero. At least one unit is required. `AI_BACKEND_URL` identifies the Python service. This route does not calculate recommendations itself.

### 3. The Python service loads live inputs

- File: `Backend/ai/app/main.py`
- Function: `create_recommendations()`
- Lines: 45-72

The service rejects an all-zero inventory, then loads:

- sensors and the latest reading for each sensor from MongoDB;
- family aggregate vulnerability rows and barangays from Supabase;
- operator-entered inventory from the request.

Repository implementation: `Backend/ai/app/repositories.py`, lines 47-93. Family fields selected are at lines 23-26.

### 4. Inputs are grouped by canonical barangay

- File: `Backend/ai/app/engine.py`
- Functions: `_scored_barangays()`, `_group_sensors()`, `_group_families()`
- Lines: 92-106, 142-177

The code builds aliases from the barangay registry, takes the maximum latest water level per barangay, and sums stored family counts. Output is one aggregate input row per barangay.

### 5. Flood severity is analyzed

- File: `Backend/ai/app/engine.py`
- Functions: `_risk_from_water_level()`, `_fuzzy_explanation()` and membership helpers
- Lines: 288-295, 324-342, 354-377

The fuzzy layer returns degrees for normal, flood alert, flood warning, and severity. A crisp threshold assigns the operational risk label. There is no fuzzy rule base or defuzzification in the current repository.

### 6. Vulnerability is scored

- File: `Backend/ai/app/engine.py`
- Constants/function: `AHP_WEIGHTS`, `AHP_COUNT_FIELDS`, `_ahp_breakdown()`
- Lines: 18-38 and 311-321

Each stored vulnerability count is multiplied by its fixed weight and summed. This is a simplified AHP-inspired weighted sum, not runtime pairwise AHP.

### 7. Barangay demand and base priority are prepared

- File: `Backend/ai/app/engine.py`
- Function: `_score_barangay()`
- Lines: 180-215

The base priority is `risk weight × 100 + vulnerability score + total family members`. Food demand is affected-family count, individual-goods demand is population, and kit demand is the sum of PWD, elderly, lactating, pregnant, and infant counts.

### 8. Three strategy coefficients are built

- File: `Backend/ai/app/ilp.py`
- Constants/functions: `OPTIMIZATION_PROFILES`, `_profile_priority()`
- Lines: 37-74 and 257-266

#### Severity First

- Severity weight: 2.5
- Vulnerability weight: 0.7
- Coverage targets: food 55%, individual goods 45%, emergency kits 100%

It makes differences in flood-risk category dominate the coefficient and reserves full kit-demand coverage as the target when supply permits.

#### Vulnerability First

- Severity weight: 0.7
- Vulnerability weight: 2.5
- Coverage targets: food 90%, individual goods 90%, emergency kits 55%

It emphasizes the AHP-inspired demographic score plus total members.

#### Balanced

- Severity weight: 1.0
- Vulnerability weight: 1.0
- Coverage targets: 75% for all three resources

It gives the two coefficient components equal multipliers. The top-level compatibility recommendation rows use Balanced, but all three plans are returned for selection (`engine.py`, lines 41-58).

### 9. PuLP/CBC solves the ILP

- File: `Backend/ai/app/ilp.py`
- Functions: `build_optimization_plans()`, `_solve_resource_allocation()`
- Lines: 92-173 and 189-239

For every profile and resource category, the solver chooses integer units per barangay. It maximizes the weighted sum of allocations while keeping every allocation non-negative, integral, below demand, and total allocation below effective supply. The effective supply also applies the strategy coverage target (`_effective_supply()`, lines 242-249).

Output is three plans containing allocation rows, objective values, solver statuses, profile weights, coverage targets, constraints, and reasoning text.

### 10. Generation returns drafts only

- File: `Backend/ai/app/main.py`
- Function: `create_recommendations()`
- Lines: 45-72

Generation logs an audit event, but does **not** insert recommendation-history rows. Test proof: `Backend/ai/tests/test_recommendation_flow.py`, lines 66-78.

### 11. A human reviews a strategy

- Frontend service: `Frontend/src/services/reliefService.ts`, lines 35-49
- Approval API: `Backend/api/src/app/api/ai/recommendations/approve/route.ts`, lines 16-71
- Rejection API: `Backend/api/src/app/api/ai/recommendations/reject/route.ts`, lines 10-37

The dashboard user can switch among plans and approve or reject one. Approval and rejection require an authenticated `super` or `cswdd` viewer. This is the Human-in-the-Loop boundary: draft output alone does not become an active allocation.

### 12. Approval persists history and workflow

First the Next.js approval route sends the selected plan to FastAPI. FastAPI validates the allocation list and inserts projected rows into `ai_recommendations`:

- `Backend/ai/app/main.py`, `approve_recommendations()`, lines 75-109
- `Backend/ai/app/payloads.py`, `recommendation_rows_to_save()`, lines 13-27
- `Backend/ai/app/repositories.py`, `save_recommendations()`, lines 73-74

Then Next.js creates an accepted workflow batch and one item per barangay:

- `Backend/api/src/lib/emergencyWorkflow.ts`, `createAcceptedWorkflowBatch()`, lines 122-194
- Tables: `emergency_allocation_batches`, `emergency_allocation_items`

Equivalent accepted plans are detected to avoid duplicate active batches (`emergencyWorkflow.ts`, lines 58-94).

### 13. Rejection is recorded separately

`createRejectedWorkflowBatch()` records the plan/status/reviewer in `emergency_allocation_batches` but does not save AI recommendation rows or allocation items. Source: `Backend/api/src/lib/emergencyWorkflow.ts`, lines 196-230.

### 14. Distribution is a later human workflow

Acceptance does not physically distribute goods. Authorized users notify barangays, start a campaign, barangays accept/confirm receipt, family heads are notified, and receipt/distribution records are verified. Campaign start is `Backend/api/src/app/api/emergency/campaigns/[batchId]/start/route.ts`, lines 13-75. Distribution rows are defined in `supabase/migrations/20260813010000_create_relief_distributions.sql`, lines 13-34.

## AI recommendation versus final decision

| AI-generated draft | Human-approved decision |
|---|---|
| Three optimized alternatives | One selected plan |
| Not recommendation history | Saved to `ai_recommendations` |
| No workflow batch | Accepted/rejected batch records |
| Cannot begin distribution | Can proceed to notification/campaign stages |

“AI recommendation” in this project means an explainable deterministic allocation proposal produced by multicriteria scoring, fuzzy membership analysis, and ILP. It does not mean autonomous delivery or a learned prediction.

## Practical examples

### When inventory is insufficient

The model cannot exceed the effective supply. Since each unit earns its barangay coefficient in the maximization objective, higher-coefficient barangays receive limited units first, subject to demand bounds. A barangay can receive zero.

### When a sensor reading is missing

If a registered sensor has no latest reading, risk becomes `no_reading` and the response explicitly says no latest reading was available (`engine.py`, lines 180-237). The code does not fabricate a reading.

### When demographic data is entirely absent

The optimizer raises `OptimizationError` if all barangays lack affected-family and total-member demand (`ilp.py`, lines 252-254). The generation endpoint returns HTTP 422 (`main.py`, lines 57-60).

## Important accuracy notes

- Current AI family inputs come from `families` aggregate fields, not from dynamic `family_members` classifications.
- There is no family-level ILP allocation; decision variables are barangay/resource units.
- There is no ML training dataset or model.
- There is no fuzzy rule base or defuzzification.
- There is no hard minimum/equity-floor constraint.
- Approval RBAC exists; generation-route RBAC was not found in `generate/route.ts`.
