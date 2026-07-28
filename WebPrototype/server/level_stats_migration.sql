-- ============================================================================
-- Migration: Levels (vs Computer) crowd stats update.
-- ----------------------------------------------------------------------------
-- Two changes, safe to run more than once (idempotent). Apply in the Supabase
-- SQL editor. Until applied, the game still works: Level 9 is playable (its
-- clears just are not recorded) and the Levels screen shows plain clear counts.
--
--   1. Allow Level 9 (the new top rung) in level_clears + record_level_clear.
--   2. Replace the crowd stat: instead of a 25th-percentile *rating* (which was
--      meaningless because most players only play the AI and sit at the 1200
--      default rating), report the *share of players* who have beaten each
--      level. level_stats() now returns raw `clears` + `players` (total distinct
--      ladder players) in place of `p25_elo`; the app computes the share.
-- ============================================================================

-- 1a) widen the level CHECK constraint from 1..8 to 1..9
alter table public.level_clears
  drop constraint if exists level_clears_level_check;
alter table public.level_clears
  add  constraint level_clears_level_check check (level between 1 and 9);

-- 1b) let record_level_clear() accept level 9 (only the guard changes)
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

grant execute on function public.record_level_clear(integer, integer) to anon, authenticated;

-- 2) crowd stat as raw counts: `clears` for this (level, colour) and `players`
--    (all distinct players who have cleared any level). The app turns them into
--    the shown share. The return signature changes (clears+players replace
--    p25_elo); create or replace cannot change a function's OUT columns, so drop
--    it first.
drop function if exists public.level_stats();
create or replace function public.level_stats()
returns table (level integer, colour integer, clears integer, players integer)
language sql
security definer set search_path = public
stable
as $$
  with base as (select count(distinct user_id)::integer as total from public.level_clears)
  select lc.level::integer,
         lc.colour::integer,
         count(*)::integer as clears,
         b.total as players
  from public.level_clears lc cross join base b
  group by lc.level, lc.colour, b.total;
$$;

grant execute on function public.level_stats() to anon, authenticated;
