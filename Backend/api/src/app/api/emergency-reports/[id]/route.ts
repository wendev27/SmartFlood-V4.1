import { NextRequest } from "next/server";
import { incidentRoute, incidentService } from "@/lib/emergencyIncidentHttp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return incidentRoute(request, async actor => incidentService.detail(actor, (await context.params).id));
}
