import { fetchEnvelope, fetchJson } from "@/services/apiClient";
import type {
  EmergencyAllocationActionResponse,
  EmergencyNotification,
  EmergencyNotificationListResponse,
  ReliefCampaignActionResponse,
  ReliefCampaignHistoryResponse,
  ReliefBeneficiaryStatusFilter,
  ReliefBeneficiaryStatusResponse,
  ReliefDistributionHistoryResponse,
  ReliefDistributionReportResponse,
  ReliefDistributionVerifyResponse,
  ReliefNotReceivedResponse,
} from "@/types/emergency";

export async function getEmergencyNotifications() {
  const data = await fetchJson<EmergencyNotificationListResponse>("/api/emergency/notifications");
  return data.notifications;
}

export async function markEmergencyNotificationRead(notificationId: string) {
  const response = await fetchEnvelope<EmergencyNotification>(`/api/emergency/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "PATCH",
  });
  return response.data ?? null;
}

export async function acceptEmergencyAllocationItem(itemId: string) {
  const response = await fetchEnvelope<EmergencyAllocationActionResponse>(`/api/emergency/allocation-items/${encodeURIComponent(itemId)}/accept`, {
    method: "POST",
  });
  return response.data ?? null;
}

export async function rejectEmergencyAllocationItem(itemId: string) {
  const response = await fetchEnvelope<EmergencyAllocationActionResponse>(`/api/emergency/allocation-items/${encodeURIComponent(itemId)}/reject`, {
    method: "POST",
  });
  return response.data ?? null;
}

export async function confirmEmergencyAllocationReceipt(itemId: string) {
  const response = await fetchEnvelope<EmergencyAllocationActionResponse>(`/api/emergency/allocation-items/${encodeURIComponent(itemId)}/confirm-receipt`, {
    method: "POST",
  });
  return response.data ?? null;
}

export async function notifyFamilyHeadsForEmergencyAllocation(itemId: string) {
  const response = await fetchEnvelope<EmergencyAllocationActionResponse>(`/api/emergency/allocation-items/${encodeURIComponent(itemId)}/notify-family-heads`, {
    method: "POST",
  });
  return response.data ?? null;
}

export async function verifyReliefDistribution(batchId: string | null, identifier: string, qrToken?: string | null) {
  const response = await fetchEnvelope<ReliefDistributionVerifyResponse>("/api/emergency/distribution/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(batchId ? { batchId } : {}), identifier, ...(qrToken ? { qrToken } : {}) }),
  });
  return response as ReliefDistributionVerifyResponse;
}

export async function confirmReliefDistribution(batchId: string | null, identifier: string, allocationItemId?: string | null, qrToken?: string | null) {
  const response = await fetchEnvelope<ReliefDistributionVerifyResponse>("/api/emergency/distribution/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(batchId ? { batchId } : {}), identifier, allocation_item_id: allocationItemId ?? null, ...(qrToken ? { qrToken } : {}) }),
  });
  return response as ReliefDistributionVerifyResponse;
}

export async function getReliefDistributionHistory(batchId?: string | null, page?: number, limit?: number) {
  const params = new URLSearchParams();
  if (batchId) params.set("batch_id", batchId);
  if (page) params.set("page", String(page));
  if (limit) params.set("limit", String(limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await fetchJson<ReliefDistributionHistoryResponse>(`/api/emergency/distribution/history${query}`);
  return data;
}

export async function getReliefDistributionReport(batchId: string) {
  const data = await fetchJson<ReliefDistributionReportResponse>(`/api/emergency/distribution/report?batchId=${encodeURIComponent(batchId)}`);
  return data;
}

export async function getReliefNotReceived(batchId: string, page = 1, limit = 5) {
  const data = await fetchJson<ReliefNotReceivedResponse>(`/api/emergency/distribution/not-received?batchId=${encodeURIComponent(batchId)}&page=${page}&limit=${limit}`);
  return data;
}

export async function getReliefBeneficiaryStatus(batchId: string, filter: ReliefBeneficiaryStatusFilter, search: string, page = 1, limit = 10) {
  const params = new URLSearchParams({
    batchId,
    filter,
    search,
    page: String(page),
    limit: String(limit),
  });
  const data = await fetchJson<ReliefBeneficiaryStatusResponse>(`/api/emergency/distribution/beneficiary-status?${params.toString()}`);
  return data;
}

export function reliefDistributionExportUrl(batchId: string) {
  return `/api/emergency/distribution/export?batchId=${encodeURIComponent(batchId)}`;
}

export function reliefDistributionScannerUrl(batchId: string) {
  return `/dashboard/reliefDistribution/scan?batchId=${encodeURIComponent(batchId)}`;
}

export async function getReliefCampaignHistory() {
  const data = await fetchJson<ReliefCampaignHistoryResponse>("/api/emergency/campaigns/history");
  return data.campaigns;
}

export async function startReliefCampaign(batchId: string, expiresAt: string) {
  const response = await fetchEnvelope<ReliefCampaignActionResponse>(`/api/emergency/campaigns/${encodeURIComponent(batchId)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expires_at: expiresAt }),
  });
  return response.data ?? null;
}

export async function closeReliefCampaign(batchId: string, closureReason: string) {
  const response = await fetchEnvelope<ReliefCampaignActionResponse>(`/api/emergency/campaigns/${encodeURIComponent(batchId)}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ closure_reason: closureReason }),
  });
  return response.data ?? null;
}

export async function getReliefCampaignQrToken(batchId: string) {
  const data = await fetchJson<{ qr_token: string }>(`/api/emergency/campaigns/${encodeURIComponent(batchId)}/qr`);
  return data.qr_token;
}

export async function getReliefCampaignByQrToken(qrToken: string, batchId?: string | null) {
  const data = await fetchJson<ReliefCampaignHistoryResponse>("/api/emergency/campaigns/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrToken, ...(batchId ? { batchId } : {}) }),
  });
  return data.campaigns;
}
