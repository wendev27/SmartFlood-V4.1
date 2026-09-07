import { NextRequest, NextResponse } from "next/server";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { endorseReliefRequest, ReliefRequestError } from "@/lib/reliefRequests";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(request);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (dashboardViewerRole(viewer) !== "barangay") return NextResponse.json({ success: false, error: "Only barangay users can endorse resident relief requests." }, { status: 403 });
    const { id } = await context.params;
    return NextResponse.json({ success: true, data: await endorseReliefRequest(id, viewer) });
  } catch (error) {
    if (error instanceof ReliefRequestError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to endorse resident relief request." }, { status: 500 });
  }
}
