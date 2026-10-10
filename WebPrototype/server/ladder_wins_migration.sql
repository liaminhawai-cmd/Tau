-- ============================================================================
-- Migration: human wins over the trained nets become training data; levels past 13 record.
-- ----------------------------------------------------------------------------
-- Two things:
--
--   1. level_clears and record_level_clear() still stopped at 13, so a Level 14 clear was dropped
--      without a word (the client ignores the rpc's result). The cap goes to 30 so the next rungs
--      record the day they ship, with no migration each time.
--
--   2. ladder_wins: every game a human wins against a net rung (rung 11 and up, the league nets),
--      on any client -- web, Steam, mobile all run index.html -- as the list of turns
--      nn/human-league.js already saves for a PLAY-LEAGUE game: the pose each turn started from and
--      who moved. nn/pull-web-games.js reads the table with the service-role key, turns each game
--      into nn/data rows the trainer reads, and deletes what it pulled -- git keeps the copy, so the
--      table only ever holds games not yet fetched.
--
-- Wins only: the trainer has millions of games the nets won; a human beating one is the rare part.
-- Clients can only call submit_ladder_win(); nobody but the service role can read the table.
-- Idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- 1) levels 1..30 everywhere a level is checked
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

  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return; end if;

  insert into public.level_clears (user_id, level, colour, player_elo)
  values (me, p_level::smallint, p_colour::smallint, my_elo)
  on conflict (user_id, level, colour) do nothing;
end;
$$;

grant execute on function public.record_level_clear(integer, integer) to anon, authenticated;

-- 2) the wins themselves
create table if not exists public.ladder_wins (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  level      smallint    not null check (level between 11 and 30),
  colour     smallint    not null check (colour in (0, 1)),
  turns      jsonb       not null,
  plies      integer     not null,
  client     text,
  created_at timestamptz not null default now()
);
-- the daily cap's lookup
create index if not exists ladder_wins_user_created_idx on public.ladder_wins (user_id, created_at);

-- RLS on with no policies: anon/authenticated can neither read nor write the table directly.
-- Writes go through submit_ladder_win (security definer); reads are the service role's.
alter table public.ladder_wins enable row level security;
revoke all on public.ladder_wins from anon, authenticated;

create or replace function public.submit_ladder_win(p_level integer, p_colour integer, p_turns jsonb, p_client text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  n  integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_level is null or p_level < 11 or p_level > 30 then raise exception 'not a net rung'; end if;
  if p_colour is null or p_colour not in (0, 1) then raise exception 'invalid colour'; end if;
  if p_turns is null or jsonb_typeof(p_turns) <> 'array' then raise exception 'turns must be an array'; end if;
  n := jsonb_array_length(p_turns);
  if n < 2 or n > 1000 or octet_length(p_turns::text) > 200000 then raise exception 'implausible game length'; end if;

  -- every turn is { pose: [6 numbers], m: 0|1 }. CASE, not OR, so jsonb_array_length never sees a
  -- non-array (SQL does not promise to evaluate OR left to right).
  if exists (
    select 1 from jsonb_array_elements(p_turns) t
    where case
            when jsonb_typeof(t) <> 'object' then true
            when coalesce(t->>'m', '') not in ('0', '1') then true
            when jsonb_typeof(t->'pose') is distinct from 'array' then true
            when jsonb_array_length(t->'pose') <> 6 then true
            else exists (select 1 from jsonb_array_elements(t->'pose') v where jsonb_typeof(v) <> 'number')
          end
  ) then
    raise exception 'malformed turn';
  end if;

  -- a cheap brake on anyone scripting fake wins into the training data
  if (select count(*) from public.ladder_wins
       where user_id = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'daily limit reached';
  end if;

  insert into public.ladder_wins (user_id, level, colour, turns, plies, client)
  values (me, p_level::smallint, p_colour::smallint, p_turns, n, left(p_client, 16));
end;
$$;

revoke execute on function public.submit_ladder_win(integer, integer, jsonb, text) from public, anon;
grant  execute on function public.submit_ladder_win(integer, integer, jsonb, text) to authenticated;
