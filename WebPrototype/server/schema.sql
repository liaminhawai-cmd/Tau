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
--
-- IMPORTANT: this runs INSIDE the auth.users insert transaction, so if the profile insert throws
-- (e.g. a unique-username collision), the whole sign-up is rolled back -- the user just silently
-- lands back on the signed-out screen. That's why we do NOT trust an OAuth provider's `full_name`
-- as the username: two Google users called "John Smith" would collide on the unique constraint and
-- the SECOND one's Google sign-in would fail outright. Instead, a client-chosen username (already
-- format-checked before sign-up) is used when present; everyone else -- Google, magic-link -- gets
-- a guaranteed-unique Player_<hex> handle they can rename in-app afterward.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  hexid text := replace(new.id::text, '-', '');
  chosen text := nullif(new.raw_user_meta_data->>'username', '');
  uname text;
begin
  -- Only accept a supplied username that already fits the app's own format rule; never a raw
  -- provider display name.
  if chosen is not null and chosen ~ '^[A-Za-z0-9_]{3,20}$' then
    uname := chosen;
  else
    uname := 'Player_' || substr(hexid, 1, 8);
  end if;
  -- Extremely defensive: if that still collides, extend with more of the (unique) uid so the insert
  -- can never fail the sign-up on a duplicate.
  while exists (select 1 from public.profiles where username = uname) loop
    uname := 'Player_' || substr(hexid, 1, 8) || substr(hexid, 9, 4);
    exit when not exists (select 1 from public.profiles where username = uname);
    uname := 'Player_' || hexid;   -- last resort: the full 32-hex uid is unique by construction
    exit;
  end loop;
  insert into public.profiles (id, username) values (new.id, uname);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
