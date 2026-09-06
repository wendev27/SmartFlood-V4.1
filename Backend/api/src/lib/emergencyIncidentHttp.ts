import { NextRequest, NextResponse } from "next/server";
import { getIncidentActor } from "@/lib/emergencyIncidentAuth";
import { incidentRepository } from "@/lib/emergencyIncidentRepository";
import { createIncidentService } from "@/lib/emergencyIncidentService";
import { BODY_LIMIT, IncidentError, listInput, requireActor } from "@/lib/emergencyIncidentRules";
import { logAuditEvent } from "@/lib/auditLogger";
import type { IncidentActor } from "@/types/emergencyIncident";

export const incidentService = createIncidentService(incidentRepository, async (action, id, actor) => {
  await logAuditEvent({ action, module: "Emergency Reports", target_type: "emergency_report", target_id: id,
    actor_user_id: actor.kind === "barangay" ? actor.userId : actor.residentId,
    actor_role: actor.kind === "barangay" ? "Barangay Admin" : "Resident", barangay_id: actor.barangayId,
    description: `Emergency report ${id}: ${action}.`,
  });
});
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };
export async function incidentRoute(request: NextRequest, operation: (actor: IncidentActor) => Promise<unknown>, status = 200) {
  try {
    const actor = await getIncidentActor(request);
    const data = await operation(actor);
    if (data instanceof Blob) {
      return new NextResponse(data, { headers: { ...headers, "Content-Type": data.type || "application/octet-stream", "Content-Disposition": "inline" } });
    }
    return NextResponse.json({ success: true, data }, { status, headers });
  } catch (error) {
    if (!(error instanceof IncidentError)) console.error("Emergency report request failed", { type: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ success: false, error: error instanceof IncidentError ? error.message : "Unable to process the emergency report." }, { status: error instanceof IncidentError ? error.status : 500, headers });
  }
}
async function boundedBody(request: NextRequest, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new IncidentError(400, "Request body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new IncidentError(413, "Request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function incidentJson(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new IncidentError(415, "Use application/json.");
  const bytes = await boundedBody(request, 16 * 1024);
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new IncidentError(400, "Invalid JSON body."); }
}
export async function incidentForm(request: NextRequest, actor: IncidentActor) {
  requireActor(actor, "resident");
  const type = request.headers.get("content-type") || "";
  if (!type.startsWith("multipart/form-data;")) throw new IncidentError(415, "Use multipart/form-data with photos.");
  const bytes = await boundedBody(request, BODY_LIMIT);
  try { return await new Response(bytes, { headers: { "Content-Type": type } }).formData(); }
  catch { throw new IncidentError(400, "Invalid multipart form."); }
}
export function listIncidentRequest(request: NextRequest) {
  return incidentRoute(request, actor => incidentService.list(actor, listInput(request.nextUrl.searchParams, actor)));
}
