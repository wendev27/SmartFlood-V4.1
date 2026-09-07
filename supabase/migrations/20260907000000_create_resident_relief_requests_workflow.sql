-- Resident relief requests are created by the mobile application.
-- This migration only adds web endorsement/review metadata; it is not applied
-- automatically by the application.

alter table if exists public.relief_requests
  add column if not exists endorsed_by uuid null references public.app_users(id) on update restrict on delete restrict,
  add column if not exists endorsed_at timestamptz null,
  add column if not exists reviewed_by uuid null references public.app_users(id) on update restrict on delete restrict,
  add column if not exists reviewed_at timestamptz null,
  add column if not exists rejection_feedback text null,
  add column if not exists release_date date null,
  add column if not exists release_time time null,
  add column if not exists release_details text null;

do $$
begin
  if to_regclass('public.relief_requests') is not null
    and not exists (
      select 1 from pg_constraint
      where conrelid = 'public.relief_requests'::regclass
        and conname = 'relief_requests_workflow_status_check'
    ) then
    alter table public.relief_requests
      add constraint relief_requests_workflow_status_check
      check (status in ('Pending', 'Endorsed', 'Approved', 'Rejected', 'Completed'));
  end if;
end;
$$;

create index if not exists relief_requests_status_created_at_idx
  on public.relief_requests (status, created_at desc);

create index if not exists relief_requests_endorsed_at_idx
  on public.relief_requests (endorsed_at desc)
  where status in ('Endorsed', 'Approved', 'Rejected');

create index if not exists relief_requests_reviewed_at_idx
  on public.relief_requests (reviewed_at desc)
  where reviewed_at is not null;
