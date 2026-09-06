import { NextRequest } from "next/server";
import { incidentForm, incidentRoute, incidentService, listIncidentRequest } from "@/lib/emergencyIncidentHttp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = listIncidentRequest;
export async function POST(request: NextRequest) {
  return incidentRoute(request, async actor => incidentService.create(actor, await incidentForm(request, actor)), 201);
}
