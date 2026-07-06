-- =====================================================================================
-- Tau — ONE-SHOT patch for an ALREADY-DEPLOYED database.
-- Paste this whole file into the Supabase SQL editor (Project → SQL Editor → New query →
-- paste → Run). It is safe to run on a live DB that already has data, and safe to run more
-- than once: every statement is either idempotent (ADD COLUMN IF NOT EXISTS / CREATE OR
-- REPLACE) or a no-op on repeat.
--
-- It rolls up three fixes that were added after the original schema.sql / schema_matches.sql
-- were first run:
--   1. Sign-in trigger: stop trusting an OAuth provider's display name as the username (it
--      could collide with the unique constraint and silently fail Google sign-ins).
--   2. Matchmaking heartbeat: stop pairing people with closed/abandoned queue tabs.
--   3. Private matches: the create/join/cancel functions the "Private match" button calls
--      (previously missing entirely -> "Could not find the function public.create_private_match").
--
-- If you are setting up a BRAND-NEW project instead, run schema.sql, then schema_matches.sql,
-- then schema_private.sql in order — you don't need this file.
-- =====================================================================================


-- ---------------------------------------------------------------------------------------
-- 1. Robust sign-up trigger (fixes Google sign-in that "looked right then came back signed
--    out", and gives OAuth users a rename-able Player_xxxx handle instead of their raw name).
-- ---------------------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  hexid text := replace(new.id::text, '-', '');
  chosen text := nullif(new.raw_user_meta_data->>'username', '');
  uname text;
begin
  if chosen is not null and chosen ~ '^[A-Za-z0-9_]{3,20}$' then
    uname := chosen;
  else
    uname := 'Player_' || substr(hexid, 1, 8);
  end if;
  while exists (select 1 from public.profiles where username = uname) loop
    uname := 'Player_' || substr(hexid, 1, 8) || substr(hexid, 9, 4);
    exit when not exists (select 1 from public.profiles where username = uname);
    uname := 'Player_' || hexid;
    exit;
  end loop;
  insert into public.profiles (id, username) values (new.id, uname);
  return new;
end;
$$;


-- ---------------------------------------------------------------------------------------
-- 2. Matchmaking heartbeat (exclude stale/abandoned queue rows; passively GC dead ones).
-- ---------------------------------------------------------------------------------------
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
    return null;
  end if;

  delete from public.matchmaking_queue where user_id in (me, opp.user_id);

  -- Only RANKED (public) games feed the blue/red fairness estimate; private/casual results excluded.
  select count(*) into n_finished from public.matches where status = 'finished' and invite_code is null;
  if n_finished >= 20 then
    select count(*) filter (where winner_color = 'blue')::numeric / count(*)
      into blue_win_rate
      from public.matches where status = 'finished' and invite_code is null;
    blue_win_rate := greatest(0.02, least(0.98, blue_win_rate));
    blue_adv := 400 * log(10, blue_win_rate / (1 - blue_win_rate));
  end if;

  gap := my_elo - opp.elo;

  if abs(gap) > abs(blue_adv) then
    assign_blue_to_me := gap < 0;
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


-- ---------------------------------------------------------------------------------------
-- 3. Private matches (the create/join/cancel RPCs the "Private match" button needs).
-- ---------------------------------------------------------------------------------------
alter table public.matches alter column red_id drop not null;
alter table public.matches alter column red_elo drop not null;
alter table public.matches drop constraint if exists matches_status_check;
alter table public.matches add constraint matches_status_check check (status in ('waiting','active','finished'));
alter table public.matches add column if not exists invite_code text unique;

create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.matches where invite_code = code and status = 'waiting');
  end loop;
  return code;
end;
$$;

create or replace function public.create_private_match()
returns table(match_id uuid, code text)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_elo integer;
  existing_id uuid;
  existing_code text;
  new_code text;
  new_id uuid;
begin
  if me is null then return; end if;
  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return; end if;

  select id, invite_code into existing_id, existing_code
    from public.matches where blue_id = me and status = 'waiting' and invite_code is not null
    limit 1;
  if existing_id is not null then
    match_id := existing_id; code := existing_code; return next; return;
  end if;

  new_code := public.generate_invite_code();
  insert into public.matches (blue_id, red_id, blue_elo, red_elo, status, invite_code)
  values (me, null, my_elo, null, 'waiting', new_code)
  returning id into new_id;

  match_id := new_id; code := new_code;
  return next;
end;
$$;
grant execute on function public.create_private_match() to authenticated;

