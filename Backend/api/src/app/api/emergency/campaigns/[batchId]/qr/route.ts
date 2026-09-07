import { NextRequest, NextResponse } from "next/server";
import { assignedBarangayForUser } from "@/lib/barangayScope";
import { decryptCampaignQrToken } from "@/lib/campaignQrCrypto";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import {
  activeCampaignStatuses,
  getCampaign,
  getCampaignBarangayItem,
  getEncryptedCampaignQrToken,
  reconcileCampaignDistributionReadiness,
  refreshCampaignExpiration,
} from "@/lib/emergencyCampaigns";

type RouteContext = {
  params: Promise<{ batchId: string }>;
};

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(request);
    if (!viewer) return noStoreJson({ success: false, error: "Unauthorized." }, 401);

    const role = dashboardViewerRole(viewer);
    if (role !== "barangay") {
      return noStoreJson({ success: false, error: "Only barangay officials can access campaign QR codes." }, 403);
    }

    const barangay = assignedBarangayForUser(viewer);
    if (!barangay) {
      return noStoreJson({ success: false, error: "Your account is not assigned to a barangay." }, 403);
    }

    const { batchId } = await context.params;
    const selectedBatchId = String(batchId ?? "").trim();
    if (!selectedBatchId) return noStoreJson({ success: false, error: "Relief campaign was not found." }, 404);

    const campaign = await getCampaign(selectedBatchId);
    if (!campaign) return noStoreJson({ success: false, error: "Relief campaign was not found." }, 404);

    const allocationItem = await getCampaignBarangayItem(selectedBatchId, barangay.barangay_id);
    if (!allocationItem) return noStoreJson({ success: false, error: "Relief campaign was not found." }, 404);

    const refreshedCampaign = await refreshCampaignExpiration(campaign, viewer);
    const effectiveCampaign = await reconcileCampaignDistributionReadiness(refreshedCampaign, viewer);
    if (!activeCampaignStatuses.includes(effectiveCampaign.status)) {
      return noStoreJson({
        success: false,
        error: `Campaign status ${effectiveCampaign.status} cannot display a campaign QR.`,
      }, 409);
    }

    const encryptedToken = await getEncryptedCampaignQrToken(selectedBatchId);
    if (!encryptedToken) return noStoreJson({ success: false, error: "Campaign QR is unavailable." }, 404);

    const qrToken = decryptCampaignQrToken(encryptedToken);
    return noStoreJson({ success: true, data: { qr_token: qrToken } });
  } catch {
    return noStoreJson({ success: false, error: "Unable to load campaign QR." }, 500);
  }
}
