# SmartFlood V3.2 — Capstone Defense Reviewer

## 1. Project in 30 Seconds

**Memorize this:** SmartFlood is a flood-monitoring and relief decision-support platform. It combines sensor readings, resident/family vulnerability information, and available relief inventory. Its AI-assisted module uses transparent weighted scoring, fuzzy water-level memberships, and integer optimization to propose three barangay-level allocation strategies. Authorized people still select, approve, and operate the final relief workflow. It also derives time-sensitive age, demographic classification, and pregnancy weeks from stable dates instead of storing values that immediately become stale.

What makes it different is the end-to-end connection between monitoring, resident vulnerability data, explainable optimization, Human-in-the-Loop approval, and auditable distribution—not a trained prediction model.

## 2. Architecture in 60 Seconds

```text
React/Next.js frontend (port 3000)
  -> Next.js API (port 5000)
      -> Supabase/PostgreSQL: users, residents, families, members, workflows
      -> MongoDB: sensors and sensor readings
      -> Python FastAPI AI service: scoring + PuLP/CBC optimization
  -> draft strategies returned to frontend
  -> super/CSWDD approves or rejects
  -> accepted workflow batch/items
  -> barangay notification, campaign, verification, distribution history
```

The frontend calls typed services such as `Frontend/src/services/reliefService.ts`, lines 11-80. The Next.js API validates sessions and roles on sensitive actions. The Python service performs deterministic decision analysis. Supabase stores durable workflow/history; MongoDB supplies current sensor data.

## 3. AI in 60 Seconds

“Our AHP layer is an AHP-inspired fixed weighted sum of seven vulnerability counts. Our fuzzy layer calculates degrees of membership for four flood labels, while a threshold selects the operational risk. Those values form priority coefficients. Then PuLP with CBC solves an integer model that maximizes priority-weighted relief units without exceeding inventory or demand. The system returns Severity First, Vulnerability First, and Balanced. It stays Human-in-the-Loop because only an authorized user can approve a selected plan.”

## 4. Explain Our AI Naturally

“First, the system loads the newest water reading for each sensor and the stored family vulnerability totals for each barangay. It normalizes those records to the barangay registry. Then it describes the water level with fuzzy memberships and gives the barangay a flood-risk label. The demographic counts are combined with fixed AHP-inspired weights. For each strategy, severity and vulnerability receive different multipliers. Finally, an integer optimizer chooses whole relief units under inventory and demand limits. These are drafts; CSWDD or a super administrator chooses whether to accept or reject one.”

## 5. Algorithm defense

### AHP

- **What:** transparent weighted vulnerability score.
- **Why:** compare multiple vulnerable groups with one explainable value.
- **Inputs:** infant, elderly, PWD, pregnant, lactating, toddler, and 4Ps counts from `families`.
- **Output:** total vulnerability score plus per-criterion contributions.
- **Code:** `Backend/ai/app/engine.py`, weights lines 18-38; `_ahp_breakdown()` lines 311-321.
- **Accuracy:** simplified/custom AHP-inspired weighted sum; no pairwise matrix/eigenvector/consistency ratio.

### Fuzzy Logic

- **What:** degrees of membership for normal, alert, warning, severity.
- **Why:** show gradual transitions near water-level boundaries.
- **Input:** maximum latest water level per barangay.
- **Output:** membership map, crisp risk label, confidence.
- **Code:** `Backend/ai/app/engine.py`, lines 288-295 and 324-377.
- **Accuracy:** no IF/THEN fuzzy rule base or defuzzification was found.

### LP/ILP

- **What:** integer optimization for three resource categories.
- **Why:** limited supplies and indivisible units.
- **Decision variable:** integer units of one resource allocated to one barangay.
- **Objective:** maximize `sum(priority × allocated units)`.
- **Constraints:** non-negative integer, per-barangay demand ceiling, total effective-supply ceiling.
- **Output:** three strategy plans.
- **Code:** `Backend/ai/app/ilp.py`, lines 92-173 and 189-249.

## 6. Dynamic data defense

**How does age update automatically?** `calculateCurrentAge()` compares DOB with today's Manila month/day on every response (`Backend/api/src/lib/dateUtils.ts`, 84-98).

**Why not store current age?** Age is a changing fact. DOB is stable; recalculation avoids scheduled writes and stale values.

**How do you know someone becomes 60 tomorrow?** The next API response after the Manila birthday returns 60 and `elderly` through `residentWithCurrentAge()` (`dateUtils.ts`, 235-260).

**Infant versus toddler?** Exactly the first anniversary remains infant; the next Manila date becomes toddler (`dateUtils.ts`, 159-217).

**How do pregnancy weeks increase?** Complete elapsed Manila calendar weeks are added to baseline weeks (`dateUtils.ts`, 104-119).

**Do you update weekly?** No. Baseline facts stay stored; current weeks are response enrichment (`familyMembers.ts`, 360-373).

**Why Asia/Manila?** It makes legal/operational day boundaries consistent regardless of server timezone (`dateUtils.ts`, line 1 and 285-302).

## 7. Household vulnerability defense

