import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCurrentAge,
  calculateCurrentPregnancyWeeks,
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

test("calculateCurrentPregnancyWeeks advances only after complete Manila calendar weeks", () => {
  const baseline = "2026-09-17T04:00:00.000Z";

  assert.equal(calculateCurrentPregnancyWeeks(24, baseline, new Date("2026-09-17T15:59:59.000Z")), 24);
  assert.equal(calculateCurrentPregnancyWeeks(24, baseline, new Date("2026-09-23T15:59:59.000Z")), 24);
  assert.equal(calculateCurrentPregnancyWeeks(24, baseline, new Date("2026-09-24T04:00:00.000Z")), 25);
  assert.equal(calculateCurrentPregnancyWeeks(24, baseline, new Date("2026-10-01T04:00:00.000Z")), 26);
});

test("calculateCurrentPregnancyWeeks uses calendar dates instead of elapsed hours", () => {
  const lateNightBaseline = "2026-09-17T15:59:59.000Z";
  const sevenCalendarDatesLater = new Date("2026-09-24T00:00:00.000Z");

  assert.equal(calculateCurrentPregnancyWeeks(24, lateNightBaseline, sevenCalendarDatesLater), 25);
});

test("calculateCurrentPregnancyWeeks accepts zero and does not cap the derived result", () => {
  assert.equal(calculateCurrentPregnancyWeeks(0, "2026-09-01T00:00:00.000Z", new Date("2026-09-22T00:00:00.000Z")), 3);
  assert.equal(calculateCurrentPregnancyWeeks(42, "2026-09-01T00:00:00.000Z", new Date("2026-09-22T00:00:00.000Z")), 45);
});

test("calculateCurrentPregnancyWeeks returns unavailable for missing, invalid, or future baselines", () => {
  const asOf = new Date("2026-09-17T04:00:00.000Z");

  assert.equal(calculateCurrentPregnancyWeeks(null, "2026-09-17T00:00:00.000Z", asOf), null);
  assert.equal(calculateCurrentPregnancyWeeks(24, null, asOf), null);
  assert.equal(calculateCurrentPregnancyWeeks(24, "not-a-timestamp", asOf), null);
  assert.equal(calculateCurrentPregnancyWeeks(24, "2026-09-18T00:00:00.000Z", asOf), null);
});

test("calculateCurrentPregnancyWeeks does not mutate its baseline inputs", () => {
  const baselineDate = new Date("2026-09-17T00:00:00.000Z");
  const baselineTime = baselineDate.getTime();
  const baselineWeeks = 24;

  assert.equal(calculateCurrentPregnancyWeeks(baselineWeeks, baselineDate, new Date("2026-09-24T00:00:00.000Z")), 25);
  assert.equal(baselineWeeks, 24);
  assert.equal(baselineDate.getTime(), baselineTime);
});
