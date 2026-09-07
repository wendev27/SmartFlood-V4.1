from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, Protocol

import httpx
from pymongo import MongoClient
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from .audit import sanitize_audit_event
from .config import get_settings

logger = logging.getLogger(__name__)

RECOMMENDATION_FIELDS = (
    "recommendation_id,barangay_id,barangay_name,risk_level,priority_score,"
    "affected_families,"
    "recommended_family_food_packs,recommended_medicine_kits,"
    "recommended_relief_goods_individual,analysis_reason,created_at"
)
FAMILY_FIELDS = (
    "barangay_id,barangay_name,pwd_count,elderly_count,four_ps_count,"
    "lactating_count,pregnant_count,infant_count,toddler_count,total_family_members"
)


class SmartFloodRepository(Protocol):
    def get_sensor_snapshot(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]: ...

    def get_families(self) -> list[dict[str, Any]]: ...

    def get_recommendations(self) -> list[dict[str, Any]]: ...

    def save_recommendations(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]: ...

    def get_inventory(self) -> list[dict[str, Any]]: ...

    def save_inventory(self, payload: dict[str, Any]) -> dict[str, Any]: ...

    def log_audit_event(self, event: dict[str, Any]) -> None: ...


class DatabaseRepository:
    def __init__(self, mongo_client: MongoClient[Any], mongo_db: str, supabase: Client) -> None:
        self._mongo_db = mongo_client[mongo_db]
        self._supabase = supabase

    def get_sensor_snapshot(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        sensors = list(self._mongo_db["sensors"].find({}))
        readings = list(
            self._mongo_db["sensor_readings"].aggregate(
                [
                    {"$sort": {"createdAt": -1}},
                    {"$group": {"_id": "$sensorId", "doc": {"$first": "$$ROOT"}}},
                ]
            )
        )
        return sensors, readings

    def get_families(self) -> list[dict[str, Any]]:
        return self._select("families", FAMILY_FIELDS)

    def get_recommendations(self) -> list[dict[str, Any]]:
        return self._select("ai_recommendations", RECOMMENDATION_FIELDS, order="created_at")

    def save_recommendations(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._supabase.table("ai_recommendations").insert(rows).execute().data or []

    def get_inventory(self) -> list[dict[str, Any]]:
        return self._select("relief_inventory", "*", order="created_at")

    def save_inventory(self, payload: dict[str, Any]) -> dict[str, Any]:
        rows = self._supabase.table("relief_inventory").insert(payload).execute().data or []
        return rows[0] if rows else payload

    def log_audit_event(self, event: dict[str, Any]) -> None:
        try:
            self._supabase.table("audit_logs").insert(sanitize_audit_event(event)).execute()
        except Exception:
            logger.exception("Audit log insert failed")

    def _select(self, table: str, columns: str, order: str | None = None) -> list[dict[str, Any]]:
        query = self._supabase.table(table).select(columns)
        if order:
            query = query.order(order, desc=True)
        return query.execute().data or []


@lru_cache
def get_repository() -> SmartFloodRepository:
    settings = get_settings()
    settings.validate()
    supabase_options = SyncClientOptions()
    supabase_options.httpx_client = httpx.Client(
        transport=httpx.HTTPTransport(local_address="0.0.0.0", http2=True),
        timeout=supabase_options.postgrest_client_timeout,
        follow_redirects=True,
    )
    return DatabaseRepository(
        mongo_client=MongoClient(settings.mongodb_uri, connectTimeoutMS=2000),
        mongo_db=settings.mongodb_db,
        supabase=create_client(
            settings.supabase_url, settings.supabase_service_role_key, options=supabase_options
        ),
    )