| Vulnerability | Current representation | Dynamic? | AI source today |
|---|---|---|---|
| Infant | DOB-derived classification in structured members; stored family aggregate | Age-derived preview | Stored `families.infant_count` |
| Toddler | DOB-derived classification; stored aggregate | Age-derived preview | Stored `families.toddler_count` |
| Elderly | DOB-derived classification; stored aggregate | Age-derived preview | Stored `families.elderly_count` |
| PWD | Explicit `family_members.is_pwd`; stored aggregate | No | Stored `families.pwd_count` |
| Pregnant | Explicit flag + weeks/timestamp; stored aggregate | Weeks only | Stored `families.pregnant_count` |
| Lactating | Explicit `family_members.is_lactating`; stored aggregate | No | Stored `families.lactating_count` |
| 4Ps | Explicit `family_members.is_4ps`; stored aggregate | No | Stored `families.four_ps_count` |

The dynamic comparison is deliberately not connected to AHP. Source: `Backend/api/src/lib/familyMembers.ts`, lines 469-560. AI query: `Backend/ai/app/repositories.py`, lines 23-26 and 67-68.

## QR System

**30-second explanation:** SmartFlood’s QR represents an emergency relief campaign, not a resident. When a plan is accepted, the server creates a 32-byte random token, stores its SHA-256 hash for lookup, and stores an AES-256-GCM encrypted copy for authorized re-display. An assigned barangay official retrieves the token and `qrcode.react` renders it as SVG. During distribution, that token resolves the campaign while a separate family/resident UUID resolves the beneficiary. The backend checks login, role, barangay, campaign status, allocation readiness, and duplicate receipt before a separate confirmation inserts the distribution record.

```text
accepted plan
  -> random campaign token
  -> hash + encrypted database copy
  -> barangay-only token endpoint
  -> qrcode.react SVG display/download
  -> campaign token + separate beneficiary UUID
  -> backend validation and eligibility preview
  -> explicit confirmation
  -> relief_distributions + audit log
```

- **Generation:** `Backend/api/src/lib/emergencyWorkflow.ts`, `createAcceptedWorkflowBatch()`, lines 122-197.
- **Payload:** one opaque base64url campaign token; no PII, resident UUID, family UUID, URL, or JSON.
- **Stored protection:** `campaignQrCrypto.ts`, lines 3-57; `emergencyCampaigns.ts`, lines 37-49.
- **Rendering:** `Frontend/src/components/emergency/CampaignQrCode.tsx`, lines 6-19.
- **Retrieval:** `Backend/api/src/app/api/emergency/campaigns/[batchId]/qr/route.ts`, lines 18-67.
- **Verification:** `emergencyDistribution.ts`, lines 45-175 and 264-347.
- **Confirmation:** `distribution/confirm/route.ts`, lines 7-110.
- **Resident/family identification:** separate UUID input; QR identifies only the campaign.
- **Security:** authenticated barangay role, assigned-barangay scope, token hashing, encrypted recoverable copy, campaign/readiness checks, confirm-time revalidation, unique `(batch_id, family_id)`, and audit logging.
- **Limitations:** no browser-camera decoder, no anti-copy control, no one-time token/rotation, no offline flow, and no proof that the presenter is the beneficiary.

The `reliefDistribution/scan` page displays a campaign QR; it does not scan with a camera (`Frontend/src/app/dashboard/reliefDistribution/scan/page.tsx`, lines 12-82). See `QR.md` for the full reviewer.

## 8. Data-flow diagrams

### Resident registration

```text
resident application
  -> server validates optional household_members snapshot
  -> dashboard review
  -> approval creates resident
  -> creates/selects family
  -> persists structured family_members with trusted provenance
  -> marks application approved
```

Approval code: `Backend/api/src/app/api/resident-applications/[id]/review/route.ts`, lines 18-245.

### Dynamic age

```text
DOB -> Manila date -> birthday comparison -> age
    -> approved life-stage policy -> classification -> API -> frontend
```

### Dynamic pregnancy

```text
baseline weeks + baseline timestamp
  -> elapsed Manila calendar days / 7
  -> current pregnancy weeks
  -> API enrichment -> frontend
```

### AI relief recommendation

```text
sensor snapshot + families aggregates + barangay registry + inventory
  -> grouping
  -> fuzzy memberships/crisp risk
  -> AHP-inspired vulnerability score
  -> strategy coefficient
  -> ILP per resource
  -> three draft plans
  -> authorized human approve/reject
  -> workflow batch/items
  -> campaign/distribution
```

## 9. Likely panel questions

### A. Project Overview

**1. What problem does SmartFlood solve?**

- Short: It supports flood awareness and evidence-based relief allocation.
- Expanded: It combines current flood readings, household vulnerability, inventory limits, and an auditable human workflow rather than treating monitoring and relief as disconnected systems.
- File: `Backend/ai/app/main.py`; lines 45-109.

**2. Is SmartFlood a forecasting system?**

- Short: Not in this implementation.
- Expanded: The AI uses latest sensor readings and current database records. No weather/flood forecasting ML model was found in the current repository.
- File: `Backend/ai/app/repositories.py`; lines 52-68.

**3. What does the AI output?**

- Short: Three barangay-level whole-unit relief plans.
- Expanded: Each plan includes food packs, individual goods, emergency kits, objective/solver metadata, and explanations.
- File: `Backend/ai/app/ilp.py`; lines 92-173.

**4. Is the system autonomous?**

- Short: No; it is decision support.
- Expanded: Generation returns drafts. Authorized humans approve or reject a selected plan before workflow records become active.
- File: `Backend/api/src/app/api/ai/recommendations/approve/route.ts`; lines 16-71.

### B. System Architecture

**5. Why both Next.js and FastAPI?**

