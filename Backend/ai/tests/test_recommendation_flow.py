from __future__ import annotations

import unittest

import app.main as main_module
from app.models import InventoryInput


async def direct_run(func, *args, **kwargs):
    return func(*args, **kwargs)


class FakeRequest:
    def __init__(self, payload):
        self.payload = payload

    async def json(self):
        return self.payload


class FakeRepository:
    def __init__(self):
        self.saved_rows = []
        self.audit_events = []

    def get_sensor_snapshot(self):
        return (
            [
                {"_id": "tanong-sensor", "barangayName": "Tanong"},
                {"_id": "catmon-sensor", "barangayName": "Catmon"},
            ],
            [
                {"_id": "tanong-sensor", "doc": {"waterLevelM": 1.2}},
                {"_id": "catmon-sensor", "doc": {"waterLevelM": 0.6}},
            ],
        )

    def get_barangays(self):
        return [
            {"barangay_id": 1, "barangay_name": "Barangay Tanong"},
            {"barangay_id": 2, "barangay_name": "Barangay Longos"},
        ]

    def get_families(self):
        return [
            {"barangay_id": 1, "total_family_members": 9, "pwd_count": 2, "elderly_count": 2},
            {"barangay_id": 2, "total_family_members": 7, "infant_count": 2, "pregnant_count": 1},
        ]

    def save_recommendations(self, rows):
        self.saved_rows.extend(rows)
        return [{"recommendation_id": f"saved-{index + 1}", **row} for index, row in enumerate(rows)]

    def log_audit_event(self, event):
        self.audit_events.append(event)


class RecommendationApprovalFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original_run_in_threadpool = main_module.run_in_threadpool
        main_module.run_in_threadpool = direct_run

    async def asyncTearDown(self):
        main_module.run_in_threadpool = self.original_run_in_threadpool

    async def test_generate_returns_plans_without_saving_history(self):
        repository = FakeRepository()

        response = await main_module.create_recommendations(
            InventoryInput.model_validate({"family_food_packs": 100, "medicine_kits": 50, "relief_goods_individual": 100}),
            repository,
        )

        self.assertEqual(repository.saved_rows, [])
        self.assertEqual(len(response.plans), 3)
        self.assertEqual([plan["plan_id"] for plan in response.plans], ["severity_first", "vulnerability_first", "balanced"])
        self.assertTrue(all(row["barangay_name"] != "Barangay Catmon" for row in response.data))
        self.assertIn("Barangay Longos", {row["barangay_name"] for row in response.data})

    async def test_approve_saves_selected_plan_to_history(self):
        repository = FakeRepository()
        generated = await main_module.create_recommendations(
            InventoryInput.model_validate({"family_food_packs": 100, "medicine_kits": 50, "relief_goods_individual": 100}),
            repository,
        )
        selected_plan = next(plan for plan in generated.plans if plan["plan_id"] == "vulnerability_first")

        response = await main_module.approve_recommendations(FakeRequest({"plan": selected_plan}), repository)

        self.assertEqual(len(repository.saved_rows), len(selected_plan["allocations"]))
        self.assertEqual(len(response.data), len(selected_plan["allocations"]))
        self.assertTrue(all(row["recommendation_id"].startswith("saved-") for row in response.data))


if __name__ == "__main__":
    unittest.main()
