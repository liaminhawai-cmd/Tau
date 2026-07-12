-- ============================================================================
-- Levels (vs Computer) crowd stats
-- ----------------------------------------------------------------------------
-- Records who has beaten each level and at what rating, so the Levels screen can
-- show, per level (1..9) AND per colour (0 = Blue, 1 = Red) — 18 independent
-- stats — either "Unbeaten", a raw count (<= 5 clears), or "beaten by X% of
-- players" (share of all ladder players who have cleared it, at 6+ clears).
--
-- One row per player per (level, colour). player_elo is still stored (the
-- rating at first clear) for history, but the crowd stat is now a share of
-- players, which needs no rating and cannot be skewed by the many players who
-- only play the AI (and so sit at the default rating).
--
-- Safe to run more than once (idempotent). Apply in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.level_clears (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  level      smallint    not null check (level between 1 and 9),
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
  if p_level is null or p_level < 1 or p_level > 9 then return; end if;
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
-- missing pair as "Unbeaten". `pct` is the share of all distinct ladder players
-- (anyone who has cleared any level in any colour) who have cleared this one.
-- ----------------------------------------------------------------------------
create or replace function public.level_stats()
returns table (level integer, colour integer, clears integer, pct integer)
language sql
security definer set search_path = public
stable
as $$
  with base as (select count(distinct user_id)::numeric as total from public.level_clears)
  select lc.level::integer,
         lc.colour::integer,
         count(*)::integer as clears,
         case when b.total > 0 then round(count(*) * 100.0 / b.total)::integer else 0 end as pct
  from public.level_clears lc cross join base b
  group by lc.level, lc.colour, b.total;
$$;

grant execute on function public.record_level_clear(integer, integer) to anon, authenticated;
grant execute on function public.level_stats() to anon, authenticated;
