from __future__ import annotations

import unittest

from app.engine import generate_recommendation_plans, generate_recommendations
from app.ilp import OptimizationError


class RecommendationEngineTests(unittest.TestCase):
    BARANGAYS = [
        {"barangay_id": 1, "barangay_name": "Barangay Tanong"},
        {"barangay_id": 2, "barangay_name": "Barangay Longos"},
        {"barangay_id": 3, "barangay_name": "Barangay Potrero"},
    ]

    def test_prioritizes_high_risk_barangay_and_respects_inventory(self) -> None:
        sensors = [
            {"_id": "tanong-sensor", "barangayName": "Tanong"},
            {"_id": "catmon-sensor", "barangayName": "Catmon"},
        ]
        readings = [
            {"_id": "tanong-sensor", "doc": {"waterLevelM": 1.2}},
            {"_id": "catmon-sensor", "doc": {"waterLevelM": 0.2}},
        ]
        families = [
            {"barangay_id": 1, "pwd_count": 1, "total_family_members": 5},
            {"barangay_id": 2, "total_family_members": 3},
        ]
        inventory = {"family_food_packs": 2, "medicine_kits": 1, "relief_goods_individual": 6}

        rows = generate_recommendations(sensors, readings, families, inventory, self.BARANGAYS)

        self.assertEqual(rows[0]["barangay_name"], "Barangay Tanong")
        self.assertEqual(rows[0]["risk_level"], "severity")
        self.assertIn("Severity flood risk detected", rows[0]["analysis_reason"])
        self.assertLessEqual(sum(row["recommended_family_food_packs"] for row in rows), 2)
        self.assertLessEqual(sum(row["recommended_medicine_kits"] for row in rows), 1)
        self.assertLessEqual(sum(row["recommended_relief_goods_individual"] for row in rows), 6)
        for row in rows:
            self.assertIsInstance(row["recommended_family_food_packs"], int)
            self.assertIsInstance(row["recommended_medicine_kits"], int)
            self.assertIsInstance(row["recommended_relief_goods_individual"], int)

    def test_canonical_registry_name_wins_over_stale_sensor_name(self) -> None:
        rows = generate_recommendations(
            [{"_id": "longos-sensor", "barangay_id": 2, "barangayName": "Catmon"}],
            [{"_id": "longos-sensor", "doc": {"waterLevelM": 0.8}}],
            [{"barangay_id": 2, "total_family_members": 4}],
            {"family_food_packs": 1, "medicine_kits": 0, "relief_goods_individual": 0},
            self.BARANGAYS,
        )

        longos = next(row for row in rows if row["barangay_id"] == "2")
        self.assertEqual(longos["barangay_name"], "Barangay Longos")
        self.assertEqual(longos["risk_level"], "flood_warning")

    def test_new_registry_barangay_is_scored_without_code_change(self) -> None:
        barangays = [*self.BARANGAYS, {"barangay_id": 4, "barangay_name": "Barangay Tinajeros"}]
        rows = generate_recommendations(
            [], [], [{"barangay_id": 4, "total_family_members": 6}],
            {"family_food_packs": 2, "medicine_kits": 0, "relief_goods_individual": 0}, barangays,
        )

        self.assertEqual({row["barangay_id"] for row in rows}, {"1", "2", "3", "4"})
        self.assertIn("Barangay Tinajeros", {row["barangay_name"] for row in rows})

    def test_missing_demographic_data_is_reported(self) -> None:
        with self.assertRaisesRegex(OptimizationError, "Missing demographic family data"):
            generate_recommendations(
                [], [], [], {"family_food_packs": 3, "medicine_kits": 0, "relief_goods_individual": 0}, self.BARANGAYS
            )

    def test_exposes_ahp_fuzzy_and_readable_reasoning_details(self) -> None:
        rows = generate_recommendations(
            [{"_id": "tanong-sensor", "barangayName": "Tanong"}],
            [{"_id": "tanong-sensor", "doc": {"waterLevelM": 0.8}}],
            [{"barangay_id": 1, "infant_count": 2, "elderly_count": 1, "pwd_count": 1}],
            {"family_food_packs": 1, "medicine_kits": 1, "relief_goods_individual": 1}, self.BARANGAYS,
        )

        tanong = next(row for row in rows if row["barangay_name"] == "Barangay Tanong")
        self.assertEqual(tanong["risk_level"], "flood_warning")
        self.assertEqual(tanong["ahp_breakdown"]["weights"]["infant"], 0.22)
        self.assertEqual(tanong["ahp_breakdown"]["contributions"]["infant"], 0.44)
        self.assertEqual(tanong["ahp_breakdown"]["total_vulnerability_score"], 0.82)
        self.assertEqual(tanong["fuzzy_explanation"]["risk_label"], "Flood warning")
        self.assertEqual(tanong["fuzzy_explanation"]["memberships"]["flood_warning"], 1.0)
        self.assertGreaterEqual(len(tanong["reasoning_steps"]), 4)
        self.assertIn("plans", tanong)
        self.assertEqual(len(tanong["plans"]), 3)

    def test_rounded_allocations_remain_within_available_inventory(self) -> None:
        rows = generate_recommendations(
            [],
            [],
            [
                {"barangay_id": 1, "total_family_members": "10.8"},
                {"barangay_id": 2, "total_family_members": "9.6"},
                {"barangay_id": 3, "total_family_members": "8.4"},
            ],
            {"family_food_packs": 2, "medicine_kits": 2, "relief_goods_individual": 7}, self.BARANGAYS,
        )

        self.assertLessEqual(sum(row["recommended_family_food_packs"] for row in rows), 2)
        self.assertLessEqual(sum(row["recommended_medicine_kits"] for row in rows), 2)
        self.assertLessEqual(sum(row["recommended_relief_goods_individual"] for row in rows), 7)

    def test_three_ilp_profiles_are_returned(self) -> None:
        plans = generate_recommendation_plans(
            [{"_id": "tanong-sensor", "barangayName": "Tanong"}],
            [{"_id": "tanong-sensor", "doc": {"waterLevelM": 1.3}}],
            [{"barangay_id": 1, "total_family_members": 10, "pwd_count": 2}],
            {"family_food_packs": 5, "medicine_kits": 2, "relief_goods_individual": 9}, self.BARANGAYS,
        )

        self.assertEqual([plan["plan_id"] for plan in plans], ["severity_first", "vulnerability_first", "balanced"])
        for plan in plans:
            self.assertIn("objective_value", plan)
            self.assertEqual(len(plan["allocations"]), 3)

    def test_allocations_never_exceed_supply_or_demand_ceiling(self) -> None:
        rows = generate_recommendations(
            [],
            [],
            [
                {"barangay_id": 1, "affected_families": 1, "total_family_members": 2, "pwd_count": 1},
                {"barangay_id": 2, "affected_families": 2, "total_family_members": 3, "elderly_count": 1},
            ],
            {"family_food_packs": 99, "medicine_kits": 99, "relief_goods_individual": 99}, self.BARANGAYS,
        )

        self.assertLessEqual(sum(row["recommended_family_food_packs"] for row in rows), 2)
        self.assertLessEqual(sum(row["recommended_relief_goods_individual"] for row in rows), 5)
        self.assertLessEqual(sum(row["recommended_medicine_kits"] for row in rows), 2)

    def test_profiles_can_return_distinct_allocations_with_abundant_inventory(self) -> None:
        plans = generate_recommendation_plans(
            [
                {"_id": "tanong-sensor", "barangayName": "Tanong"},
                {"_id": "catmon-sensor", "barangayName": "Catmon"},
                {"_id": "potrero-sensor", "barangayName": "Potrero"},
            ],
            [
                {"_id": "tanong-sensor", "doc": {"waterLevelM": 1.2}},
                {"_id": "catmon-sensor", "doc": {"waterLevelM": 0.8}},
                {"_id": "potrero-sensor", "doc": {"waterLevelM": 0.3}},
            ],
            [
                {"barangay_id": 1, "total_family_members": 9, "pwd_count": 2, "elderly_count": 2},
                {"barangay_id": 2, "total_family_members": 7, "infant_count": 2, "pregnant_count": 1},
                {"barangay_id": 3, "total_family_members": 4, "lactating_count": 1, "elderly_count": 1},
            ],
            {"family_food_packs": 500, "medicine_kits": 500, "relief_goods_individual": 500}, self.BARANGAYS,
        )

        signatures = {
            plan["plan_id"]: tuple(
                (
                    allocation["barangay_id"],
                    allocation["recommended_family_food_packs"],
                    allocation["recommended_emergency_kits"],
                    allocation["recommended_individual_relief_goods"],
                )
                for allocation in plan["allocations"]
            )
            for plan in plans
        }

        self.assertNotEqual(signatures["severity_first"], signatures["vulnerability_first"])
        self.assertNotEqual(signatures["severity_first"], signatures["balanced"])

    def test_zero_inventory_returns_zero_allocations_when_demographics_exist(self) -> None:
        rows = generate_recommendations(
            [],
            [],
            [{"barangay_id": 1, "affected_families": 2, "total_family_members": 5, "pwd_count": 1}],
            {"family_food_packs": 0, "medicine_kits": 0, "relief_goods_individual": 0}, self.BARANGAYS,
        )

        for row in rows:
            self.assertEqual(row["recommended_family_food_packs"], 0)
            self.assertEqual(row["recommended_medicine_kits"], 0)
            self.assertEqual(row["recommended_relief_goods_individual"], 0)

    def test_limited_inventory_is_integer_and_non_negative(self) -> None:
        rows = generate_recommendations(
            [],
            [],
            [
                {"barangay_id": 1, "affected_families": 10, "total_family_members": 20, "pwd_count": 2},
                {"barangay_id": 2, "affected_families": 8, "total_family_members": 18, "elderly_count": 2},
            ],
            {"family_food_packs": 1, "medicine_kits": 1, "relief_goods_individual": 1}, self.BARANGAYS,
        )

        for field in ("recommended_family_food_packs", "recommended_medicine_kits", "recommended_relief_goods_individual"):
            self.assertLessEqual(sum(row[field] for row in rows), 1)
            for row in rows:
                self.assertIsInstance(row[field], int)
                self.assertGreaterEqual(row[field], 0)

    def test_missing_sensor_reading_is_explained_without_fake_reading(self) -> None:
        rows = generate_recommendations(
            [{"_id": "tanong-sensor", "barangayName": "Tanong"}],
            [],
            [{"barangay_id": 1, "affected_families": 2, "total_family_members": 5}],
            {"family_food_packs": 1, "medicine_kits": 0, "relief_goods_individual": 1}, self.BARANGAYS,
        )

        tanong = next(row for row in rows if row["barangay_name"] == "Barangay Tanong")
        self.assertEqual(tanong["risk_level"], "no_reading")
        self.assertIn("No latest sensor reading available", tanong["analysis_reason"])

    def test_negative_inventory_is_rejected_by_optimizer(self) -> None:
        with self.assertRaisesRegex(OptimizationError, "cannot be negative"):
            generate_recommendations(
                [],
                [],
                [{"barangay_id": 1, "affected_families": 2, "total_family_members": 5}],
                {"family_food_packs": -1, "medicine_kits": 0, "relief_goods_individual": 0}, self.BARANGAYS,
            )


if __name__ == "__main__":
    unittest.main()