- Short: Next.js owns application/API workflow; FastAPI isolates Python optimization.
- Expanded: The Next.js route proxies validated inventory and enforces approval RBAC. FastAPI loads analytical data and runs PuLP/CBC.
- Files: `generate/route.ts` lines 14-59; `Backend/ai/app/main.py` lines 45-109.

**6. Where is sensor data stored?**

- Short: MongoDB.
- Expanded: The repository reads `sensors` and aggregates the newest `sensor_readings` document per sensor.
- File: `Backend/ai/app/repositories.py`; lines 52-62.

**7. Where are resident and relief records stored?**

- Short: Supabase/PostgreSQL.
- Expanded: Families, residents, recommendations, allocation batches/items, and distributions are queried or persisted through Supabase.
- File: `Backend/ai/app/repositories.py`; lines 64-93.

**8. How does the frontend reach the AI?**

- Short: Frontend service -> Next.js API -> FastAPI.
- Expanded: `generateReliefRecommendations()` calls the Next route, which calls `AI_BACKEND_URL/api/ai/recommendations/generate`.
- Files: `Frontend/src/services/reliefService.ts` lines 27-33; `generate/route.ts` lines 31-54.

### C. Database

**9. Why separate residents and family members?**

- Short: A household member is not necessarily an account holder.
- Expanded: `family_members` stores demographics and optional resident linkage without creating authentication accounts for every person.
- File: `supabase/migrations/20260917000001_create_family_members.sql`; lines 4-22.

**10. How is duplicate resident linkage prevented?**

- Short: A partial unique index on non-null `resident_id`.
- Expanded: One resident can link to at most one family-member row, while non-account members keep NULL.
- File: same migration; lines 31-33.

**11. How are pregnancy fields protected?**

- Short: A database check enforces consistent states.
- Expanded: Non-pregnant means weeks/timestamp NULL; pregnant means weeks 0-42 and timestamp present.
- File: `supabase/migrations/20260917000002_add_family_member_vulnerabilities.sql`; lines 13-34.

**12. Are legacy name and DOB arrays migrated by position?**

- Short: No.
- Expanded: They are shown as separate historical lists. Structured persistence requires stable member UUIDs; position is not identity.
- Files: `familyMembers.ts` lines 117-307; `ResidentsPanel.tsx` lines 1109-1207.

### D. AHP

**13. Why use AHP?**

- Short: To make vulnerability priorities transparent.
- Expanded: Seven demographic dimensions have explicit normalized weights, producing inspectable contributions.
- File: `Backend/ai/app/engine.py`; lines 18-38, 311-321.

**14. Is it full textbook AHP?**

- Short: No; it is AHP-inspired.
- Expanded: Fixed weights and a weighted sum are present. Pairwise matrices, eigenvectors, and consistency ratios were not found.
- File: `Backend/ai/app/engine.py`; lines 18-38, 311-321.

**15. What is the AHP formula?**

- Short: Sum of count times weight.
- Expanded: Each demographic count is multiplied by its configured weight; contributions are summed and rounded to four decimals.
- File: `Backend/ai/app/engine.py`; lines 311-321.

**16. Where do AHP counts come from?**

- Short: Stored family aggregate columns.
- Expanded: The repository selects `pwd_count` through `total_family_members` and groups them by barangay.
- Files: `repositories.py` lines 23-26; `engine.py` lines 166-177.

### E. Fuzzy Logic

**17. Why fuzzy logic?**

- Short: To represent gradual risk membership near water boundaries.
- Expanded: A water level may partially belong to adjacent labels, making the analysis more explainable than only showing one threshold result.
- File: `Backend/ai/app/engine.py`; lines 324-377.

**18. What are the membership functions?**

- Short: One descending, two trapezoidal, one ascending.
- Expanded: They represent normal, alert, warning, and severity over specified metre ranges.
- File: `Backend/ai/app/engine.py`; lines 324-342, 354-377.

**19. Are fuzzy IF/THEN rules implemented?**

- Short: No.
- Expanded: Not found in the current repository. Memberships are calculated, while `_risk_from_water_level()` selects the operational label by thresholds.
- File: `Backend/ai/app/engine.py`; lines 288-295, 324-342.

**20. Is defuzzification used?**

- Short: No.
- Expanded: Not found in the current repository. A crisp risk label is mapped to an integer risk weight.
- File: `Backend/ai/app/engine.py`; lines 288-299.

### F. Linear Programming / ILP

**21. Why ILP rather than ordinary LP?**

- Short: Relief units must be whole numbers.
- Expanded: PuLP variables use `cat=LpInteger`; fractional food packs or kits cannot be returned.
- File: `Backend/ai/app/ilp.py`; lines 189-239.

**22. What is optimized?**

- Short: Priority-weighted allocated units.
- Expanded: For each resource, the objective sums barangay priority coefficient multiplied by integer allocation.
- File: `Backend/ai/app/ilp.py`; lines 209-215.

**23. What constraints exist?**

- Short: Integer, non-negative, demand ceiling, supply ceiling.
- Expanded: Bounds enforce demand/non-negativity, category is integer, and a summed constraint enforces effective supply.
- File: `Backend/ai/app/ilp.py`; lines 203-227.

**24. What solver is used?**

- Short: CBC through PuLP.
- Expanded: `PULP_CBC_CMD(msg=False)` solves each resource model and must return Optimal.
- File: `Backend/ai/app/ilp.py`; lines 6 and 217-220.

**25. Is there an equity-floor constraint?**

