import { createHash } from "node:crypto";
import { assignedBarangayForUser } from "@/lib/barangayScope";
import { logAuditEvent } from "@/lib/auditLogger";
import { auditActorForViewer, dashboardViewerRole, type DashboardViewer } from "@/lib/dashboardViewer";
import { supabaseServer } from "@/lib/supabaseServer";

export type CampaignStatus = "accepted" | "rejected" | "barangays_notified" | "in_distribution" | "completed" | "expired" | "closed";

export const campaignSelect = "batch_id,plan_id,plan_name,status,created_by,accepted_by,rejected_by,created_at,updated_at,accepted_at,rejected_at,started_at,expires_at,closed_at,closed_by,closure_reason";

export const activeCampaignStatuses = ["accepted", "barangays_notified", "in_distribution"];
export const terminalCampaignStatuses = ["rejected", "expired", "closed", "completed"];
const distributableItemStatuses = ["family_heads_notified", "completed"];

export async function getCampaign(batchId: string) {
  const { data, error } = await supabaseServer
    .from("emergency_allocation_batches")
    .select(campaignSelect)
    .eq("batch_id", batchId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? normalizeCampaign(data as Record<string, unknown>) : null;
}

export async function getEncryptedCampaignQrToken(batchId: string) {
  const { data, error } = await supabaseServer
    .from("emergency_allocation_batches")
    .select("qr_token_encrypted")
    .eq("batch_id", batchId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return typeof data?.qr_token_encrypted === "string" ? data.qr_token_encrypted : null;
}

export async function resolveCampaignBatchIdByQrToken(qrToken: string) {
  // Compare hashes instead of querying by the encrypted re-display value.
  // A successful match identifies a campaign batch, not a beneficiary.
  const qrTokenHash = createHash("sha256").update(qrToken, "utf8").digest("hex");
  const { data, error } = await supabaseServer
    .from("emergency_allocation_batches")
    .select("batch_id")
    .eq("qr_token_hash", qrTokenHash)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.batch_id ? String(data.batch_id) : null;
}

export async function refreshCampaignExpiration(campaign: Record<string, unknown>, viewer?: DashboardViewer | null) {
  const status = String(campaign.status ?? "");
  const expiresAt = campaign.expires_at ? new Date(String(campaign.expires_at)) : null;
  if (status !== "in_distribution" || !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() >= Date.now()) {
    return normalizeCampaign(campaign);
  }

  const { data, error } = await supabaseServer
    .from("emergency_allocation_batches")
    .update({ status: "expired" })
    .eq("batch_id", campaign.batch_id)
    .eq("status", "in_distribution")
    .select(campaignSelect)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const expired = normalizeCampaign((data as Record<string, unknown> | null) ?? { ...campaign, status: "expired" });
  if (viewer && data) {
    await logAuditEvent({
      ...auditActorForViewer(viewer),
      action: "RELIEF_CAMPAIGN_EXPIRED",
      module: "Emergency Relief Management",
      description: `Relief campaign ${expired.plan_name} expired at ${String(expired.expires_at ?? "")}.`,
      target_type: "emergency_allocation_batch",
      target_id: expired.batch_id,
    });
  }
  return expired;
}

export async function reconcileCampaignDistributionReadiness(campaign: Record<string, unknown>, viewer?: DashboardViewer | null) {
  const normalized = normalizeCampaign(campaign);
  if (normalized.status !== "barangays_notified") return normalized;

  const { data: readyItems, error: itemError } = await supabaseServer
    .from("emergency_allocation_items")
    .select("item_id")
    .eq("batch_id", normalized.batch_id)
    .in("barangay_status", distributableItemStatuses)
    .limit(1);

  if (itemError) throw new Error(itemError.message);
  if (!readyItems?.length) return normalized;

  const now = new Date().toISOString();
  const { data: updatedCampaign, error: updateError } = await supabaseServer
    .from("emergency_allocation_batches")
    .update({
      status: "in_distribution",
      started_at: normalized.started_at ?? now,
    })
    .eq("batch_id", normalized.batch_id)
    .eq("status", "barangays_notified")
    .select(campaignSelect)
    .maybeSingle();

  if (updateError) throw new Error(updateError.message);
  const reconciled = normalizeCampaign((updatedCampaign as Record<string, unknown> | null) ?? normalized);

  if (viewer && updatedCampaign) {
    await logAuditEvent({
      ...auditActorForViewer(viewer),
      action: "RELIEF_CAMPAIGN_STARTED",
      module: "Emergency Relief Management",
      description: `Started relief distribution for ${reconciled.plan_name} after at least one barangay allocation reached family-head notification readiness.`,
      target_type: "emergency_allocation_batch",
      target_id: reconciled.batch_id,
    });
  }

  return reconciled;
}

export async function findActiveCampaign(excludeBatchId?: string | null) {
  const { data, error } = await supabaseServer
    .from("emergency_allocation_batches")
    .select(campaignSelect)
    .in("status", activeCampaignStatuses)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const campaign = await refreshCampaignExpiration(row as Record<string, unknown>);
    if (excludeBatchId && campaign.batch_id === excludeBatchId) continue;
    if (activeCampaignStatuses.includes(campaign.status)) return campaign;
  }
  return null;
}

export async function listCampaignsForViewer(viewer: DashboardViewer, targetBatchId?: string | null) {
  const role = dashboardViewerRole(viewer);
  if (role !== "super" && role !== "cswdd" && role !== "barangay") {
    return { status: "UNAUTHORIZED" as const, reason: "You do not have access to relief campaigns." };
  }
  const assignedBarangay = role === "barangay" ? assignedBarangayForUser(viewer) : null;
  if (role === "barangay" && !assignedBarangay) {
    return { status: "UNAUTHORIZED" as const, reason: "Your account is not assigned to a barangay." };
  }

  let campaignQuery = supabaseServer
    .from("emergency_allocation_batches")
    .select(campaignSelect);
  if (targetBatchId) campaignQuery = campaignQuery.eq("batch_id", targetBatchId);
  const { data, error } = await campaignQuery
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);

  const campaigns = [];
  for (const row of data ?? []) {
    const refreshedCampaign = await refreshCampaignExpiration(row as Record<string, unknown>, viewer);
    const campaign = await reconcileCampaignDistributionReadiness(refreshedCampaign, viewer);
    campaigns.push(campaign);
  }

  const progressByBatch = await getLightweightCampaignProgress(
    campaigns.map((campaign) => campaign.batch_id),
    assignedBarangay?.barangay_id ?? null,
  );
  const scopedCampaigns = campaigns
    .filter((campaign) => role !== "barangay" || (progressByBatch.get(campaign.batch_id)?.total_barangays ?? 0) > 0)
    .map((campaign) => ({
      ...campaign,
      progress: progressByBatch.get(campaign.batch_id) ?? emptyCampaignProgress(),
    }));

  return { status: "OK" as const, campaigns: scopedCampaigns };
}

