-- TastePassport fresh app-data setup. Run ONCE in your Supabase SQL Editor.
-- DESTRUCTIVE: deletes saved Passports, saved plans, taste profiles and active sessions.
-- Auth users and existing destinations (including custom entries and ordering) remain.
-- This is a manual operator action. Never run it during a build or deployment.
begin;

drop table if exists public.active_passport_sessions;
drop table if exists public.saved_plans;
drop table if exists public.taste_profiles;
drop table if exists public.saved_passports;

-- Keep the existing catalogue. New projects receive editable starter destinations.
create table if not exists public.destinations (
  name text primary key,
  enabled boolean not null default true,
  sort_order integer not null default 100
);
alter table public.destinations drop constraint if exists destinations_name_check;
alter table public.destinations enable row level security;
revoke all on public.destinations from anon, authenticated;
grant select on public.destinations to anon, authenticated;
grant all on public.destinations to service_role;
drop policy if exists destinations_public_read on public.destinations;
create policy destinations_public_read on public.destinations
  for select to anon, authenticated using (enabled = true);
insert into public.destinations (name, sort_order) values
  ('Toronto', 1), ('New York City', 2), ('London', 3), ('Paris', 4), ('Tokyo', 5),
  ('Bengaluru', 6), ('Mumbai', 7), ('Singapore', 8), ('Berlin', 9), ('Sydney', 10)
on conflict (name) do nothing;

-- Server verifies each user and writes trusted snapshots; browsers can only
-- read or delete their own rows. City is free text, not a fixed allowlist.
create table public.saved_passports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  city text not null,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, city)
);
create index saved_passports_user_updated_idx on public.saved_passports (user_id, updated_at desc);
alter table public.saved_passports enable row level security;
revoke all on public.saved_passports from anon, authenticated;
grant select, delete on public.saved_passports to authenticated;
grant all on public.saved_passports to service_role;
create policy saved_passports_read_own on public.saved_passports
  for select to authenticated using ((select auth.uid()) = user_id);
create policy saved_passports_delete_own on public.saved_passports
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.saved_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  city text not null,
  scheduled_date date not null,
  time_zone text not null,
  stops jsonb not null,
  stop_times text[],
  created_at timestamptz not null default now(),
  unique (user_id, city, scheduled_date)
);
create index saved_plans_user_date_idx on public.saved_plans (user_id, scheduled_date);
alter table public.saved_plans enable row level security;
revoke all on public.saved_plans from anon, authenticated;
grant select, delete on public.saved_plans to authenticated;
grant all on public.saved_plans to service_role;
create policy saved_plans_read_own on public.saved_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy saved_plans_delete_own on public.saved_plans
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.taste_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  profile jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index taste_profiles_user_updated_idx on public.taste_profiles (user_id, updated_at desc);
alter table public.taste_profiles enable row level security;
revoke all on public.taste_profiles from anon, authenticated;
grant select, delete on public.taste_profiles to authenticated;
grant all on public.taste_profiles to service_role;
create policy taste_profiles_read_own on public.taste_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy taste_profiles_delete_own on public.taste_profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Temporary server-only editing state survives server restarts and replicas.
create table public.active_passport_sessions (
  id uuid primary key,
  revision integer not null default 0,
  state jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index active_passport_sessions_expires_idx
  on public.active_passport_sessions (expires_at);
alter table public.active_passport_sessions enable row level security;
revoke all on public.active_passport_sessions from anon, authenticated;
grant select, insert, update, delete on public.active_passport_sessions to service_role;

commit;

-- Expected: five public app tables. Destination rows survive the reset.
select table_name from information_schema.tables
where table_schema = 'public' and table_name in
  ('destinations', 'saved_passports', 'saved_plans', 'taste_profiles', 'active_passport_sessions')
order by table_name;