- Short: No.
- Expanded: The response explicitly says no existing rule was found, so none was invented.
- File: `Backend/ai/app/ilp.py`; line 162.

### G. AI Relief Recommendation

**26. What distinguishes the three strategies?**

- Short: Severity/vulnerability multipliers and coverage targets.
- Expanded: Severity First favors flood category; Vulnerability First favors demographics; Balanced uses equal multipliers.
- File: `Backend/ai/app/ilp.py`; lines 37-74.

**27. Does generation save history?**

- Short: No.
- Expanded: It returns drafts and logs generation. Recommendation rows are saved only by approval.
- File: `Backend/ai/app/main.py`; lines 45-109.

**28. What happens when supply is zero?**

- Short: The resource receives all-zero allocations.
- Expanded: `_solve_resource_allocation()` returns `ZeroSupply` without invoking CBC.
- File: `Backend/ai/app/ilp.py`; lines 195-207.

**29. What if the solver is not optimal?**

- Short: The request fails safely.
- Expanded: An `OptimizationError` is raised instead of presenting a non-optimal plan as valid.
- File: `Backend/ai/app/ilp.py`; lines 217-220.

### H. Human-in-the-Loop

**H1. Can the AI directly start distribution?**

- Short: No.
- Expanded: AI generation returns drafts. Approval creates an accepted workflow batch, and a separate authorized campaign step starts distribution with an expiry.
- Files: `Backend/api/src/app/api/ai/recommendations/approve/route.ts`, lines 16-71; `Backend/api/src/app/api/emergency/campaigns/[batchId]/start/route.ts`, lines 13-75.

**H2. What does rejection do?**

- Short: It records a rejected workflow batch.
- Expanded: It does not save recommendation rows or create barangay allocation items.
- Files: `Backend/api/src/app/api/ai/recommendations/reject/route.ts`, lines 10-37; `Backend/api/src/lib/emergencyWorkflow.ts`, `createRejectedWorkflowBatch()`.

**H3. Can a duplicate accepted plan be created accidentally?**

- Short: Equivalent active plans are detected.
- Expanded: Existing accepted/active batches and their allocation signatures are compared before creating another batch.
- File: `Backend/api/src/lib/emergencyWorkflow.ts`, `findEquivalentAcceptedBatch()`.

### I. Dynamic Resident Age

**30. Is current age stored?**

- Short: DOB is authoritative; legacy age remains for compatibility.
- Expanded: DOB-backed responses overwrite `age` dynamically and mark `age_source: birth_date`; NULL DOB preserves legacy age.
- File: `Backend/api/src/lib/dateUtils.ts`; lines 235-260.

**31. How are birthdays handled?**

- Short: Month/day are checked in Manila time.
- Expanded: The function subtracts one if today's Manila date precedes the birthday.
- File: `Backend/api/src/lib/dateUtils.ts`; lines 84-98.

**32. What happens with invalid DOB?**

- Short: The dynamic age is unavailable.
- Expanded: Strict date-only parsing rejects malformed calendar dates; future age becomes NULL.
- File: `Backend/api/src/lib/dateUtils.ts`; lines 262-283.

**33. Does dynamic age already drive AHP?**

- Short: No.
- Expanded: Dynamic counts are comparison-only; the AI still reads stored family aggregates.
- Files: `familyMembers.ts` lines 469-560; `repositories.py` lines 23-26.

### J. Dynamic Pregnancy Weeks

**34. What is the pregnancy formula?**

- Short: Baseline plus complete elapsed calendar weeks.
- Expanded: Manila calendar-day numbers are subtracted, divided by seven with floor, then added to baseline weeks.
- File: `Backend/api/src/lib/dateUtils.ts`; lines 104-119.

**35. What resets the baseline?**

- Short: Starting tracking or changing baseline weeks.
- Expanded: Unrelated edits preserve the timestamp; becoming non-pregnant clears fields.
- File: `Backend/api/src/lib/familyMembers.ts`; lines 327-357.

**36. Can calculated weeks exceed 42?**

- Short: Yes, until status is updated.
- Expanded: Stored baseline is constrained 0-42, but the derived function does not cap elapsed output.
- File: `Backend/api/src/lib/dateUtils.ts`; lines 104-119.

### K. Household Vulnerability

**37. Which vulnerabilities are age-derived?**

- Short: Infant, toddler, and elderly.
- Expanded: Structured members use DOB and approved classification policy. PWD, pregnant, lactating, and 4Ps are explicit flags.
- Files: `dateUtils.ts` lines 61-72, 126-217; migration 00002 lines 5-11.

**38. What happens with missing household DOB?**

- Short: Classification remains unknown.
- Expanded: The system does not infer DOB or use legacy age for new authoritative member classification.
- File: `Backend/api/src/lib/familyMembers.ts`; lines 539-560.

### L. QR System

**L1. What does the QR identify?**

- Short: A relief campaign batch, not a resident.
- Expanded: The token hash resolves `emergency_allocation_batches.batch_id`; a separate resident/family UUID resolves the beneficiary.
- Files: `Backend/api/src/lib/emergencyCampaigns.ts`, lines 37-49; `emergencyDistribution.ts`, lines 45-175.

**L2. What is encoded in the QR?**

- Short: One opaque random base64url campaign token.
- Expanded: No PII, resident data, family data, JSON, or URL is encoded.
- Files: `emergencyWorkflow.ts`, lines 122-145; `CampaignQrCode.tsx`, lines 6-8.