async function getLightweightCampaignProgress(batchIds: string[], barangayId: number | null) {
  const progressByBatch = new Map<string, ReturnType<typeof emptyCampaignProgress>>();
  const scopedBatchIds = batchIds.filter(Boolean);
  if (scopedBatchIds.length === 0) return progressByBatch;

  let query = supabaseServer
    .from("emergency_allocation_items")
    .select("item_id,batch_id,barangay_id,barangay_name,barangay_status")
    .in("batch_id", scopedBatchIds);
  if (barangayId) query = query.eq("barangay_id", barangayId);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  for (const item of data ?? []) {
    const batchId = String((item as Record<string, unknown>).batch_id ?? "");
    if (!batchId) continue;
    const progress = progressByBatch.get(batchId) ?? emptyCampaignProgress();
    progress.barangays.push({
      barangay_id: Number((item as Record<string, unknown>).barangay_id),
      barangay_name: String((item as Record<string, unknown>).barangay_name ?? ""),
      allocation_item_id: String((item as Record<string, unknown>).item_id ?? ""),
      barangay_status: String((item as Record<string, unknown>).barangay_status ?? ""),
      received: 0,
    });
    progress.total_barangays = progress.barangays.length;
    progressByBatch.set(batchId, progress);
  }

  for (const batchId of scopedBatchIds) {
    if (!progressByBatch.has(batchId)) progressByBatch.set(batchId, emptyCampaignProgress());
  }

  return progressByBatch;
}

