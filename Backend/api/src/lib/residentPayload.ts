type ResidentSource = Record<string, unknown>;

export const residentFields = [
  "last_name",
  "first_name",
  "middle_name",
  "suffix",
  "age",
  "birth_date",
  "sex",
  "contact_number",
  "complete_address",
  "street",
  "barangay_id",
  "barangay_name",
  "is_family_head",
  "family_id",
  "source",
  "application_id",
  "status",
  "created_by",
] as const;

export function pickResidentPayload(source: ResidentSource, familyId?: unknown) {
  const payload: Record<string, unknown> = {};

  for (const field of residentFields) {
    if (source[field] !== undefined) {
      payload[field] = source[field];
    }
  }

  if (familyId !== undefined) {
    payload.family_id = familyId;
  }

  return payload;
}

export function fullName(source: ResidentSource) {
  return [source.first_name, source.middle_name, source.last_name, source.suffix]
    .filter(Boolean)
    .join(" ");
}

export function familyVulnerabilityPayload(source: ResidentSource) {
  return {
    pwd_count: Number(source.pwd_count ?? 0),
    elderly_count: Number(source.elderly_count ?? 0),
    four_ps_count: Number(source.four_ps_count ?? 0),
    lactating_count: Number(source.lactating_count ?? 0),
    pregnant_count: Number(source.pregnant_count ?? 0),
    infant_count: Number(source.infant_count ?? 0),
    toddler_count: Number(source.toddler_count ?? 0),
    total_family_members: Number(source.total_family_members ?? 1),
  };
}
