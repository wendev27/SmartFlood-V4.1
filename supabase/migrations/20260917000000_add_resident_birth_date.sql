-- Preserve resident DOB independently of the legacy, point-in-time age value.
ALTER TABLE public.residents_v3
  ADD COLUMN IF NOT EXISTS birth_date date;

-- Backfill only rows with an exact application relationship, an approved
-- application status, and a non-null source DOB. All other rows remain NULL.
UPDATE public.residents_v3 AS resident
SET birth_date = application.birth_date::date
FROM public.resident_applications AS application
WHERE resident.birth_date IS NULL
  AND resident.application_id IS NOT NULL
  AND application.application_id = resident.application_id
  AND lower(coalesce(application.status::text, '')) = 'approved'
  AND application.birth_date IS NOT NULL;
