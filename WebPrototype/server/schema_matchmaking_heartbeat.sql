-- Tau — Supabase schema patch: matchmaking heartbeat/staleness fix.
-- Run this once in the Supabase SQL editor, after schema_matches.sql.
--
-- Bug: try_match() picked the OLDEST queued row as the opponent with no check on whether that
-- player's client was still actually around. A closed tab, a crash, a lost connection, or just
-- a forgotten background tab left a queue row sitting forever — and being the oldest, it was
-- always the FIRST thing picked against every subsequent player who queued, pairing them with
-- someone who could never respond.
--
-- Fix: track a separately-refreshed `last_seen` heartbeat (bumped every time a client's own
-- poll upserts its row, roughly every ~1.8s while genuinely still queued and running) distinct
-- from `queued_at` (kept immutable, still used for FIFO fairness among live candidates). A
-- candidate is only matchable if seen in the last 10 seconds — several missed heartbeats' worth
-- of slack for ordinary jitter or a briefly-throttled background tab, but well short of what an
-- abandoned/closed/crashed tab could ever produce. Rows that go fully silent for 60+ seconds are
-- opportunistically deleted so the table doesn't accumulate zombie entries.

alter table public.matchmaking_queue add column if not exists last_seen timestamptz not null default now();

create or replace function public.try_match()
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_elo integer;
  opp record;
  new_match_id uuid;
  blue_win_rate numeric;
  n_finished integer;
  blue_adv numeric := 0;
  gap integer;
  assign_blue_to_me boolean;
begin
  if me is null then return null; end if;

  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return null; end if;

  -- Passive garbage collection: anyone who hasn't polled in a while (tab closed, crashed, lost
  -- network) gets dropped before they could ever be picked as someone's opponent. No cron job
  -- needed -- every actively-queued client calls this function itself every ~1.8s.
  delete from public.matchmaking_queue
  where user_id <> me and last_seen < now() - interval '60 seconds';

  insert into public.matchmaking_queue (user_id, elo, last_seen)
  values (me, my_elo, now())
  on conflict (user_id) do update set elo = excluded.elo, last_seen = now();

  select q.user_id, q.elo into opp
  from public.matchmaking_queue q
  where q.user_id <> me
    and q.last_seen > now() - interval '10 seconds'
  order by q.queued_at asc
  for update skip locked
  limit 1;

  if opp.user_id is null then
    return null;   -- still waiting; stay queued
  end if;

  delete from public.matchmaking_queue where user_id in (me, opp.user_id);

  select count(*) into n_finished from public.matches where status = 'finished';
  if n_finished >= 20 then
    select count(*) filter (where winner_color = 'blue')::numeric / count(*)
      into blue_win_rate
      from public.matches where status = 'finished';
    blue_win_rate := greatest(0.02, least(0.98, blue_win_rate));
    blue_adv := 400 * log(10, blue_win_rate / (1 - blue_win_rate));
  end if;

  gap := my_elo - opp.elo;   -- positive: I'm rated higher than my opponent

  if abs(gap) > abs(blue_adv) then
    assign_blue_to_me := gap < 0;    -- the lower-rated player gets blue
  else
    assign_blue_to_me := random() < 0.5;
  end if;

  insert into public.matches (blue_id, red_id, blue_elo, red_elo)
  values (
    case when assign_blue_to_me then me else opp.user_id end,
    case when assign_blue_to_me then opp.user_id else me end,
    case when assign_blue_to_me then my_elo else opp.elo end,
    case when assign_blue_to_me then opp.elo else my_elo end
  )
  returning id into new_match_id;

  return new_match_id;
end;
$$;
