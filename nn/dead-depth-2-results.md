# Depth-2 dead-certificate batch, 2026-09-18

Resumes the depth-2 (`--dead-batch --depth 2`) run that was interrupted on 2026-09-17. That
session's scratch files (seeds, depth-1 verdicts, partial depth-2 output) lived only in its
container and are gone; this run regenerates them from the same recipe and the same source game
files, then completes the batch.

## Recipe

1. **Game files.** `nn/data/retro*.jsonl` plus 47 `retro-ratchet-2026091[67]*` files that live only
   on branch `claude/board-game-video-adaptation-cf8a93` (extract with
   `git show origin/claude/board-game-video-adaptation-cf8a93:nn/data/<f>` into a scratch dir and
   pass that dir as `dirs[0]` to `harvest-dead-seeds.js`).
2. **Harvest** (`nn/harvest-dead-seeds.js <scratchDir>` -> `nn/dead-batch-seeds.jsonl`): for every
   seed game (tag ending `-0-0` or `-N-0`) with a decided outcome, take the loser's row `k` moves
   before the end for `k` in 1..8, deduped by pose to 2 decimals. 1322 seeds: 334 each of k=2,4,6,8.
3. **Depth 1** (`node nn/dead1-batch.js [maxSeconds] [threads]` -> `nn/dead1-depth1.jsonl`):
   `deadCertificate(pieces, mover, REPLICA, {screen:true})` then the full certificate over the 334
   k=2 seeds. 2026-09-18 result (36 min, 4 threads): 84 dead / 14 escape / 52 unresolved / 184
   screen-escape.
4. **Depth-2 candidates** (`nn/dead2-depth2-candidates.jsonl`): the k=4 seeds whose *own game's*
   k=2 row is certified dead in step 3 (matching by `file` and `g` together -- matching by `g`
   alone is wrong, since several of the older `retro-*` games all share the literal tag
   `retro-0-0`). 84 candidates.
5. **Depth 2**:
   ```
   node nn/forced-win.js --dead-batch nn/dead2-depth2-candidates.jsonl --depth 2 --only 4 \
     --childDead nn/dead1-depth1.jsonl --memo nn/dead1-depth1.jsonl \
     --games <retro-today dir> nn/data --threads 4 --maxSeconds <budget> --out nn/dead2-depth2.jsonl
   ```
   Resumable via `--out`; a `timeout` row is retried from scratch, so a slice needs to be longer
   than one seed. Run in four slices (2h, 2h, 2.5h, 3h) on 4 idle cores, ~10 h wall / 27 core-hours
   total. Per-seed cost: median 6 min, mean 18 min, max 2.6 h (the per-seed cost has a long tail;
   short slices as tried on 2026-09-17 -- 480-540s -- never finish even one seed).

## Result (all 84 candidates resolved)

| certified | escape | unresolved | timeout |
|---|---|---|---|
| 1 | 75 | 8 | 0 |

- **Certified**: the k=4 row of `retro-pw0dv6b4-2026-08-21T13-08-06-498Z` (blue to move, pose
  `[4.4855,-41.6478,7.2017,-0.0716,-29.047,2.7667]`), worst margin 0.105u, one witness arm, engine
  agrees on 20/20 random playouts.
- **Unresolved (8)**: every one fails at a single 0.4-degree substep gap on one reply arm where the
  two ends are certified by different witnesses (or a throw and a witness) with no common
  certificate at the engine's own substep resolution. Five of the eight have an end value under
  0.25u -- thin at the level-1 margin already, not just at the gap rule.
- **Escape (75)**: 51 have zero candidate dead children on the refuting reply at all; 40 escape
  within the first 3 degrees of a reply arm. The k=2 death that made these seeds candidates was
  mostly a blunder one move earlier, not part of a forced loss two moves out.

Full per-seed rows in `nn/dead2-depth2.jsonl` (one JSON object per seed, same schema as
`--dead-batch`'s `--out`: `certified`, `status`, `worstMargin`, `why`, `witnesses`, `engine`,
`stats`, `seconds`, ...).
