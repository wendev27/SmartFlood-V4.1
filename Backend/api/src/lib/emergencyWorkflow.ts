import { createHash, randomBytes } from "node:crypto";
import { auditActorForViewer, type DashboardViewer } from "@/lib/dashboardViewer";
import { logAuditEvent } from "@/lib/auditLogger";
import { encryptCampaignQrToken } from "@/lib/campaignQrCrypto";
import { supabaseServer } from "@/lib/supabaseServer";

const planIds = new Set(["severity_first", "vulnerability_first", "balanced"]);
const acceptedBatchStatuses = ["accepted", "barangays_notified", "in_distribution", "completed"];

export type ValidatedAllocation = {
  barangay_id: number;
  barangay_name: string;
  family_food_packs: number;
  individual_relief_goods: number;
  emergency_kits: number;
};

export type ValidatedPlan = {
  plan_id: string;
  plan_name: string;
  allocations: ValidatedAllocation[];
};

export type WorkflowBatchResponse = {
  batch_id: string;
  plan_id: string;
  plan_name: string;
  status: string;
  items: Record<string, unknown>[];
  data?: Record<string, unknown>[];
  duplicate?: boolean;
  qr_token?: string;
};

export class WorkflowValidationError extends Error {}

export function validateAllocationPlan(value: unknown): ValidatedPlan {
  const plan = asRecord(value);
  if (!plan) throw new WorkflowValidationError("Selected allocation plan is required.");

  const planId = String(plan.plan_id ?? "").trim();
  const planName = String(plan.plan_name ?? "").trim();
  if (!planIds.has(planId) || !planName) {
    throw new WorkflowValidationError("Selected allocation plan is invalid.");
  }

  if (!Array.isArray(plan.allocations) || plan.allocations.length === 0) {
    throw new WorkflowValidationError("Selected allocation plan has no barangay allocations.");
  }

  return {
    plan_id: planId,
    plan_name: planName,
    allocations: plan.allocations.map(validateAllocation),
  };
}

export async function findEquivalentAcceptedBatch(plan: ValidatedPlan): Promise<WorkflowBatchResponse | null> {
  const { data: batches, error: batchError } = await supabaseServer
    .from("emergency_allocation_batches")
    .select("batch_id,plan_id,plan_name,status")
    .eq("plan_id", plan.plan_id)
    .eq("plan_name", plan.plan_name)
    .in("status", acceptedBatchStatuses)
    .order("created_at", { ascending: false })
    .limit(20);

  if (batchError) throw new Error(batchError.message);
  if (!batches?.length) return null;

  const batchIds = batches.map((batch: Record<string, unknown>) => String(batch.batch_id)).filter(Boolean);
  const { data: items, error: itemError } = await supabaseServer
    .from("emergency_allocation_items")
    .select("item_id,batch_id,recommendation_id,barangay_id,barangay_name,family_food_packs,individual_relief_goods,emergency_kits,barangay_status,created_at")
    .in("batch_id", batchIds);

  if (itemError) throw new Error(itemError.message);

  const expectedSignature = allocationSignature(plan.allocations);
  for (const batch of batches as Record<string, unknown>[]) {
    const batchItems = (items ?? []).filter((item: Record<string, unknown>) => String(item.batch_id) === String(batch.batch_id));
    if (allocationSignature(batchItems.map(itemToAllocation)) !== expectedSignature) continue;
    return {
      batch_id: String(batch.batch_id),
      plan_id: String(batch.plan_id),
      plan_name: String(batch.plan_name),
      status: String(batch.status),
      items: batchItems,
      duplicate: true,
    };
  }

  return null;
}

