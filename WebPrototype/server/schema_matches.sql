-- Tau — Supabase schema, chunk 2: matchmaking, live matches, ELO.
-- Run this once in the Supabase SQL editor, after chunk 1 (schema.sql).

-- ---------- matchmaking queue ----------
create table public.matchmaking_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  elo integer not null,
  queued_at timestamptz not null default now(),
  -- Refreshed on every poll (see try_match() below), separately from queued_at (which stays
  -- fixed and is used only for FIFO fairness among candidates that ARE still live). Lets
  -- try_match() tell a genuinely-still-queued player apart from a closed/crashed/abandoned tab
  -- whose row would otherwise sit there forever looking like the oldest (and therefore
  -- first-picked) opponent for everyone who queues after it.
  last_seen timestamptz not null default now()
);

alter table public.matchmaking_queue enable row level security;

-- A player can see/insert/delete only their own queue row. try_match() (below) does the
-- actual matching as SECURITY DEFINER, so it isn't limited by these policies.
create policy "own queue row only"
  on public.matchmaking_queue for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, delete on public.matchmaking_queue to authenticated;

-- ---------- matches ----------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  blue_id uuid not null references auth.users(id) on delete cascade,
  red_id uuid not null references auth.users(id) on delete cascade,
  blue_elo integer not null,
  red_elo integer not null,
  status text not null default 'active' check (status in ('active','finished')),
  winner_color text check (winner_color in ('blue','red')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- if this match is a direct rematch of an earlier one, points at that match. The unique
  -- index makes rematch() below race-safe: if both players click "Rematch" at once, only one
  -- insert wins and the other converges on the same row instead of creating a duplicate.
  rematch_of uuid references public.matches(id)
);

create index matches_players_idx on public.matches (blue_id, red_id);
create unique index matches_rematch_of_idx on public.matches (rematch_of) where rematch_of is not null;

alter table public.matches enable row level security;

create policy "players can read their own matches"
  on public.matches for select
  using (auth.uid() = blue_id or auth.uid() = red_id);

grant select on public.matches to authenticated;
-- No direct client insert/update: matches are only created by try_match() and only
-- settled by finish_match() (both SECURITY DEFINER below), so a client can't fabricate a
-- match, alter its result, or edit anyone's rating by hand.
revoke insert, update, delete on public.matches from authenticated;

