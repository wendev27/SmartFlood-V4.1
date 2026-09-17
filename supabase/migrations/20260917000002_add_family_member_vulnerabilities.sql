-- Extend authoritative household members with explicit non-age vulnerabilities.
-- Existing rows retain their identity and DOB data; new flags default to false
-- and pregnancy weeks remain unknown. No legacy application arrays are backfilled.

ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS is_pwd boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pregnant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pregnancy_weeks smallint NULL,
  ADD COLUMN IF NOT EXISTS is_lactating boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_4ps boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'family_members_pregnancy_weeks_check'
      AND conrelid = 'public.family_members'::regclass
  ) THEN
    ALTER TABLE public.family_members
      ADD CONSTRAINT family_members_pregnancy_weeks_check
      CHECK (
        (NOT is_pregnant AND pregnancy_weeks IS NULL)
        OR (is_pregnant AND (pregnancy_weeks IS NULL OR pregnancy_weeks BETWEEN 0 AND 42))
      );
  END IF;
END
$$;

-- Structured members must survive from application submission until approval.
-- This JSON snapshot is server-validated; trusted family/application provenance
-- is still assigned by the approval route.
ALTER TABLE public.resident_applications
  ADD COLUMN IF NOT EXISTS household_members jsonb NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'resident_applications_household_members_array_check'
      AND conrelid = 'public.resident_applications'::regclass
  ) THEN
    ALTER TABLE public.resident_applications
      ADD CONSTRAINT resident_applications_household_members_array_check
      CHECK (household_members IS NULL OR jsonb_typeof(household_members) = 'array');
  END IF;
END
$$;
