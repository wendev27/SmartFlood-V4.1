import { NextRequest } from "next/server";
import { incidentJson, incidentRoute, incidentService } from "@/lib/emergencyIncidentHttp";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return incidentRoute(request, async actor => incidentService.resolve(actor, (await context.params).id, await incidentJson(request)));
}
