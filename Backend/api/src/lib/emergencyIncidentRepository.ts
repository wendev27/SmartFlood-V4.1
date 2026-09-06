import { supabaseServer } from "@/lib/supabaseServer";
import { INCIDENT_BUCKET, IncidentError } from "@/lib/emergencyIncidentRules";
import type { EmergencyIncident, IncidentActor, IncidentList, IncidentListQuery, IncidentStatus } from "@/types/emergencyIncident";

export type IncidentInsert = Pick<EmergencyIncident, "id" | "user_id" | "barangay_id" | "location" | "description" | "image_paths"> & { status: "pending" };
export type IncidentChange = Partial<Pick<EmergencyIncident, "status" | "en_route_at" | "arrived_at" | "resolved_at" | "resident_confirmed" | "feedback" | "rating">>;
export interface IncidentRepository {
  resident(id: string): Promise<{ resident_id: string; barangay_id: number; status: string } | null>;
  insert(row: IncidentInsert): Promise<EmergencyIncident>;
  get(id: string, actor: IncidentActor): Promise<EmergencyIncident | null>;
  update(id: string, actor: IncidentActor, expected: IncidentStatus, change: IncidentChange): Promise<EmergencyIncident | null>;
  list(actor: IncidentActor, query: IncidentListQuery): Promise<IncidentList>;
  upload(path: string, bytes: Uint8Array, type: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  download(path: string): Promise<Blob>;
}
const columns = "id,user_id,location,description,image_paths,status,created_at,updated_at,resident:residents_v3!inner(resident_id,barangay_id,first_name,middle_name,last_name,suffix,contact_number)";
const storedStatus: Record<IncidentStatus, string> = { pending: "Pending", en_route: "En Route", arrived: "On Scene", resolved: "Resolved" };
// Persist the existing database label; the UI continues to display Arrived.
const apiStatus: Record<string, IncidentStatus> = {
  ...Object.fromEntries(Object.entries(storedStatus).map(([key, value]) => [value, key])) as Record<string, IncidentStatus>,
  "Arrived": "arrived",
};
function failure(error: unknown) {
  if (error) throw new IncidentError(503, "Emergency report data is temporarily unavailable.");
}
function scope(query: any, actor: IncidentActor) {
  return actor.kind === "resident" ? query.eq("user_id", actor.residentId) : query.eq("resident.barangay_id", actor.barangayId);
}
export function mapIncident(row: any): EmergencyIncident {
  const person = row.resident;
  if (!person || Array.isArray(person) || !apiStatus[row.status]) throw new IncidentError(503, "The report could not be loaded.");
  return {
    id: row.id, user_id: row.user_id, barangay_id: person.barangay_id,
    location: row.location, description: row.description, image_paths: row.image_paths,
    status: apiStatus[row.status], created_at: row.created_at, updated_at: row.updated_at,
    // These fields do not exist in the supplied schema. Never infer confirmation from status.
    en_route_at: null, arrived_at: null, resolved_at: null, resident_confirmed: null, feedback: null, rating: null,
    resident: { resident_id: person.resident_id,
      name: [person.first_name, person.middle_name, person.last_name, person.suffix].filter(Boolean).join(" "),
      phone: person.contact_number ?? null },
  };
}
export function createIncidentRepository(client: typeof supabaseServer): IncidentRepository {
  const scoped = (actor: IncidentActor) => scope(client.from("emergency_reports").select(columns)
    .in("status", Object.keys(apiStatus)), actor);
  return {
    async resident(id) {
      const { data, error } = await client.from("residents_v3").select("resident_id,barangay_id,status").eq("resident_id", id).maybeSingle();
      failure(error); return data;
    },
    async insert(row) {
      const { barangay_id: _derivedBarangay, ...submission } = row;
      const { data, error } = await client.from("emergency_reports").insert({ ...submission, status: "Pending" }).select(columns).single();
      failure(error); return mapIncident(data);
    },
    async get(id, actor) {
      const { data, error } = await scoped(actor).eq("id", id).maybeSingle();
      failure(error); return data ? mapIncident(data) : null;
    },
    async update(id, actor, expected, change) {
      if (change.status === "resolved" || change.feedback !== undefined || change.resident_confirmed !== undefined || change.rating !== undefined) {
        throw new IncidentError(503, "Resident confirmation and feedback persistence are not configured.");
      }
      // A PostgREST embedded filter affects returned rows, not the UPDATE target.
      // Resolve the scoped row first, then predicate the write on its resident and prior status.
      const current = await this.get(id, actor);
      if (!current) return null;
      const { data, error } = await client.from("emergency_reports")
        .update({ status: storedStatus[change.status!], updated_at: new Date().toISOString() })
        .eq("id", id).eq("user_id", current.user_id).eq("status", storedStatus[expected])
        .select(columns).maybeSingle();
      failure(error); return data ? mapIncident(data) : null;
    },
    async list(actor, query) {
      // No new RPC/schema dependency. Fetch only server-scoped rows in bounded pages;
      // search/count/pagination operate on the complete scoped result, never a truncated first page.
      const reports: EmergencyIncident[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await scoped(actor).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 499);
        failure(error);
        reports.push(...data.map(mapIncident));
        if (data.length < 500) break;
      }
      const search = query.search.toLocaleLowerCase();
      const matches = reports.filter(r => [r.id, r.location, r.description, r.resident.name, r.resident.phone].filter(Boolean).join(" ").toLocaleLowerCase().includes(search));
      const counts = { pending: 0, en_route: 0, arrived: 0, resolved: 0 };
      for (const report of matches) counts[report.status]++;
      const filtered = matches.filter(r => !query.status || (query.status === "active" ? r.status !== "resolved" : r.status === query.status));
      return { reports: filtered.slice((query.page - 1) * query.limit, query.page * query.limit), counts,
        pagination: { page: query.page, limit: query.limit, total: filtered.length, total_pages: Math.ceil(filtered.length / query.limit) } };
    },
    async upload(path, bytes, type) {
      const { error } = await client.storage.from(INCIDENT_BUCKET).upload(path, bytes, { contentType: type, upsert: false }); failure(error);
    },
    async remove(paths) {
      if (!paths.length) return;
      const { error } = await client.storage.from(INCIDENT_BUCKET).remove(paths); failure(error);
    },
    async download(path) {
      const { data, error } = await client.storage.from(INCIDENT_BUCKET).download(path);
      if (error || !data) throw new IncidentError(404, "Report photo is unavailable."); return data;
    },
  };
}
export const incidentRepository = createIncidentRepository(supabaseServer);
