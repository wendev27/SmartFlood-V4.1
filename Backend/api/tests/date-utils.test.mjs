import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCurrentAge,
  classifyCurrentAge,
  PENDING_DEMOGRAPHIC_AGE_POLICY,
  residentWithCurrentAge,
} from "../src/lib/dateUtils.ts";

const testPolicy = {
  status: "configured",
  thresholds: { infantMaxAge: 1, toddlerMaxAge: 3, elderlyMinAge: 60 },
};

test("calculateCurrentAge respects the birthday boundary", () => {
  const beforeBirthday = new Date("2026-09-16T15:59:59.000Z");
  const onBirthday = new Date("2026-09-17T16:00:00.000Z");

  assert.equal(calculateCurrentAge("2000-09-17", beforeBirthday), 25);
  assert.equal(calculateCurrentAge("2000-09-17", onBirthday), 26);
});

test("calculateCurrentAge uses the Manila calendar date", () => {
  const justBeforeMidnightUtc = new Date("2026-09-16T15:59:59.000Z");
  const justAfterMidnightUtc = new Date("2026-09-16T16:00:00.000Z");

  assert.equal(calculateCurrentAge("2000-09-17", justBeforeMidnightUtc), 25);
  assert.equal(calculateCurrentAge("2000-09-17", justAfterMidnightUtc), 26);
});

test("calculateCurrentAge rejects invalid and future birth dates", () => {
  const asOf = new Date("2026-09-17T16:00:00.000Z");

  assert.equal(calculateCurrentAge("2001-02-29", asOf), null);
  assert.equal(calculateCurrentAge("2027-01-01", asOf), null);
});

test("residentWithCurrentAge makes DOB-backed age authoritative", () => {
  const asOf = new Date("2026-09-17T15:59:59.000Z");
  const resident = residentWithCurrentAge({ birth_date: "1966-09-18", age: 59 }, asOf);

  assert.equal(resident.age, 59);
  assert.equal(resident.age_source, "birth_date");
});

test("residentWithCurrentAge preserves legacy age when DOB is absent", () => {
  const resident = residentWithCurrentAge({ birth_date: null, age: 42 });

  assert.equal(resident.age, 42);
  assert.equal(resident.age_source, "legacy");
});

test("classifyCurrentAge keeps thresholds explicitly policy-injected", () => {
  assert.deepEqual(classifyCurrentAge(1, testPolicy), { classification: "infant", age: 1, reason: "classified" });
  assert.deepEqual(classifyCurrentAge(2, testPolicy), { classification: "toddler", age: 2, reason: "classified" });
  assert.deepEqual(classifyCurrentAge(60, testPolicy), { classification: "elderly", age: 60, reason: "classified" });
  assert.deepEqual(classifyCurrentAge(30, testPolicy), { classification: "other", age: 30, reason: "classified" });
});

test("classifyCurrentAge does not classify without DOB-backed age or policy", () => {
  assert.deepEqual(classifyCurrentAge(null, testPolicy), { classification: "unknown", age: null, reason: "age_unavailable" });
  assert.deepEqual(classifyCurrentAge(60, PENDING_DEMOGRAPHIC_AGE_POLICY), { classification: "unknown", age: 60, reason: "policy_unconfigured" });
});

test("classifyCurrentAge rejects invalid injected policies", () => {
  assert.deepEqual(classifyCurrentAge(2, {
    status: "configured",
    thresholds: { infantMaxAge: 3, toddlerMaxAge: 2, elderlyMinAge: 60 },
  }), { classification: "unknown", age: 2, reason: "invalid_policy" });
});
