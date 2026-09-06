/** API incident model; database On Scene maps to arrived for presentation. */
export type IncidentStatus = "pending" | "en_route" | "arrived" | "resolved";
export interface EmergencyIncident {
  id: string; user_id: string; barangay_id: number;
  location: string; description: string | null; image_paths: string[];
  status: IncidentStatus; created_at: string; updated_at: string;
  en_route_at: string | null; arrived_at: string | null; resolved_at: string | null;
  resident_confirmed: boolean | null; feedback: string | null; rating: number | null;
  resident: { resident_id: string; name: string; phone: string | null };
}
export interface IncidentList {
  reports: EmergencyIncident[];
  counts: Record<IncidentStatus, number>;
  pagination: { page: number; limit: number; total: number; total_pages: number };
}
