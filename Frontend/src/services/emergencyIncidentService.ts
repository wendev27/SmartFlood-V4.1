import { fetchJson } from "@/services/apiClient";
import type { EmergencyIncident, IncidentList, IncidentStatus } from "@/types/emergencyIncident";
const base = "/api/emergency-reports";
function scopeQuery(barangayId?: number) {
  return barangayId ? { barangay_id: String(barangayId) } : {} as Record<string, string>;
}
export function getIncidentList(status: IncidentStatus, search: string, page: number, barangayId?: number) {
  const query = new URLSearchParams({ status, search, page: String(page), limit: "7", ...scopeQuery(barangayId) });
  return fetchJson<IncidentList>(`${base}?${query}`, { credentials: "same-origin", cache: "no-store" });
}
export function getIncident(id: string, barangayId?: number) {
  const query = barangayId ? `?barangay_id=${barangayId}` : "";
  return fetchJson<EmergencyIncident>(`${base}/${encodeURIComponent(id)}${query}`, { credentials: "same-origin", cache: "no-store" });
}
export function advanceIncident(id: string, status: "en_route" | "arrived", barangayId?: number) {
  const query = barangayId ? `?barangay_id=${barangayId}` : "";
  return fetchJson<EmergencyIncident>(`${base}/${encodeURIComponent(id)}/status${query}`, {
    method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
  });
}
