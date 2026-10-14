-- ============================================================================
-- Migration: the net rungs (levels 11 and up) were rebuilt -- archive their clears.
-- ----------------------------------------------------------------------------
-- From October 2026 a rung from 11 up holds a trained net only if it beats every rung below it,
-- as Blue and as Red, on the shipped code. Rebuilding that chain changes which brain sits behind
-- a level number, so a clear recorded on level 11+ was won against an opponent that may no longer
-- be there, and level_stats()' "beaten by" figure for it would describe the old opponent.
--
-- The game drops its own saved clears from rung 11 up at the same moment (resetChangedNetRungs in
-- index.html). This moves the matching server rows into an archive table instead of deleting
-- them, tagged with when they were archived, so nothing is lost. Rungs 1-10 are untouched.
-- ladder_wins (the replayable wins over the nets) is left as it is: those games still happened.
--
-- Apply in the Supabase SQL editor when the rebuilt ladder ships. Safe to re-run: a second run
-- only archives clears recorded since the first.
-- ============================================================================

create table if not exists public.level_clears_archive (
  like public.level_clears including defaults,
  archived_at timestamptz not null default now()
);
alter table public.level_clears_archive enable row level security;
revoke all on public.level_clears_archive from anon, authenticated;

with moved as (
  delete from public.level_clears where level >= 11 returning *
)
insert into public.level_clears_archive select moved.*, now() from moved;
