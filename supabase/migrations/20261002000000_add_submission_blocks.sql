create table if not exists public.submission_blocks (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (char_length(trim(phone)) between 6 and 32),
  reason text not null default '專員手動屏蔽',
  source_lead_id uuid references public.leads(id) on delete set null,
  blocked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists submission_blocks_created_at_idx on public.submission_blocks (created_at desc);

alter table public.submission_blocks enable row level security;
revoke all on table public.submission_blocks from anon, authenticated;

drop trigger if exists submission_blocks_set_updated_at on public.submission_blocks;
create or replace function public.set_submission_block_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger submission_blocks_set_updated_at
before update on public.submission_blocks
for each row execute function public.set_submission_block_updated_at();
