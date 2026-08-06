# Tau NN glossary

Reference for the terms, tags, and thresholds that show up across this codebase and its logs.
Regenerate/update by hand — this isn't wired to any script, just written down so it stops living
only in chat history and commit messages.

---

## The two neural nets

- **value net** (`net.js`'s `MLP`) — scores a position with one number in `[-1, 1]`: how good it
  looks for the side to move. Trained on `z`. `best.json` is the promoted flagship value net used
  everywhere as the default.
- **policy net / policy head** (`policy.js`'s `PolicyMLP`) — predicts which move a *strong* mover
  would play from a position, not how good the position is. Same MLP shape as the value net, but
  the final layer is linear (not tanh) and feeds two softmax groups: **arm** and **bin**. Trained
  by `train-policy.js` on targets `policy-targets.js` mines.
- **z** — the discounted terminal-outcome label every self-play row carries: sign = who wins,
  magnitude = `discount ^ (plies to end)`, so it rises toward ±1 as a game nears its finish.

## Move geometry

- **arm** — 1 of 6 canonical move choices: which of the mover's 3 feet pivots (**slot**, 0-2) ×
  which of 2 canonical directions. `armIndex(slot, canonDir) = slot*2 + (canonDir>0 ? 0 : 1)`.
- **bin** — 1 of 16 buckets over swing magnitude, up to the 170° safety cap (`CAP_RAD`).
- **slot** — a foot's rank by distance from the board center within the canonical frame: 0 =
  outermost, 1 = middle, 2 = innermost. (`sortedFeet()`, descending radius.)
- **pivot foot** — the one foot of the mover's piece that stays put during a swing; the other two
  sweep around it.
- **canonical frame / `moveFrame()` / mirror** — the position-normalized coordinate system the
  feature vector and policy outputs both live in: feet sorted by radius, the whole position
  mirrored so the opponent always lands on the same canonical side. This is what removes
  left/right and raw-foot-label symmetry, so the same tactical shape always maps to the same arm
  regardless of which physical foot or world direction it happens to use.
- **throw** — the winning move (pushes the opponent's foot off the rim). Has no successor row in
  self-play logs (nothing was recorded *after* the game ended), so `policy-targets.js` recovers an
  approximate target for it by replaying the mover's own 6 arms with the same contact-physics
  check every brain already uses, and taking the first one that lands a throw.

## Brains & sources

- **L1..L11** — fixed heuristic ladder levels, no search or learning. Roughly increasing strength,
  though not perfectly monotonic on the Elo axis (L8 has rated above L11 in some snapshots).
- **mv tag** — the per-row tag on self-play/arena data identifying which brain produced that move:
  a ladder id (`L7`), a checkpoint+depth tag (`ckpt-105@D2`, `best@D1`), or an arena-format tag
  (`nn(best.json,T2000ms,P:policy-champ)`).
- **@Dn** — the search depth suffix on a net-search mv tag.
- **source weight (`sw`)** — `policy-targets.js`'s per-row trust multiplier, multiplied into the
  training weight rather than used to exclude rows: ladder-mover = 0.25 (same floor
  `eloweight.js` already uses), net below `--minDepth` (default 2) = 0.5, untagged/pre-tagging =
  0.625 (`eloweight.js`'s "neutral" value), full-trust net search = 1.
- **pool-slot-NN** — checkpoints kept in the rating pool specifically for Elo-calibration
  diversity, distinct from the flagship `best.json`.

## Data pipeline

- **retromine** (`retromine.js` / `retroloop.js`) — data generation that takes a position and
  replays it against every brain on a graduated strength axis to find where a losing side stops
  being able to escape.
- **the ratchet / ratchet point** — where that climb crosses into "truly lost": nothing left on
  the axis can escape it. Retromine ratchets forward past that point instead of wasting replays on
  positions already known dead.
- **seed family** — the set of near-duplicate replay games sharing one seed position. In
  retromine's output, *every* game written to one `retro-ratchet-*.jsonl` file is one family
  (confirmed empirically: 4,191 distinct game ids collapsed to exactly 80 families — one per
  file). Matters for training splits: a naive game-level split doesn't protect against leakage
  across siblings from the same family.
- **wildcards** — off-axis brains (e.g. L2, L1) tried before a position is declared dead, in case
  something off the main axis escapes where the axis top failed.
- **worker.js / selfplay.js** — the regular self-play data generators — distinct from both
  retromine and the policy loop.
- **lanes / workers** — parallel worker processes; `retroloop.js` caps at cores-1, `policyloop.js`
  caps its tournament dispatch at `min(cores-1, 12)`.

## The policy loop (`policyloop.js`)

- **champion** — the current best policy-head shape/weights (`policy-champ.json`), what every
  cycle's mutant is measured against.
- **mutant** — a proposed architecture variant (widen/narrow/add/drop a hidden layer), trained
  fresh each cycle and fought against the champion.
- **shape hillclimb** — trying one mutation per cycle and adopting it only if it wins its
  head-to-head. No significance bar on this step by design — "simply being ahead" is the adoption
  bar, since a lucky adoption gets beaten back next cycle at no real cost, and requiring
  significance at 6 games/cycle would make the shape never move at all.
- **adoption** — copying the winning mutant over the champion and recording its shape + epoch
  count in `.policy-champ-shape`, so the next cycle doesn't mistake a fresh champion for an
  interrupted training run and retrain it for nothing.
- **gate / gateFloor (150)** — the pooled-decided-game threshold below which the shape-fight is
  skipped for the cycle — not enough pooled evidence yet to know if there's anything worth
  hill-climbing toward.
- **pooled control / `champ-vs-nopolicy`** — the running total, across every cycle under the
  current scheme, of the champion (with policy) vs a bare net (no policy) at the same clock. The
  one number that answers "does the policy help at all" — a separate question from the shape fight,
  and the reason `policyloop.js`'s own control group is slow (see below).
- **`TARGET_SCHEME`** (e.g. `search-weighted-v1`) — a version tag stamped on every cycle's history
  entry. Changing how targets are mined bumps this, so old and new pooled evidence are never
  silently mixed into one number.
- **realResult** — the loop's plain-English readout of the pooled control's verdict: "not yet
  distinguishable from no policy" / "policy beats no-policy" / "policy is a net LOSS".

## Statistics convention (used throughout, not just the policy loop)

- **2-sigma band** — `± sqrt(0.25/n) * 2` around the observed win rate: the width of the "could
  just be noise" zone around 50% for `n` decided games.
- **verdict: beats / loses / undecided** — `rate - band > 0.5` → beats; `rate + band < 0.5` →
  loses; otherwise undecided.
- Learned hard this session: **a single 24-game arena match essentially never clears this bar on
  its own** (the lower bound needs to clear 50% after subtracting ~±20 points at n=24). That's why
  the policy loop pools across cycles instead of trusting any one cycle's tournament, and why a
  "63% on 24 games" result should be read as directionally suggestive, not proven, until it's
  replicated or pooled.

## Tools, quick reference

| file | does |
|---|---|
| `engine.js` | game physics/rules: piece positions, feet, pivots, swings, collisions, throws |
| `features.js` | builds the 94-number canonical feature vector; `moveFrame()` |
| `net.js` | `MLP` — the value net |
| `policy.js` | `PolicyMLP` — the policy net; `armIndex`/`binIndex`/`binCenter` |
| `train.js` | trains the value net, game-level 90/10 split, `--seed` for reproducible splits |
| `policy-targets.js` | mines policy targets from self-play data; source weighting; per-file cache |
| `train-policy.js` | trains the policy net; z-weight × elo-weight × source-weight per row |
| `eloweight.js` | per-mover training weight from current Elo rating |
| `retromine.js` | single-worker ratchet climb |
| `retroloop.js` | supervises many retromine lanes, periodic commit+push |
| `policyloop.js` | the policy loop: mint → train → tournament → adopt-or-keep → push, forever |
| `arena.js` | head-to-head match runner; reports W-L-D and the 2-sigma band |
| `menu.bat` | the Windows console front-end wrapping all of the above |
| `promote-mutant.js` | manually promotes `policy-mutant.json` → `policy-champ.json` |
| `digest.js` → `claude-digest.md` | crunches local-only files into one pushable summary |

`elo-summary.json` (pushed) = fitted per-brain ratings. `elo-results.json` (local-only, never
force-added) = the raw per-pair W/L/D store underneath those ratings.

## This session's additions

- **source weight softening** — replaced an earlier hard mv/depth exclude filter in
  `policy-targets.js` with the `sw` multiplier above, after the hard-filtered policy champion lost
  its live A/B to both the unfiltered champion (8-16) and to no policy at all (8-16).
- **mine-cache** (`nn/.mine-cache/<cacheKey>/`) — per-file cache keyed on `(mtimeMs, size)` that
  cut a ~2h09m mint down to seconds once warm. Safe because a game never spans files, so each
  file's mined output is a pure function of its own bytes.
- **family-corrected split** — when comparing retromine-only vs non-retromine training data:
  rewriting each row's `g` (game id) to its true seed-family id before training, since retromine's
  "distinct games" are mostly near-duplicate replay siblings and a naive game-level split let them
  leak across train/val, inflating retromine's apparent val accuracy.
- **"L12" / L12 CHECK** — informal shorthand (not a real ladder level) for "is `best.json`'s own
  search now a full rung stronger than the top of the ladder." The actual test is `best.json` at
  depth 2 vs L11, real sample size.
- **`promote-mutant.js`** — written this session to manually copy a hand-tested, winning
  `policy-mutant.json` into `policy-champ.json` (backing up the outgoing champion first) before
  the loop's next cycle silently overwrites it.
- **`retroloop.js`'s `-Af` fix** — `pushData()` was staging with `git add -A nn/data`, but
  `nn/.gitignore` excludes `data/` wholesale, so the add matched only already-ignored paths and
  silently staged nothing new. Mined rows were generated for hours but never left the machine.
  Fixed to `git add -Af nn/data`.
- **`--familyWeight`** (`train.js`, default `sqrt`) — weights retromine's replay families by
  *outcome*, not just game length. Every replay of one seed that fails to escape gets its own
  game id but is a near-duplicate of its siblings; confirmed live that every sampled family had a
  real outcome split (e.g. 71 "still lost" replays vs 5 "escaped" from the same seed). Flat
  per-game weighting let the common outcome outvote the rare one by exactly that ratio, even
  though the rare outcome — an escape found from a position otherwise declared dead — is the one
  exception that actually teaches the net something. Same `1/sqrt(n)` shape as `--gameWeight sqrt`,
  one level up: a family's total say per outcome grows as sqrt of how many replays shared it.
