from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pulp import LpInteger, LpMaximize, LpProblem, LpStatus, LpVariable, PULP_CBC_CMD, lpSum, value

from .payloads import to_int


RESOURCE_CATEGORIES = (
    {
        "id": "family_food_packs",
        "label": "Family Food Packs",
        "inventory_key": "family_food_packs",
        "allocation_key": "recommended_family_food_packs",
        "demand_key": "affected_families",
    },
    {
        "id": "individual_relief_goods",
        "label": "Individual Relief Goods",
        "inventory_key": "relief_goods_individual",
        "allocation_key": "recommended_relief_goods_individual",
        "public_allocation_key": "recommended_individual_relief_goods",
        "demand_key": "total_family_members",
    },
    {
        "id": "emergency_kits",
        "label": "Emergency Kits",
        "inventory_key": "medicine_kits",
        "allocation_key": "recommended_medicine_kits",
        "public_allocation_key": "recommended_emergency_kits",
        "demand_key": "emergency_kit_demand",
    },
)

# Each profile changes both the severity/vulnerability objective coefficients
# and the fraction of demand made available to the solver. This is what makes
# the three strategies produce potentially different, reviewable allocations.
OPTIMIZATION_PROFILES = (
    {
        "plan_id": "severity_first",
        "plan_name": "Severity First",
        "severity_weight": 2.5,
        "vulnerability_weight": 0.7,
        "coverage_targets": {
            "family_food_packs": 0.55,
            "individual_relief_goods": 0.45,
            "emergency_kits": 1.0,
        },
    },
    {
        "plan_id": "vulnerability_first",
        "plan_name": "Vulnerability First",
        "severity_weight": 0.7,
        "vulnerability_weight": 2.5,
        "coverage_targets": {
            "family_food_packs": 0.9,
            "individual_relief_goods": 0.9,
            "emergency_kits": 0.55,
        },
    },
    {
        "plan_id": "balanced",
        "plan_name": "Balanced",
        "severity_weight": 1.0,
        "vulnerability_weight": 1.0,
        "coverage_targets": {
            "family_food_packs": 0.75,
            "individual_relief_goods": 0.75,
            "emergency_kits": 0.75,
        },
    },
)


class OptimizationError(RuntimeError):
    """Raised when the ILP allocation layer cannot produce a defensible plan."""


@dataclass(frozen=True)
class ResourceResult:
    allocation_key: str
    public_allocation_key: str
    supply: int
    objective_value: float
    allocations: dict[str, int]
    demands: dict[str, int]
    status: str


def build_optimization_plans(scored: list[dict[str, Any]], inventory: dict[str, int]) -> list[dict[str, Any]]:
    # Build one independent ILP per resource category and strategy, then merge
    # the solved whole-unit quantities into a plan for each barangay.
    if not scored:
        raise OptimizationError("No barangays are available for optimization.")
    _validate_demographic_demand(scored)

    plans = []
    for profile in OPTIMIZATION_PROFILES:
        coefficients = {
            item["key"]: _profile_priority(
                item,
                severity_weight=float(profile["severity_weight"]),
                vulnerability_weight=float(profile["vulnerability_weight"]),
            )
            for item in scored
        }
        resource_results = [
            _solve_resource_allocation(
                scored=scored,
                coefficients=coefficients,
                supply=to_int(inventory.get(str(category["inventory_key"]))),
                coverage_target=float(dict(profile["coverage_targets"])[str(category["id"])]),
                category_id=str(category["id"]),
                allocation_key=str(category["allocation_key"]),
                public_allocation_key=str(category.get("public_allocation_key", category["allocation_key"])),
                demand_key=str(category["demand_key"]),
            )
            for category in RESOURCE_CATEGORIES
        ]
        objective_value = round(sum(result.objective_value for result in resource_results), 4)
        allocations = []
        for item in scored:
            key = item["key"]
            allocation = {
                name: value
                for name, value in item.items()
                if name not in {"key", "has_sensor_reading"}
            }
            allocation["priority_score"] = coefficients[key]
            allocation["base_priority_score"] = item["priority_score"]
            allocation["demand_ceiling"] = {
                result.public_allocation_key: result.demands[key] for result in resource_results
            }
            for result in resource_results:
                allocation[result.allocation_key] = result.allocations[key]
                allocation[result.public_allocation_key] = result.allocations[key]
            allocation["constraints_satisfied"] = _constraints_satisfied(resource_results, key)
            allocation["reasoning_steps"] = _ilp_reasoning_steps(str(profile["plan_name"]))
            allocations.append(allocation)
        plans.append(
            {
                "plan_id": profile["plan_id"],
                "plan_name": profile["plan_name"],
                "objective_value": objective_value,
                "available_supply": {
                    "family_food_packs": to_int(inventory.get("family_food_packs")),
                    "individual_relief_goods": to_int(inventory.get("relief_goods_individual")),
                    "emergency_kits": to_int(inventory.get("medicine_kits")),
                },
                "profile_weights": {
                    "flood_severity": profile["severity_weight"],
                    "demographic_vulnerability": profile["vulnerability_weight"],
                },
                "coverage_targets": profile["coverage_targets"],
                "constraints": {
                    "supply": "Allocation totals do not exceed available supply.",
                    "integer": "Decision variables are constrained to whole numbers.",
                    "non_negative": "Decision variables are constrained to zero or greater.",
                    "demand_ceiling": "Allocations do not exceed existing family and demographic demand data.",
                    "equity_floor": "No existing equity floor rule was found in the backend, so no hard-coded minimum was added.",
                },
                "solver_status": {result.public_allocation_key: result.status for result in resource_results},
                "allocations": allocations,
                "reasoning_steps": [
                    "AHP and fuzzy logic produced the priority coefficients used by the ILP objective.",
                    "ILP allocated whole relief units while respecting available supply and demand ceilings.",
                    "This allocation is optimal under the defined objective and constraints.",
                ],
            }
        )
    return plans


