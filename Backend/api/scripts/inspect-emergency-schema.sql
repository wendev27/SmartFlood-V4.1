-- Read-only catalog inspection. Run through a trusted SQL connection before deployment.
select table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where (table_schema = 'public' and table_name in ('emergency_reports','residents_v3','barangays','user_profiles_v3'))
order by table_schema, table_name, ordinal_position;
select conrelid::regclass as relation, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in ('public.emergency_reports'::regclass,'public.residents_v3'::regclass);
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname='public' and c.relname in ('emergency_reports','residents_v3'))
   or (n.nspname='storage' and c.relname='objects');
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where (schemaname='public' and tablename in ('emergency_reports','residents_v3'))
or (schemaname='storage' and tablename='objects');
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid='public.emergency_reports'::regclass and not tgisinternal;
select n.nspname, t.typname, e.enumlabel from pg_type t
join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid
where t.typname ilike '%emergency%' order by t.typname, e.enumsortorder;
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='emergency-report-images';
