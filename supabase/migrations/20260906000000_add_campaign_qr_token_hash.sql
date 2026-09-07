alter table public.emergency_allocation_batches
  add column if not exists qr_token_hash text;

create unique index if not exists emergency_allocation_batches_qr_token_hash_uidx
  on public.emergency_allocation_batches(qr_token_hash)
  where qr_token_hash is not null;
