-- Tau — Supabase schema, chunk 1: accounts.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query -> paste -> Run).

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  elo integer not null default 1200,
  wins integer not null default 0,
  losses integer not null default 0,
  created_at timestamptz not null default now()
);

create index profiles_elo_idx on public.profiles (elo desc);

alter table public.profiles enable row level security;

-- Leaderboard needs every profile readable by everyone, signed in or not.
create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

-- Row-level: a user may only touch their own row.
create policy "users can update their own row"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Column-level: even on their own row, players can rename themselves but cannot write
-- elo/wins/losses directly — RLS is per-row, not per-column, so this is enforced
-- separately. Rating changes are applied by a SECURITY DEFINER function only (added in
-- the matchmaking/ELO chunk), never by a direct client UPDATE.
revoke update on public.profiles from authenticated;
grant update (username) on public.profiles to authenticated;

-- Auto-create a profile the moment someone signs up, so there's never a signed-in user
-- with no row for the app (and thus no leaderboard entry / no rating) to fall back on.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Player_' || substr(new.id::text, 1, 6)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
