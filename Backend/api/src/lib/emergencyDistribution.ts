import { assignedBarangayForUser } from "@/lib/barangayScope";
import { dashboardViewerRole, type DashboardViewer } from "@/lib/dashboardViewer";
import { getCampaign, reconcileCampaignDistributionReadiness, refreshCampaignExpiration, resolveCampaignBatchIdByQrToken } from "@/lib/emergencyCampaigns";
import type { Pagination } from "@/lib/emergencyReports";
import { supabaseServer } from "@/lib/supabaseServer";

export type DistributionStatus =
  | "ELIGIBLE"
  | "ALREADY_RECEIVED"
  | "INVALID_IDENTIFIER"
  | "WRONG_BARANGAY"
  | "CAMPAIGN_NOT_ACTIVE"
  | "NOT_ELIGIBLE"
  | "UNAUTHORIZED";

export type DistributionInput = {
  identifier: string;
  allocation_item_id?: string | null;
  batch_id?: string | null;
  qr_token?: string | null;
};

export type DistributionContext = {
  status: DistributionStatus;
  reason?: string;
  viewer: DashboardViewer;
  role: string;
  beneficiary?: BeneficiarySummary;
  allocation?: AllocationSummary;
  existing_distribution?: DistributionSummary | null;
  request_error?: boolean;
};

type FamilyRecord = Record<string, unknown>;
type ResidentRecord = Record<string, unknown>;
type ItemRecord = Record<string, unknown>;

const readyItemStatuses = ["family_heads_notified"];

const familySelect = "family_id,family_name,family_head_id,family_head_name,barangay_id,barangay_name,complete_address,street,total_family_members,pwd_count,elderly_count,four_ps_count,lactating_count,pregnant_count,infant_count,toddler_count";
const residentSelect = "resident_id,last_name,first_name,middle_name,suffix,barangay_id,barangay_name,family_id,is_family_head,status";
const itemSelect = "item_id,batch_id,barangay_id,barangay_name,family_food_packs,individual_relief_goods,emergency_kits,barangay_status,created_at";
const distributionSelect = "distribution_id,batch_id,allocation_item_id,family_id,family_head_id,barangay_id,status,verified_by,verified_at,created_at";

export async function resolveDistributionContext(viewer: DashboardViewer | null, input: DistributionInput): Promise<DistributionContext | { status: "UNAUTHORIZED"; reason: string }> {
  if (!viewer) {
    return { status: "UNAUTHORIZED", reason: "Unauthorized." };
  }

  const role = dashboardViewerRole(viewer);
  if (role !== "barangay") {
    return { status: "UNAUTHORIZED", reason: "You do not have access to relief distribution." };
  }

  const barangay = assignedBarangayForUser(viewer);
  if (!barangay) return { status: "UNAUTHORIZED", reason: "Your account is not assigned to a barangay." };

  // Campaign and beneficiary are deliberately resolved independently: the QR
  // token selects the campaign, while identifier selects a family/resident.
  const campaignIdentifier = await resolveCampaignBatchId(input);
  if (!campaignIdentifier.batchId) {
    return {
      status: "CAMPAIGN_NOT_ACTIVE",
      viewer,
      role,
      request_error: campaignIdentifier.requestError,
      reason: "reason" in campaignIdentifier ? campaignIdentifier.reason : "Unable to resolve the relief campaign.",
    };
  }
  const batchId = campaignIdentifier.batchId;

  const campaign = await getCampaign(batchId);
  if (!campaign) {
    return { status: "CAMPAIGN_NOT_ACTIVE", viewer, role, reason: "Selected relief campaign was not found." };
  }

  const refreshedCampaign = await refreshCampaignExpiration(campaign, viewer);
  const effectiveCampaign = await reconcileCampaignDistributionReadiness(refreshedCampaign, viewer);
  if (effectiveCampaign.status !== "in_distribution") {
    return {
      status: "CAMPAIGN_NOT_ACTIVE",
      viewer,
      role,
      allocation: campaignToAllocationSummary(effectiveCampaign),
      reason: `Selected relief campaign is ${String(effectiveCampaign.status).replace(/_/g, " ")} and cannot accept distributions.`,
    };
  }

  const resolved = await resolveBeneficiary(input.identifier);
  if (!resolved.family) {
    return { status: "INVALID_IDENTIFIER", viewer, role, allocation: campaignToAllocationSummary(effectiveCampaign), reason: resolved.reason ?? "Beneficiary was not found." };
  }

  const family = resolved.family;
  const beneficiary = await buildBeneficiarySummary(family, resolved.resident);
  if (barangay.barangay_id !== Number(family.barangay_id)) {
    return {
      status: "WRONG_BARANGAY",
      viewer,
      role,
      beneficiary,
      allocation: campaignToAllocationSummary(effectiveCampaign),
      reason: "Beneficiary does not belong to your barangay.",
    };
  }

  const allocation = await findAllocationItem(barangay.barangay_id, batchId, input.allocation_item_id);
  if (!allocation.item) {
    return {
      status: "NOT_ELIGIBLE",
      viewer,
      role,
      beneficiary,
      allocation: campaignToAllocationSummary(effectiveCampaign),
      reason: allocation.reason ?? "Your barangay has no distribution-ready allocation for the selected campaign.",
    };
  }

  const allocationSummary = await buildAllocationSummary(allocation.item);
  if (!readyItemStatuses.includes(String(allocation.item.barangay_status ?? ""))) {
    return {
      status: "NOT_ELIGIBLE",
      viewer,
      role,
      beneficiary,
      allocation: allocationSummary,
      reason: `Allocation status ${String(allocation.item.barangay_status ?? "")} is not ready for QR distribution.`,
    };
  }

  const existingDistribution = await getExistingDistribution(String(allocation.item.batch_id), String(family.family_id));
  if (existingDistribution) {
    return {
      status: "ALREADY_RECEIVED",
      viewer,
      role,
      beneficiary,
      allocation: allocationSummary,
      existing_distribution: existingDistribution,
      reason: "This family has already received relief for this emergency allocation.",
    };
  }

  return {
    status: "ELIGIBLE",
    viewer,
    role,
    beneficiary,
    allocation: allocationSummary,
    existing_distribution: null,
  };
}

