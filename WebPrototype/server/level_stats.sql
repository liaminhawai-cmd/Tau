-- ============================================================================
-- Levels (vs Computer) crowd stats
-- ----------------------------------------------------------------------------
-- Records who has beaten each level and at what rating, so the Levels screen can
-- show, per level (1..8) AND per colour (0 = Blue, 1 = Red) — 16 independent
-- stats — either "Unbeaten", a raw count (<= 5 clears), or "usually cleared
-- above ~X" (25th-percentile rating, at 6+ clears).
--
-- One row per player per (level, colour). The stored rating is the player's
-- rating at their FIRST clear of that level in that colour, so replays never
-- reshuffle the number. Every user (including anonymous guests) has a profile
-- row with a rating, so the rating is read server-side and cannot be spoofed by
-- the client.
--
-- Safe to run more than once (idempotent). Apply in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.level_clears (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  level      smallint    not null check (level between 1 and 8),
  colour     smallint    not null check (colour in (0, 1)),   -- 0 = Blue, 1 = Red
  player_elo integer     not null,
  created_at timestamptz not null default now(),
  primary key (user_id, level, colour)
);

-- percentile_cont + count read straight off this index
create index if not exists level_clears_lc_elo
  on public.level_clears (level, colour, player_elo);

-- All access goes through the SECURITY DEFINER functions below; no direct table access.
alter table public.level_clears enable row level security;
revoke all on public.level_clears from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Record the caller's clear of a level in a colour.
-- Idempotent per (user, level, colour): the first clear's rating stands.
-- ----------------------------------------------------------------------------
create or replace function public.record_level_clear(p_level integer, p_colour integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me     uuid := auth.uid();
  my_elo integer;
begin
  if me is null then return; end if;
  if p_level is null or p_level < 1 or p_level > 8 then return; end if;
  if p_colour is null or p_colour not in (0, 1) then return; end if;

  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return; end if;

  insert into public.level_clears (user_id, level, colour, player_elo)
  values (me, p_level::smallint, p_colour::smallint, my_elo)
  on conflict (user_id, level, colour) do nothing;
end;
$$;

-- ----------------------------------------------------------------------------
-- Per-level-per-colour aggregate for the Levels screen.
-- Returns only (level, colour) pairs with >= 1 clear; the client treats any
-- missing pair as "Unbeaten".
-- ----------------------------------------------------------------------------
create or replace function public.level_stats()
returns table (level integer, colour integer, clears integer, p25_elo integer)
language sql
security definer set search_path = public
stable
as $$
  select level::integer,
         colour::integer,
         count(*)::integer as clears,
         round(percentile_cont(0.25) within group (order by player_elo))::integer as p25_elo
  from public.level_clears
  group by level, colour;
$$;

grant execute on function public.record_level_clear(integer, integer) to anon, authenticated;
grant execute on function public.level_stats() to anon, authenticated;
