-- ============================================================================
-- Migration: allow Levels 10 AND 11 (one paste covers both).
-- ----------------------------------------------------------------------------
-- Supersedes level10_migration.sql: if that one already ran, this simply
-- widens the cap again; if it never ran, this covers both new levels at once.
-- Idempotent, safe to run more than once. Apply in the Supabase SQL editor.
-- Until applied, Levels 10 and 11 are fully playable: their clears just are
-- not recorded and their crowd stats show "Unbeaten".
--
--   1a. Widen the level CHECK constraint to 1..11.
--   1b. Let record_level_clear() accept up to level 11.
--
-- level_stats() needs no change: it reports whatever levels exist in
-- level_clears.
-- ============================================================================

-- 1a) widen the level CHECK constraint to 1..11
alter table public.level_clears
  drop constraint if exists level_clears_level_check;
alter table public.level_clears
  add  constraint level_clears_level_check check (level between 1 and 11);

-- 1b) let record_level_clear() accept levels up to 11 (only the guard changes)
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
  if p_level is null or p_level < 1 or p_level > 11 then return; end if;
  if p_colour is null or p_colour not in (0, 1) then return; end if;

  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return; end if;

  insert into public.level_clears (user_id, level, colour, player_elo)
  values (me, p_level::smallint, p_colour::smallint, my_elo)
  on conflict (user_id, level, colour) do nothing;
end;
$$;

grant execute on function public.record_level_clear(integer, integer) to anon, authenticated;
