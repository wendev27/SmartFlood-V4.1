import { NextRequest, NextResponse } from "next/server";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { ReliefRequestError, reviewReliefRequest } from "@/lib/reliefRequests";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(request);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (role !== "cswdd" && role !== "super") return NextResponse.json({ success: false, error: "Only CSWDD users can review resident relief requests." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (action !== "feedback") return NextResponse.json({ success: false, error: "action must be feedback." }, { status: 400 });
    const { id } = await context.params;
    return NextResponse.json({ success: true, data: await reviewReliefRequest(id, viewer, action, body) });
  } catch (error) {
    if (error instanceof ReliefRequestError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to review resident relief request." }, { status: 500 });
  }
}
