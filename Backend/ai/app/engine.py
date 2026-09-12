from __future__ import annotations

from typing import Any

from .ilp import apply_plan_allocations, build_optimization_plans
from .payloads import to_int

COUNT_FIELDS = (
    "pwd_count",
    "elderly_count",
    "four_ps_count",
    "lactating_count",
    "pregnant_count",
    "infant_count",
    "toddler_count",
    "total_family_members",
)
AHP_WEIGHTS = {
    "infant": 0.22,
    "elderly": 0.20,
    "pwd": 0.18,
    "pregnant": 0.12,
    "lactating": 0.10,
    "toddler": 0.10,
    "four_ps": 0.08,
}
AHP_COUNT_FIELDS = {
    "infant": "infant_count",
    "elderly": "elderly_count",
    "pwd": "pwd_count",
    "pregnant": "pregnant_count",
    "lactating": "lactating_count",
    "toddler": "toddler_count",
    "four_ps": "four_ps_count",
}


def generate_recommendations(
    sensors: list[dict[str, Any]],
    latest_readings: list[dict[str, Any]],
    families: list[dict[str, Any]],
    inventory: dict[str, int],
    barangays: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    plans = generate_recommendation_plans(sensors, latest_readings, families, inventory, barangays)
    balanced = next(plan for plan in plans if plan["plan_id"] == "balanced")
    rows = apply_plan_allocations(_base_recommendation_rows(sensors, latest_readings, families, barangays), balanced)
    for row in rows:
        row["plans"] = plans
        row["analysis_reason"] = _analysis_reason(row, row["has_sensor_reading"])
        row["reasoning_steps"] = _reasoning_steps(row)
    return [{name: value for name, value in row.items() if name != "has_sensor_reading"} for row in rows]


def generate_recommendation_plans(
    sensors: list[dict[str, Any]],
    latest_readings: list[dict[str, Any]],
    families: list[dict[str, Any]],
    inventory: dict[str, int],
    barangays: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    scored = _scored_barangays(sensors, latest_readings, families, barangays)
    plans = build_optimization_plans(scored, inventory)
    for plan in plans:
        for allocation in plan["allocations"]:
            allocation["analysis_reason"] = _analysis_reason(allocation, allocation.get("has_sensor_reading", False))
    return plans


def _base_recommendation_rows(
    sensors: list[dict[str, Any]],
    latest_readings: list[dict[str, Any]],
    families: list[dict[str, Any]],
    barangays: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    return [
        {
            name: value
            for name, value in item.items()
            if name != "key"
        }
        for item in _scored_barangays(sensors, latest_readings, families, barangays)
    ]


def _scored_barangays(
    sensors: list[dict[str, Any]],
    latest_readings: list[dict[str, Any]],
    families: list[dict[str, Any]],
    barangays: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    registry = _build_barangay_registry(barangays, sensors, families)
    aliases = _build_barangay_aliases(registry)
    sensor_groups = _group_sensors(sensors, latest_readings, aliases)
    family_groups = _group_families(families, aliases)
    return sorted(
        (_score_barangay(barangay, sensor_groups, family_groups) for barangay in registry),
        key=lambda item: item["priority_score"],
        reverse=True,
    )


def allocate_inventory(scored: list[dict[str, Any]], available: int, need_for: Any) -> dict[str, int]:
    available = max(0, to_int(available))
    allocations = {item["key"]: 0 for item in scored}
    if available <= 0 or not scored:
        return allocations
    needs = {item["key"]: max(0, to_int(need_for(item))) for item in scored}
    total_priority = sum(item["priority_score"] for item in scored) or 1
    remaining = available
    for item in scored:
        key = item["key"]
        allocation = min(int((available * item["priority_score"]) // total_priority), needs[key], remaining)
        allocations[key] = allocation
        remaining -= allocation
    top = scored[0]
    if remaining > 0 and allocations[top["key"]] == 0 and needs[top["key"]] > 0:
        allocations[top["key"]] = 1
        remaining -= 1
    while remaining > 0:
        distributed = False
        for item in scored:
            key = item["key"]
            if allocations[key] >= needs[key]:
                continue
            allocations[key] += 1
            remaining -= 1
            distributed = True
            if remaining == 0:
                break
        if not distributed:
            break
    return allocations


def _group_sensors(
    sensors: list[dict[str, Any]],
    latest_readings: list[dict[str, Any]],
    aliases: dict[str, dict[str, str]],
) -> dict[str, dict[str, Any]]:
    reading_map = {str(row.get("_id")): row.get("doc", row) for row in latest_readings}
    groups: dict[str, dict[str, Any]] = {}
    for sensor in sensors:
        barangay = normalize_barangay(
            sensor.get("barangay_id", sensor.get("barangayId", sensor.get("barangayName", sensor.get("barangay")))),
            aliases,
        )
        if not barangay:
            continue
        key = barangay["barangay_id"]
        group = groups.setdefault(key, {"max_water_level_m": None, "reading_count": 0})
        reading = reading_map.get(str(sensor.get("_id")))
        if reading:
            water_level = _number(reading.get("waterLevelM", reading.get("waterLevel")))
            group["max_water_level_m"] = max(group["max_water_level_m"] or 0, water_level)
            group["reading_count"] += 1
    return groups


def _group_families(families: list[dict[str, Any]], aliases: dict[str, dict[str, str]]) -> dict[str, dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for family in families:
        barangay = normalize_barangay(family.get("barangay_id", family.get("barangay_name")), aliases)
        if not barangay:
            continue
        key = barangay["barangay_id"]
        group = groups.setdefault(key, {field: 0 for field in COUNT_FIELDS} | {"affected_families": 0})
        for field in COUNT_FIELDS:
            group[field] += _number(family.get(field))
        group["affected_families"] += 1
    return groups


def _score_barangay(
    barangay: dict[str, str], sensor_groups: dict[str, dict[str, Any]], family_groups: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    key = barangay["barangay_id"]
    sensor = sensor_groups.get(key)
    totals = family_groups.get(key, {field: 0 for field in COUNT_FIELDS} | {"affected_families": 0})
    water_level = sensor["max_water_level_m"] if sensor and sensor["max_water_level_m"] is not None else 0
    fuzzy_explanation = _fuzzy_explanation(water_level)
    risk_level = "no_reading" if sensor and sensor["reading_count"] == 0 else fuzzy_explanation["risk_level"]
    ahp_breakdown = _ahp_breakdown(totals)
    emergency_kit_demand = (
        totals["pwd_count"]
        + totals["elderly_count"]
        + totals["lactating_count"]
        + totals["pregnant_count"]
        + totals["infant_count"]
    )
    priority_score = round(
        _risk_weight(risk_level) * 100 + ahp_breakdown["total_vulnerability_score"] + totals["total_family_members"],
        4,
    )
    return {
        "key": key,
        "barangay_id": key,
        "barangay_name": barangay["barangay_name"],
        "risk_level": risk_level,
        "water_level_m": water_level,
        "priority_score": priority_score,
        "ahp_breakdown": ahp_breakdown,
        "fuzzy_explanation": fuzzy_explanation,
        "emergency_kit_demand": emergency_kit_demand,
        **totals,
        "has_sensor_reading": bool(sensor and sensor["reading_count"]),
    }


def _analysis_reason(item: dict[str, Any], has_sensor_reading: bool) -> str:
    families = item["affected_families"]
    if has_sensor_reading:
        family_label = "family" if families == 1 else "families"
        base = f"{_risk_label(item['risk_level'])} flood risk detected at {item['water_level_m']:.2f}m with {families} affected {family_label}."
    else:
        family_label = "family record" if families == 1 else "family records"
        base = f"No latest sensor reading available. Based on {families} affected {family_label}."
    total_allocated = (
        item["recommended_family_food_packs"]
        + item["recommended_medicine_kits"]
        + item["recommended_relief_goods_individual"]
    )
    if total_allocated:
        allocation = "ILP allocated whole relief units under the selected objective and constraints."
    elif families == 0:
        allocation = "No family vulnerability data is currently available for this barangay."
    else:
        allocation = "Current inventory was insufficient for this barangay after higher-priority allocation."
    return f"{base} {allocation}"


def normalize_barangay(value: Any, aliases: dict[str, dict[str, str]] | None = None) -> dict[str, str] | None:
    return (aliases or {}).get(str(value or "").strip().lower())


def _build_barangay_registry(
    barangays: list[dict[str, Any]] | None,
    sensors: list[dict[str, Any]],
    families: list[dict[str, Any]],
) -> tuple[dict[str, str], ...]:
    source = barangays if barangays is not None else _infer_barangays(sensors, families)
    registry: dict[str, dict[str, str]] = {}
    for row in source:
        barangay_id = str(row.get("barangay_id", row.get("id", ""))).strip()
        barangay_name = str(row.get("barangay_name", row.get("name", ""))).strip()
        if barangay_id and barangay_name:
            registry[barangay_id] = {"barangay_id": barangay_id, "barangay_name": barangay_name}
    return tuple(registry.values())


def _infer_barangays(sensors: list[dict[str, Any]], families: list[dict[str, Any]]) -> list[dict[str, Any]]:
    inferred: dict[str, dict[str, Any]] = {}
    for row in [*families, *sensors]:
        value = row.get("barangay_id", row.get("barangayId", row.get("barangay_name", row.get("barangayName", row.get("barangay")))))
        key = str(value or "").strip()
        if not key:
            continue
        inferred.setdefault(key, {"barangay_id": key, "barangay_name": str(value).strip()})
    return list(inferred.values())


def _build_barangay_aliases(registry: tuple[dict[str, str], ...]) -> dict[str, dict[str, str]]:
    aliases: dict[str, dict[str, str]] = {}
    for barangay in registry:
        canonical = barangay["barangay_name"]
        barangay_id = barangay["barangay_id"]
        names = {barangay_id, canonical, canonical.removeprefix("Barangay ").strip()}
        aliases.update({name.strip().lower(): barangay for name in names if name.strip()})
    return aliases


def _number(value: Any) -> int | float:
    try:
        number = float(value or 0)
        return int(number) if number.is_integer() else number
    except (TypeError, ValueError):
        return 0


def _risk_from_water_level(water_level: int | float) -> str:
    if water_level >= 1.2:
        return "severity"
    if water_level >= 0.75:
        return "flood_warning"
    if water_level >= 0.25:
        return "flood_alert"
    return "normal"


def _risk_weight(risk_level: str) -> int:
    return {"severity": 4, "flood_warning": 3, "flood_alert": 2}.get(risk_level, 1)


def _risk_label(risk_level: str) -> str:
    return {
        "severity": "Severity",
        "flood_warning": "Flood warning",
        "flood_alert": "Flood alert",
        "no_reading": "No reading",
    }.get(risk_level, "Normal")


def _ahp_breakdown(totals: dict[str, Any]) -> dict[str, Any]:
    counts = {name: _number(totals.get(field)) for name, field in AHP_COUNT_FIELDS.items()}
    contributions = {name: round(counts[name] * weight, 4) for name, weight in AHP_WEIGHTS.items()}
    return {
        "weights": AHP_WEIGHTS.copy(),
        "counts": counts,
        "contributions": contributions,
        "total_vulnerability_score": round(sum(contributions.values()), 4),
    }


def _fuzzy_explanation(water_level: int | float) -> dict[str, Any]:
    memberships = {
        "normal": _descending_membership(water_level, 0.25, 0.50),
        "flood_alert": _trapezoid_membership(water_level, 0.25, 0.25, 0.50, 0.75),
        "flood_warning": _trapezoid_membership(water_level, 0.50, 0.75, 1.00, 1.20),
        "severity": _ascending_membership(water_level, 1.00, 1.20),
    }
    risk_level = _risk_from_water_level(water_level)
    return {
        "water_level_m": water_level,
        "risk_level": risk_level,
        "risk_label": _risk_label(risk_level),
        "confidence": memberships[risk_level],
        "memberships": memberships,
    }


def _reasoning_steps(item: dict[str, Any]) -> list[str]:
    return [
        f"Sensor reading classified the barangay as {_risk_label(item['risk_level'])} risk.",
        "Family vulnerability score was computed using AHP-inspired weights.",
        "AHP and fuzzy priority scores were used as ILP objective coefficients.",
        "ILP allocated exact integer relief units while respecting supply and demand ceilings.",
    ]


def _descending_membership(value: int | float, full_until: float, zero_at: float) -> float:
    if value <= full_until:
        return 1.0
    if value >= zero_at:
        return 0.0
    return round((zero_at - value) / (zero_at - full_until), 4)


def _ascending_membership(value: int | float, zero_until: float, full_at: float) -> float:
    if value <= zero_until:
        return 0.0
    if value >= full_at:
        return 1.0
    return round((value - zero_until) / (full_at - zero_until), 4)


def _trapezoid_membership(value: int | float, start: float, full_from: float, full_until: float, end: float) -> float:
    if value < start or value > end:
        return 0.0
    if full_from <= value <= full_until:
        return 1.0
    if value < full_from:
        return round((value - start) / (full_from - start), 4)
    return round((end - value) / (end - full_until), 4)
