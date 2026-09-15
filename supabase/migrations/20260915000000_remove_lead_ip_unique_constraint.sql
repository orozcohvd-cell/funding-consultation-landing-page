-- Keep the hashed IP for operational diagnostics, but allow multiple leads
-- from the same network, such as shared households or mobile carrier NATs.
alter table public.leads
  drop constraint if exists leads_client_ip_hash_key;

create index if not exists leads_client_ip_hash_idx
  on public.leads (client_ip_hash);