**L3. Is the QR encrypted?**

- Short: The displayed payload is not ciphertext.
- Expanded: The database’s recoverable token copy is AES-256-GCM encrypted; the QR contains the decrypted opaque token.
- File: `Backend/api/src/lib/campaignQrCrypto.ts`, lines 3-57.

**L4. Does the QR authenticate a resident?**

- Short: No.
- Expanded: The session authenticates the official. The token identifies a campaign, and the UUID identifies a beneficiary record.
- File: `Backend/api/src/lib/emergencyDistribution.ts`, lines 45-105 and 264-307.

**L5. Does SmartFlood scan using a camera?**

- Short: Not in the current repository.
- Expanded: The app displays/downloads a QR and accepts text identifiers, but no camera/decoder library or handler was found.
- Files: `scan/page.tsx`, lines 12-82; `ReliefDistributionPanel.tsx`, lines 411-439.

**L6. What happens if the QR is copied?**

- Short: The copy has the same reusable campaign token.
- Expanded: There is no anti-copy or one-time-token mechanism. Backend login, barangay scope, active campaign, beneficiary, and duplicate checks still apply.
- File: `Backend/api/src/lib/emergencyDistribution.ts`, lines 45-175.

**L7. How is duplicate receipt prevented?**

- Short: Service check plus a database unique constraint.
- Expanded: Existing distribution is checked before confirmation, and `(batch_id, family_id)` rejects concurrent duplicates.
- Files: `emergencyDistribution.ts`, lines 131-141; `20260813010000_create_relief_distributions.sql`, lines 13-34.

**L8. What happens after successful verification?**

- Short: Nothing is written until the official confirms.
- Expanded: Confirmation repeats validation, inserts a received distribution, and writes an audit event.
- File: `Backend/api/src/app/api/emergency/distribution/confirm/route.ts`, lines 7-110.

### M. Security

**39. Who can approve AI plans?**

- Short: Authenticated super or CSWDD users.
- Expanded: The approval route resolves the signed dashboard viewer and rejects all other roles.
- File: `Backend/api/src/app/api/ai/recommendations/approve/route.ts`; lines 16-30.

**40. How is barangay data scoped?**

- Short: Server-side viewer assignment and comparisons.
- Expanded: Resident/family-member routes derive viewer role and call barangay-scope helpers; clients cannot expand scope merely by supplying an ID.
- File: `Backend/api/src/app/api/family-members/route.ts`; lines 11-44.

**41. Is CORS authentication?**

- Short: No.
- Expanded: `proxy.ts` only controls allowed browser origins/headers. Sensitive routes must independently call `getDashboardViewer()`.
- Files: `Backend/api/src/proxy.ts` lines 3-40; `dashboardViewer.ts` lines 20-60.

**42. Is the generation route RBAC-protected?**

- Short: Not in the route itself.
- Expanded: `generate/route.ts` validates inventory and proxies it but does not call `getDashboardViewer()`. Approval is protected. This is a real limitation.
- File: `Backend/api/src/app/api/ai/recommendations/generate/route.ts`; lines 14-59.

### N. Testing

**45. How is inventory safety tested?**

- Short: Tests assert totals never exceed supply and allocations are whole/non-negative.
- Expanded: Tests cover limited/abundant/zero inventory, demand ceilings, and negative input errors.
- File: `Backend/ai/tests/test_engine.py`; lines 16-43 and 92-221.

**46. Is the Human-in-the-Loop flow tested?**

- Short: Yes at service level.
- Expanded: Tests prove generation saves nothing and approval saves the selected plan.
- File: `Backend/ai/tests/test_recommendation_flow.py`; lines 66-92.

**47. Are date boundaries tested?**

- Short: Yes.
- Expanded: Focused backend tests cover age/classification, exact infant boundary, invalid DOB, and pregnancy elapsed-week behavior.
- File: `Backend/api/tests/date-utils.test.mjs`; lines 17-112.

### O. Limitations

**43. What is the largest AI limitation?**

- Short: Data and policies are fixed and aggregate-level.
- Expanded: The model is not learned, AHP weights are fixed, fuzzy logic is partial, and ILP allocates by barangay using stored family counts.
- Files: `engine.py` lines 18-38; `ilp.py` lines 189-239.

**44. Can incomplete family data distort priority?**

- Short: Yes.
- Expanded: AI consumes stored aggregates. Structured dynamic comparison is deliberately not substituted until household coverage is complete and integration is approved.
- File: `Backend/api/src/lib/familyMembers.ts`; lines 409-560.

## 10. Hard questions / trap questions

**Is this really AI?** Say: “It is AI-assisted decision support using multicriteria scoring, fuzzy membership analysis, and mathematical optimization. It is not machine learning.”

**Why not only if/else?** Thresholds alone label risk but cannot optimize several limited inventories across several barangays under constraints. ILP handles that combinatorial allocation transparently.

**Why AHP instead of ML?** The project needs explainable policy weights and has no labeled outcome dataset for training. Be honest that the implementation is AHP-inspired, not full pairwise AHP.

**Why fuzzy logic if the label is crisp?** Memberships expose gradual transitions/confidence. Be honest that the present objective uses the crisp label's risk weight, not a defuzzified score.

**Can the AI be wrong?** Yes. Output quality depends on sensor and family data, weights, thresholds, and model assumptions. Human review exists for this reason.

**Can an admin override quantities?** No direct manual quantity-edit endpoint was found in the current repository. Users can choose among three plans or reject one.

