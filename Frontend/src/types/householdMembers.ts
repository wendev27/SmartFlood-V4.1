export interface StructuredHouseholdMember {
  member_id: string;
  family_id?: string;
  full_name: string;
  birth_date: string | null;
  resident_id: string | null;
  source_application_id?: string | null;
  is_pwd: boolean;
  is_pregnant: boolean;
  pregnancy_weeks: number | null;
  pregnancy_baseline_at?: string | null;
  current_pregnancy_weeks?: number | null;
  is_lactating: boolean;
  is_4ps: boolean;
  current_age?: number | null;
  age_source?: "birth_date" | "unavailable";
  classification?: string;
}
