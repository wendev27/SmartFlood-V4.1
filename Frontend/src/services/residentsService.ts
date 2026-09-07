import { fetchJson } from "@/services/apiClient";

export async function getResidents(barangayId?: number) {
  const query = barangayId ? `?barangay_id=${barangayId}` : "";
  return fetchJson<Record<string, unknown>[]>(`/api/residents${query}`);
}

export async function getFamilies(search = "", barangayId?: number) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (barangayId) params.set("barangay_id", String(barangayId));
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchJson<Record<string, unknown>[]>(`/api/families${query}`);
}
