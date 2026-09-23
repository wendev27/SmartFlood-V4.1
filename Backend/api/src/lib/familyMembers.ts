import {
  APPROVED_DEMOGRAPHIC_AGE_POLICY,
  calculateCurrentAge,
  calculateCurrentPregnancyWeeks,
  classifyCurrentAge,
  type DemographicAgePolicy,
} from "@/lib/dateUtils";
import { supabaseServer } from "@/lib/supabaseServer";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BIRTH_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_MEMBERS_PER_APPLICATION = 100;
const MAX_FULL_NAME_LENGTH = 120;
const MAX_PREGNANCY_WEEKS = 42;

export type StructuredHouseholdMember = Readonly<{
  member_id: string;
  full_name: string;
  birth_date: string | null;
  resident_id: string | null;
  is_pwd: boolean;
  is_pregnant: boolean;
  pregnancy_weeks: number | null;
  is_lactating: boolean;
  is_4ps: boolean;
}>;

export type FamilyMemberValidationErrorCode =
  | "invalid_members_payload"
  | "invalid_member_id"
  | "duplicate_member_id"
  | "invalid_full_name"
  | "invalid_birth_date"
  | "future_birth_date"
  | "invalid_resident_id"
  | "duplicate_resident_id"
  | "invalid_vulnerability_flag"
  | "invalid_pregnancy_weeks"
  | "invalid_pregnancy_baseline_at"
  | "resident_not_found"
  | "resident_family_mismatch"
  | "member_identity_conflict";

export class FamilyMemberValidationError extends Error {
  constructor(
    message: string,
    public readonly code: FamilyMemberValidationErrorCode,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "FamilyMemberValidationError";
  }
}

export type FamilyCoverageReason =
  | "complete"
  | "no_resident_or_member_coverage"
  | "member_rows_missing"
  | "member_count_exceeds_declared_total"
  | "resident_rows_exceed_declared_total"
  | "birth_date_missing"
  | "declared_member_count_invalid";

export type FamilyCoverageRow = Readonly<{
  family_id: string;
  stored_total_family_members: number | null;
  resident_row_count: number;
  family_members_row_count: number;
  dob_known_family_member_count: number;
  dob_unknown_family_member_count: number;
  coverage_complete: boolean;
  coverage_reasons: FamilyCoverageReason[];
}>;

export type FamilyCoverageSummary = Readonly<{
  family_count: number;
  complete_family_count: number;
  incomplete_family_count: number;
  resident_row_count: number;
  family_members_row_count: number;
  dob_known_family_member_count: number;
  dob_unknown_family_member_count: number;
}>;

export type FamilyDemographicComparisonRow = Readonly<FamilyCoverageRow & {
  dynamic_member_count: number | null;
  stored_infant_count: number | null;
  dynamic_infant_count: number | null;
  infant_difference: number | null;
  stored_toddler_count: number | null;
  dynamic_toddler_count: number | null;
  toddler_difference: number | null;
  stored_elderly_count: number | null;
  dynamic_elderly_count: number | null;
  elderly_difference: number | null;
}>;

export type FamilyDemographicComparisonSummary = Readonly<FamilyCoverageSummary & {
  families_with_missing_dob_count: number;
  families_with_missing_member_rows_count: number;
  families_with_contradictory_resident_coverage_count: number;
  authoritative_family_member_row_count: number;
  complete_stored_infant_total: number;
  complete_dynamic_infant_total: number;
  complete_infant_match_family_count: number;
  complete_infant_difference_family_count: number;
  complete_stored_toddler_total: number;
  complete_dynamic_toddler_total: number;
  complete_toddler_match_family_count: number;
  complete_toddler_difference_family_count: number;
  complete_stored_elderly_total: number;
  complete_dynamic_elderly_total: number;
  complete_elderly_match_family_count: number;
  complete_elderly_difference_family_count: number;
}>;