async function resolveCampaignBatchId(input: DistributionInput): Promise<{ batchId: string; requestError?: false } | { batchId: null; requestError: boolean; reason: string }> {
  const batchId = stringifyOrNull(input.batch_id);
  const qrToken = stringifyOrNull(input.qr_token);

  if (!batchId && !qrToken) {
    return { batchId: null, requestError: false, reason: "Select a relief campaign before verifying beneficiaries." };
  }

  let tokenBatchId: string | null = null;
  if (qrToken) {
    tokenBatchId = await resolveCampaignBatchIdByQrToken(qrToken);
    if (!tokenBatchId) {
      return { batchId: null, requestError: true, reason: "Campaign QR token was not found." };
    }
  }

  if (batchId && tokenBatchId && batchId !== tokenBatchId) {
    return { batchId: null, requestError: true, reason: "batchId and qrToken refer to different campaigns." };
  }

  return { batchId: batchId ?? tokenBatchId! };
}

export async function getDistributionHistoryForViewer(viewer: DashboardViewer | null) {
  if (!viewer) {
    return { status: "UNAUTHORIZED" as const, reason: "Unauthorized." };
  }

  const role = dashboardViewerRole(viewer);
  if (role !== "barangay" && role !== "super" && role !== "cswdd") {
    return { status: "UNAUTHORIZED" as const, reason: "You do not have access to relief distribution history." };
  }

  return getDistributionHistoryForViewerByBatch(viewer, null);
}

export async function getDistributionHistoryForViewerByBatch(viewer: DashboardViewer | null, batchId: string | null) {
  return getDistributionHistoryForViewerByBatchPaginated(viewer, batchId, null);
}

export async function getDistributionHistoryForViewerByBatchPaginated(viewer: DashboardViewer | null, batchId: string | null, pagination: { page: number; limit: number } | null) {
  if (!viewer) {
    return { status: "UNAUTHORIZED" as const, reason: "Unauthorized." };
  }

  const role = dashboardViewerRole(viewer);
  if (role !== "barangay" && role !== "super" && role !== "cswdd") {
    return { status: "UNAUTHORIZED" as const, reason: "You do not have access to relief distribution history." };
  }

  let barangayId: number | null = null;
  if (role === "barangay") {
    const barangay = assignedBarangayForUser(viewer);
    if (!barangay) return { status: "UNAUTHORIZED" as const, reason: "Your account is not assigned to a barangay." };
    barangayId = barangay.barangay_id;
  }

  if (pagination) {
    const from = (pagination.page - 1) * pagination.limit;
    const { error: countError, count } = await distributionHistoryQuery(batchId, barangayId, true);
    if (countError) throw new Error(countError.message);

    const total = count ?? 0;
    const baseResponse = {
      status: "OK" as const,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
      },
    };
    if (from >= total) {
      return { ...baseResponse, distributions: [] };
    }

    const { data, error } = await distributionHistoryQuery(batchId, barangayId).range(from, from + pagination.limit - 1);
    if (error) throw new Error(error.message);
    return {
      ...baseResponse,
      distributions: await attachDistributionNames((data ?? []) as Record<string, unknown>[]),
    };
  }

  const query = distributionHistoryQuery(batchId, barangayId).limit(100);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const response: { status: "OK"; distributions: DistributionSummary[]; pagination?: Pagination } = {
    status: "OK",
    distributions: await attachDistributionNames((data ?? []) as Record<string, unknown>[]),
  };
  return response;
}

