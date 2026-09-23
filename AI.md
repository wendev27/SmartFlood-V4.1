# SmartFlood AI Reviewer

## 1. What the AI does

SmartFlood is an AI-assisted decision-support system for allocating limited relief inventory among barangays. It receives the latest sensor readings from MongoDB, barangay and family vulnerability aggregates from Supabase, and inventory quantities entered by an operator. It returns three integer allocation strategies for family food packs, individual relief goods, and emergency kits.

The implementation is deterministic. It does not train or run a machine-learning model. It combines:

1. fixed, AHP-inspired demographic weights;
2. fuzzy membership values and a crisp flood-risk label from water level;
3. Integer Linear Programming (ILP) with PuLP/CBC;
4. an explicit human accept/reject step.

Database repositories prepare inputs, the Python service calculates plans, the Next.js API enforces approval RBAC and creates workflow records, and React presents the results.

## 2. Actual AI architecture

```text
MongoDB sensors/readings + Supabase families/barangays + operator inventory
  -> repository loading
  -> barangay grouping and normalization
  -> fuzzy water-level memberships + crisp risk label
  -> AHP-inspired vulnerability weighted sum
  -> strategy-specific priority coefficient
  -> PuLP/CBC integer optimization per resource
  -> three draft strategies
  -> human selects Approve or Reject
  -> approved recommendation rows + emergency workflow batch/items
  -> notifications, campaign, and distribution workflow
```

| Stage | File / function / final lines | Input | Processing | Output |
|---|---|---|---|---|
| Load data | `Backend/ai/app/repositories.py`, `DatabaseRepository`, 47-93 | MongoDB and Supabase | Latest reading per sensor; selects barangays, families, inventory/history | Python dictionaries |
| Generate endpoint | `Backend/ai/app/main.py`, `create_recommendations()`, 45-72 | Validated inventory | Loads current data and invokes engine without saving history | Draft rows and plans |
| Preprocess | `Backend/ai/app/engine.py`, `_scored_barangays()`, 92-106; grouping 142-177 | Sensors, readings, family rows | Canonicalizes barangays and aggregates maxima/counts | One scored input per barangay |
| Fuzzy layer | `Backend/ai/app/engine.py`, `_fuzzy_explanation()`, 324-342 | Water level in metres | Computes four membership degrees; assigns risk by thresholds | Membership map, risk label, confidence |
| AHP-inspired layer | `Backend/ai/app/engine.py`, weights 18-38 and `_ahp_breakdown()`, 311-321 | Seven family vulnerability counts | Count × fixed weight, then sum | Vulnerability score and breakdown |
| Combined score | `Backend/ai/app/engine.py`, `_score_barangay()`, 180-215 | Risk, vulnerability, population | `risk_weight*100 + vulnerability + members` | Base priority score and demand ceilings |
| Strategies | `Backend/ai/app/ilp.py`, profiles 37-74 and `_profile_priority()`, 257-266 | Base components | Reweights severity and vulnerability | Strategy coefficient per barangay |
| ILP | `Backend/ai/app/ilp.py`, `_solve_resource_allocation()`, 189-239 | Coefficients, demand, inventory | Maximizes weighted integer units within bounds | Whole-unit allocations |
| Human gate | `Backend/api/src/app/api/ai/recommendations/approve/route.ts`, `POST()`, 16-71 | Selected plan + session | Requires super/CSWDD; validates, persists, creates workflow | Accepted batch/items |

## 3. AHP

### Simple defense explanation

AHP generally helps assign relative importance to criteria. SmartFlood uses the resulting idea—a normalized criterion-weight vector—to combine several vulnerability counts into one comparable score.

### Actual SmartFlood implementation

SmartFlood implements a **simplified/custom AHP-inspired weighted sum**. The repository contains no runtime pairwise-comparison matrix, consistency ratio, eigenvector calculation, or matrix normalization. The seven weights are fixed constants and already sum to 1.00:

| Criterion | Weight | Stored source field |
|---|---:|---|
| Infant | 0.22 | `families.infant_count` |
| Elderly | 0.20 | `families.elderly_count` |
| PWD | 0.18 | `families.pwd_count` |
| Pregnant | 0.12 | `families.pregnant_count` |
| Lactating | 0.10 | `families.lactating_count` |
| Toddler | 0.10 | `families.toddler_count` |
| 4Ps | 0.08 | `families.four_ps_count` |

