import { NextRequest, NextResponse } from "next/server";
import { isAllowedReadRole, listReliefRequests, viewerForRequest, ReliefRequestError } from "@/lib/reliefRequests";

export async function GET(request: NextRequest) {
  try {
    const { viewer, role } = await viewerForRequest(request);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (!isAllowedReadRole(role)) return NextResponse.json({ success: false, error: "You do not have access to resident relief requests." }, { status: 403 });
    return NextResponse.json({ success: true, data: await listReliefRequests(viewer, role) });
  } catch (error) {
    return errorResponse(error, "Unable to load resident relief requests.");
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ReliefRequestError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  return NextResponse.json({ success: false, error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