function distributionHistoryQuery(batchId: string | null, barangayId: number | null, countOnly = false) {
  let query = supabaseServer
    .from("relief_distributions")
    .select(distributionSelect, countOnly ? { count: "exact", head: true } : undefined)
    .order("verified_at", { ascending: false });

  if (batchId) query = query.eq("batch_id", batchId);
  if (barangayId) query = query.eq("barangay_id", barangayId);
  return query;
}

export function duplicateDistributionError(error: unknown) {
  const maybeError = error as { code?: string; message?: string } | null | undefined;
  return maybeError?.code === "23505" || String(maybeError?.message ?? "").toLowerCase().includes("relief_distributions_batch_family_key");
}

async function resolveBeneficiary(identifier: string): Promise<{ family: FamilyRecord | null; resident: ResidentRecord | null; reason?: string }> {
  // Prefixes are optional. A bare UUID is tried as a family first and then as
  // a resident; a resident is valid only when it links to a family.
  const parsed = parseIdentifier(identifier);
  if (!parsed.value) return { family: null, resident: null, reason: "QR identifier is required." };
  if (!isUuid(parsed.value)) return { family: null, resident: null, reason: "QR identifier is not a valid resident or family identifier." };

  if (parsed.kind !== "resident") {
    const family = await getFamily(parsed.value);
    if (family) return { family, resident: null };
  }

  if (parsed.kind !== "family") {
    const resident = await getResident(parsed.value);
    if (!resident) return { family: null, resident: null, reason: "Resident or family was not found." };
    if (!resident.family_id) return { family: null, resident, reason: "Resident is not linked to a family." };
    const family = await getFamily(String(resident.family_id));
    return family ? { family, resident } : { family: null, resident, reason: "Resident family was not found." };
  }

  return { family: null, resident: null, reason: "Family was not found." };
}

