import { assignedBarangayForUser } from "@/lib/barangayScope";
import { logAuditEvent } from "@/lib/auditLogger";
import { auditActorForViewer, dashboardViewerRole, getDashboardViewer, type DashboardViewer } from "@/lib/dashboardViewer";
import { supabaseServer } from "@/lib/supabaseServer";
import type { NextRequest } from "next/server";

export type ReliefRequestStatus = "Pending" | "Endorsed" | "Approved" | "Rejected" | "Completed";
export type ReliefRequestAction = "feedback";

export type ReliefRequest = {
  id: string;
  user_id: string;
  full_name: string;
  address: string;
  contact_number: string;
  request_kind: "family" | "individual";
  family_name: string | null;
  relief_type: string;
  reason: string;
  status: ReliefRequestStatus;
  endorsed_by?: string | null;
  endorsed_at?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  rejection_feedback?: string | null;
  release_date?: string | null;
  release_time?: string | null;
  release_details?: string | null;
  created_at: string;
  updated_at: string;
  resident?: {
    resident_id: string;
    barangay_id: number | null;
    barangay_name: string | null;
    family_id: string | null;
  } | null;
};

const requestSelect = "id,user_id,full_name,address,contact_number,request_kind,family_name,relief_type,reason,status,endorsed_by,endorsed_at,reviewed_by,reviewed_at,rejection_feedback,release_date,release_time,release_details,created_at,updated_at,residents_v3!inner(resident_id,barangay_id,barangay_name,family_id)";

export async function viewerForRequest(request: NextRequest) {
  const viewer = await getDashboardViewer(request);
  if (!viewer) return { viewer: null, role: null as ReturnType<typeof dashboardViewerRole> };
  return { viewer, role: dashboardViewerRole(viewer) };
}

export function isAllowedReadRole(role: ReturnType<typeof dashboardViewerRole>) {
  return role === "barangay" || role === "cswdd" || role === "super";
}

export async function listReliefRequests(viewer: DashboardViewer, role: ReturnType<typeof dashboardViewerRole>) {
  if (!isAllowedReadRole(role)) throw new ReliefRequestError("You do not have access to resident relief requests.", 403);

  let query = supabaseServer
    .from("relief_requests")
    .select(requestSelect)
    .order("created_at", { ascending: false });

  if (role === "barangay") {
    const scope = assignedBarangayForUser(viewer);
    if (!scope) throw new ReliefRequestError("Your account is not assigned to a barangay.", 403);
    query = query.eq("residents_v3.barangay_id", scope.barangay_id);
  } else if (role === "cswdd") {
    query = query.in("status", ["Endorsed", "Approved", "Rejected"]);
  }

  const { data, error } = await query;
  if (error) throw new ReliefRequestError(error.message, 500);
  return (data ?? []).map(normalizeRequest);
}

export async function getReliefRequest(requestId: string, viewer: DashboardViewer, role: ReturnType<typeof dashboardViewerRole>) {
  if (!isAllowedReadRole(role)) throw new ReliefRequestError("You do not have access to resident relief requests.", 403);
  const { data, error } = await supabaseServer
    .from("relief_requests")
    .select(requestSelect)
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new ReliefRequestError(error.message, 500);
  if (!data) throw new ReliefRequestError("Resident relief request was not found.", 404);
  const normalized = normalizeRequest(data);
  if (role === "cswdd" && normalized.status === "Pending") throw new ReliefRequestError("This request has not been endorsed for CSWDD review.", 404);
  assertRequestScope(normalized, viewer, role);
  return normalized;
}

