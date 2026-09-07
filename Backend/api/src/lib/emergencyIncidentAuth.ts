import type { NextRequest } from "next/server";
import { assignedBarangayForUser } from "@/lib/barangayScope";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { IncidentError } from "@/lib/emergencyIncidentRules";
import type { IncidentActor } from "@/types/emergencyIncident";

/**
 * Resident identity is deliberately not guessed from a UUID, phone, user metadata,
 * or request body. Live inspection found no Supabase Auth users and no verified
 * mobile-login-to-residents_v3 relationship. Connect that existing authentication
 * mechanism here once its contract is supplied; do not add a second identity system.
 */
export async function getIncidentActor(request: NextRequest): Promise<IncidentActor> {
  if (request.headers.has("authorization")) {
    throw new IncidentError(503, "Resident authentication integration is not configured.");
  }
  const viewer = await getDashboardViewer(request);
  if (!viewer) throw new IncidentError(401, "Unauthorized.");
  const role = dashboardViewerRole(viewer);
  if (role === "super" || role === "cswdd") {
    const rawScope = request.nextUrl.searchParams.get("barangay_id");
    const barangayId = Number(rawScope);
    if (!rawScope || !Number.isSafeInteger(barangayId) || barangayId < 1) {
      throw new IncidentError(403, "A barangay scope is required for this dashboard emergency report view.");
    }
    return { kind: "barangay", userId: viewer.id, barangayId };
  }
  if (role !== "barangay") throw new IncidentError(403, "Only assigned barangay users can access dashboard emergency reports.");
  const barangay = assignedBarangayForUser(viewer);
  if (!barangay || !Number.isSafeInteger(barangay.barangay_id) || barangay.barangay_id < 1) {
    throw new IncidentError(403, "Your account is not assigned to a barangay.");
  }
  return { kind: "barangay", userId: viewer.id, barangayId: barangay.barangay_id };
}