function emptyCampaignProgress() {
  return {
    total_barangays: 0,
    total_distributions: 0,
    barangays: [] as Array<{
      barangay_id: number;
      barangay_name: string;
      allocation_item_id: string;
      barangay_status: string;
      received: number;
    }>,
  };
}

export async function getCampaignProgress(batchId: string, viewer?: DashboardViewer | null) {
  const role = dashboardViewerRole(viewer);
  const barangay = role === "barangay" ? assignedBarangayForUser(viewer) : null;

  let itemQuery = supabaseServer
    .from("emergency_allocation_items")
    .select("item_id,barangay_id,barangay_name,barangay_status")
    .eq("batch_id", batchId);
  if (barangay) itemQuery = itemQuery.eq("barangay_id", barangay.barangay_id);

  const { data: items, error: itemError } = await itemQuery;
  if (itemError) throw new Error(itemError.message);

  const itemIds = (items ?? []).map((item: Record<string, unknown>) => String(item.item_id)).filter(Boolean);
  let distributions: Record<string, unknown>[] = [];
  if (itemIds.length > 0) {
    const { data, error } = await supabaseServer
      .from("relief_distributions")
      .select("distribution_id,allocation_item_id,barangay_id,status")
      .in("allocation_item_id", itemIds);

    if (error) throw new Error(error.message);
    distributions = (data ?? []) as Record<string, unknown>[];
  }

  const byBarangay = new Map<string, { barangay_id: number; barangay_name: string; allocation_item_id: string; barangay_status: string; received: number }>();
  for (const item of items ?? []) {
    byBarangay.set(String(item.item_id), {
      barangay_id: Number(item.barangay_id),
      barangay_name: String(item.barangay_name ?? ""),
      allocation_item_id: String(item.item_id),
      barangay_status: String(item.barangay_status ?? ""),
      received: 0,
    });
  }
  for (const distribution of distributions) {
    const key = String(distribution.allocation_item_id ?? "");
    const row = byBarangay.get(key);
    if (row && distribution.status === "received") row.received += 1;
  }

  return {
    total_barangays: items?.length ?? 0,
    total_distributions: distributions.filter((distribution) => distribution.status === "received").length,
    barangays: Array.from(byBarangay.values()),
  };
}

export async function getCampaignBarangayItem(batchId: string, barangayId: number) {
  const { data, error } = await supabaseServer
    .from("emergency_allocation_items")
    .select("item_id,batch_id,barangay_id,barangay_name,barangay_status")
    .eq("batch_id", batchId)
    .eq("barangay_id", barangayId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

export function normalizeCampaign(row: Record<string, unknown>) {
  return {
    batch_id: String(row.batch_id),
    plan_id: String(row.plan_id ?? ""),
    plan_name: String(row.plan_name ?? ""),
    status: String(row.status ?? "") as CampaignStatus,
    created_by: stringifyOrNull(row.created_by),
    accepted_by: stringifyOrNull(row.accepted_by),
    rejected_by: stringifyOrNull(row.rejected_by),
    created_at: stringifyOrNull(row.created_at),
    updated_at: stringifyOrNull(row.updated_at),
    accepted_at: stringifyOrNull(row.accepted_at),
    rejected_at: stringifyOrNull(row.rejected_at),
    started_at: stringifyOrNull(row.started_at),
    expires_at: stringifyOrNull(row.expires_at),
    closed_at: stringifyOrNull(row.closed_at),
    closed_by: stringifyOrNull(row.closed_by),
    closure_reason: stringifyOrNull(row.closure_reason),
  };
}

function stringifyOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}