export async function endorseReliefRequest(requestId: string, viewer: DashboardViewer) {
  if (dashboardViewerRole(viewer) !== "barangay") throw new ReliefRequestError("Only barangay users can endorse resident relief requests.", 403);
  const scope = assignedBarangayForUser(viewer);
  if (!scope) throw new ReliefRequestError("Your account is not assigned to a barangay.", 403);
  const current = await getReliefRequest(requestId, viewer, "barangay");
  if (current.status !== "Pending") throw new ReliefRequestError(`Request status ${current.status} cannot be endorsed.`, 409);

  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("relief_requests")
    .update({ status: "Endorsed", endorsed_by: viewer.id, endorsed_at: now, reviewed_by: null, reviewed_at: null, rejection_feedback: null, release_date: null, release_time: null, release_details: null })
    .eq("id", requestId)
    .eq("user_id", current.user_id)
    .eq("status", "Pending")
    .select(requestSelect)
    .maybeSingle();
  if (error) throw new ReliefRequestError(error.message, 500);
  if (!data) throw new ReliefRequestError("The request was already changed. Refresh and try again.", 409);
  const result = normalizeRequest(data);
  await logAuditEvent({ ...auditActorForViewer(viewer), action: "RELIEF_REQUEST_ENDORSED", module: "Resident Relief Request Endorsement", description: `Endorsed resident relief request ${requestId} to CSWDD.`, target_type: "relief_request", target_id: requestId, barangay_id: scope.barangay_id, barangay_name: scope.barangay_name });
  return result;
}

export async function reviewReliefRequest(requestId: string, viewer: DashboardViewer, action: ReliefRequestAction, input: { rejection_feedback?: unknown }) {
  const role = dashboardViewerRole(viewer);
  if (role !== "cswdd" && role !== "super") throw new ReliefRequestError("Only CSWDD users can review resident relief requests.", 403);
  if (action !== "feedback") throw new ReliefRequestError("action must be feedback.", 400);
  const feedback = typeof input.rejection_feedback === "string" ? input.rejection_feedback.trim() : "";
  if (!feedback) throw new ReliefRequestError("Feedback is required.", 400);
  const current = await getReliefRequest(requestId, viewer, "cswdd");
  if (current.status !== "Endorsed") throw new ReliefRequestError(`Request status ${current.status} cannot be reviewed.`, 409);
  if (current.reviewed_at || current.reviewed_by || current.rejection_feedback) throw new ReliefRequestError("Feedback has already been provided for this request.", 409);

  // Reuse the existing feedback column without changing status or release metadata.
  // Conditional predicates also prevent concurrent submissions from overwriting feedback.
  const payload = { reviewed_by: viewer.id, reviewed_at: new Date().toISOString(), rejection_feedback: feedback };
  const { data, error } = await supabaseServer.from("relief_requests").update(payload)
    .eq("id", requestId).eq("status", "Endorsed")
    .is("reviewed_at", null).is("reviewed_by", null).is("rejection_feedback", null)
    .select(requestSelect).maybeSingle();
  if (error) throw new ReliefRequestError(error.message, 500);
  if (!data) throw new ReliefRequestError("The request was already changed. Refresh and try again.", 409);
  const result = normalizeRequest(data);
  await logAuditEvent({ ...auditActorForViewer(viewer), action: "RELIEF_REQUEST_FEEDBACK_PROVIDED", module: "Resident Relief Request Endorsement", description: `Provided feedback for resident relief request ${requestId}.`, target_type: "relief_request", target_id: requestId, barangay_id: result.resident?.barangay_id ?? null, barangay_name: result.resident?.barangay_name ?? null });
  return { result, role };
}

function assertRequestScope(request: ReliefRequest, viewer: DashboardViewer, role: ReturnType<typeof dashboardViewerRole>) {
  if (role !== "barangay") return;
  const scope = assignedBarangayForUser(viewer);
  if (!scope || request.resident?.barangay_id !== scope.barangay_id) throw new ReliefRequestError("You do not have access to this resident relief request.", 403);
}

function normalizeRequest(row: Record<string, unknown>) {
  const resident = row.residents_v3 && typeof row.residents_v3 === "object" ? row.residents_v3 as Record<string, unknown> : null;
  return { ...row, resident: resident ? { resident_id: String(resident.resident_id), barangay_id: resident.barangay_id == null ? null : Number(resident.barangay_id), barangay_name: resident.barangay_name == null ? null : String(resident.barangay_name), family_id: resident.family_id == null ? null : String(resident.family_id) } : null } as unknown as ReliefRequest;
}

export class ReliefRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
