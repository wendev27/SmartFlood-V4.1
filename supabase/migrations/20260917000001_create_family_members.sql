-- Additive authoritative household-member storage.
-- This migration intentionally creates schema only; it does not backfill data.

CREATE TABLE IF NOT EXISTS public.family_members (
  member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL
    REFERENCES public.families(family_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  resident_id uuid NULL
    REFERENCES public.residents_v3(resident_id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  source_application_id uuid NULL
    REFERENCES public.resident_applications(application_id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,
  full_name text NOT NULL,
  birth_date date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_members_family_id_idx
  ON public.family_members(family_id);

CREATE INDEX IF NOT EXISTS family_members_source_application_id_idx
  ON public.family_members(source_application_id)
  WHERE source_application_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS family_members_resident_id_uidx
  ON public.family_members(resident_id)
  WHERE resident_id IS NOT NULL;

-- Household DOBs are sensitive. The application server already authenticates
-- dashboard viewers and enforces barangay scope before using service_role.
-- Direct anon/authenticated table access remains denied.
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.family_members FROM public, anon, authenticated;
GRANT ALL ON TABLE public.family_members TO service_role;

CREATE POLICY family_members_service_role_only
  ON public.family_members
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
