-- ============================================================================
-- Migration: the ladder is thirteen rungs, and the old rows mean different rungs.
-- ----------------------------------------------------------------------------
-- Supersedes level11_migration.sql. TWO things happened, and only one of them is
-- the usual "widen the cap":
--
--   1. Yellow was inserted at rung 1 and the Committee added at rung 13, so the
--      shipped ladder is 1..13 rather than 1..11.
--   2. EVERY EXISTING ROW NOW MEANS A DIFFERENT RUNG. level_clears rows were
--      written under the old numbering, where level 5 was Cosy/Vesper; level 5
--      is now Slate/Flint. Left alone, every crowd stat on the Levels screen is
--      quietly attributed to the wrong opponent -- the same trap index.html's
--      own migrateLadderRenumbering exists to avoid for a player's local save,
--      and this is that migration's other half.
--
-- So the rows are shifted before the cap is widened, and one row is COPIED as
-- well as moved: an old rung-1 clear lands on both rung 2 (Walnut, where that
-- opponent now lives) and rung 1 (Yellow), because RUNG_TO_AI_LADDER points both
-- of those rungs at the same brain -- whoever beat it has beaten what Yellow
-- wears. Without the copy, every player's strict frontier snaps back to rung 1.
--
-- Idempotent: the data step runs once, recorded in applied_migrations. The
-- declarative steps are safe to re-run. Apply in the Supabase SQL editor.
-- Until applied, Levels 12 and 13 are fully playable -- their clears just are
-- not recorded and their crowd stats show "Unbeaten" -- but the stats on rungs
-- 1..11 are wrong by one until step 2 runs.
-- ============================================================================

-- 0) somewhere to remember that the one non-idempotent step has already run.
create table if not exists public.applied_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);

-- 1) widen the level CHECK constraint to 1..13 FIRST -- the shift below pushes
--    level 11 up to 12, which the old 1..11 constraint would reject.
alter table public.level_clears
  drop constraint if exists level_clears_level_check;
alter table public.level_clears
  add  constraint level_clears_level_check check (level between 1 and 13);

-- 2) renumber the existing rows, exactly once.
do $$
declare
  lvl integer;
begin
  if exists (select 1 from public.applied_migrations where name = 'level13_renumber') then
    raise notice 'level13_renumber already applied; leaving level_clears alone';
    return;
  end if;

  -- Nothing should sit above the old cap of 11. If something does, either this has already
  -- half-run or the data is not what this migration was written against -- stop rather than
  -- shuffle rows into each other.
  if exists (select 1 from public.level_clears where level > 11) then
    raise exception 'level_clears already has rows above level 11; refusing to renumber';
  end if;

  -- Highest rung first, one rung per statement.
  --
  -- This was originally a single "set level = level + 1 where level between 1 and 12", on the
  -- reasoning that Postgres would check the (user_id, level, colour) key once the whole statement
  -- had finished, by which point nothing collides. That is only true of a DEFERRABLE constraint.
  -- level_clears_pkey is an ordinary primary key, so the check happens per ROW, as each row moves:
  -- the statement lifts a level-1 row onto a level-2 row that has not moved yet and dies with
  -- 23505. It did exactly that against the live database.
  --
  -- Walking down from the top instead means the rung being moved into was vacated by the previous
  -- step, so no two rows are ever on the same one.
  for lvl in reverse 11..1 loop
    update public.level_clears set level = lvl + 1 where level = lvl;
  end loop;

  -- ...and leave a copy of the old rung 1 on the new rung 1 (Yellow), which is
  -- the same opponent under a different board.
  insert into public.level_clears (user_id, level, colour, player_elo)
  select user_id, 1, colour, player_elo
    from public.level_clears
   where level = 2
  on conflict (user_id, level, colour) do nothing;

  insert into public.applied_migrations (name) values ('level13_renumber');
end $$;

-- 3) let record_level_clear() accept up to level 13 (only the guard changes)
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
  if p_level is null or p_level < 1 or p_level > 13 then return; end if;
  if p_colour is null or p_colour not in (0, 1) then return; end if;

  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return; end if;

  insert into public.level_clears (user_id, level, colour, player_elo)
  values (me, p_level::smallint, p_colour::smallint, my_elo)
  on conflict (user_id, level, colour) do nothing;
end;
$$;

grant execute on function public.record_level_clear(integer, integer) to anon, authenticated;

-- level_stats() needs no change: it reports whatever levels exist in level_clears.