async function getFamily(familyId: string) {
  const { data, error } = await supabaseServer
    .from("families")
    .select(familySelect)
    .eq("family_id", familyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as FamilyRecord | null;
}

async function getResident(residentId: string) {
  const { data, error } = await supabaseServer
    .from("residents_v3")
    .select(residentSelect)
    .eq("resident_id", residentId)
    .or("status.is.null,status.neq.inactive")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as ResidentRecord | null;
}

async function findAllocationItem(barangayId: number, batchId: string, allocationItemId?: string | null): Promise<{ item: ItemRecord | null; reason?: string }> {
  if (allocationItemId) {
    const { data, error } = await supabaseServer
      .from("emergency_allocation_items")
      .select(itemSelect)
      .eq("item_id", allocationItemId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return { item: null, reason: "Emergency allocation item was not found." };
    if (String(data.batch_id) !== batchId) return { item: null, reason: "Emergency allocation item does not belong to the selected campaign." };
    if (Number(data.barangay_id) !== barangayId) return { item: null, reason: "Emergency allocation item does not match the beneficiary barangay." };
    return { item: data as ItemRecord };
  }

  const { data, error } = await supabaseServer
    .from("emergency_allocation_items")
    .select(itemSelect)
    .eq("batch_id", batchId)
    .eq("barangay_id", barangayId)
    .in("barangay_status", readyItemStatuses)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  return { item: (data?.[0] as ItemRecord | undefined) ?? null };
}

async function getExistingDistribution(batchId: string, familyId: string) {
  const { data, error } = await supabaseServer
    .from("relief_distributions")
    .select(distributionSelect)
    .eq("batch_id", batchId)
    .eq("family_id", familyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? (await attachDistributionNames([data as Record<string, unknown>]))[0] : null;
}

async function buildBeneficiarySummary(family: FamilyRecord, resident: ResidentRecord | null) {
  let headId = stringifyOrNull(family.family_head_id);
  let headName = stringifyOrNull(family.family_head_name);

  if (!headId || !headName) {
    const { data, error } = await supabaseServer
      .from("residents_v3")
      .select("resident_id,last_name,first_name,middle_name,suffix,family_id,is_family_head,status")
      .eq("family_id", family.family_id)
      .eq("is_family_head", true)
      .or("status.is.null,status.neq.inactive")
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) {
      headId ||= String(data.resident_id ?? "");
      headName ||= residentName(data as Record<string, unknown>);
    }
  }

  return {
    family_id: String(family.family_id),
    family_name: String(family.family_name ?? "Family"),
    family_head_id: headId,
    family_head_name: headName,
    barangay_id: Number(family.barangay_id),
    barangay_name: String(family.barangay_name ?? ""),
    total_family_members: Number(family.total_family_members ?? 0),
    address: stringifyOrNull(family.complete_address) ?? stringifyOrNull(family.street),
    scanned_resident_name: resident ? residentName(resident) : null,
    vulnerability: {
      pwd_count: Number(family.pwd_count ?? 0),
      elderly_count: Number(family.elderly_count ?? 0),
      four_ps_count: Number(family.four_ps_count ?? 0),
      lactating_count: Number(family.lactating_count ?? 0),
      pregnant_count: Number(family.pregnant_count ?? 0),
      infant_count: Number(family.infant_count ?? 0),
      toddler_count: Number(family.toddler_count ?? 0),
    },
  };
}

async function buildAllocationSummary(item: ItemRecord) {
  const batch = await getCampaign(String(item.batch_id));
  const effectiveBatch = batch ? await refreshCampaignExpiration(batch) : null;
  return {
    item_id: String(item.item_id),
    batch_id: String(item.batch_id),
    barangay_id: Number(item.barangay_id),
    barangay_name: String(item.barangay_name ?? ""),
    barangay_status: String(item.barangay_status ?? ""),
    family_food_packs: Number(item.family_food_packs ?? 0),
    individual_relief_goods: Number(item.individual_relief_goods ?? 0),
    emergency_kits: Number(item.emergency_kits ?? 0),
    batch: effectiveBatch,
  };
}

async function attachDistributionNames(distributions: Record<string, unknown>[]) {
  if (distributions.length === 0) return [];

  const familyIds = Array.from(new Set(distributions.map((distribution) => String(distribution.family_id ?? "")).filter(Boolean)));
  const userIds = Array.from(new Set(distributions.map((distribution) => String(distribution.verified_by ?? "")).filter(Boolean)));
  const familiesById = new Map<string, Record<string, unknown>>();
  const usersById = new Map<string, Record<string, unknown>>();

  if (familyIds.length > 0) {
    const { data, error } = await supabaseServer
      .from("families")
      .select("family_id,family_name,family_head_name,barangay_name,total_family_members")
      .in("family_id", familyIds);

    if (error) throw new Error(error.message);
    for (const family of data ?? []) familiesById.set(String(family.family_id), family as Record<string, unknown>);
  }

  if (userIds.length > 0) {
    const { data, error } = await supabaseServer
      .from("app_users")
      .select("id,first_name,last_name,email")
      .in("id", userIds);

    if (error) throw new Error(error.message);
    for (const user of data ?? []) usersById.set(String(user.id), user as Record<string, unknown>);
  }

  return distributions.map((distribution) => {
    const family = familiesById.get(String(distribution.family_id ?? ""));
    const user = usersById.get(String(distribution.verified_by ?? ""));
    return {
      ...distribution,
      family_name: family?.family_name ?? null,
      family_head_name: family?.family_head_name ?? null,
      barangay_name: family?.barangay_name ?? null,
      total_family_members: family?.total_family_members ?? null,
      verified_by_name: user ? [user.first_name, user.last_name].filter(Boolean).join(" ") || String(user.email ?? "") : null,
    };
  });
}

function parseIdentifier(identifier: string) {
  const raw = String(identifier ?? "").trim();
  const normalized = raw.replace(/^smartflood:/i, "");
  const match = normalized.match(/^(family|resident|fam|res)[:|/](.+)$/i);
  if (!match) return { kind: "unknown", value: normalized };
  const kind = match[1].toLowerCase().startsWith("fam") ? "family" : "resident";
  return { kind, value: match[2].trim() };
}

function campaignToAllocationSummary(campaign: Awaited<ReturnType<typeof refreshCampaignExpiration>>) {
  return {
    item_id: "",
    batch_id: String(campaign.batch_id ?? ""),
    barangay_id: 0,
    barangay_name: "",
    barangay_status: "",
    family_food_packs: 0,
    individual_relief_goods: 0,
    emergency_kits: 0,
    batch: campaign,
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function residentName(resident: Record<string, unknown>) {
  return [resident.first_name, resident.middle_name, resident.last_name, resident.suffix]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function stringifyOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export type BeneficiarySummary = Awaited<ReturnType<typeof buildBeneficiarySummary>>;
export type AllocationSummary = Awaited<ReturnType<typeof buildAllocationSummary>>;
export type DistributionSummary = Awaited<ReturnType<typeof attachDistributionNames>>[number];
