const RESIDENT_DATE_TIME_ZONE = "Asia/Manila";

export type DemographicClassification =
  | "infant"
  | "toddler"
  | "preschool"
  | "child"
  | "teen"
  | "adult"
  | "elderly"
  | "other"
  | "unknown";

export type DemographicAgeThresholds = Readonly<{
  infantMaxAge: number;
  toddlerMaxAge: number;
  elderlyMinAge: number;
}>;

export type ApprovedDemographicAgeThresholds = Readonly<{
  infantMaxAgeMonths: number;
  toddlerMaxAgeYearsExclusive: number;
  preschoolMaxAge: number;
  childMaxAge: number;
  teenMaxAge: number;
  elderlyMinAge: number;
}>;

export type DemographicAgePolicy = Readonly<{
  status: "pending" | "configured";
  mode?: "legacy_vulnerability" | "approved_life_stage";
  thresholds?: DemographicAgeThresholds | ApprovedDemographicAgeThresholds;
}>;

export type DemographicClassificationContext = Readonly<{
  birthDate?: string | Date;
  asOf?: Date;
}>;

export type DemographicClassificationResult = Readonly<{
  classification: DemographicClassification;
  age: number | null;
  reason:
    | "age_unavailable"
    | "policy_unconfigured"
    | "invalid_policy"
    | "boundary_context_unavailable"
    | "classified";
}>;

/** Threshold policy is intentionally pending until demographic policy is approved. */
export const PENDING_DEMOGRAPHIC_AGE_POLICY: DemographicAgePolicy = {
  status: "pending",
};

/**
 * Approved policy for the read-only demographic comparison. Infant uses an
 * exact calendar boundary: the date of the first anniversary is still
 * classified as infant; the following calendar date is toddler.
 */