**How do you prevent incorrect legacy pairing?** Names and DOBs are displayed as independent lists; structured rows require their own stable UUID.

**How do barangays avoid seeing another barangay?** Scoped routes derive the logged-in viewer and compare server-side barangay identity. Do not claim this for the unguarded AI generation proxy.

**Is the QR encrypted?** Say: “The QR contains a plaintext opaque random token. Its recoverable database copy is AES-256-GCM encrypted, while a SHA-256 hash is used for lookup.”

**Does the QR identify or authenticate the resident?** It does neither by itself. It identifies the campaign; a separate UUID identifies the beneficiary, and the dashboard session authenticates the barangay official.

**Can someone copy and reuse the QR?** Yes. There is no anti-copy or one-time-use mechanism. Reuse still cannot bypass RBAC, barangay scope, active-campaign checks, beneficiary lookup, or duplicate receipt protection.

**What happens after a scan?** Be precise: the repository has no built-in camera decoder. A supplied token/identifier is verified; no receipt is recorded until a separate confirmation repeats checks and inserts the distribution.

## 11. Limitations

- No trained ML model, prediction, or learning loop.
- AHP is fixed-weight and AHP-inspired, not full textbook AHP.
- Fuzzy memberships exist, but no fuzzy rules/defuzzification.
- AI uses stored family aggregates; dynamic member counts are not integrated.
- ILP allocates resources at barangay level, not directly to families.
- No hard equity floor.
- Strategy coverage targets can leave surplus inventory outside the optimization target.
- Missing/inaccurate aggregate data can affect recommendations.
- Generation and recommendation-list proxy routes lack explicit viewer checks in their route code.
- Approval writes span the AI service and Next workflow; no cross-service database transaction exists.
- Legacy residents without DOB remain dynamically unverifiable.
- Derived pregnancy weeks are not capped after baseline time passes.
- QR tokens can be copied and reused; there is no token rotation or one-time-use rule.
- No browser-camera QR decoder or offline distribution workflow is implemented.
- The campaign QR does not prove the presenter is the identified beneficiary.

## 12. What NOT to say during defense

- Do not say “we trained a machine-learning model.”
- Do not say “the AI predicts floods.”
- Do not say “we implement full pairwise AHP with consistency checking.”
- Do not say “fuzzy IF/THEN rules combine vulnerability and severity.”
- Do not say “we defuzzify to obtain the final priority.”
- Do not say “the AI automatically distributes relief.”
- Do not say “the administrator can freely edit optimized quantities” unless that feature is later added.
- Do not say “dynamic family-member counts already feed AHP.”
- Do not say “all household members have resident accounts.”
- Do not say “legacy names and dates are matched by array index.”
- Do not say “current age is always stored.”
- Do not say “pregnancy weeks are updated in the database every week.”
- Do not say “all AI endpoints have route-level RBAC.”
- Do not call CORS an authentication mechanism.
- Do not say “the QR contains resident information” or “belongs to one resident.”
- Do not say “the displayed QR is encrypted”; only the recoverable database copy is encrypted.
- Do not say “the QR authenticates the resident” or “cannot be copied.”
- Do not say “SmartFlood scans QR codes with the browser camera.”
- Do not say “scanning automatically records relief as received.”

## 13. Source-code cheat sheet

| Topic | File | Function/section | Final lines | Remember |
|---|---|---|---:|---|
| AHP weights | `Backend/ai/app/engine.py` | `AHP_WEIGHTS` | 18-38 | Fixed normalized weights |
| AHP score | same | `_ahp_breakdown()` | 311-321 | Sum count × weight |
| Fuzzy | same | `_fuzzy_explanation()` | 324-342 | Memberships + crisp label |
| Fuzzy functions | same | membership helpers | 354-377 | Descending/trapezoid/ascending |
| Base priority | same | `_score_barangay()` | 180-215 | Risk×100 + vulnerability + members |
| Strategies | `Backend/ai/app/ilp.py` | `OPTIMIZATION_PROFILES` | 37-74 | Three multipliers/targets |
| ILP | same | `_solve_resource_allocation()` | 189-239 | Integer objective and constraints |
| AI generation | `Backend/ai/app/main.py` | `create_recommendations()` | 45-72 | Draft; no history insert |
| AI approval | same | `approve_recommendations()` | 75-109 | Saves selected rows |
| Human gate | `Backend/api/src/app/api/ai/recommendations/approve/route.ts` | `POST()` | 16-71 | super/CSWDD only |
| Workflow | `Backend/api/src/lib/emergencyWorkflow.ts` | accepted/rejected creation | 122-230 | Batch and items |
| Dynamic age | `Backend/api/src/lib/dateUtils.ts` | `calculateCurrentAge()` | 84-98 | Manila birthday comparison |
| Classification | same | `classifyCurrentAge()` | 126-217 | Exact 12-month boundary |
| Resident enrichment | same | `residentWithCurrentAge()` | 235-260 | DOB or legacy source marker |
| Pregnancy | same | `calculateCurrentPregnancyWeeks()` | 104-119 | Baseline + full calendar weeks |
| Structured members | `Backend/api/src/lib/familyMembers.ts` | validation/persistence | 117-307 | Stable UUID and provenance |
| Pregnancy enrichment | same | enrichment functions | 310-406 | Preserve/reset baseline correctly |
| Coverage comparison | same | coverage/dynamic preview | 409-560 | Read-only; not AHP |
| Registration approval | `Backend/api/src/app/api/resident-applications/[id]/review/route.ts` | `PATCH()` | 18-245 | Resident/family/member workflow |
| Family-member API | `Backend/api/src/app/api/family-members/route.ts` | `GET()` | 11-64 | Scoped dynamic response |
| RBI editor | `Frontend/src/components/residents/ResidentsPanel/ResidentsPanel.tsx` | member sections | 1057-1402 | Structured edits + historical read-only data |
| QR token creation | `Backend/api/src/lib/emergencyWorkflow.ts` | `createAcceptedWorkflowBatch()` | 122-197 | Random campaign token, hash, encrypted copy |
| QR stored-token crypto | `Backend/api/src/lib/campaignQrCrypto.ts` | encrypt/decrypt | 3-57 | AES-GCM protects recoverable DB copy |
| QR token lookup | `Backend/api/src/lib/emergencyCampaigns.ts` | `resolveCampaignBatchIdByQrToken()` | 37-49 | SHA-256 hash resolves campaign |
| QR retrieval | `Backend/api/src/app/api/emergency/campaigns/[batchId]/qr/route.ts` | `GET()` | 18-67 | Barangay-only and scoped |
| QR rendering | `Frontend/src/components/emergency/CampaignQrCode.tsx` | render/download | 6-19 | Opaque token rendered as SVG |
| QR distribution validation | `Backend/api/src/lib/emergencyDistribution.ts` | context and resolvers | 45-175, 264-347 | Campaign separate from beneficiary |
| QR distribution confirmation | `Backend/api/src/app/api/emergency/distribution/confirm/route.ts` | `POST()` | 7-110 | Recheck, receipt insert, audit |

