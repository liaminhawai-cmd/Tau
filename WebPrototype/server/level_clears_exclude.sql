-- ============================================================================
-- Migration: leave chosen accounts out of the level clears and the "beaten by" stats.
-- ----------------------------------------------------------------------------
-- The developer beats rungs while testing them. Counted, those clears make a level read "beaten
-- by 1" before any player has, which spoils "first to beat level X" contests. An account listed
-- in level_clears_excluded has its clears dropped by record_level_clear() and is left out of
-- level_stats() (which reads only level_clears, so its player total excludes it too).
--
-- Wins over the nets still go to ladder_wins and the trainer either way -- this is only the
-- public record.
--
-- Idempotent. Apply in the Supabase SQL editor, then list the account:
--
--   insert into public.level_clears_excluded (user_id)
--   select id from auth.users where email = '<the account''s email>'
--   on conflict do nothing;
--   delete from public.level_clears
--   where user_id in (select user_id from public.level_clears_excluded);
-- ============================================================================

create table if not exists public.level_clears_excluded (
  user_id uuid primary key references auth.users (id) on delete cascade
);
-- RLS on with no policies: only the dashboard / service role can read or change the list.
alter table public.level_clears_excluded enable row level security;
revoke all on public.level_clears_excluded from anon, authenticated;

alter table public.level_clears
  drop constraint if exists level_clears_level_check;
alter table public.level_clears
  add  constraint level_clears_level_check check (level between 1 and 30);

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
  if p_level is null or p_level < 1 or p_level > 30 then return; end if;
  if p_colour is null or p_colour not in (0, 1) then return; end if;
  if exists (select 1 from public.level_clears_excluded where user_id = me) then return; end if;

  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return; end if;

  insert into public.level_clears (user_id, level, colour, player_elo)
  values (me, p_level::smallint, p_colour::smallint, my_elo)
  on conflict (user_id, level, colour) do nothing;
end;
$$;

grant execute on function public.record_level_clear(integer, integer) to anon, authenticated;
