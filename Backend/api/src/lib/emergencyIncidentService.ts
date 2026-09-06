import { randomUUID } from "node:crypto";
import type { IncidentActor, IncidentListQuery, IncidentStatus } from "@/types/emergencyIncident";
import type { IncidentRepository } from "@/lib/emergencyIncidentRepository";
import { feedbackInput, IncidentError, requireActor, requireUuid, safePhotoPath, strictObject, textInput, transition, validatePhotos } from "@/lib/emergencyIncidentRules";

/** All reads/writes are scoped in the repository, including compare-and-set writes. */
export function createIncidentService(repo: IncidentRepository, audit: (action: string, id: string, actor: IncidentActor) => Promise<void>) {
  const detail = async (actor: IncidentActor, id: string) => {
    requireUuid(id);
    const report = await repo.get(id, actor);
    if (!report) throw new IncidentError(404, "Emergency report was not found.");
    return report;
  };
  const update = async (actor: IncidentActor, id: string, next: IncidentStatus, extra = {}) => {
    const current = await detail(actor, id);
    transition(actor, current.status, next);
    const timestamp = next === "en_route" ? "en_route_at" : next === "arrived" ? "arrived_at" : "resolved_at";
    const updated = await repo.update(id, actor, current.status, { status: next, [timestamp]: new Date().toISOString(), ...extra });
    if (!updated) throw new IncidentError(409, "The report has changed. Refresh and try again.");
    await audit(`EMERGENCY_REPORT_${next.toUpperCase()}`, id, actor);
    return updated;
  };
  return {
    detail,
    list: (actor: IncidentActor, query: IncidentListQuery) => repo.list(actor, query),
    async create(actor: IncidentActor, form: FormData) {
      requireActor(actor, "resident");
      if (actor.kind !== "resident") throw new IncidentError(403, "Resident access required.");
      for (const key of form.keys()) if (!["location", "description", "photos"].includes(key)) throw new IncidentError(400, "Unexpected form fields.");
      if (form.getAll("location").length !== 1 || form.getAll("description").length > 1) throw new IncidentError(400, "Invalid form fields.");
      const location = textInput(form.get("location"), "Location", 300, true)!;
      if (location.length < 3) throw new IncidentError(400, "Location must contain at least 3 characters.");
      const description = textInput(form.get("description"), "Description", 2000);
      const entries = form.getAll("photos");
      if (entries.some(value => typeof value === "string")) throw new IncidentError(400, "Photos must be uploaded files.");
      const photos = await validatePhotos(entries as File[]);
      // Recheck the current registry assignment rather than accepting request or stale token values.
      const resident = await repo.resident(actor.residentId);
      if (!resident || resident.status !== "active" || !Number.isSafeInteger(resident.barangay_id) || resident.barangay_id < 1) {
        throw new IncidentError(403, "An active resident with an assigned barangay is required.");
      }
      const id = randomUUID();
      const paths: string[] = [];
      let report;
      try {
        for (const photo of photos) {
          const path = `${resident.resident_id}/${id}/${randomUUID()}.${photo.extension}`;
          // Include attempted uploads in cleanup: a timeout may occur after Storage persists a file.
          paths.push(path);
          await repo.upload(path, photo.bytes, photo.type);
        }
        report = await repo.insert({ id, user_id: resident.resident_id, barangay_id: resident.barangay_id, location, description, image_paths: paths, status: "pending" });
      } catch (error) {
        // An insert may have committed despite a lost HTTP response. Never delete its photos.
        let committed;
        try { committed = await repo.get(id, actor); }
        catch { throw new IncidentError(503, "Submission outcome is unknown. Check your reports before retrying."); }
        if (committed) return committed;
        try { await repo.remove(paths); }
        catch { console.error("Emergency report upload cleanup failed", { reportId: id }); }
        throw error;
      }
      await audit("EMERGENCY_REPORT_CREATED", id, actor);
      return report;
    },
    async changeStatus(actor: IncidentActor, id: string, body: unknown) {
      requireActor(actor, "barangay");
      const input = strictObject(body, ["status"]);
      if (input.status !== "en_route" && input.status !== "arrived") throw new IncidentError(400, "Barangay status must be en_route or arrived.");
      return update(actor, id, input.status);
    },
    async resolve(actor: IncidentActor, id: string, body: unknown) {
      requireActor(actor, "resident");
      return update(actor, id, "resolved", feedbackInput(body));
    },
    async photo(actor: IncidentActor, id: string, index: string) {
      const report = await detail(actor, id);
      if (!/^[0-4]$/.test(index)) throw new IncidentError(404, "Report photo was not found.");
      const path = report.image_paths[Number(index)];
      if (!path || !safePhotoPath(path, report.user_id, report.id)) throw new IncidentError(404, "Report photo was not found.");
      return repo.download(path);
    },
  };
}
