import { NextRequest, NextResponse } from "next/server";
import { getReliefRequest, ReliefRequestError, viewerForRequest } from "@/lib/reliefRequests";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { viewer, role } = await viewerForRequest(request);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    return NextResponse.json({ success: true, data: await getReliefRequest(id, viewer, role) });
  } catch (error) {
    if (error instanceof ReliefRequestError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to load resident relief request." }, { status: 500 });
  }
}