def apply_plan_allocations(rows: list[dict[str, Any]], plan: dict[str, Any]) -> list[dict[str, Any]]:
    allocation_by_key = {str(row["barangay_id"]): row for row in plan["allocations"]}
    updated = []
    for row in rows:
        allocation = allocation_by_key.get(str(row["barangay_id"]), {})
        updated_row = dict(row)
        for category in RESOURCE_CATEGORIES:
            key = str(category["allocation_key"])
            updated_row[key] = to_int(allocation.get(key))
        updated.append(updated_row)
    return updated


def _solve_resource_allocation(
    *,
    scored: list[dict[str, Any]],
    coefficients: dict[str, float],
    supply: int,
    coverage_target: float,
    category_id: str,
    allocation_key: str,
    public_allocation_key: str,
    demand_key: str,
) -> ResourceResult:
    if supply < 0:
        raise OptimizationError(f"Available supply for {category_id} cannot be negative.")
    demands = {item["key"]: max(0, to_int(item.get(demand_key))) for item in scored}
    total_demand = sum(demands.values())
    effective_supply = _effective_supply(supply, total_demand, coverage_target)
    if effective_supply == 0:
        return ResourceResult(allocation_key, public_allocation_key, effective_supply, 0.0, {item["key"]: 0 for item in scored}, demands, "ZeroSupply")

    # Decision variable x(resource, barangay) is an integer bounded by that
    # barangay's demand. The objective maximizes the sum of
    # priority_coefficient * allocated_units under the effective supply cap.
    problem = LpProblem(f"smartflood_{category_id}", LpMaximize)
    variables = {
        item["key"]: LpVariable(f"x_{category_id}_{item['key']}", lowBound=0, upBound=demands[item["key"]], cat=LpInteger)
        for item in scored
    }
    problem += lpSum(coefficients[item["key"]] * variables[item["key"]] for item in scored)
    problem += lpSum(variables.values()) <= effective_supply

    status_code = problem.solve(PULP_CBC_CMD(msg=False))
    status = LpStatus.get(status_code, "Unknown")
    if status != "Optimal":
        raise OptimizationError(f"ILP solver failed for {category_id}: {status}.")

    allocations = {key: max(0, to_int(variable.varValue)) for key, variable in variables.items()}
    if sum(allocations.values()) > effective_supply:
        raise OptimizationError(f"ILP allocation for {category_id} exceeds available supply.")
    for key, allocation in allocations.items():
        if allocation > demands[key]:
            raise OptimizationError(f"ILP allocation for {category_id} exceeds demand ceiling for barangay {key}.")

    return ResourceResult(
        allocation_key=allocation_key,
        public_allocation_key=public_allocation_key,
        supply=effective_supply,
        objective_value=float(value(problem.objective) or 0),
        allocations=allocations,
        demands=demands,
        status=status,
    )


def _effective_supply(available_supply: int, total_demand: int, coverage_target: float) -> int:
    # A strategy deliberately optimizes only its configured coverage share,
    # capped by both physical inventory and total recorded demand.
    if available_supply <= 0 or total_demand <= 0:
        return 0
    bounded_target = min(1.0, max(0.0, coverage_target))
    target_supply = max(1, int(round(total_demand * bounded_target)))
    return min(available_supply, total_demand, target_supply)


def _validate_demographic_demand(scored: list[dict[str, Any]]) -> None:
    if all(to_int(item.get("affected_families")) <= 0 and to_int(item.get("total_family_members")) <= 0 for item in scored):
        raise OptimizationError("Missing demographic family data required to calculate defensible demand ceilings.")


def _profile_priority(item: dict[str, Any], *, severity_weight: float, vulnerability_weight: float) -> float:
    # Profile priority combines crisp flood severity with the AHP-inspired
    # demographic score and household population. It becomes the ILP objective
    # coefficient; it is not itself an allocation quantity.
    severity_component = _risk_weight(str(item.get("risk_level"))) * 100
    vulnerability_component = (
        float(item.get("ahp_breakdown", {}).get("total_vulnerability_score", 0))
        + float(item.get("total_family_members", 0))
    )
    return round(severity_component * severity_weight + vulnerability_component * vulnerability_weight, 4)


def _risk_weight(risk_level: str) -> int:
    return {"severity": 4, "flood_warning": 3, "flood_alert": 2}.get(risk_level, 1)


def _constraints_satisfied(results: list[ResourceResult], barangay_key: str) -> bool:
    return all(
        result.allocations[barangay_key] >= 0
        and result.allocations[barangay_key] <= result.demands[barangay_key]
        and sum(result.allocations.values()) <= result.supply
        for result in results
    )


def _ilp_reasoning_steps(plan_name: str) -> list[str]:
    return [
        f"{plan_name} adjusted the priority coefficient before optimization.",
        "Flood severity contributed to the barangay priority score.",
        "Demographic vulnerability contributed to the AHP vulnerability score.",
        "ILP allocated whole relief units while respecting available supply and demand constraints.",
        "Allocation favors higher-priority barangays according to the selected optimization profile.",
    ]
