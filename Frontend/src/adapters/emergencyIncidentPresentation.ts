import type { EmergencyIncident, IncidentStatus } from "@/types/emergencyIncident";
import type { EmergencyReportStatus, EmergencyReportViewModel } from "@/components/emergency/EmergencyReportPanel/EmergencyReportPanel";
const labels: Record<IncidentStatus, EmergencyReportStatus> = { pending: "Pending", en_route: "En Route", arrived: "Arrived", resolved: "Resolved" };
export const incidentStatusForLabel: Record<EmergencyReportStatus, IncidentStatus> = { Pending: "pending", "En Route": "en_route", Arrived: "arrived", Resolved: "resolved" };
function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
export function incidentPresentation(row: EmergencyIncident): EmergencyReportViewModel {
  return {
    id: row.id, residentName: row.resident.name || null, location: row.location, phone: row.resident.phone,
    submittedAtLabel: dateLabel(row.created_at), description: row.description, status: labels[row.status],
    photos: row.image_paths.map((path, index) => ({ id: path, url: `/api/emergency-reports/${encodeURIComponent(row.id)}/photos/${index}`, description: `Emergency report photo ${index + 1}` })),
    residentConfirmation: row.resident_confirmed === true ? { message: row.feedback, confirmedAtLabel: dateLabel(row.resolved_at) } : null,
  };
}