Definitions: `Backend/ai/app/engine.py`, lines 18-38. Family input query: `Backend/ai/app/repositories.py`, lines 23-26 and 67-68.

Formula actually implemented:

```text
contribution_i = count_i * weight_i
total_vulnerability_score = sum(contribution_i)
```

Code: `_ahp_breakdown()`, `Backend/ai/app/engine.py`, lines 311-321.

Example matching the tests: two infants, one elderly, and one PWD produce `2×0.22 + 1×0.20 + 1×0.18 = 0.82`. Test evidence: `Backend/ai/tests/test_engine.py`, lines 73-90.

The base barangay priority is:

```text
base_priority = risk_weight(risk_level) * 100
              + total_vulnerability_score
              + total_family_members
```

Code: `_score_barangay()`, lines 180-215. Risk weights are severity=4, warning=3, alert=2, otherwise=1 at lines 298-299. The ILP profile later recomputes a coefficient from severity and `(AHP score + members)`.

## 4. Fuzzy Logic

### General concept

Fuzzy logic represents partial membership instead of forcing every value into only one category.

### SmartFlood implementation

SmartFlood calculates memberships for `normal`, `flood_alert`, `flood_warning`, and `severity` using descending, trapezoidal, and ascending functions. Source: `Backend/ai/app/engine.py`, `_fuzzy_explanation()` lines 324-342 and membership helpers lines 354-377.

Membership ranges:

- normal: full through 0.25 m, descends to zero at 0.50 m;
- flood alert: trapezoid from 0.25 to 0.75 m, full from 0.25 to 0.50 m;
- flood warning: trapezoid from 0.50 to 1.20 m, full from 0.75 to 1.00 m;
- severity: rises from zero at 1.00 m to full at 1.20 m.

The operational risk label is selected separately by crisp thresholds in `_risk_from_water_level()`, lines 288-295: severity ≥1.2, warning ≥0.75, alert ≥0.25, otherwise normal. `confidence` is the selected label's membership.

Important honesty: **no fuzzy IF/THEN rule base and no defuzzification were found in the current repository.** Membership values explain uncertainty, but the crisp risk label supplies the numeric risk weight. Therefore, do not claim “high vulnerability AND high severity” is a coded fuzzy rule.

Example: 0.80 m is classified as `flood_warning`; its warning membership is 1.0. This behavior is asserted in `Backend/ai/tests/test_engine.py`, lines 73-88.

## 5. Linear Programming / ILP

SmartFlood uses Integer Linear Programming because relief items are indivisible whole units. PuLP creates the model and the bundled CBC solver solves it (`Backend/ai/app/ilp.py`, import line 6; dependency `Backend/ai/requirements.txt`, line 5).

### Resources and demand ceilings

Defined at `Backend/ai/app/ilp.py`, lines 11-35:

- food-pack demand = affected families;
- individual-goods demand = total family members;
- emergency-kit demand = PWD + elderly + lactating + pregnant + infant (`engine.py`, lines 192-198).

### Decision variables

For each resource and barangay, `x` is a non-negative integer with upper bound equal to recorded demand. Code: `_solve_resource_allocation()`, lines 189-239, especially 209-211.

### Objective

```text
maximize sum(priority_coefficient_barangay * x_barangay)
```

Code: line 214. Higher-priority barangays make each allocated unit more valuable to the objective.

### Constraints

- `0 <= x_barangay <= demand_barangay` through variable bounds;
- all `x` are integers;
- `sum(x) <= effective_supply` at line 215;
- effective supply is capped by entered inventory, total demand, and strategy coverage target at `_effective_supply()`, lines 242-249.

CBC must return `Optimal`, or `OptimizationError` is raised (lines 217-220). Post-solve checks guard supply and demand ceilings (lines 222-227).

No hard equity-floor constraint was found; the response explicitly reports this at `build_optimization_plans()`, line 162. No family-level decision variable is used—the model allocates to barangays.

## 6. Relationship between AHP, fuzzy, and ILP

