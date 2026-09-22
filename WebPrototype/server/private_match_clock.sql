-- ============================================================================
-- Migration: a private match carries its own turn clock.
-- ----------------------------------------------------------------------------
-- The clock exists to stop a stranger in the ranked queue holding someone's
-- evening hostage. Two people who swapped an invite code are not strangers, so
-- the one who made the invite picks the pace on the waiting screen: 1 minute,
-- 2 minutes, or no clock.
--
-- It lives on the match row because both clients read it. A clock only one side
-- believed in would have that side passing the other's turn out from under
-- them.
--
-- "No clock" is not unlimited. An abandoned match holds a live row and a
-- realtime subscription until something settles it, and nothing else would, so
-- the client asks "still playing?" every ten minutes (UNTIMED_PING_MS in
-- index.html). Answering buys another ten, as many times as the pair like;
-- ignoring it lets the turn time out as usual, so a walked-away-from board
-- passes, then surrenders, and settles its own row.
--
-- Written through an RPC rather than a client UPDATE on purpose: schema_matches
-- revokes insert/update/delete on public.matches from authenticated outright,
-- so that a client can never fabricate a match or edit its result. That stance
-- is worth keeping for one column -- this follows cancel_private_match's shape
-- instead (SECURITY DEFINER, and it checks who is asking).
--
-- Safe to apply at any time, and safe NOT to apply: index.html calls this in a
-- follow-up it deliberately allows to fail. Until this runs, the picker says so
-- and the match keeps the standard clock. Nothing breaks.
--
-- Idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- 1) the column. Seconds per turn; NULL means no clock.
--
--    DEFAULT 60 rather than NULL, and that default matters: it is what every
--    EXISTING row gets, and what create_private_match() keeps writing without
--    being changed. If the default were NULL, applying this migration would
--    silently make every match in the table -- including every ranked one --
--    untimed.
alter table public.matches
  add column if not exists turn_seconds integer default 60;

-- 2) the creator's one permitted write. Scoped hard: only the player who made
--    the invite, only while it is still waiting for someone to join, and only
--    to one of the offered paces. Once someone has joined, the setting is
--    fixed -- neither side can change the clock mid-match.
--
--    The p_turn_seconds check is not ceremony. Without it a doctored client
--    could set a one-second clock on a match someone is about to join, and win
--    by timeout before they had taken a turn.
create or replace function public.set_private_match_clock(p_match_id uuid, p_turn_seconds integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_turn_seconds is not null and p_turn_seconds not in (60, 120) then
    raise exception 'unsupported turn clock: %', p_turn_seconds;
  end if;

  update public.matches set turn_seconds = p_turn_seconds
    where id = p_match_id and blue_id = auth.uid() and status = 'waiting';
end;
$$;
grant execute on function public.set_private_match_clock(uuid, integer) to authenticated;

-- 3) the earlier draft of this migration shipped a boolean and its own setter.
--    Nothing reads either any more; drop them so the schema has one answer about
--    a match's clock rather than two that can disagree.
drop function if exists public.set_private_match_untimed(uuid);
alter table public.matches drop column if exists untimed;
