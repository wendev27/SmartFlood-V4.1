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

export async function getFamilyMembers(familyId: string) {
  const params = new URLSearchParams({ family_id: familyId });
  return fetchJson<Record<string, unknown>[]>(`/api/family-members?${params.toString()}`);
}

export type FamilyCoverageRow = {
  family_id: string;
  coverage_complete: boolean;
  coverage_reasons: string[];
  dynamic_infant_count: number | null;
  dynamic_toddler_count: number | null;
  dynamic_elderly_count: number | null;
  stored_infant_count: number | null;
  stored_toddler_count: number | null;
  stored_elderly_count: number | null;
};

export type FamilyCoverageResponse = {
  families: FamilyCoverageRow[];
  summary: Record<string, unknown>;
};

export async function getFamilyCoverage(barangayId?: number) {
  const query = barangayId ? `?barangay_id=${barangayId}` : "";
  return fetchJson<FamilyCoverageResponse>(`/api/family-members/coverage${query}`);
}
