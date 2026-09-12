import type { DashboardUserProfile } from "@/components/layout/AppShell/AppShell";
import { formatBarangayName } from "@/lib/formatters";
import { normalizeLogRole } from "@/lib/logVisibility";
import type { DashboardRole } from "@/types/navigation";

export type StoredSessionUser = {
  id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  role_id?: number | null;
  role?: string;
  role_name?: string;
  role_label?: string;
  barangay_id?: number | null;
  barangay_name?: string;
  barangay?: string;
  department?: string;
  status?: string;
};

export type AuthSession = {
  user: StoredSessionUser;
};

export type NormalizedRole = DashboardRole;

export const sessionKey = "smartflood_session";

const legacySessionKeys = [
  "smartflood_session",
  "smartflood:user",
  "smartfloodUser",
  "smartflood:userProfile",
  "smartflood_user",
  "currentUser",
  "user",
  "authUser",
  "session",
];

export function setStoredSession(user: StoredSessionUser) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(sessionKey, JSON.stringify({ user }));
}

export function getStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(sessionKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession> | StoredSessionUser;
    const user = "user" in parsed ? parsed.user : parsed;
    if (user && typeof user === "object" && "id" in user) {
      return { user: user as StoredSessionUser };
    }
  } catch {
    return null;
  }

  return null;
}

export function getCurrentUser() {
  return getStoredSession()?.user ?? null;
}

export function clearStoredSession() {
  if (typeof window === "undefined") return;
  for (const key of legacySessionKeys) {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
}

export function normalizeUserRole(user: StoredSessionUser | null): NormalizedRole | null {
  return normalizeLogRole(user);
}

export function getUserInitials(user: StoredSessionUser | null) {
  const fullName = userDisplayName(user);
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "SF";
}

export function userDisplayName(user: StoredSessionUser | null) {
  if (!user) return "";
  return String(user.full_name ?? [user.first_name, user.last_name].filter(Boolean).join(" ")).trim();
}

export function profileForUser(user: StoredSessionUser, role: NormalizedRole): DashboardUserProfile {
  const displayName = userDisplayName(user) || roleLabelForRole(role);
  return {
    userId: user.id,
    displayName,
    email: user.email ?? "",
    roleLabel: roleLabelForRole(role, user),
    roleSubtitle: roleSubtitleForRole(role, user),
    initials: getUserInitials(user),
    logLabel: logLabelForRole(role, user),
    barangayId: user.barangay_id ?? null,
    barangayName: user.barangay_name ?? null,
  };
}

export function roleLabelForRole(role: NormalizedRole, user?: StoredSessionUser) {
  if (role === "super") return user?.role_id === 2 ? "CDRRMO Command Center" : "Super Admin";
  if (role === "cdrrmo") return "CDRRMO Admin";
  if (role === "cswdd") return "CSWDD Admin";
  return user?.role_label || "Barangay Admin";
}

export function roleSubtitleForRole(role: NormalizedRole, user?: StoredSessionUser) {
  if (role === "super") return "Full Access";
  if (role === "cdrrmo") return "Disaster Response";
  if (role === "cswdd") return "City Welfare";
  return formatBarangayName(user?.barangay_name) || "Administrator";
}

export function logLabelForRole(role: NormalizedRole, user?: StoredSessionUser | null) {
  if (role === "super") return "System Logs";
  if (role === "cswdd") return "CSWDD System Logs";
  if (role === "cdrrmo") return "CDRRMO System Logs";

  const barangay = formatBarangayName(user?.barangay_name ?? user?.barangay ?? user?.department ?? "").replace(/^Barangay\s+/i, "").trim();
  return barangay ? `${barangay} System Logs` : "Barangay System Logs";
}
