import { isSameBarangayForUser } from "@/lib/barangayScope";

export type LogRole = "super" | "cswdd" | "cdrrmo" | "barangay";

export type LogViewer = {
  id?: string | null;
  user_id?: string | null;
  role_id?: number | null;
  role?: string | null;
  role_name?: string | null;
  role_label?: string | null;
  barangay_id?: number | null;
  barangay_name?: string | null;
  barangay?: string | null;
};

export type ScopedAuditLog = {
  actor_user_id?: string | null;
  actor_role?: string | null;
  role?: string | null;
  action?: string | null;
  module?: string | null;
  description?: string | null;
  department?: string | null;
  scope?: string | null;
  barangay_id?: number | null;
  barangay_name?: string | null;
  barangay?: string | null;
};

const cdrrmoModules = [
  "flood monitoring",
  "flood heatmap",
  "flood history",
  "sensor history",
];

export function normalizeLogRole(viewer: LogViewer | null | undefined): LogRole | null {
  if (!viewer) return null;

  const roleId = viewer.role_id == null ? "" : String(viewer.role_id);
  const roleText = normalizeText(`${viewer.role ?? ""} ${viewer.role_name ?? ""} ${viewer.role_label ?? ""}`);

  if (roleId === "1" || roleId === "2" || roleText.includes("super")) return "super";
  if (/(cdrrmo|ndrrmo)/.test(roleText)) return "super";
  if (roleId === "3" || /(cswdd|city welfare|welfare)/.test(roleText)) return "cswdd";
  if (roleId === "4" || roleText.includes("barangay")) return "barangay";
  return null;
}

export function filterLogsForViewer<T extends ScopedAuditLog>(logs: T[], viewer: LogViewer | null | undefined): T[] {
  const role = normalizeLogRole(viewer);
  if (!viewer || !role) return [];
  if (role === "super") return logs;

  return logs.filter((log) => canViewLog(log, viewer, role));
}

function canViewLog(log: ScopedAuditLog, viewer: LogViewer, role: Exclude<LogRole, "super">) {
  if (isAuthenticationLog(log)) return isOwnLog(log, viewer);
  if (role === "barangay") return isSameBarangayForUser(viewer, log);

  const actorRole = normalizeText(log.actor_role ?? log.role);
  const scope = normalizeText(`${log.department ?? ""} ${log.scope ?? ""}`);
  if (role === "cswdd") {
    return isOwnLog(log, viewer)
      || /(cswdd|city welfare)/.test(actorRole)
      || /(cswdd|city welfare)/.test(scope);
  }

  const searchable = normalizeText(`${log.module ?? ""} ${actorRole} ${scope}`);
  return cdrrmoModules.some((module) => searchable.includes(module))
    || /(cdrrmo|ndrrmo|disaster)/.test(searchable);
}

function isAuthenticationLog(log: ScopedAuditLog) {
  return normalizeText(log.module).includes("authentication");
}

function isOwnLog(log: ScopedAuditLog, viewer: LogViewer) {
  const viewerId = String(viewer.id ?? viewer.user_id ?? "");
  return Boolean(viewerId) && String(log.actor_user_id ?? "") === viewerId;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replaceAll("ñ", "n").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