export const APPROVED_DEMOGRAPHIC_AGE_POLICY: DemographicAgePolicy = {
  status: "configured",
  mode: "approved_life_stage",
  thresholds: {
    infantMaxAgeMonths: 12,
    toddlerMaxAgeYearsExclusive: 4,
    preschoolMaxAge: 6,
    childMaxAge: 12,
    teenMaxAge: 17,
    elderlyMinAge: 60,
  },
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

/**
 * Calculates age from a date-only birth date using the current Manila calendar
 * date. Returns null for malformed/future birth dates.
 */
export function calculateCurrentAge(birthDate: string | Date, asOf = new Date()): number | null {
  const birth = parseBirthDate(birthDate);
  const today = calendarDateInTimeZone(asOf, RESIDENT_DATE_TIME_ZONE);

  if (!birth || !today) return null;

  let age = today.year - birth.year;
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

/**
 * Adds complete Manila calendar weeks elapsed to a stored pregnancy baseline.
 * The baseline remains unchanged; this function only derives a response value.
 */
export function calculateCurrentPregnancyWeeks(
  baselineWeeks: unknown,
  pregnancyBaselineAt: unknown,
  currentDate = new Date(),
): number | null {
  if (!Number.isInteger(baselineWeeks) || Number(baselineWeeks) < 0) return null;

  const baselineDate = parseTimestampCalendarDate(pregnancyBaselineAt, RESIDENT_DATE_TIME_ZONE);
  const today = calendarDateInTimeZone(currentDate, RESIDENT_DATE_TIME_ZONE);
  if (!baselineDate || !today || compareCalendarDates(baselineDate, today) > 0) return null;

  const elapsedDays = calendarDayNumber(today) - calendarDayNumber(baselineDate);
  return Number(baselineWeeks) + Math.floor(elapsedDays / 7);
}

/**
 * Maps an authoritative current age to a demographic class using an explicitly
 * supplied policy. Legacy stored age values must not be passed here as a
 * substitute for dynamically verified age.
 */
export function classifyCurrentAge(
  age: number | null | undefined,
  policy: DemographicAgePolicy = PENDING_DEMOGRAPHIC_AGE_POLICY,
  context: DemographicClassificationContext = {},
): DemographicClassificationResult {
  if (!Number.isInteger(age) || age == null || age < 0) {
    return { classification: "unknown", age: null, reason: "age_unavailable" };
  }

  if (policy.status === "pending" || !policy.thresholds) {
    return { classification: "unknown", age, reason: "policy_unconfigured" };
  }

  if (policy.mode === "approved_life_stage") {
    return classifyApprovedLifeStage(age, policy.thresholds, context);
  }

  const thresholds = policy.thresholds as DemographicAgeThresholds;
  const { infantMaxAge, toddlerMaxAge, elderlyMinAge } = thresholds;
  if (
    !Number.isInteger(infantMaxAge) || infantMaxAge < 0
    || !Number.isInteger(toddlerMaxAge) || toddlerMaxAge <= infantMaxAge
    || !Number.isInteger(elderlyMinAge) || elderlyMinAge <= toddlerMaxAge
  ) {
    return { classification: "unknown", age, reason: "invalid_policy" };
  }

  if (age <= infantMaxAge) return { classification: "infant", age, reason: "classified" };
  if (age <= toddlerMaxAge) return { classification: "toddler", age, reason: "classified" };
  if (age >= elderlyMinAge) return { classification: "elderly", age, reason: "classified" };
  return { classification: "other", age, reason: "classified" };
}

function classifyApprovedLifeStage(
  age: number,
  thresholds: DemographicAgeThresholds | ApprovedDemographicAgeThresholds,
  context: DemographicClassificationContext,
): DemographicClassificationResult {
  if (!isApprovedThresholds(thresholds)) {
    return { classification: "unknown", age, reason: "invalid_policy" };
  }

  const {
    infantMaxAgeMonths,
    toddlerMaxAgeYearsExclusive,
    preschoolMaxAge,
    childMaxAge,
    teenMaxAge,
    elderlyMinAge,
  } = thresholds;

  if (
    infantMaxAgeMonths !== 12
    || !Number.isInteger(toddlerMaxAgeYearsExclusive)
    || toddlerMaxAgeYearsExclusive <= 1
    || !Number.isInteger(preschoolMaxAge)
    || preschoolMaxAge < toddlerMaxAgeYearsExclusive
    || !Number.isInteger(childMaxAge)
    || childMaxAge < preschoolMaxAge
    || !Number.isInteger(teenMaxAge)
    || teenMaxAge < childMaxAge
    || !Number.isInteger(elderlyMinAge)
    || elderlyMinAge <= teenMaxAge
  ) {
    return { classification: "unknown", age, reason: "invalid_policy" };
  }

  if (age === 0) return { classification: "infant", age, reason: "classified" };

  if (age === 1) {
    const birth = context.birthDate == null ? null : parseBirthDate(context.birthDate);
    const today = calendarDateInTimeZone(context.asOf ?? new Date(), RESIDENT_DATE_TIME_ZONE);
    if (!birth || !today) {
      return { classification: "unknown", age, reason: "boundary_context_unavailable" };
    }

    const firstAnniversary = { year: birth.year + 1, month: birth.month, day: birth.day };
    if (compareCalendarDates(today, firstAnniversary) <= 0) {
      return { classification: "infant", age, reason: "classified" };
    }
    return { classification: "toddler", age, reason: "classified" };
  }

  if (age < toddlerMaxAgeYearsExclusive) return { classification: "toddler", age, reason: "classified" };
  if (age <= preschoolMaxAge) return { classification: "preschool", age, reason: "classified" };
  if (age <= childMaxAge) return { classification: "child", age, reason: "classified" };
  if (age <= teenMaxAge) return { classification: "teen", age, reason: "classified" };
  if (age < elderlyMinAge) return { classification: "adult", age, reason: "classified" };
  return { classification: "elderly", age, reason: "classified" };
}

function isApprovedThresholds(
  thresholds: DemographicAgeThresholds | ApprovedDemographicAgeThresholds,
): thresholds is ApprovedDemographicAgeThresholds {
  return "infantMaxAgeMonths" in thresholds
    && "toddlerMaxAgeYearsExclusive" in thresholds
    && "preschoolMaxAge" in thresholds
    && "childMaxAge" in thresholds
    && "teenMaxAge" in thresholds;
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate) {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

export function residentWithCurrentAge<T extends Record<string, unknown>>(source: T, asOf = new Date()) {
  const birthDate = source.birth_date;
  const hasBirthDate = birthDate instanceof Date
    || (typeof birthDate === "string" && birthDate.trim().length > 0);

  if (!hasBirthDate) {
    return {
      ...source,
      age_source: "legacy" as const,
      age_classification: "unknown" as const,
    };
  }

  const age = calculateCurrentAge(birthDate as string | Date, asOf);
  const classification = classifyCurrentAge(age, APPROVED_DEMOGRAPHIC_AGE_POLICY, {
    birthDate: birthDate as string | Date,
    asOf,
  });

  return {
    ...source,
    age,
    age_source: "birth_date" as const,
    age_classification: classification.classification,
  };
}

function parseBirthDate(value: string | Date): CalendarDate | null {
  if (value instanceof Date) return calendarDateInTimeZone(value, "UTC");

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function calendarDateInTimeZone(value: Date, timeZone: string): CalendarDate | null {
  if (Number.isNaN(value.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    ? { year, month, day }
    : null;
}

function parseTimestampCalendarDate(value: unknown, timeZone: string): CalendarDate | null {
  if (value instanceof Date) return calendarDateInTimeZone(value, timeZone);
  if (typeof value !== "string" || value.trim().length === 0) return null;

  const dateOnly = parseBirthDate(value.trim());
  if (dateOnly) return dateOnly;

  const parsed = new Date(value);
  return calendarDateInTimeZone(parsed, timeZone);
}

function calendarDayNumber(value: CalendarDate) {
  return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / 86_400_000);
}