## Final one-sentence defense summary

“SmartFlood turns current flood severity, stored vulnerability evidence, and limited inventory into explainable integer allocation options, while keeping the final relief decision with authorized human users and deriving time-sensitive demographics from stable date facts.”

# 5-Minute Pre-Defense Cheat Sheet

## 1. SmartFlood problem

**WHAT IT DOES:** Connects flood monitoring, household vulnerability, constrained relief planning, approval, and distribution.

**WHERE IT IS:** `Backend/ai/app/main.py`, `create_recommendations()`, lines 45-72; `Backend/api/src/lib/emergencyWorkflow.ts`, lines 122-230.

**HOW I EXPLAIN IT:** SmartFlood is decision support for flood relief. It converts current sensor and household evidence into explainable options, but authorized humans control the workflow.

**KEY QUESTION:** Is it a flood-prediction system?

**KEY ANSWER:** No. It uses latest readings for current risk and relief planning; it does not forecast floods with ML.

## 2. Architecture

**WHAT IT DOES:** Separates UI/workflow, durable data, sensor data, and Python optimization.

**WHERE IT IS:** `Frontend/src/services/reliefService.ts`, lines 11-80; `Backend/api/src/app/api/ai/recommendations/generate/route.ts`, lines 14-59; `Backend/ai/app/main.py`, lines 45-109.

**HOW I EXPLAIN IT:** Next.js serves the frontend and workflow APIs, Supabase stores operational records, MongoDB stores sensors, and FastAPI runs scoring and PuLP. The API boundary keeps optimization separate from authorization and workflow persistence.

**KEY QUESTION:** Why use both Next.js and FastAPI?

**KEY ANSWER:** Next.js owns the application workflow; FastAPI isolates Python analytics and optimization.

## 3. AHP

**WHAT IT DOES:** Produces a transparent weighted vulnerability score from seven stored demographic counts.

**WHERE IT IS:** `Backend/ai/app/engine.py`, `AHP_WEIGHTS` and `_ahp_breakdown()`, lines 18-38 and 311-321.

**HOW I EXPLAIN IT:** Each count is multiplied by an explicit normalized weight and contributions are summed. It is explainable but is AHP-inspired, not full pairwise AHP.

**KEY QUESTION:** Is this textbook AHP?

**KEY ANSWER:** No. It uses fixed AHP-inspired weights without pairwise matrices, eigenvectors, or consistency ratio.

## 4. Fuzzy Logic

**WHAT IT DOES:** Shows gradual water-level membership across normal, alert, warning, and severity.

**WHERE IT IS:** `Backend/ai/app/engine.py`, `_fuzzy_explanation()` and membership helpers, lines 324-377.

**HOW I EXPLAIN IT:** A reading can partially belong to adjacent risk labels, which explains boundary uncertainty. The current operational label is still selected by thresholds.

**KEY QUESTION:** Are fuzzy rules and defuzzification implemented?

**KEY ANSWER:** No. Membership functions are implemented; a fuzzy rule base and defuzzification were not found.

## 5. LP/ILP

**WHAT IT DOES:** Allocates whole relief units under demand and inventory limits.

**WHERE IT IS:** `Backend/ai/app/ilp.py`, `_solve_resource_allocation()`, lines 189-239.

**HOW I EXPLAIN IT:** PuLP/CBC maximizes priority-weighted allocations. Integer variables prevent fractional food packs, goods, or emergency kits.

**KEY QUESTION:** Why ILP instead of LP?

**KEY ANSWER:** Relief units are indivisible, so decision variables must be whole numbers.

## 6. AI recommendation

**WHAT IT DOES:** Generates Severity First, Vulnerability First, and Balanced draft allocation strategies.