-- ---------- match_moves ----------
-- One row per completed turn. `keyframes` is a small sampled trajectory (recorded on the
-- mover's own client while it plays the turn locally) that the OTHER client replays purely
-- as a visual tween — it never re-runs the physics itself, so there's no risk of the two
-- clients' Math.sin/cos disagreeing in the last bit after hundreds of substeps and drifting
-- apart. `final_state` is the authoritative board state both clients converge to.
create table public.match_moves (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  move_index integer not null,
  mover_color text not null check (mover_color in ('blue','red')),
  keyframes jsonb not null,
  final_state jsonb not null,
  created_at timestamptz not null default now(),
  unique (match_id, move_index)
);

alter table public.match_moves enable row level security;

create policy "players can read moves from their own matches"
  on public.match_moves for select
  using (
    exists (select 1 from public.matches m
            where m.id = match_moves.match_id
              and (m.blue_id = auth.uid() or m.red_id = auth.uid()))
  );

-- A player may only insert a move into their OWN active match, tagged with their OWN
-- colour — they can't post a move as their opponent, or post into a finished/other match.
create policy "players can insert their own moves"
  on public.match_moves for insert
  with check (
    exists (select 1 from public.matches m
            where m.id = match_moves.match_id
              and m.status = 'active'
              and ((mover_color = 'blue' and m.blue_id = auth.uid())
                or (mover_color = 'red'  and m.red_id  = auth.uid())))
  );

grant select, insert on public.match_moves to authenticated;

-- ---------- try_match(): atomically pair off two queued players ----------
-- Called by the client every ~1.5s while queued. Whichever of the two calls actually finds
-- the other player creates the match row; the other player learns about it via a Realtime
-- subscription on `matches`, not from their own try_match() return value.
--
-- Colour assignment follows the designer's rule: lower-rated player gets blue, UNLESS the
-- empirically measured blue-side advantage (from finished matches, expressed as an
-- ELO-equivalent gap) is bigger than the actual rating gap between the two players — in
-- that case blue is assigned randomly instead, since handing the lower-rated player blue
-- would over-correct. Needs at least 20 finished matches before it trusts that measurement.
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

grant execute on function public.try_match() to authenticated;

-- Lets a queued player give up waiting without needing direct table access beyond their own
-- row (already covered by the RLS policy above, but a named function is a cleaner client call).
create or replace function public.leave_queue()
returns void
language sql
security definer set search_path = public
as $$
  delete from public.matchmaking_queue where user_id = auth.uid();
$$;

grant execute on function public.leave_queue() to authenticated;

-- ---------- finish_match(): settle a result, update both ratings atomically ----------
-- Idempotent (a no-op if the match is already finished) since either client may call this
-- the instant it locally detects the win — no coordination needed over who "reports" first.
create or replace function public.finish_match(p_match_id uuid, p_winner_color text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  m record;
  winner_id uuid; loser_id uuid;
  winner_elo integer; loser_elo integer;
  expected numeric;
  k constant integer := 24;
begin
  if p_winner_color not in ('blue','red') then
    raise exception 'invalid winner_color';
  end if;

  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then return; end if;
  if m.status = 'finished' then return; end if;
  if auth.uid() <> m.blue_id and auth.uid() <> m.red_id then
    raise exception 'not a player in this match';
  end if;

  if p_winner_color = 'blue' then
    winner_id := m.blue_id; loser_id := m.red_id;
    winner_elo := m.blue_elo; loser_elo := m.red_elo;
  else
    winner_id := m.red_id; loser_id := m.blue_id;
    winner_elo := m.red_elo; loser_elo := m.blue_elo;
  end if;

  expected := 1.0 / (1.0 + power(10, (loser_elo - winner_elo) / 400.0));

  update public.profiles
    set elo = round(winner_elo + k * (1 - expected)), wins = wins + 1
    where id = winner_id;
  update public.profiles
    set elo = round(loser_elo + k * (0 - (1 - expected))), losses = losses + 1
    where id = loser_id;

  update public.matches
    set status = 'finished', winner_color = p_winner_color, finished_at = now()
    where id = p_match_id;
end;
$$;

grant execute on function public.finish_match(uuid, text) to authenticated;

-- ---------- rematch(): the LOSER of a finished match gets blue (moves first) in the rematch ----------
-- Idempotent per source match (see the unique index on rematch_of above): if both players
-- click "Rematch" at nearly the same moment, whichever insert loses the race catches the
-- unique_violation and just hands back the row the other one created, instead of a duplicate.
create or replace function public.rematch(p_prev_match_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  m record;
  winner_id uuid; loser_id uuid;
  winner_elo integer; loser_elo integer;
  new_id uuid;
begin
  select * into m from public.matches where id = p_prev_match_id;
  if m.id is null then return null; end if;
  if auth.uid() <> m.blue_id and auth.uid() <> m.red_id then
    raise exception 'not a player in that match';
  end if;
  if m.status <> 'finished' or m.winner_color is null then return null; end if;

  if m.winner_color = 'blue' then winner_id := m.blue_id; loser_id := m.red_id;
  else winner_id := m.red_id; loser_id := m.blue_id; end if;

  select elo into winner_elo from public.profiles where id = winner_id;
  select elo into loser_elo from public.profiles where id = loser_id;

  begin
    insert into public.matches (blue_id, red_id, blue_elo, red_elo, rematch_of)
    values (loser_id, winner_id, loser_elo, winner_elo, p_prev_match_id)
    returning id into new_id;
  exception when unique_violation then
    select id into new_id from public.matches where rematch_of = p_prev_match_id;
  end;

  return new_id;
end;
$$;

grant execute on function public.rematch(uuid) to authenticated;

-- ---------- realtime ----------
-- Both tables need to be added to the supabase_realtime publication for postgres_changes
-- subscriptions to deliver INSERT/UPDATE events to clients (Project -> Database ->
-- Replication -> supabase_realtime in the dashboard, or run directly here):
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_moves;

-- ---------- spectating ----------
-- Any signed-in player may READ public (non-private) matches and their moves, so live games can be
-- watched from the "Watch" menu. Private matches keep an invite_code, which excludes them here.
-- (Direct rematches of private matches currently have no invite_code and so ARE watchable -- a
-- known beta looseness, not a security boundary.) Write access is unchanged.
create policy "anyone can watch public matches"
  on public.matches for select
  to authenticated
  using (invite_code is null and status in ('active','finished'));

create policy "anyone can watch public match moves"
  on public.match_moves for select
  to authenticated
  using (
    exists (select 1 from public.matches m
            where m.id = match_moves.match_id and m.invite_code is null)
  );
