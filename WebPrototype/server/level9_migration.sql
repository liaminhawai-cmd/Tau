-- ============================================================================
-- Migration: allow Level 9 in the Levels (vs Computer) crowd stats.
-- ----------------------------------------------------------------------------
-- The original level_clears table capped `level` at 8 (a CHECK constraint) and
-- record_level_clear() rejected p_level > 8, so a Level 9 clear was silently
-- dropped and the Levels screen showed L9 as permanently "Unbeaten".
--
-- Run this once in the Supabase SQL editor to raise the cap to 9. Safe to run
-- more than once (idempotent). Until it is applied, the game still works: L9 is
-- fully playable, its clears just are not recorded and it reads "Unbeaten".
-- ============================================================================

-- 1) widen the level CHECK constraint from 1..8 to 1..9
alter table public.level_clears
  drop constraint if exists level_clears_level_check;
alter table public.level_clears
  add  constraint level_clears_level_check check (level between 1 and 9);

-- 2) let record_level_clear() accept level 9 (only the guard changes)
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