export function validateStructuredHouseholdMembers(input: unknown): StructuredHouseholdMember[] {
  if (!Array.isArray(input) || input.length > MAX_MEMBERS_PER_APPLICATION) {
    throw new FamilyMemberValidationError(
      `household_members must be an array containing at most ${MAX_MEMBERS_PER_APPLICATION} members.`,
      "invalid_members_payload",
    );
  }

  const memberIds = new Set<string>();
  const residentIds = new Set<string>();

  return input.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new FamilyMemberValidationError(`household_members[${index}] must be an object.`, "invalid_members_payload");
    }

    const memberId = readRequiredText(raw.member_id);
    if (!memberId || !UUID_PATTERN.test(memberId)) {
      throw new FamilyMemberValidationError(`household_members[${index}].member_id must be a UUID.`, "invalid_member_id");
    }
    const normalizedMemberId = memberId.toLowerCase();
    if (memberIds.has(normalizedMemberId)) {
      throw new FamilyMemberValidationError(`household_members[${index}].member_id is duplicated.`, "duplicate_member_id");
    }
    memberIds.add(normalizedMemberId);

    const fullName = readRequiredText(raw.full_name);
    if (!fullName || fullName.length > MAX_FULL_NAME_LENGTH || hasControlCharacters(fullName)) {
      throw new FamilyMemberValidationError(
        `household_members[${index}].full_name must be 1-${MAX_FULL_NAME_LENGTH} characters without control characters.`,
        "invalid_full_name",
      );
    }

    const birthDate = readNullableText(raw.birth_date);
    if (birthDate !== null) {
      const birthDateStatus = validateBirthDate(birthDate);
      if (birthDateStatus === "invalid") {
        throw new FamilyMemberValidationError(`household_members[${index}].birth_date must be a valid YYYY-MM-DD date.`, "invalid_birth_date");
      }
      if (birthDateStatus === "future") {
        throw new FamilyMemberValidationError(`household_members[${index}].birth_date cannot be in the future.`, "future_birth_date");
      }
    }

    const residentId = readNullableText(raw.resident_id);
    if (residentId !== null && !UUID_PATTERN.test(residentId)) {
      throw new FamilyMemberValidationError(`household_members[${index}].resident_id must be a UUID or null.`, "invalid_resident_id");
    }
    const normalizedResidentId = residentId?.toLowerCase() ?? null;
    if (normalizedResidentId && residentIds.has(normalizedResidentId)) {
      throw new FamilyMemberValidationError(`household_members[${index}].resident_id is duplicated.`, "duplicate_resident_id");
    }
    if (normalizedResidentId) residentIds.add(normalizedResidentId);

    const isPwd = readRequiredBoolean(raw.is_pwd, index, "is_pwd");
    const isPregnant = readRequiredBoolean(raw.is_pregnant, index, "is_pregnant");
    const isLactating = readRequiredBoolean(raw.is_lactating, index, "is_lactating");
    const is4ps = readRequiredBoolean(raw.is_4ps, index, "is_4ps");
    const pregnancyWeeks = readPregnancyWeeks(raw.pregnancy_weeks, isPregnant, index);

    return {
      member_id: normalizedMemberId,
      full_name: fullName,
      birth_date: birthDate,
      resident_id: normalizedResidentId,
      is_pwd: isPwd,
      is_pregnant: isPregnant,
      pregnancy_weeks: pregnancyWeeks,
      is_lactating: isLactating,
      is_4ps: is4ps,
    };
  });
}

