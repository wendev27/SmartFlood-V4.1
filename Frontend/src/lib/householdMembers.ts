import type { StructuredHouseholdMember } from "@/types/householdMembers";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type HouseholdMemberClassification =
  | "Infant"
  | "Toddler"
  | "Preschool / Young Child"
  | "Child"
  | "Teen / Adolescent"
  | "Adult"
  | "Senior Citizen / Elderly";

export interface HouseholdMemberAgePreview {
  age: number | null;
  ageLabel: string | null;
  classification: HouseholdMemberClassification | "Unavailable";
}

export function createStructuredHouseholdMember(): StructuredHouseholdMember {
  return {
    member_id: globalThis.crypto.randomUUID(),
    full_name: "",
    birth_date: null,
    resident_id: null,
    is_pwd: false,
    is_pregnant: false,
    pregnancy_weeks: null,
    is_lactating: false,
    is_4ps: false,
  };
}

export function isValidStructuredHouseholdMemberDraft(member: StructuredHouseholdMember) {
  return UUID_PATTERN.test(member.member_id)
    && member.full_name.trim().length > 0
    && member.full_name.trim().length <= 120
    && !/[\u0000-\u001f\u007f]/.test(member.full_name)
    && (member.birth_date === null || isValidDateOnly(member.birth_date))
    && typeof member.is_pwd === "boolean"
    && typeof member.is_pregnant === "boolean"
    && typeof member.is_lactating === "boolean"
    && typeof member.is_4ps === "boolean"
    && (member.pregnancy_weeks === null
      || (member.is_pregnant && Number.isInteger(member.pregnancy_weeks) && member.pregnancy_weeks >= 0 && member.pregnancy_weeks <= 42));
}

/**
 * Read only the structured contract when an API response actually contains it.
 * Legacy parallel name/DOB arrays are intentionally not converted here.
 */
export function readStructuredHouseholdMembers(value: unknown): StructuredHouseholdMember[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];

    const memberId = candidate.member_id;
    const fullName = candidate.full_name;
    const birthDate = candidate.birth_date;
    const residentId = candidate.resident_id;
    const familyId = candidate.family_id;
    const sourceApplicationId = candidate.source_application_id;
    const pregnancyWeeks = candidate.pregnancy_weeks;

    if (
      typeof memberId !== "string"
      || !UUID_PATTERN.test(memberId)
      || typeof fullName !== "string"
      || fullName.trim().length === 0
      || (birthDate !== null && birthDate !== undefined && !isValidDateOnly(birthDate))
      || (residentId !== null && residentId !== undefined && (typeof residentId !== "string" || !UUID_PATTERN.test(residentId)))
      || (familyId !== undefined && (typeof familyId !== "string" || !UUID_PATTERN.test(familyId)))
      || (sourceApplicationId !== null && sourceApplicationId !== undefined && (typeof sourceApplicationId !== "string" || !UUID_PATTERN.test(sourceApplicationId)))
      || typeof candidate.is_pwd !== "boolean"
      || typeof candidate.is_pregnant !== "boolean"
      || typeof candidate.is_lactating !== "boolean"
      || typeof candidate.is_4ps !== "boolean"
      || (pregnancyWeeks !== null && pregnancyWeeks !== undefined
        && (!candidate.is_pregnant || !Number.isInteger(pregnancyWeeks) || Number(pregnancyWeeks) < 0 || Number(pregnancyWeeks) > 42))
    ) {
      return [];
    }

    return [{
      member_id: memberId,
      family_id: typeof familyId === "string" ? familyId : undefined,
      full_name: fullName.trim(),
      birth_date: birthDate == null ? null : birthDate,
      resident_id: residentId == null ? null : residentId,
      source_application_id: sourceApplicationId == null ? null : sourceApplicationId,
      is_pwd: candidate.is_pwd,
      is_pregnant: candidate.is_pregnant,
      pregnancy_weeks: pregnancyWeeks == null ? null : Number(pregnancyWeeks),
      is_lactating: candidate.is_lactating,
      is_4ps: candidate.is_4ps,
      current_age: Number.isInteger(candidate.current_age) ? Number(candidate.current_age) : null,
      age_source: candidate.age_source === "birth_date" ? "birth_date" : "unavailable",
      classification: typeof candidate.classification === "string" ? candidate.classification : "unknown",
    }];
  });
}

/**
 * Presentation-only mirror of the approved server policy. It never uses the
 * legacy residents_v3.age value; persisted classification remains server-side.
 */
export function getHouseholdMemberAgePreview(birthDate: string | null, asOf = new Date()): HouseholdMemberAgePreview {
  if (!birthDate || !isValidDateOnly(birthDate)) {
    return { age: null, ageLabel: null, classification: "Unavailable" };
  }

  const birth = parseDateOnly(birthDate);
  const today = calendarDateInManila(asOf);
  if (!birth || !today) return { age: null, ageLabel: null, classification: "Unavailable" };

  let age = today.year - birth.year;
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) age -= 1;
  if (age < 0) return { age: null, ageLabel: null, classification: "Unavailable" };

  const ageLabel = formatCalendarAge(birth, today);

  if (age === 0) return { age, ageLabel, classification: "Infant" };
  if (age === 1) {
    const anniversary = { year: birth.year + 1, month: birth.month, day: birth.day };
    if (compareCalendarDates(today, anniversary) <= 0) return { age, ageLabel, classification: "Infant" };
    return { age, ageLabel, classification: "Toddler" };
  }
  if (age < 4) return { age, ageLabel, classification: "Toddler" };
  if (age <= 6) return { age, ageLabel, classification: "Preschool / Young Child" };
  if (age <= 12) return { age, ageLabel, classification: "Child" };
  if (age <= 17) return { age, ageLabel, classification: "Teen / Adolescent" };
  if (age < 60) return { age, ageLabel, classification: "Adult" };
  return { age, ageLabel, classification: "Senior Citizen / Elderly" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const candidate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return !Number.isNaN(candidate.getTime())
    && candidate.getUTCFullYear() === Number(match[1])
    && candidate.getUTCMonth() === Number(match[2]) - 1
    && candidate.getUTCDate() === Number(match[3]);
}

type CalendarDate = { year: number; month: number; day: number };

function parseDateOnly(value: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function calendarDateInManila(value: Date): CalendarDate | null {
  if (Number.isNaN(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) ? { year, month, day } : null;
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate) {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function formatCalendarAge(birth: CalendarDate, today: CalendarDate) {
  let totalMonths = (today.year - birth.year) * 12 + today.month - birth.month;
  if (today.day < birth.day) totalMonths -= 1;

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  return parts.length > 0 ? parts.join(", ") : "Less than 1 month";
}
