/** Resident incidents, separate from the existing emergency relief contracts. */
export const incidentStatuses = ["pending", "en_route", "arrived", "resolved"] as const;
export type IncidentStatus = typeof incidentStatuses[number];
export type IncidentActor =
  | { kind: "resident"; residentId: string; barangayId: number }
  | { kind: "barangay"; userId: string; barangayId: number };

export interface EmergencyIncident {
  id: string;
  user_id: string;
  barangay_id: number;
  location: string;
  description: string | null;
  image_paths: string[];
  status: IncidentStatus;
  created_at: string;
  updated_at: string;
  en_route_at: string | null;
  arrived_at: string | null;
  resolved_at: string | null;
  resident_confirmed: boolean | null;
  feedback: string | null;
  rating: number | null;
  resident: { resident_id: string; name: string; phone: string | null };
}

export interface IncidentListQuery {
  status?: IncidentStatus | "active";
  search: string;
  page: number;
  limit: number;
}
export interface IncidentList {
  reports: EmergencyIncident[];
  counts: Record<IncidentStatus, number>;
  pagination: { page: number; limit: number; total: number; total_pages: number };
}
export interface IncidentStatusRequest { status: "en_route" | "arrived" }
export interface IncidentFeedbackRequest { confirmed: true; feedback?: string | null; rating?: number }
export type IncidentResponse<T> = { success: true; data: T } | { success: false; error: string };
