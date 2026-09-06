-- Extends the table/bucket verified through the live Supabase REST/Storage APIs.
-- Review Backend/api/docs/EMERGENCY_REPORTS.md and run the catalog inspection first.
-- No new identity, report table, history table, or bucket is created.
begin;

do $$
begin
  if to_regclass('public.emergency_reports') is null then
    raise exception 'Existing emergency_reports table is required; inspect the deployment before proceeding';
  end if;
  if not exists (select 1 from storage.buckets where id = 'emergency-report-images'
    and public = false and file_size_limit <= 2097152
    and allowed_mime_types <@ array['image/jpeg','image/png','image/webp']::text[]) then
    raise exception 'Expected private emergency-report-images bucket restrictions were not found';
  end if;
  if exists (select 1 from public.emergency_reports e left join public.residents_v3 r on r.resident_id = e.user_id
      where r.resident_id is null or r.barangay_id is null) then
    raise exception 'Existing reports require valid resident/barangay relationships before migration';
  end if;
  if exists (select 1 from public.emergency_reports
      where lower(replace(status, ' ', '_')) not in ('pending','en_route','arrived','resolved')) then
    raise exception 'Unknown existing emergency status; review rather than silently rewriting it';
  end if;
  -- Do not silently remove unknown checks or triggers from a live mobile workflow.
  if exists (select 1 from pg_constraint where conrelid = 'public.emergency_reports'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%') then
    raise exception 'Review existing emergency status constraints and reconcile this migration before applying';
  end if;
end $$;

alter table public.emergency_reports
  add column barangay_id bigint references public.barangays(barangay_id) on delete restrict,
  add column en_route_at timestamptz,
  add column arrived_at timestamptz,
  add column resolved_at timestamptz,
  add column resident_confirmed boolean not null default false,
  add column feedback text,
  add column rating smallint;

update public.emergency_reports e
set barangay_id = r.barangay_id, status = lower(replace(e.status, ' ', '_'))
from public.residents_v3 r where r.resident_id = e.user_id;

-- Historical arrival/en-route times are unknown; do not manufacture them.
-- Existing resolved rows require a reviewed backfill of real confirmation data.
do $$ begin
  if exists (select 1 from public.emergency_reports where status = 'resolved') then
    raise exception 'Existing resolved reports require a reviewed confirmation/timestamp backfill';
  end if;
end $$;

alter table public.emergency_reports
  alter column barangay_id set not null,
  alter column status set default 'pending',
  add constraint emergency_incident_status_check check (status in ('pending','en_route','arrived','resolved')),
  add constraint emergency_incident_rating_check check (rating between 1 and 5),
  add constraint emergency_incident_feedback_check check (feedback is null or char_length(feedback) <= 2000),
  add constraint emergency_incident_resolution_check check (
    (status = 'resolved' and resident_confirmed and resolved_at is not null)
    or (status <> 'resolved' and not resident_confirmed and resolved_at is null and feedback is null and rating is null)
  );

create function public.guard_emergency_incident()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare resident_barangay bigint; resident_status text; image_path text;
begin
  if tg_op = 'INSERT' then
    select barangay_id, status into resident_barangay, resident_status
      from public.residents_v3 where resident_id = new.user_id;
    if resident_barangay is null or resident_status is distinct from 'active'
        or new.barangay_id is distinct from resident_barangay then
      raise exception 'Active resident and matching barangay required' using errcode = '23514';
    end if;
    if new.status is distinct from 'pending' or new.resident_confirmed
       or new.en_route_at is not null or new.arrived_at is not null or new.resolved_at is not null
       or new.feedback is not null or new.rating is not null then
      raise exception 'Reports must start pending without lifecycle metadata' using errcode = '23514';
    end if;
    if new.location is null or char_length(btrim(new.location)) not between 1 and 1000
       or char_length(new.description) > 4000 or cardinality(new.image_paths) not between 1 and 5 then
      raise exception 'Invalid report content' using errcode = '23514';
    end if;
    foreach image_path in array new.image_paths loop
      if image_path is null or image_path !~ ('^' || new.user_id::text || '/' || new.id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then
        raise exception 'Invalid report image path' using errcode = '23514';
      end if;
    end loop;
    if cardinality(new.image_paths) <> (select count(distinct p) from unnest(new.image_paths) p) then
      raise exception 'Duplicate report image paths' using errcode = '23514';
    end if;
    new.created_at := now();
  else
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id
       or new.barangay_id is distinct from old.barangay_id or new.image_paths is distinct from old.image_paths
       or new.created_at is distinct from old.created_at or new.location is distinct from old.location
       or new.description is distinct from old.description then
      raise exception 'Report identity and submission fields are immutable' using errcode = '23514';
    end if;
    if old.status = 'pending' and new.status = 'en_route' then
      new.en_route_at := now();
      new.arrived_at := old.arrived_at;
      new.resolved_at := old.resolved_at;
    elsif old.status = 'en_route' and new.status = 'arrived' then
      new.en_route_at := old.en_route_at;
      new.arrived_at := now();
      new.resolved_at := old.resolved_at;
    elsif old.status = 'arrived' and new.status = 'resolved' and new.resident_confirmed then
      new.en_route_at := old.en_route_at;
      new.arrived_at := old.arrived_at;
      new.resolved_at := now();
    else
      raise exception 'Invalid emergency report transition' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_emergency_incident before insert or update on public.emergency_reports
for each row execute function public.guard_emergency_incident();

create index emergency_incident_barangay_status_created_idx on public.emergency_reports(barangay_id, status, created_at desc, id desc);
create index emergency_incident_resident_created_idx on public.emergency_reports(user_id, created_at desc, id desc);

-- The API is the authorization boundary. Dashboard HMAC cookies are not Supabase JWTs.
-- A restrictive policy prevents unknown permissive policies from reopening direct access.
alter table public.emergency_reports enable row level security;
revoke all on public.emergency_reports from public, anon, authenticated;
grant select, insert, update on public.emergency_reports to service_role;
create policy emergency_incident_api_only on public.emergency_reports as restrictive
for all to anon, authenticated using (false) with check (false);
create policy emergency_incident_private_images on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'emergency-report-images') with check (bucket_id <> 'emergency-report-images');

-- One snapshot for filtered reports, totals and counts. Resident information is joined,
-- never copied onto the incident. Counts apply to search/scope, independent of the tab.
create function public.list_emergency_incidents(
  p_resident_id uuid, p_barangay_id bigint, p_status text default null,
  p_search text default '', p_page integer default 1, p_limit integer default 7
) returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if (p_resident_id is null) = (p_barangay_id is null) or p_page not between 1 and 100000
     or p_limit not between 1 and 50 or p_page is null or p_limit is null or p_search is null
     or char_length(p_search) > 100 or (p_status is not null and p_status not in ('active','pending','en_route','arrived','resolved')) then
    raise exception 'Invalid emergency report query' using errcode = '22023';
  end if;
  with scoped as materialized (
    select e.id, e.user_id, e.barangay_id, e.location, e.description, e.image_paths,
      e.status, e.created_at, e.updated_at, e.en_route_at, e.arrived_at, e.resolved_at,
      e.resident_confirmed, e.feedback, e.rating, jsonb_build_object('resident_id', r.resident_id,
      'name', concat_ws(' ', r.first_name, r.middle_name, r.last_name, r.suffix),
      'phone', r.contact_number) as resident
    from public.emergency_reports e join public.residents_v3 r on r.resident_id = e.user_id
    where (p_resident_id is null or e.user_id = p_resident_id)
      and (p_barangay_id is null or e.barangay_id = p_barangay_id)
      and (p_search = '' or strpos(lower(concat_ws(' ', e.id::text, e.location, e.description,
        r.first_name, r.middle_name, r.last_name, r.suffix, r.contact_number)), lower(p_search)) > 0)
  ), filtered as (
    select * from scoped where p_status is null or (p_status = 'active' and status <> 'resolved') or status = p_status
  ), paged as (
    select * from filtered order by created_at desc, id desc offset (p_page - 1) * p_limit limit p_limit
  ) select jsonb_build_object(
    'reports', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc) from paged p), '[]'::jsonb),
    'counts', (select jsonb_build_object('pending', count(*) filter (where status = 'pending'),
      'en_route', count(*) filter (where status = 'en_route'), 'arrived', count(*) filter (where status = 'arrived'),
      'resolved', count(*) filter (where status = 'resolved')) from scoped),
    'pagination', jsonb_build_object('page', p_page, 'limit', p_limit, 'total', (select count(*) from filtered),
      'total_pages', (select ceil(count(*)::numeric / p_limit)::integer from filtered))
  ) into result;
  return result;
end $$;
revoke all on function public.list_emergency_incidents(uuid,bigint,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.list_emergency_incidents(uuid,bigint,text,text,integer,integer) to service_role;
revoke all on function public.guard_emergency_incident() from public, anon, authenticated;
commit;
