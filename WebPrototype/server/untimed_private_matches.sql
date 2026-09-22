-- ============================================================================
-- Migration: private matches may opt out of the turn clock.
-- ----------------------------------------------------------------------------
-- The turn clock exists to stop a stranger in the ranked queue holding
-- someone's evening hostage. Two people who swapped an invite code are not
-- strangers, so "Create a match — no clock" lets them play without one. Both
-- clients have to agree, or one would pass the other's turn out from under
-- them, so the flag lives on the match row that both of them already read.
--
-- Written through an RPC rather than a client UPDATE on purpose: schema_matches
-- revokes insert/update/delete on public.matches from authenticated outright,
-- so that a client can never fabricate a match or edit its result. That stance
-- is worth keeping for one boolean -- this follows cancel_private_match's
-- shape instead (SECURITY DEFINER, and it checks who is asking).
--
-- Safe to apply at any time, and safe NOT to apply: index.html calls this in a
-- follow-up it deliberately allows to fail (see createPrivateMatch). Until this
-- runs, "no clock" quietly creates an ordinary timed match. Nothing breaks.
--
-- Idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- 1) the column. NOT NULL DEFAULT false, so every existing row -- and every row
--    the unchanged create_private_match() writes -- is timed, which is exactly
--    what those rows mean today.
alter table public.matches
  add column if not exists untimed boolean not null default false;

-- 2) the creator's one permitted write. Scoped hard: only the player who made
--    the invite, only while it is still waiting for someone to join, and only
--    ever this one column. Once someone has joined, the setting is fixed --
--    neither side can take the clock away mid-match.
create or replace function public.set_private_match_untimed(p_match_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.matches set untimed = true
    where id = p_match_id and blue_id = auth.uid() and status = 'waiting';
$$;
grant execute on function public.set_private_match_untimed(uuid) to authenticated;
