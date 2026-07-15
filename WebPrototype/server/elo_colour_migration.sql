-- ============================================================================
-- Migration: colour-adjusted ELO in finish_match().
-- ----------------------------------------------------------------------------
-- A win as RED (moving second) is harder than as BLUE, so it should move your
-- rating more, and a win as blue less. This reuses the SAME live blue-advantage
-- estimate the matchmaker already computes: blue's win rate over ranked games,
-- converted to an ELO-equivalent (blue_adv). Blue is treated as effectively
-- rated blue_adv points higher when computing the expected score.
--
-- No circular feedback: the estimate reads match OUTCOMES (who won, by colour),
-- which this update never changes -- it only changes ratings. Snapshot-and-
-- freeze, exactly like the rest of Elo: read the current best estimate, apply
-- it, never retroactively recompute. Guards: needs >= 20 ranked games before it
-- kicks in, and blue_adv is clamped to +/-150 so a noisy early estimate can't
-- swing an update wildly. Idempotent and safe to run more than once.
-- ============================================================================

create or replace function public.finish_match(p_match_id uuid, p_winner_color text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  m record;
  winner_id uuid; loser_id uuid;
  winner_elo integer; loser_elo integer;
  winner_is_blue boolean;
  winner_eff numeric; loser_eff numeric;
  expected numeric;
  n_ranked integer;
  blue_win_rate numeric;
  blue_adv numeric := 0;          -- ELO-equivalent of the first-move (blue) edge; 0 until enough data
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
    winner_id := m.blue_id; loser_id := m.red_id; winner_is_blue := true;
  else
    winner_id := m.red_id; loser_id := m.blue_id; winner_is_blue := false;
  end if;

  select elo into winner_elo from public.profiles where id = winner_id;
  select elo into loser_elo from public.profiles where id = loser_id;

  -- live blue-advantage estimate, from OTHER finished ranked matches (exclude this one so a result
  -- never rates itself). Same formula the matchmaker uses for fair colour assignment.
  select count(*) into n_ranked
    from public.matches where status = 'finished' and invite_code is null and id <> p_match_id;
  if n_ranked >= 20 then
    select count(*) filter (where winner_color = 'blue')::numeric / count(*)
      into blue_win_rate
      from public.matches where status = 'finished' and invite_code is null and id <> p_match_id;
    blue_win_rate := greatest(0.02, least(0.98, blue_win_rate));
    blue_adv := 400 * log(10, blue_win_rate / (1 - blue_win_rate));
    blue_adv := greatest(-150, least(150, blue_adv));   -- clamp against early noise
  end if;

  -- blue plays as if rated blue_adv higher, so a red win beats a stronger effective opponent
  winner_eff := winner_elo + (case when winner_is_blue then blue_adv else 0 end);
  loser_eff  := loser_elo  + (case when winner_is_blue then 0 else blue_adv end);
  expected   := 1.0 / (1.0 + power(10, (loser_eff - winner_eff) / 400.0));

  update public.profiles
    set elo = round(winner_elo + k * (1 - expected)), wins = wins + 1
    where id = winner_id;
  update public.profiles
    set elo = round(loser_elo + k * (0 - (1 - expected))), losses = losses + 1
    where id = loser_id;
end;
$$;

grant execute on function public.finish_match(uuid, text) to authenticated;