export async function findExistingRejectedBatch(plan: ValidatedPlan, viewer: DashboardViewer): Promise<WorkflowBatchResponse | null> {
  const { data, error } = await supabaseServer
    .from("emergency_allocation_batches")
    .select("batch_id,plan_id,plan_name,status")
    .eq("plan_id", plan.plan_id)
    .eq("plan_name", plan.plan_name)
    .eq("status", "rejected")
    .eq("created_by", viewer.id)
    .eq("rejected_by", viewer.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  const batch = data?.[0];
  if (!batch) return null;

  return {
    batch_id: String(batch.batch_id),
    plan_id: String(batch.plan_id),
    plan_name: String(batch.plan_name),
    status: String(batch.status),
    items: [],
    duplicate: true,
  };
}

export async function createAcceptedWorkflowBatch(
  plan: ValidatedPlan,
  savedRecommendations: Record<string, unknown>[],
  viewer: DashboardViewer,
): Promise<WorkflowBatchResponse> {
  const now = new Date().toISOString();
  const actor = auditActorForViewer(viewer);
  // The rendered QR contains this opaque bearer token, never resident or
  // family PII. Store a hash for lookup and an encrypted copy only so an
  // authorized barangay user can retrieve and display the campaign QR later.
  const qrToken = randomBytes(32).toString("base64url");
  const qrTokenHash = createHash("sha256").update(qrToken, "utf8").digest("hex");
  const qrTokenEncrypted = encryptCampaignQrToken(qrToken);
  const { data: batch, error: batchError } = await supabaseServer
    .from("emergency_allocation_batches")
    .insert([{
      plan_id: plan.plan_id,
      plan_name: plan.plan_name,
      status: "accepted",
      created_by: viewer.id,
      accepted_by: viewer.id,
      accepted_at: now,
      qr_token_hash: qrTokenHash,
      qr_token_encrypted: qrTokenEncrypted,
    }])
    .select("batch_id,plan_id,plan_name,status")
    .single();

  if (batchError || !batch) throw new Error(batchError?.message ?? "Unable to create emergency allocation batch.");

  const recommendationByBarangay = new Map(
    savedRecommendations.map((row) => [barangayKey(row), row]).filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[0])),
  );
  const itemPayloads = plan.allocations.map((allocation) => {
    const saved = recommendationByBarangay.get(String(allocation.barangay_id));
    return {
      batch_id: batch.batch_id,
      recommendation_id: saved?.recommendation_id ?? null,
      barangay_id: allocation.barangay_id,
      barangay_name: allocation.barangay_name,
      family_food_packs: allocation.family_food_packs,
      individual_relief_goods: allocation.individual_relief_goods,
      emergency_kits: allocation.emergency_kits,
      barangay_status: "pending",
    };
  });

  const { data: items, error: itemError } = await supabaseServer
    .from("emergency_allocation_items")
    .insert(itemPayloads)
    .select("*");

  if (itemError) {
    await supabaseServer.from("emergency_allocation_batches").delete().eq("batch_id", batch.batch_id);
    throw new Error(itemError.message);
  }

  await logAuditEvent({
    ...actor,
    action: "AI_RECOMMENDATION_APPROVED",
    module: "AI-Optimized Relief Recommendation",
    description: `Approved ${plan.plan_name} emergency allocation strategy for ${itemPayloads.length} barangays.`,
    target_type: "emergency_allocation_batch",
    target_id: String(batch.batch_id),
  });

  return {
    batch_id: String(batch.batch_id),
    plan_id: String(batch.plan_id),
    plan_name: String(batch.plan_name),
    status: String(batch.status),
    items: items ?? [],
    data: savedRecommendations,
    qr_token: qrToken,
  };
}

export async function createRejectedWorkflowBatch(plan: ValidatedPlan, viewer: DashboardViewer): Promise<WorkflowBatchResponse> {
  const now = new Date().toISOString();
  const actor = auditActorForViewer(viewer);
  const { data: batch, error } = await supabaseServer
    .from("emergency_allocation_batches")
    .insert([{
      plan_id: plan.plan_id,
      plan_name: plan.plan_name,
      status: "rejected",
      created_by: viewer.id,
      rejected_by: viewer.id,
      rejected_at: now,
    }])
    .select("batch_id,plan_id,plan_name,status")
    .single();

  if (error || !batch) throw new Error(error?.message ?? "Unable to create rejected emergency allocation batch.");

  await logAuditEvent({
    ...actor,
    action: "AI_RECOMMENDATION_REJECTED",
    module: "AI-Optimized Relief Recommendation",
    description: `Rejected ${plan.plan_name} emergency allocation strategy.`,
    target_type: "emergency_allocation_batch",
    target_id: String(batch.batch_id),
  });

  return {
    batch_id: String(batch.batch_id),
    plan_id: String(batch.plan_id),
    plan_name: String(batch.plan_name),
    status: String(batch.status),
    items: [],
  };
}

function validateAllocation(value: unknown): ValidatedAllocation {
  const allocation = asRecord(value);
  if (!allocation) throw new WorkflowValidationError("Selected allocation plan contains malformed allocation rows.");

  const barangayId = toWholeNumber(allocation.barangay_id);
  const barangayName = String(allocation.barangay_name ?? allocation.barangay ?? "").trim();
  if (!barangayId || !barangayName) {
    throw new WorkflowValidationError("Each allocation requires a valid barangay.");
  }

  return {
    barangay_id: barangayId,
    barangay_name: barangayName,
    family_food_packs: toWholeNumber(allocation.recommended_family_food_packs),
    individual_relief_goods: toWholeNumber(allocation.recommended_individual_relief_goods ?? allocation.recommended_relief_goods_individual),
    emergency_kits: toWholeNumber(allocation.recommended_emergency_kits ?? allocation.recommended_medicine_kits),
  };
}

function allocationSignature(allocations: ValidatedAllocation[]) {
  return JSON.stringify(
    allocations
      .map((allocation) => ({
        barangay_id: allocation.barangay_id,
        barangay_name: allocation.barangay_name,
        family_food_packs: allocation.family_food_packs,
        individual_relief_goods: allocation.individual_relief_goods,
        emergency_kits: allocation.emergency_kits,
      }))
      .sort((left, right) => left.barangay_id - right.barangay_id),
  );
}

function itemToAllocation(item: Record<string, unknown>): ValidatedAllocation {
  return {
    barangay_id: toWholeNumber(item.barangay_id),
    barangay_name: String(item.barangay_name ?? "").trim(),
    family_food_packs: toWholeNumber(item.family_food_packs),
    individual_relief_goods: toWholeNumber(item.individual_relief_goods),
    emergency_kits: toWholeNumber(item.emergency_kits),
  };
}

function barangayKey(row: Record<string, unknown>) {
  const id = toWholeNumber(row.barangay_id);
  return id ? String(id) : "";
}

function toWholeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new WorkflowValidationError("Allocation quantities must be non-negative whole numbers.");
  }
  return Math.floor(parsed);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
