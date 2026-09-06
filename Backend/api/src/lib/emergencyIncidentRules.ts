import { incidentStatuses, type IncidentActor, type IncidentStatus, type IncidentListQuery } from "@/types/emergencyIncident";

export class IncidentError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export const PHOTO_LIMIT = 2 * 1024 * 1024;
export const BODY_LIMIT = 5 * PHOTO_LIMIT + 128 * 1024;
export const INCIDENT_BUCKET = "emergency-report-images";
export function requireUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new IncidentError(400, "Invalid report ID.");
  }
  return value;
}
export function requireActor(actor: IncidentActor, kind: IncidentActor["kind"]) {
  if (actor.kind !== kind) throw new IncidentError(403, `Only ${kind} users may perform this action.`);
}
export function transition(actor: IncidentActor, current: IncidentStatus, next: IncidentStatus) {
  if (next === "resolved") requireActor(actor, "resident");
  else requireActor(actor, "barangay");
  if (!((current === "pending" && next === "en_route") ||
        (current === "en_route" && next === "arrived") ||
        (current === "arrived" && next === "resolved"))) {
    throw new IncidentError(409, "Invalid status transition. Refresh the report and try again.");
  }
}
export function textInput(value: unknown, name: string, max: number, required = false): string | null {
  if (value == null && !required) return null;
  if (typeof value !== "string" || value.length > max || value.includes("\0")) {
    throw new IncidentError(400, `${name} must be text of at most ${max} characters.`);
  }
  const text = value.trim();
  if (required && !text) throw new IncidentError(400, `${name} is required.`);
  return text || null;
}
export function strictObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) {
    throw new IncidentError(400, "Unexpected request fields.");
  }
  return value as Record<string, unknown>;
}
export function feedbackInput(value: unknown) {
  const body = strictObject(value, ["confirmed", "feedback", "rating"]);
  if (body.confirmed !== true) throw new IncidentError(400, "Explicit resident confirmation is required.");
  if (body.rating !== undefined && (!Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5)) {
    throw new IncidentError(400, "Rating must be an integer from 1 to 5.");
  }
  return { resident_confirmed: true, feedback: textInput(body.feedback, "Feedback", 2000), rating: body.rating === undefined ? null : Number(body.rating) };
}
export function listInput(params: URLSearchParams, actor: IncidentActor): IncidentListQuery {
  for (const key of params.keys()) {
    if (!["status", "search", "page", "limit", "barangay_id"].includes(key) || params.getAll(key).length > 1) {
      throw new IncidentError(400, "Unexpected or duplicate query parameter.");
    }
  }
  const requestedBarangay = params.get("barangay_id");
  if (requestedBarangay !== null && requestedBarangay !== String(actor.barangayId)) {
    throw new IncidentError(403, "You cannot query another barangay.");
  }
  const status = params.get("status") || undefined;
  if (status && status !== "active" && !incidentStatuses.includes(status as IncidentStatus)) {
    throw new IncidentError(400, "Invalid status filter.");
  }
  const integer = (name: string, fallback: number, max: number) => {
    const value = params.get(name);
    if (value === null) return fallback;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > max) throw new IncidentError(400, `Invalid ${name}.`);
    return Number(value);
  };
  return { status: status as IncidentListQuery["status"], search: textInput(params.get("search"), "Search", 100) || "", page: integer("page", 1, 100000), limit: integer("limit", 7, 50) };
}

export async function validatePhotos(files: File[]) {
  if (files.length < 1 || files.length > 5) throw new IncidentError(400, "Provide 1–5 photos.");
  const photos: { bytes: Uint8Array; type: string; extension: string }[] = [];
  for (const file of files) {
    if (file.size < 1 || file.size > PHOTO_LIMIT) throw new IncidentError(400, "Each photo must be nonempty and at most 2 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const signature = (start: number, values: number[]) => values.every((v, i) => bytes[start + i] === v);
    const jpeg = signature(0, [255, 216, 255]);
    const png = signature(0, [137, 80, 78, 71, 13, 10, 26, 10]);
    const webp = signature(0, [82, 73, 70, 70]) && signature(8, [87, 69, 66, 80]);
    const detected = jpeg ? ["image/jpeg", "jpg"] : png ? ["image/png", "png"] : webp ? ["image/webp", "webp"] : null;
    if (!detected || file.type !== detected[0]) throw new IncidentError(400, "Photos must be JPEG, PNG, or WebP with matching file content.");
    photos.push({ bytes, type: detected[0], extension: detected[1] });
  }
  return photos;
}
export function safePhotoPath(path: string, residentId: string, reportId: string) {
  const prefix = `${residentId}/${reportId}/`;
  return path.startsWith(prefix) && /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i.test(path.slice(prefix.length));
}
