alter table public.emergency_allocation_batches
  add column if not exists qr_token_encrypted text;
