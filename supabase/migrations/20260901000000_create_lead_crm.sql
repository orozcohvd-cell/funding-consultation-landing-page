create extension if not exists pgcrypto;

do $$
begin
  create type public.lead_status as enum ('new', 'line_redirected', 'contacted', 'qualified', 'won', 'lost');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  consent_at timestamptz not null default now(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  age smallint not null check (age between 18 and 120),
  phone text not null check (char_length(trim(phone)) between 6 and 32),
  requested_amount text not null check (requested_amount in ('10萬-30萬', '30萬-80萬', '80萬-180萬', '180萬-300萬')),
  warning_account boolean not null,
  status public.lead_status not null default 'new',
  status_updated_at timestamptz not null default now(),
  line_redirected_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  staff_notes text,
  tiktok_click_id text,
  browser_event_id uuid,
  client_ip_hash text not null unique,
  source_url text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.lead_status_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  created_at timestamptz not null default now(),
  previous_status public.lead_status,
  next_status public.lead_status not null,
  changed_by uuid references auth.users(id) on delete set null,
  notes text,
  tiktok_event_name text,
  tiktok_event_id uuid,
  tiktok_delivery_status text not null default 'pending' check (tiktok_delivery_status in ('pending', 'sent', 'failed', 'skipped')),
  tiktok_response jsonb
);

create table if not exists public.crm_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'specialist' check (role in ('admin', 'specialist')),
  created_at timestamptz not null default now()
);

create index if not exists leads_status_created_at_idx on public.leads (status, created_at desc);
create index if not exists lead_status_events_lead_created_at_idx on public.lead_status_events (lead_id, created_at desc);

create or replace function public.set_lead_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at before update on public.leads for each row execute function public.set_lead_updated_at();

alter table public.leads enable row level security;
alter table public.lead_status_events enable row level security;
alter table public.crm_staff enable row level security;

revoke all on table public.leads from anon, authenticated;
revoke all on table public.lead_status_events from anon, authenticated;
revoke all on table public.crm_staff from anon, authenticated;