| Component | Input | Processing | Output | Used by |
|---|---|---|---|---|
| AHP-inspired score | Stored family vulnerability counts | Fixed weighted sum | Demographic vulnerability score | Strategy priority coefficient |
| Fuzzy layer | Latest maximum water level | Membership functions plus crisp label | Risk explanation and risk weight category | Base/strategy priority coefficient |
| ILP | Priority coefficients, demands, inventory | Whole-unit maximization | Three allocation plans | Human reviewer |

The fuzzy memberships themselves are not directly multiplied into the objective. The selected crisp risk label is converted to a 1–4 risk weight. AHP and fuzzy-derived risk meet in `_score_barangay()` and `_profile_priority()`.

## 7. Three strategies

Defined in `Backend/ai/app/ilp.py`, lines 37-74:

- **Severity First:** severity 2.5, vulnerability 0.7; coverage targets food 0.55, goods 0.45, kits 1.0.
- **Vulnerability First:** severity 0.7, vulnerability 2.5; targets food 0.9, goods 0.9, kits 0.55.
- **Balanced:** both weights 1.0; all targets 0.75.

The profile formula is at lines 257-266:

```text
coefficient = severity_component * profile.severity_weight
            + (AHP vulnerability + total members) * profile.vulnerability_weight
```

## 8. Important source map

```text
Backend/ai/app/
├── repositories.py   data access (47-112)
├── main.py           HTTP generation/approval (38-109)
├── engine.py         grouping, AHP-inspired score, fuzzy memberships (18-377)
├── ilp.py            strategies and PuLP/CBC models (11-289)
├── models.py         validated inventory contract (16-63)
└── payloads.py       persisted recommendation projection (13-27)

Backend/api/src/
├── app/api/ai/recommendations/generate/route.ts   AI-service proxy (14-59)
├── app/api/ai/recommendations/approve/route.ts    approval gate (16-71)
├── app/api/ai/recommendations/reject/route.ts     rejection gate (10-37)
└── lib/emergencyWorkflow.ts                       durable batch/items (37-230)

Frontend/src/
├── services/reliefService.ts                      client calls (11-52)
└── components/relief/ReliefPanel/ReliefPanel.tsx generation, selection, review UI
```

## 9. Defense questions

**Why AHP?** It gives transparent relative importance to seven vulnerability dimensions. In this code it is AHP-inspired fixed weighting, not full pairwise AHP.

**Why fuzzy logic?** It exposes partial membership around water-level boundaries. The present operational label remains threshold-based; there is no fuzzy rule engine or defuzzification.

**Why ILP?** Inventory is limited and relief units must be whole numbers. ILP maximizes priority-weighted allocation without exceeding supply or demand.

**What makes it AI-assisted?** Multiple-criteria scoring, fuzzy membership analysis, and mathematical optimization generate explainable options. It is not predictive ML.

**Who makes the final decision?** A super/CSWDD dashboard user selects and approves or rejects a draft. Approval route: `Backend/api/src/app/api/ai/recommendations/approve/route.ts`, lines 16-71.

**What if data is incomplete?** Missing all demographic demand causes optimization to stop (`ilp.py`, 252-254). A sensor with no latest reading receives `no_reading`; the analysis says so (`engine.py`, 218-237).

**What if inventory is insufficient?** The supply constraint prevents over-allocation; low-ranked barangays may receive zero and the explanation says inventory went to higher-priority areas.

**Can the result be overridden?** The user may choose among three plans or reject them. No endpoint for manually changing solved quantities was found in the current repository; approval validates the selected generated plan shape.

## 10. Key limitations

- Fixed weights are not recalculated from pairwise judgments.
- Fuzzy memberships do not form a rule base and are not defuzzified.
- Current AI input uses stored `families.*_count` aggregates, not `family_members` dynamic demographic previews.
- Optimization is barangay-level, not family-level.
- Coverage targets may intentionally leave available stock unused even when inventory exceeds the strategy's target demand.
- No hard equity-floor constraint exists.
- The AI service trusts calls from the Next.js backend; approval RBAC is enforced in the Next.js route, not inside FastAPI.
- The Next.js generation proxy itself does not call `getDashboardViewer()` (`generate/route.ts`, 14-59). CORS is not authentication. This should not be described as protected by generation-route RBAC.
