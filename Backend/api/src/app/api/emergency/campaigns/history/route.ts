import { NextRequest, NextResponse } from "next/server";
import { getDashboardViewer } from "@/lib/dashboardViewer";
import { listCampaignsForViewer, resolveCampaignBatchIdByQrToken } from "@/lib/emergencyCampaigns";

export async function GET(request: NextRequest) {
  try {
    const viewer = await getDashboardViewer(request);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });

    const result = await listCampaignsForViewer(viewer);
    if (result.status === "UNAUTHORIZED") {
      return NextResponse.json({ success: false, error: result.reason }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: { campaigns: result.campaigns } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to load relief campaign history." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const viewer = await getDashboardViewer(request);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const qrToken = typeof body.qrToken === "string" ? body.qrToken.trim() : "";
    const suppliedBatchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
    if (!qrToken) return NextResponse.json({ success: false, error: "qrToken is required." }, { status: 400 });

    const resolvedBatchId = await resolveCampaignBatchIdByQrToken(qrToken);
    if (!resolvedBatchId) return NextResponse.json({ success: false, error: "Campaign was not found." }, { status: 404 });
    if (suppliedBatchId && suppliedBatchId !== resolvedBatchId) {
      return NextResponse.json({ success: false, error: "batchId and qrToken refer to different campaigns." }, { status: 400 });
    }

    const result = await listCampaignsForViewer(viewer, resolvedBatchId);
    if (result.status === "UNAUTHORIZED") {
      return NextResponse.json({ success: false, error: result.reason }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: { campaigns: result.campaigns } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to load relief campaign." }, { status: 500 });
  }
}
