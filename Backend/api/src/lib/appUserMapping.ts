export const roleNames: Record<number, string> = {
  1: "SUPER_ADMIN",
  2: "NDRRMO_OFFICER",
  3: "CITY_WELFARE",
  4: "BARANGAY_OFFICIAL",
};

export const displayRoleNames: Record<number, string> = {
  1: "Super Admin",
  2: "NDRRMO Officer",
  3: "City Welfare",
  4: "Barangay Official",
};

// Barangay names belong to the master table. Do not reintroduce renamed
// barangays through an application fallback.
export const fallbackBarangays: Record<number, string> = {};

export const allowedAccountStatuses = new Set(["active", "inactive", "blocked"]);

export function normalizeAccountStatus(value: unknown) {
  const status = String(value ?? "active").trim().toLowerCase();
  return allowedAccountStatuses.has(status) ? status : "active";
}

export function accountDepartment(roleId: number | null, barangayName?: string | null) {
  if (roleId === 3) return "City Welfare";
  if (roleId === 4) return barangayName || "Barangay";
  return "NDRRMO";
}

export function sanitizeAppUser(row: Record<string, unknown>, barangayName?: string | null) {
  const roleId = row.role_id == null ? null : Number(row.role_id);
  const barangayId = row.barangay_id == null ? null : Number(row.barangay_id);
  const resolvedBarangay = barangayName
    ?? (barangayId == null ? String(row.barangay ?? "") : "");

  return {
    id: String(row.id ?? ""),
    first_name: String(row.first_name ?? ""),
    last_name: String(row.last_name ?? ""),
    email: String(row.email ?? ""),
    mobile_number: String(row.mobile_number ?? ""),
    address: String(row.address ?? ""),
    profile_image: row.profile_image ?? null,
    barangay: resolvedBarangay,
    barangay_name: resolvedBarangay,
    sex: String(row.sex ?? ""),
    role_id: roleId,
    role_name: roleId ? roleNames[roleId] ?? String(row.role_id) : "",
    role_label: roleId ? displayRoleNames[roleId] ?? String(row.role_id) : "",
    department: accountDepartment(roleId, resolvedBarangay),
    barangay_id: barangayId,
    status: normalizeAccountStatus(row.status),
    failed_login_attempts: Number(row.failed_login_attempts ?? 0),
    locked_until: row.locked_until ?? null,
    last_login_at: row.last_login_at ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function pickAppUserPayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  const fields = ["first_name", "last_name", "email", "mobile_number", "address", "sex", "role_id", "barangay_id", "status"];

  for (const field of fields) {
    if (body[field] !== undefined) payload[field] = body[field];
  }

  if (payload.email != null) payload.email = String(payload.email).trim().toLowerCase();
  if (payload.role_id != null) payload.role_id = Number(payload.role_id);
  if (payload.barangay_id != null && payload.barangay_id !== "") payload.barangay_id = Number(payload.barangay_id);
  if (payload.barangay_id === "") payload.barangay_id = null;
  if (payload.status != null) payload.status = normalizeAccountStatus(payload.status);

  return payload;
}
