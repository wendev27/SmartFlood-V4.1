import { fetchJson } from "@/services/apiClient";
import type { BarangayOption } from "@/types/navigation";

export async function getAccountUsers() {
  return fetchJson<Record<string, unknown>[]>("/api/app-users");
}

export async function getBarangays() {
  return fetchJson<BarangayOption[]>("/api/barangays");
}

export async function getAuditLogs() {
  return fetchJson<Record<string, unknown>[]>("/api/logs?limit=300");
}
