import { fetchJson } from "@/services/apiClient";
import type { EmergencyIncident, IncidentList, IncidentStatus } from "@/types/emergencyIncident";
const base = "/api/emergency-reports";
export function getIncidentList(status: IncidentStatus, search: string, page: number) {
  const query = new URLSearchParams({ status, search, page: String(page), limit: "7" });
  return fetchJson<IncidentList>(`${base}?${query}`, { credentials: "same-origin", cache: "no-store" });
}
export function getIncident(id: string) {
  return fetchJson<EmergencyIncident>(`${base}/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
}
export function advanceIncident(id: string, status: "en_route" | "arrived") {
  return fetchJson<EmergencyIncident>(`${base}/${encodeURIComponent(id)}/status`, {
    method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
  });
}