**WHERE IT IS:** `Backend/ai/app/ilp.py`, `OPTIMIZATION_PROFILES`, lines 37-74; `Backend/ai/app/main.py`, `create_recommendations()`, lines 45-72.

**HOW I EXPLAIN IT:** Each strategy applies different severity/vulnerability multipliers and coverage targets before ILP. Generation returns drafts and does not itself activate distribution.

**KEY QUESTION:** Does generation save or execute the plan?

**KEY ANSWER:** No. An authorized human must choose and approve a plan.

## 7. Human-in-the-Loop

**WHAT IT DOES:** Keeps plan acceptance, campaign activation, and distribution confirmation under authorized human control.

**WHERE IT IS:** `Backend/api/src/app/api/ai/recommendations/approve/route.ts`, `POST()`, lines 16-71; `Backend/api/src/app/api/emergency/campaigns/[batchId]/start/route.ts`, lines 13-75.

**HOW I EXPLAIN IT:** AI proposes; people decide. Approval creates workflow records, a separate campaign action starts distribution, and barangay officials verify and confirm each receipt.

**KEY QUESTION:** Can AI distribute relief automatically?

**KEY ANSWER:** No. It cannot bypass approval or the operational confirmation steps.

## 8. Dynamic age

**WHAT IT DOES:** Derives current age and demographic class from DOB using Manila calendar boundaries.

**WHERE IT IS:** `Backend/api/src/lib/dateUtils.ts`, `calculateCurrentAge()` and `classifyCurrentAge()`, lines 84-98 and 126-217.

**HOW I EXPLAIN IT:** DOB is stable; age is recalculated when data is read. Invalid/NULL DOB stays unavailable, and exactly 12 months remains infant until the next day.

**KEY QUESTION:** Why not update age every year?

**KEY ANSWER:** Deriving from DOB avoids stale values and scheduled database writes.

## 9. Dynamic pregnancy

**WHAT IT DOES:** Adds complete elapsed Manila weeks to stored baseline pregnancy weeks.

**WHERE IT IS:** `Backend/api/src/lib/dateUtils.ts`, `calculateCurrentPregnancyWeeks()`, lines 104-119; `Backend/api/src/lib/familyMembers.ts`, lines 327-373.

**HOW I EXPLAIN IT:** The server stores baseline weeks and timestamp, then derives current weeks on response. Unrelated edits preserve the baseline; ending pregnancy clears it.

**KEY QUESTION:** Does a scheduled job update pregnancy every week?

**KEY ANSWER:** No. Current weeks are computed at read time from baseline facts.

## 10. Household vulnerability

**WHAT IT DOES:** Represents member-level DOB/flags while preserving current family-level AI aggregates.

**WHERE IT IS:** `Backend/api/src/lib/familyMembers.ts`, validation/persistence/coverage, lines 117-560.

**HOW I EXPLAIN IT:** Infant, toddler, and elderly can be DOB-derived for structured members; PWD, pregnant, lactating, and 4Ps are explicit flags. Dynamic comparison remains read-only because incomplete households must not be undercounted.

**KEY QUESTION:** Do dynamic member counts already feed AHP?

**KEY ANSWER:** No. AI still reads stored `families` aggregates until coverage-aware integration is approved.

## 11. QR system

**WHAT IT DOES:** Uses an opaque campaign token to bind distribution verification to a relief campaign.

**WHERE IT IS:** `Backend/api/src/lib/emergencyWorkflow.ts`, lines 122-197; `Backend/api/src/lib/emergencyDistribution.ts`, lines 45-175; `Frontend/src/components/emergency/CampaignQrCode.tsx`, lines 6-19.

**HOW I EXPLAIN IT:** The backend generates the token, stores a hash plus encrypted recoverable copy, and the frontend renders the plaintext token as SVG. The token identifies the campaign; a separate UUID identifies the beneficiary, and confirmation records receipt.

**KEY QUESTION:** Does the QR contain or authenticate the resident?

**KEY ANSWER:** No. It contains only a campaign token; session authentication and separate beneficiary lookup perform those other jobs.

## 12. Security/RBAC

**WHAT IT DOES:** Restricts sensitive actions by authenticated role, assigned barangay, server-side record checks, and database constraints.

**WHERE IT IS:** `Backend/api/src/lib/dashboardViewer.ts`, lines 20-60; `Backend/api/src/lib/emergencyDistribution.ts`, lines 45-152.

**HOW I EXPLAIN IT:** The server derives the viewer from the session rather than trusting client role or barangay fields. Distribution additionally rechecks campaign, beneficiary scope, readiness, and duplicates.

**KEY QUESTION:** Is CORS your authentication?

**KEY ANSWER:** No. CORS is a browser-origin policy; route-level session and RBAC checks provide authorization.

## 13. Biggest system limitation

**WHAT IT DOES:** States the boundary of the current implementation honestly.

**WHERE IT IS:** `Backend/ai/app/repositories.py`, lines 23-26 and 67-68; `Backend/api/src/lib/familyMembers.ts`, lines 409-560; `QR.md`, sections 9 and 13.

**HOW I EXPLAIN IT:** Recommendation quality depends on current sensors and stored aggregate household data. Member-level dynamic counts are not yet AHP inputs, and QR has no camera decoder, anti-copy control, or offline mode.

**KEY QUESTION:** What would you improve first?

**KEY ANSWER:** Complete authoritative household coverage and safely integrate dynamic counts, then harden the QR operational flow with camera scanning, rotation/expiry policy, and offline-safe procedures.