export async function persistStructuredHouseholdMembers({
  client = supabaseServer,
  applicationId,
  familyId,
  members,
  pregnancyBaselineAt,
}: {
  client?: any;
  applicationId: string;
  familyId: string;
  members: unknown;
  pregnancyBaselineAt: unknown;
}) {
  // Identity and provenance are validated before upsert. The route supplies
  // trusted family/application IDs; legacy parallel name/DOB arrays are never
  // positionally paired or converted here.
  const validatedMembers = validateStructuredHouseholdMembers(members);
  if (validatedMembers.length === 0) return [];
  const normalizedPregnancyBaselineAt = pregnancyBaselineAtForMembers(validatedMembers, pregnancyBaselineAt);

  const residentIds = validatedMembers
    .map((member) => member.resident_id)
    .filter((residentId): residentId is string => Boolean(residentId));

  if (residentIds.length > 0) {
    const { data: residents, error: residentError } = await client
      .from("residents_v3")
      .select("resident_id,family_id")
      .in("resident_id", residentIds);

    if (residentError) throw residentError;

    const residentsById = new Map<string, Record<string, unknown>>((residents ?? []).map((resident: Record<string, unknown>) => [String(resident.resident_id).toLowerCase(), resident]));
    for (const residentId of residentIds) {
      const resident = residentsById.get(residentId.toLowerCase());
      if (!resident) {
        throw new FamilyMemberValidationError(`resident_id ${residentId} does not reference an existing resident.`, "resident_not_found");
      }
      if (!sameIdentifier(resident.family_id, familyId)) {
        throw new FamilyMemberValidationError(`resident_id ${residentId} belongs to a different family.`, "resident_family_mismatch");
      }
    }
  }

  const memberIds = validatedMembers.map((member) => member.member_id);
  const { data: existingMembers, error: existingError } = await client
    .from("family_members")
    .select("member_id,family_id,source_application_id,resident_id")
    .in("member_id", memberIds);

  if (existingError) throw existingError;

  const { data: existingResidentLinks, error: existingResidentLinksError } = residentIds.length > 0
    ? await client
      .from("family_members")
      .select("member_id,family_id,source_application_id,resident_id")
      .in("resident_id", residentIds)
    : { data: [], error: null };

  if (existingResidentLinksError) throw existingResidentLinksError;

  const existingById = new Map<string, Record<string, unknown>>((existingMembers ?? []).map((member: Record<string, unknown>) => [String(member.member_id).toLowerCase(), member]));
  const existingByResidentId = new Map<string, Record<string, unknown>>(
    (existingResidentLinks ?? [])
      .filter((member: Record<string, unknown>) => member.resident_id != null)
      .map((member: Record<string, unknown>) => [String(member.resident_id).toLowerCase(), member]),
  );

  for (const member of validatedMembers) {
    const existing = existingById.get(member.member_id);
    if (existing && (
      !sameIdentifier(existing.family_id, familyId)
      || !sameIdentifier(existing.source_application_id, applicationId)
    )) {
      throw new FamilyMemberValidationError(
        `member_id ${member.member_id} is already associated with another family or application.`,
        "member_identity_conflict",
        409,
      );
    }

    if (member.resident_id) {
      const existingResidentLink = existingByResidentId.get(member.resident_id);
      if (existingResidentLink && String(existingResidentLink.member_id).toLowerCase() !== member.member_id) {
        throw new FamilyMemberValidationError(
          `resident_id ${member.resident_id} is already linked to another household member.`,
          "member_identity_conflict",
          409,
        );
      }
    }
  }

  const rows = validatedMembers.map((member) => ({
    member_id: member.member_id,
    family_id: familyId,
    resident_id: member.resident_id,
    source_application_id: applicationId,
    full_name: member.full_name,
    birth_date: member.birth_date,
    is_pwd: member.is_pwd,
    is_pregnant: member.is_pregnant,
    pregnancy_weeks: member.pregnancy_weeks,
    pregnancy_baseline_at: member.is_pregnant ? normalizedPregnancyBaselineAt : null,
    is_lactating: member.is_lactating,
    is_4ps: member.is_4ps,
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await client
    .from("family_members")
    .upsert(rows, { onConflict: "member_id" })
    .select();

  if (error) throw error;
  return data ?? [];
}

export function pregnancyBaselineAtForMembers(
  members: ReadonlyArray<StructuredHouseholdMember>,
  pregnancyBaselineAt: unknown,
  asOf = new Date(),
): string | null {
  if (!members.some((member) => member.is_pregnant)) return null;

  const normalized = normalizePregnancyBaselineAt(pregnancyBaselineAt, asOf);
  if (!normalized) {
    throw new FamilyMemberValidationError(
      "Pregnant household members require a valid, non-future application submitted_at timestamp.",
      "invalid_pregnancy_baseline_at",
    );
  }
  return normalized;
}

export function resolvePregnancyBaselineAtForUpdate({
  existingIsPregnant,
  existingPregnancyWeeks,
  existingPregnancyBaselineAt,
  nextIsPregnant,
  nextPregnancyWeeks,
  now = new Date(),
}: Readonly<{
  existingIsPregnant: boolean;
  existingPregnancyWeeks: number | null;
  existingPregnancyBaselineAt: unknown;
  nextIsPregnant: boolean;
  nextPregnancyWeeks: number | null;
  now?: Date;
}>): string | null {
  if (!nextIsPregnant) return null;

  // Starting pregnancy tracking or explicitly changing baseline weeks starts a
  // new baseline. Unrelated edits preserve the prior timestamp.
  if (!existingIsPregnant || existingPregnancyWeeks !== nextPregnancyWeeks) {
    return now.toISOString();
  }

  const normalized = normalizePregnancyBaselineAt(existingPregnancyBaselineAt, now);
  if (!normalized) {
    throw new FamilyMemberValidationError(
      "The existing pregnant household member has no valid pregnancy baseline timestamp.",
      "invalid_pregnancy_baseline_at",
    );
  }
  return normalized;
}

export function familyMemberWithCurrentPregnancyWeeks<T extends Record<string, unknown>>(
  member: T,
  asOf = new Date(),
) {
  // Enrich API output only. The stored baseline fields are not rewritten as
  // weeks pass, and non-pregnant members expose no active current value.
  const currentPregnancyWeeks = member.is_pregnant === true
    ? calculateCurrentPregnancyWeeks(member.pregnancy_weeks, member.pregnancy_baseline_at, asOf)
    : null;

  return {
    ...member,
    current_pregnancy_weeks: currentPregnancyWeeks,
  };
}

export function residentApplicationWithCurrentPregnancyWeeks<T extends Record<string, unknown>>(
  application: T,
  asOf = new Date(),
) {
  // submitted_at is the immutable baseline date for pregnancy weeks captured
  // with an application, including read-only legacy week entries.
  const baselineAt = application.submitted_at;
  const householdMembers = Array.isArray(application.household_members)
    ? application.household_members.map((value) => {
      if (!isRecord(value)) return value;
      const pregnancyBaselineAt = value.is_pregnant === true ? baselineAt ?? null : null;
      return familyMemberWithCurrentPregnancyWeeks({
        ...value,
        pregnancy_baseline_at: pregnancyBaselineAt,
      }, asOf);
    })
    : application.household_members;

  const legacyPregnancyWeekDetails = Array.isArray(application.pregnancy_weeks)
    ? application.pregnancy_weeks.map((pregnancyWeeks) => ({
      pregnancy_weeks: pregnancyWeeks,
      pregnancy_baseline_at: baselineAt ?? null,
      current_pregnancy_weeks: calculateCurrentPregnancyWeeks(pregnancyWeeks, baselineAt, asOf),
    }))
    : [];

  return {
    ...application,
    household_members: householdMembers,
    legacy_pregnancy_week_details: legacyPregnancyWeekDetails,
  };
}

export function buildFamilyCoveragePreview(
  families: Array<Record<string, unknown>>,
  residents: Array<Record<string, unknown>>,
  members: Array<Record<string, unknown>>,
) {
  const residentsByFamily = groupByFamily(residents);
  const membersByFamily = groupByFamily(members);
  const rows: FamilyCoverageRow[] = families.map((family) => {
    const familyId = String(family.family_id ?? "");
    const familyResidents = residentsByFamily.get(familyId) ?? [];
    const familyMembers = membersByFamily.get(familyId) ?? [];
    const storedTotal = toNullableInteger(family.total_family_members);
    const knownDobCount = familyMembers.filter((member) => isUsableBirthDate(member.birth_date)).length;
    const unknownDobCount = familyMembers.length - knownDobCount;
    const reasons: FamilyCoverageReason[] = [];

    if (storedTotal === null || storedTotal <= 0) reasons.push("declared_member_count_invalid");
    if (familyResidents.length === 0 && familyMembers.length === 0) {
      reasons.push("no_resident_or_member_coverage");
    } else if (storedTotal !== null && familyMembers.length < storedTotal) {
      reasons.push("member_rows_missing");
    }
    if (storedTotal !== null && familyMembers.length > storedTotal) reasons.push("member_count_exceeds_declared_total");
    if (storedTotal !== null && familyResidents.length > storedTotal) reasons.push("resident_rows_exceed_declared_total");
    if (unknownDobCount > 0) reasons.push("birth_date_missing");

    const coverageComplete = storedTotal !== null
      && storedTotal > 0
      && familyMembers.length === storedTotal
      && unknownDobCount === 0
      && familyResidents.length <= storedTotal
      && reasons.length === 0;

    if (coverageComplete) reasons.push("complete");

    return {
      family_id: familyId,
      stored_total_family_members: storedTotal,
      resident_row_count: familyResidents.length,
      family_members_row_count: familyMembers.length,
      dob_known_family_member_count: knownDobCount,
      dob_unknown_family_member_count: unknownDobCount,
      coverage_complete: coverageComplete,
      coverage_reasons: reasons,
    };
  });

  const summary: FamilyCoverageSummary = {
    family_count: rows.length,
    complete_family_count: rows.filter((row) => row.coverage_complete).length,
    incomplete_family_count: rows.filter((row) => !row.coverage_complete).length,
    resident_row_count: rows.reduce((total, row) => total + row.resident_row_count, 0),
    family_members_row_count: rows.reduce((total, row) => total + row.family_members_row_count, 0),
    dob_known_family_member_count: rows.reduce((total, row) => total + row.dob_known_family_member_count, 0),
    dob_unknown_family_member_count: rows.reduce((total, row) => total + row.dob_unknown_family_member_count, 0),
  };

  return { families: rows, summary };
}

export function buildFamilyDemographicComparison(
  families: Array<Record<string, unknown>>,
  residents: Array<Record<string, unknown>>,
  members: Array<Record<string, unknown>>,
  options: Readonly<{
    asOf?: Date;
    policy?: DemographicAgePolicy;
  }> = {},
): {
  families: FamilyDemographicComparisonRow[];
  summary: FamilyDemographicComparisonSummary;
} {
  // Dynamic age counts are previewed only for coverage-complete families.
  // This comparison never overwrites the aggregate fields consumed by AHP.
  const coverage = buildFamilyCoveragePreview(families, residents, members);
  const membersByFamily = groupByFamily(members);
  const familyById = new Map(families.map((family) => [String(family.family_id ?? ""), family]));
  const asOf = options.asOf ?? new Date();
  const policy = options.policy ?? APPROVED_DEMOGRAPHIC_AGE_POLICY;

  const rows: FamilyDemographicComparisonRow[] = coverage.families.map((coverageRow) => {
    const family = familyById.get(coverageRow.family_id) ?? {};
    const familyMembers = membersByFamily.get(coverageRow.family_id) ?? [];
    const storedInfant = toNullableInteger(family.infant_count);
    const storedToddler = toNullableInteger(family.toddler_count);
    const storedElderly = toNullableInteger(family.elderly_count);
    const dynamicCounts = coverageRow.coverage_complete
      ? calculateDynamicCounts(familyMembers, policy, asOf)
      : null;
    const dynamicMemberCount = dynamicCounts ? familyMembers.length : null;

    return {
      ...coverageRow,
      dynamic_member_count: dynamicMemberCount,
      stored_infant_count: storedInfant,
      dynamic_infant_count: dynamicCounts?.infant ?? null,
      infant_difference: difference(dynamicCounts?.infant, storedInfant),
      stored_toddler_count: storedToddler,
      dynamic_toddler_count: dynamicCounts?.toddler ?? null,
      toddler_difference: difference(dynamicCounts?.toddler, storedToddler),
      stored_elderly_count: storedElderly,
      dynamic_elderly_count: dynamicCounts?.elderly ?? null,
      elderly_difference: difference(dynamicCounts?.elderly, storedElderly),
    };
  });

  const completeRows = rows.filter((row) => row.coverage_complete);
  const summary: FamilyDemographicComparisonSummary = {
    ...coverage.summary,
    families_with_missing_dob_count: rows.filter((row) => row.dob_unknown_family_member_count > 0).length,
    families_with_missing_member_rows_count: rows.filter((row) => row.coverage_reasons.includes("member_rows_missing")).length,
    families_with_contradictory_resident_coverage_count: rows.filter((row) => row.coverage_reasons.includes("resident_rows_exceed_declared_total")).length,
    authoritative_family_member_row_count: coverage.summary.family_members_row_count,
    complete_stored_infant_total: sumStored(completeRows, "stored_infant_count"),
    complete_dynamic_infant_total: sumDynamic(completeRows, "dynamic_infant_count"),
    complete_infant_match_family_count: countMatches(completeRows, "infant_difference"),
    complete_infant_difference_family_count: countDifferences(completeRows, "infant_difference"),
    complete_stored_toddler_total: sumStored(completeRows, "stored_toddler_count"),
    complete_dynamic_toddler_total: sumDynamic(completeRows, "dynamic_toddler_count"),
    complete_toddler_match_family_count: countMatches(completeRows, "toddler_difference"),
    complete_toddler_difference_family_count: countDifferences(completeRows, "toddler_difference"),
    complete_stored_elderly_total: sumStored(completeRows, "stored_elderly_count"),
    complete_dynamic_elderly_total: sumDynamic(completeRows, "dynamic_elderly_count"),
    complete_elderly_match_family_count: countMatches(completeRows, "elderly_difference"),
    complete_elderly_difference_family_count: countDifferences(completeRows, "elderly_difference"),
  };

  return { families: rows, summary };
}

function calculateDynamicCounts(
  members: Array<Record<string, unknown>>,
  policy: DemographicAgePolicy,
  asOf: Date,
) {
  const counts = { infant: 0, toddler: 0, elderly: 0 };

  for (const member of members) {
    if (typeof member.birth_date !== "string") return null;
    const age = calculateCurrentAge(member.birth_date, asOf);
    const classification = classifyCurrentAge(age, policy, {
      birthDate: member.birth_date,
      asOf,
    });

    if (classification.classification === "unknown") return null;
    if (classification.classification === "infant") counts.infant += 1;
    if (classification.classification === "toddler") counts.toddler += 1;
    if (classification.classification === "elderly") counts.elderly += 1;
  }

  return counts;
}

function difference(dynamic: number | undefined, stored: number | null) {
  return dynamic == null || stored == null ? null : dynamic - stored;
}

function sumStored(
  rows: FamilyDemographicComparisonRow[],
  key: "stored_infant_count" | "stored_toddler_count" | "stored_elderly_count",
) {
  return rows.reduce((total, row) => total + (row[key] ?? 0), 0);
}

function sumDynamic(
  rows: FamilyDemographicComparisonRow[],
  key: "dynamic_infant_count" | "dynamic_toddler_count" | "dynamic_elderly_count",
) {
  return rows.reduce((total, row) => total + (row[key] ?? 0), 0);
}

function countMatches(
  rows: FamilyDemographicComparisonRow[],
  key: "infant_difference" | "toddler_difference" | "elderly_difference",
) {
  return rows.filter((row) => row[key] === 0).length;
}

function countDifferences(
  rows: FamilyDemographicComparisonRow[],
  key: "infant_difference" | "toddler_difference" | "elderly_difference",
) {
  return rows.filter((row) => row[key] != null && row[key] !== 0).length;
}

function validateBirthDate(value: string): "valid" | "invalid" | "future" {
  const match = BIRTH_DATE_PATTERN.exec(value);
  if (!match) return "invalid";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(candidate.getTime())
    || candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return "invalid";

  if (calculateCurrentAge(value) === null) return "future";
  return "valid";
}

function isUsableBirthDate(value: unknown) {
  return typeof value === "string" && validateBirthDate(value) === "valid";
}

function groupByFamily(rows: Array<Record<string, unknown>>) {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const familyId = String(row.family_id ?? "");
    if (!familyId) continue;
    const existing = grouped.get(familyId) ?? [];
    existing.push(row);
    grouped.set(familyId, existing);
  }
  return grouped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableText(value: unknown) {
  if (value == null || value === "") return null;
  return typeof value === "string" ? value.trim() : "__invalid__";
}

function readRequiredBoolean(value: unknown, index: number, field: string) {
  if (typeof value !== "boolean") {
    throw new FamilyMemberValidationError(
      `household_members[${index}].${field} must be a boolean.`,
      "invalid_vulnerability_flag",
    );
  }
  return value;
}

function readPregnancyWeeks(value: unknown, isPregnant: boolean, index: number) {
  if (!isPregnant && (value == null || value === "")) return null;
  if (!isPregnant || !Number.isInteger(value) || Number(value) < 0 || Number(value) > MAX_PREGNANCY_WEEKS) {
    throw new FamilyMemberValidationError(
      `household_members[${index}].pregnancy_weeks must be null when not pregnant, or a required integer from 0 to ${MAX_PREGNANCY_WEEKS} when pregnant.`,
      "invalid_pregnancy_weeks",
    );
  }
  return Number(value);
}

function normalizePregnancyBaselineAt(value: unknown, asOf: Date) {
  if (!(value instanceof Date) && (typeof value !== "string" || value.trim().length === 0)) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return calculateCurrentPregnancyWeeks(0, parsed, asOf) === null ? null : parsed.toISOString();
}

function hasControlCharacters(value: string) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function toNullableInteger(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function sameIdentifier(left: unknown, right: unknown) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}