create or replace function public.cancel_private_match(p_match_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  delete from public.matches
    where id = p_match_id and blue_id = auth.uid() and status = 'waiting';
$$;
grant execute on function public.cancel_private_match(uuid) to authenticated;

create or replace function public.join_private_match(p_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_elo integer;
  m record;
begin
  if me is null then return null; end if;
  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return null; end if;

  select * into m from public.matches
    where invite_code = upper(trim(p_code)) and status = 'waiting'
    for update skip locked;
  if m.id is null then return null; end if;
  if m.blue_id = me then return null; end if;

  update public.matches
    set red_id = me, red_elo = my_elo, status = 'active'
    where id = m.id;

  return m.id;
end;
$$;
grant execute on function public.join_private_match(text) to authenticated;


-- ---------------------------------------------------------------------------------------
-- 4. Spectating (the "Watch" menu): any signed-in player may READ public (non-private)
--    matches and their moves. Private matches keep an invite_code, which excludes them.
--    Safe to re-run: drops the policies first if they already exist.
-- ---------------------------------------------------------------------------------------
drop policy if exists "anyone can watch public matches" on public.matches;
create policy "anyone can watch public matches"
  on public.matches for select
  to authenticated
  using (invite_code is null and status in ('active','finished'));

drop policy if exists "anyone can watch public match moves" on public.match_moves;
create policy "anyone can watch public match moves"
  on public.match_moves for select
  to authenticated
  using (
    exists (select 1 from public.matches m
            where m.id = match_moves.match_id and m.invite_code is null)
  );


-- ---------------------------------------------------------------------------------------
-- 5. Retire abandoned matches. A match only leaves 'active' when a live client ends it (a win
--    or the 30s turn-clock forfeit). If BOTH players' tabs close there's no one left to run the
--    clock, so the row sits 'active' forever and clutters the Watch list as "two idle players".
--    This finishes any active match with no move in the last few minutes (30s clock => a live match
--    records a move at least every 30s, so 3 minutes of silence means it's abandoned). Winner is left
--    null: nobody earned it, so no ELO changes. The client calls this best-effort when the Watch menu
--    opens; you can also schedule it with pg_cron if the extension is enabled. Safe to re-run.
-- ---------------------------------------------------------------------------------------
create or replace function public.gc_stale_matches()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare n integer;
begin
  update public.matches m
     set status = 'finished'
   where m.status = 'active'
     and coalesce(
           (select max(mm.created_at) from public.match_moves mm where mm.match_id = m.id),
           m.created_at
         ) < now() - interval '3 minutes';
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function public.gc_stale_matches() to authenticated;


-- ---------------------------------------------------------------------------------------
-- 6. Server-side username hygiene. The client validates format + profanity, but a user has a
--    column-level UPDATE grant on profiles.username, so a direct API call could set anything.
--    Enforce it in the database too: a format CHECK (added NOT VALID so it never fails on rows
--    that already exist) plus a BEFORE INSERT/UPDATE trigger that rejects a small leetspeak-folded
--    slur list. Safe to re-run.
-- ---------------------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[A-Za-z0-9_]{3,40}$') not valid;   -- 40: room for the Player_<hex> auto-handles

create or replace function public.check_username_clean()
returns trigger
language plpgsql set search_path = public
as $$
declare
  folded text;
  bad text;
  words text[] := array['fuck','shit','bitch','cunt','asshole','nigger','nigga','faggot',
                         'rape','whore','slut','retard','nazi','kike','spic'];
begin
  -- fold common leetspeak (1->i 3->e 4->a 0->o 5->s 7->t 8->b 9->g), drop non-letters, then substring-match
  folded := translate(lower(new.username), '13405789', 'ieaostbg');
  folded := regexp_replace(folded, '[^a-z]', '', 'g');
  foreach bad in array words loop
    if position(bad in folded) > 0 then
      raise exception 'username not allowed';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists profiles_username_clean on public.profiles;
create trigger profiles_username_clean
  before insert or update of username on public.profiles
  for each row execute function public.check_username_clean();


-- ---------------------------------------------------------------------------------------
-- 7. Private matches must NOT affect ELO. finish_match applied a rating change to every finished
--    match; private (invite_code) games route through the same call, so two friends with an invite
--    link could farm rating. Re-define finish_match to still RECORD the result (so the game can end
--    and be replayed) but skip ELO + win/loss for private matches. Only public matchmaking ranks.
--    Safe to re-run.
-- ---------------------------------------------------------------------------------------
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

  update public.matches
    set status = 'finished', winner_color = p_winner_color, finished_at = now()
    where id = p_match_id;

  if m.invite_code is not null then
    return;   -- private/casual game: no rating or win/loss change
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
end;
$$;
grant execute on function public.finish_match(uuid, text) to authenticated;

-- rematch of a PRIVATE game must also stay private (else friends could rematch a private game into a
-- ranked one and farm rating). Carry a unique, non-joinable invite_code onto the rematch when the
-- source was private. Safe to re-run.
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
  new_code text := null;
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

  if m.invite_code is not null then new_code := 'pv:' || p_prev_match_id::text; end if;

  begin
    insert into public.matches (blue_id, red_id, blue_elo, red_elo, rematch_of, invite_code)
    values (loser_id, winner_id, loser_elo, winner_elo, p_prev_match_id, new_code)
    returning id into new_id;
  exception when unique_violation then
    select id into new_id from public.matches where rematch_of = p_prev_match_id;
  end;

  return new_id;
end;
$$;
grant execute on function public.rematch(uuid) to authenticated;
