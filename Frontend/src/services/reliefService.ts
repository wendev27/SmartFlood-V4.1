import { fetchEnvelope, fetchJson } from "@/services/apiClient";
import { withAuditActor } from "@/lib/auditClient";
import type { BarangayNotificationResponse, CurrentEmergencyAllocation, EmergencyWorkflowResponse, ReliefGenerationResponse, ResidentReliefRequest } from "@/types/relief";

const AI_GENERATION_TIMEOUT_MS = 60000;

export async function getReliefSummary() {
  return Promise.resolve([]);
}

export async function getReliefRecommendations() {
  return fetchJson<Record<string, unknown>[]>("/api/ai/recommendations");
}

export async function getReliefInventory() {
  return fetchJson<Record<string, unknown>[]>("/api/relief/inventory");
}

export async function saveReliefInventory(payload: Record<string, unknown>) {
  return fetchJson<Record<string, unknown>>("/api/relief/inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withAuditActor(payload)),
  });
}

export async function generateReliefRecommendations(payload: Record<string, number>) {
  return fetchEnvelope<Record<string, unknown>[]>("/api/ai/recommendations/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withAuditActor(payload)),
  }, AI_GENERATION_TIMEOUT_MS) as Promise<ReliefGenerationResponse>;
}

export async function approveReliefRecommendationPlan(plan: Record<string, unknown>) {
  return fetchEnvelope<Record<string, unknown>[]>("/api/ai/recommendations/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withAuditActor({ plan })),
  }) as Promise<EmergencyWorkflowResponse>;
}

export async function rejectReliefRecommendationPlan(plan: Record<string, unknown>) {
  return fetchEnvelope<Record<string, unknown>[]>("/api/ai/recommendations/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withAuditActor({ plan })),
  }) as Promise<EmergencyWorkflowResponse>;
}

export async function getCurrentEmergencyAllocation() {
  return fetchJson<CurrentEmergencyAllocation | null>("/api/emergency/allocation/current");
}

export async function notifyBarangaysForEmergencyAllocation(batchId: string) {
  return fetchEnvelope<CurrentEmergencyAllocation>(`/api/emergency/allocations/${encodeURIComponent(batchId)}/notify-barangays`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withAuditActor({})),
  }) as Promise<BarangayNotificationResponse>;
}

function barangayScopeQuery(barangayId?: number) {
  return barangayId == null ? "" : `?barangay_id=${encodeURIComponent(String(barangayId))}`;
}

export async function getResidentReliefRequests(barangayId?: number) {
  return fetchJson<ResidentReliefRequest[]>(`/api/relief-requests${barangayScopeQuery(barangayId)}`);
}

export async function endorseResidentReliefRequest(id: string) {
  return fetchJson<ResidentReliefRequest>(`/api/relief-requests/${encodeURIComponent(id)}/endorse`, { method: "POST" });
}

export async function reviewResidentReliefRequest(id: string, payload: Record<string, unknown>, barangayId?: number) {
  return fetchJson<{ result: ResidentReliefRequest }>(`/api/relief-requests/${encodeURIComponent(id)}/review${barangayScopeQuery(barangayId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
