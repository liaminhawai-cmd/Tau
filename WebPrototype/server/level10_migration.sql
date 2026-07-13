-- ============================================================================
-- Migration: allow Level 10 (the new top rung).
-- ----------------------------------------------------------------------------
-- One change, safe to run more than once (idempotent). Apply in the Supabase
-- SQL editor. Until applied, the game still works: Level 10 is playable, its
-- clears just are not recorded and its crowd stat shows "Unbeaten".
--
--   1a. Widen the level CHECK constraint from 1..9 to 1..10.
--   1b. Let record_level_clear() accept level 10 (only the guard changes).
--
-- level_stats() needs no change: it reports whatever levels exist in
-- level_clears.
-- ============================================================================

-- 1a) widen the level CHECK constraint from 1..9 to 1..10
alter table public.level_clears
  drop constraint if exists level_clears_level_check;
alter table public.level_clears
  add  constraint level_clears_level_check check (level between 1 and 10);

-- 1b) let record_level_clear() accept level 10 (only the guard changes)
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
  if p_level is null or p_level < 1 or p_level > 10 then return; end if;
  if p_colour is null or p_colour not in (0, 1) then return; end if;

  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return; end if;

  insert into public.level_clears (user_id, level, colour, player_elo)
  values (me, p_level::smallint, p_colour::smallint, my_elo)
  on conflict (user_id, level, colour) do nothing;
end;
$$;

grant execute on function public.record_level_clear(integer, integer) to anon, authenticated;
