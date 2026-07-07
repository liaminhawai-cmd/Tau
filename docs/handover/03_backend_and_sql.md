# Tau — backend & SQL reference

Backend is **Supabase** (Postgres + Auth + Realtime). All privileged logic is in `SECURITY DEFINER`
functions; clients can't write matches or ratings directly. SQL source lives in the repo under
`WebPrototype/server/` (`schema.sql`, `schema_matches.sql`, `schema_private.sql`,
`apply_to_live_db.sql`). `apply_to_live_db.sql` is the running list of patches to paste into the
Supabase SQL editor.

## Tables
- **`profiles`** — `id`, `username` (unique, `^[A-Za-z0-9_]{3,40}$`), `elo`, `wins`, `losses`.
  Created by the `handle_new_user` trigger on `auth.users` (defaults to a `Player_<hex>` handle).
- **`matchmaking_queue`** — `user_id`, `elo`, `last_seen`.
- **`matches`** — `blue_id`, `red_id`, `blue_elo`, `red_elo` (snapshot at creation, display only),
  `status`, `winner_color`, `created_at`, `finished_at`, `rematch_of`, `invite_code`.
- **`match_moves`** — one row per turn: `keyframes` (sampled trajectory) + `final_state`
  (authoritative). The other client replays keyframes; never re-simulates.

## Key functions (RPCs)
- **`try_match()`** — joins the queue and pairs the closest-rated waiting opponent.
- **`finish_match(match_id, winner_color)`** — records the result; for **public** games updates ELO
  and win/loss. **Private (`invite_code` set) games record the result but never touch rating.**
- **`rematch(prev_match_id)`** — creates the rematch; carries a private code forward if the source
  was private (so friends can't rematch a private game into a ranked one).
- **`gc_stale_matches()`** — clears abandoned matches.
- **`recompute_all_elo()`** — one-time admin repair (see below).
- Triggers: `handle_new_user` (assigns default handle), `check_username_clean` (leetspeak-folded
  profanity guard), plus a `profiles_username_format` CHECK.

## ELO
- Standard Elo, **K = 24**, starting rating **1200**.
- **Important fix (applied):** `finish_match` now rates each result off each player's **current**
  profile ELO, not the ELO *snapshot* stored on the match at creation. The old snapshot approach
  didn't compound across a player's games (a later-finishing match overwrote earlier gains), which
  made standings drift out of line with win/loss records. Live ELO makes each result build on the
  last, like `rematch()` already did.
- Private/casual games do **not** affect rating (guards against invite-link farming).

## Repairing existing standings — `recompute_all_elo()`
Because the old formula had already corrupted ratings, there's a one-time rebuild: it first
**normalizes any legacy out-of-format username** (older rows like `H.Y. G-K` were grandfathered by
the `NOT VALID` CHECK and would otherwise block row updates — and would break `finish_match` the next
time that player plays), then resets everyone to 1200/0/0 and **replays every finished public match
in finish order**, producing a clean, self-consistent ladder. Run once in the SQL editor:
`select public.recompute_all_elo();` — safe to re-run (rebuilds from scratch).

## Waitlist (physical game)
`public.waitlist` (apply_to_live_db.sql **section 9**): email capture from the site's "Get Tau in
real life" line. Insert-only for everyone (incl. signed-out); **no API read access** — export from
the SQL editor: `select email, interest, lang, created_at from public.waitlist order by created_at;`
→ Download CSV. Unique on `lower(email)`; the client treats a duplicate as already subscribed.
`interest` records what they signed up for: `diy` (free print-and-play files), `kit` (the full
shipped set), or `both`. `lang` records the UI language at signup.

## Most-watched replays
`matches.save_count` + `bump_save_count(mid)` RPC (apply_to_live_db.sql **section 10**): a counter
of how many times each finished match has been saved to a collection, powering the Watch menu's
"Most watched game" pick. Fully additive — the client no-ops the bump and hides the pick until this
section is applied, so nothing breaks in the meantime. Bump is granted to anon + authenticated (a
save is a save; guests count too). No spam guard beyond that; dedupe by (match, user) later if it
ever gets gamed.

## What has / hasn't been applied to the live DB
Track this here as you go. As of this pack:
- Applied by owner: stale-match GC (5), spectating (4), live-ELO `finish_match` (7) and
  `recompute_all_elo()` (8, run once — standings rebuilt; legacy usernames normalized).
- **Needs running: section 9 (waitlist table, now with `interest`)** and **section 10 (save_count +
  bump_save_count)** — both fail gracefully / no-op until applied. Section 6 (username hygiene) worth
  confirming.
- **Keep this section current** — it's the single most useful thing to know before touching the DB.

## Known backend limitation
`finish_match` trusts the client-reported winner (no server-side move validation). Acceptable for a
casual beta; the hardening pass would validate moves server-side. See `05_backlog`.
