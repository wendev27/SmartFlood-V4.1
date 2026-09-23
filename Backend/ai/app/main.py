from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .audit import log_audit_event_safely
from .config import get_settings
from .engine import _ahp_breakdown, _fuzzy_explanation, _reasoning_steps, generate_recommendations
from .ilp import OptimizationError
from .models import ApiResponse, AuditActor, InventoryInput
from .payloads import recommendation_rows_to_save, to_int
from .repositories import SmartFloodRepository, get_repository

app = FastAPI(title="SmartFlood AI Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(get_settings().cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, error: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=error.status_code, content={"success": False, "error": str(error.detail)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "smartflood-ai-backend"}


@app.get("/api/ai/recommendations", response_model=ApiResponse)
async def list_recommendations(repository: SmartFloodRepository = Depends(get_repository)) -> ApiResponse:
    rows = await run_in_threadpool(repository.get_recommendations)
    return ApiResponse(data=[_recommendation_response(row) for row in rows])


@app.post("/api/ai/recommendations/generate", response_model=ApiResponse)
async def create_recommendations(
    inventory: InventoryInput, repository: SmartFloodRepository = Depends(get_repository)
) -> ApiResponse:
    if inventory.total <= 0:
        raise HTTPException(status_code=400, detail="Please input available relief inventory before generating recommendations.")
    # Generation is read-only with respect to recommendation history: current
    # sensor, family, barangay, and operator-entered inventory data are scored
    # and optimized into draft plans for human review.
    sensors, readings = await run_in_threadpool(repository.get_sensor_snapshot)
    families = await run_in_threadpool(repository.get_families)
    barangays = await run_in_threadpool(repository.get_barangays)
    try:
        rows = generate_recommendations(sensors, readings, families, inventory.inventory_payload(), barangays)
    except OptimizationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    await run_in_threadpool(
        log_audit_event_safely,
        repository.log_audit_event,
        _audit_event(
            inventory.audit_actor,
            action="AI_RECOMMENDATION_GENERATED",
            description=f"Generated draft relief allocation plans using current available inventory for {len(rows)} barangays.",
            target_type="ai_recommendation_batch",
            target_id=datetime.now(UTC).isoformat(),
        ),
    )
    return ApiResponse(data=[_recommendation_response(row, inventory.audit_actor) for row in rows], plans=rows[0].get("plans") if rows else [])


@app.post("/api/ai/recommendations/approve", response_model=ApiResponse)
async def approve_recommendations(request: Request, repository: SmartFloodRepository = Depends(get_repository)) -> ApiResponse:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid approval payload.")
    plan = body.get("plan")
    if not isinstance(plan, dict):
        raise HTTPException(status_code=400, detail="Selected allocation plan is required.")
    allocations = plan.get("allocations")
    if not isinstance(allocations, list) or not allocations:
        raise HTTPException(status_code=400, detail="Selected allocation plan has no barangay allocations.")
    rows = [row for row in allocations if isinstance(row, dict)]
    if len(rows) != len(allocations):
        raise HTTPException(status_code=400, detail="Selected allocation plan contains invalid allocation rows.")

    # Only the separately approved plan reaches persistence. Authentication and
    # role enforcement happen in the dashboard API before this service call.
    actor = _audit_actor_from_payload(body.get("audit_actor"))
    try:
        saved_rows = await run_in_threadpool(repository.save_recommendations, recommendation_rows_to_save(rows))
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Unable to save approved AI recommendations: {error}") from error

    await run_in_threadpool(
        log_audit_event_safely,
        repository.log_audit_event,
        _audit_event(
            actor,
            action="AI_RECOMMENDATION_APPROVED",
            description=f"Approved {plan.get('plan_name', 'selected')} relief allocation strategy for {len(saved_rows or rows)} barangays.",
            target_type="ai_recommendation_plan",
            target_id=str(plan.get("plan_id") or datetime.now(UTC).isoformat()),
        ),
    )
    return ApiResponse(data=_merge_saved_recommendations(rows, saved_rows, actor))


@app.get("/api/relief/inventory", response_model=ApiResponse)
async def list_inventory(repository: SmartFloodRepository = Depends(get_repository)) -> ApiResponse:
    return ApiResponse(data=await run_in_threadpool(repository.get_inventory))


@app.post("/api/relief/inventory", response_model=ApiResponse, status_code=201)
async def save_inventory(
    inventory: InventoryInput, repository: SmartFloodRepository = Depends(get_repository)
) -> ApiResponse:
    saved = await run_in_threadpool(repository.save_inventory, inventory.inventory_payload())
    await run_in_threadpool(
        log_audit_event_safely,
        repository.log_audit_event,
        _audit_event(
            inventory.audit_actor,
            action="RELIEF_INVENTORY_UPDATED",
            description="Updated available relief inventory.",
            target_type="relief_inventory",
            target_id=str(saved.get("inventory_id", saved.get("id", saved.get("created_at", "")))),
        ),
    )
    return ApiResponse(data=saved)


def _merge_saved_recommendations(
    generated_rows: list[dict[str, object]],
    saved_rows: list[dict[str, object]],
    actor: AuditActor | None,
) -> list[dict[str, object | None]]:
    generated_at = datetime.now(UTC).isoformat()
    return [
        _recommendation_response(
            {"created_at": generated_at, **row, **(saved_rows[index] if index < len(saved_rows) else {})},
            actor,
        )
        for index, row in enumerate(generated_rows)
    ]


def _recommendation_response(
    row: dict[str, object], actor: AuditActor | None = None
) -> dict[str, object | None]:
    risk_level = _public_risk_level(row.get("risk_level"))
    if row.get("fuzzy_explanation"):
        fuzzy_explanation = dict(row["fuzzy_explanation"])
    elif "water_level_m" in row:
        fuzzy_explanation = _fuzzy_explanation(row["water_level_m"])
    else:
        fuzzy_explanation = {
            "water_level_m": None,
            "risk_level": risk_level,
            "risk_label": _risk_label_for_api(risk_level),
            "confidence": None,
            "memberships": {},
        }
    fuzzy_explanation["risk_level"] = _public_risk_level(fuzzy_explanation.get("risk_level"))
    fuzzy_explanation["risk_label"] = _risk_label_for_api(fuzzy_explanation["risk_level"])
    fallback_row = {**row, "risk_level": risk_level}
    created_by = row.get("created_by") or (actor.actor_user_id or actor.actor_name if actor else None)
    return {
        "recommendation_id": row.get("recommendation_id"),
        "barangay_id": row.get("barangay_id"),
        "barangay_name": row.get("barangay_name"),
        "risk_level": risk_level,
        "priority_score": row.get("priority_score", 0),
        "affected_families": to_int(row.get("affected_families")),
        "recommended_family_food_packs": to_int(row.get("recommended_family_food_packs")),
        "recommended_medicine_kits": to_int(row.get("recommended_medicine_kits")),
        "recommended_emergency_kits": to_int(row.get("recommended_medicine_kits")),
        "recommended_relief_goods_individual": to_int(row.get("recommended_relief_goods_individual")),
        "analysis_reason": _replace_critical_text(str(row.get("analysis_reason", ""))),
        "ahp_breakdown": row.get("ahp_breakdown") or _ahp_breakdown(row),
        "fuzzy_explanation": fuzzy_explanation,
        "reasoning_steps": row.get("reasoning_steps") or _reasoning_steps(fallback_row),
        "status": row.get("status") or "generated",
        "created_by": created_by,
        "created_at": row.get("created_at"),
    }


def _public_risk_level(value: object) -> str:
    risk_level = str(value or "normal")
    return "severity" if risk_level == "critical" else risk_level


def _risk_label_for_api(risk_level: object) -> str:
    return {
        "severity": "Severity",
        "flood_warning": "Flood warning",
        "flood_alert": "Flood alert",
        "no_reading": "No reading",
    }.get(str(risk_level), "Normal")


def _replace_critical_text(value: str) -> str:
    return value.replace("Critical", "Severity").replace("critical", "severity")


def _audit_actor_from_payload(value: object) -> AuditActor | None:
    if not isinstance(value, dict):
        return None
    return AuditActor.model_validate(value)


def _audit_event(
    actor: AuditActor | None, *, action: str, description: str, target_type: str, target_id: str
) -> dict[str, object | None]:
    actor_data = actor.model_dump() if actor else {}
    return {
        **actor_data,
        "action": action,
        "module": "AI-Optimized Relief Recommendation",
        "description": description,
        "target_type": target_type,
        "target_id": target_id,
    }
