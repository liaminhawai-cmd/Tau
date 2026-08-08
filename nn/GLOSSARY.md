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
- **dual net / dual-head net** (`dualnet.js`'s `DualMLP`) — one shared tanh trunk with BOTH heads
  wired off its last hidden layer: a value scalar (tanh, same convention as the value net) and
  policy logits (linear, same convention as the policy net), so a search node that wants a score
  AND a move prior pays for one forward pass instead of two. Trained jointly on the GPU (if
  available) by `torch-train-dual.py`, straight from `policy-targets.jsonl` — every row there
  already carries a value target `z` alongside its `arm`/`bin` policy target, so no new data has
  to be mined. `nnai.js`'s `dual` option always supplies the leaf evaluator (like `net` does for a
  plain value-net search, at no extra cost); `dualPolicy` is a separate opt-in for also spending
  its policy head on arm ordering/pruning, so a bare `dual:` arena brain is a clean, directly
  comparable value-head-only test against a plain `nn:` brain, and `--dualPolicyA` is the actual
  fusion question (one forward pass vs a separate value net + policy net). Whether the joint
  objective helps, hurts, or is a wash for either head is an open, measured question, not assumed.
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

## Search cost, measured (`nnai.js`)

Why pruning arms buys less wall-clock than it looks like it should — the answer turned out to be
Amdahl's law, not diminishing returns, and naming the six things Amdahl's law was about is what
made that legible.

- **Amdahl's law / the Amdahl argument** — the general principle that speeding up one part of a
  computation caps overall speedup at `1/(1 - that part's share of total time)`, no matter how much
  faster that part gets, because everything else keeps costing what it always cost. Applied here as
  `T = S*(sweep ratio) + F`: search time splits into sweep-proportional work `S` and a fixed
  remainder `F` that six unrelated costs (below) contribute to but arm count doesn't touch. Solved
  from real depth-3/keepForDepth-4 measurements at `S≈1687ms, F≈636ms` — which then *predicts* the
  arms-2 time as `1687/3 + 636 = 1198ms`, exactly what was independently measured. Consequence: even
  pruning every arm down to zero sweeps caps speedup at `(S+F)/F ≈ 3.7x`, below the 4-6x a single
  extra ply costs, so arm pruning can never bank a ply — not because the pruning itself is somehow
  imperfect (it's exactly linear, confirmed by counting real sweeps: 6→2 arms = exactly 3.00x fewer),
  but because the un-prunable remainder sits just below the price of admission for going one ply
  deeper. `keepForDepth`, by contrast, compounds every ply and clears that bar easily (8.04x at
  keep-1) — see the header comment in `nnai.js` for the full arms-vs-keepForDepth numbers.
- **engine snapshot/restore per candidate** — `eng.takeSnap()` / the `restore()` closure (`nnai.js`
  lines 158-164, called again at 220, 313, 334), taken once before trying a candidate's swing and
  used to roll the engine back to it afterward so trying move N+1 never sees move N's side effects.
  Paid once per candidate regardless of how many arms survive pruning — part of `F`, not `S`.
- **candidate sorting** — `cands.sort((a, b) => b.s - a.s)` (`nnai.js:257`), ordering the swept
  waypoints by smoothed score before the depth-2+ loop spends a deep search only on the top `keep`
  of them. One sort per node, whatever the arm count — flat cost, part of `F`.
- **plateau smoothing** — averaging each non-throw waypoint's score with its immediate neighbours
  before ranking (`nnai.js:221-230`) so an isolated spike or good-bad-good alternation doesn't get
  mistaken for a real local optimum; throws are excluded from the average entirely
  (`isThrow = w.v >= 1e5`) since a throw's value is an engine-exact sentinel, not a noisy sample. The
  same per-waypoint pass also accumulates roughness (how jagged a sweep is, normalized against
  `ROUGH_REF = 0.0225`, the measured median roughness over 158 real positions), which feeds the
  (currently off-by-default, inconclusive) adaptive-`keepForDepth` budget. Cost scales with waypoints
  swept, same as the sweep itself, but the neighbour-lookup and threshold checks are per-node
  overhead layered on top of it either way.
- **quiescence screening** — `opponentHasThrow(eng, victimIdx)` (`nnai.js:110`, `attacker = 1 -
  victimIdx`, its own `takeSnap()`/restore) screens the top few ranked candidates for an immediate
  opponent throw reply before trusting the ranking, promoting the first one that survives. Cheap
  (physics-only, no recursive search) but still per-candidate, still indifferent to arm count — part
  of `F`.
- **feature extraction** — building the 94-number canonical feature vector (`features.js`'s
  `moveFrame()`) so a value-net `evalFn` can score a position. Paid once per node the value net is
  asked to judge; a hand-tuned `evalFn` like `laddereval.js`'s skips this entirely, which is part of
  why `le:L11` and the trained net aren't apples-to-apples on raw speed either. Flat per-node cost,
  part of `F`.
- **recursion bookkeeping** — the overhead of the search's own recursive machinery: threading
  `evalFn`/`sweepDeg`/`depth`/`keepForDepth`/`abCut`/`cutIfAbove` down through each `nnPlanFor` call,
  building the option object for the opponent's reply, unwinding results back up. Independent of arm
  count, so — like the other five — it doesn't shrink when arms are pruned, and it's what keeps `F`
  above zero even in the limit of a single-arm search.

- **antisymmetric evaluator** — an evaluator where `eval(me) == -eval(them)`, i.e. one side's gain
  is exactly the other's loss. `nnai.js` used to score every swept leaf as `-evalFn(eng, 1 - idx)`
  (evaluate from the opponent's view, negate), which *silently requires* this property. The value
  net, trained on `z`, approximately has it. `ladderEval` does not: `park` sums over `pieces[idx]`
  only, `oppFree` over `pieces[1-idx]` only, `triMe` over `me=idx` only — three one-sided terms, and
  `park` carries L11's second-heaviest weight (8). Measured on real played positions:
  mean `|ladderEval(0) - (-ladderEval(1))|` = 24.9, **sign disagreeing outright** at plies 0, 2 and
  4. That made `le:L11` a frequently sign-flipped number rather than L11's judgement, and it lost
  **0-42** to the real L11 across seven policy-loop cycles before anyone read the negation. Fixed by
  making the contract explicit — every call site now asks for `idx`'s score directly, and the
  default value-net evaluator does the flip itself (verified bit-identical, 48/48 searches).
  The lesson worth keeping: *a pluggable seam inherits every assumption the old inlined code made,
  including the ones nobody wrote down.*

- **L11 clock match** (menu 38, `l11-clock.js`) — a `leL11-vs-L11` comparison that holds L11's own
  THINK TIME constant instead of holding search width constant, the way the full loop's
  `leL11-nopolicy vs L11` matchup does. The full loop's version isn't a fair fight even with the
  antisymmetric-evaluator bug fixed: `keepForDepth` defaults to 4 everywhere `policyloop.js` never
  overrides it, against L11's own `maxCands 28` — a 7x width disadvantage — on top of a random
  1-30s clock that may not afford L11's guaranteed depth 3 at all. That's a real result (how much a
  narrow, clock-gated search costs L11's judgement), just not the same question as "is L11's own
  judgement better served by nnai's search machinery, given the time it already spends." `l11-clock.js`
  measures the median of the local machine's own real per-move L11 times first (median, not mean —
  a small early pass found 2.8-4.2s typical but occasional moves in the 17-38s range, and a mean
  built from that would hand leL11 a budget dominated by rare expensive positions), then feeds that
  number to a matchup. Measured per-machine, deliberately: a laptop and a desktop don't take the
  same wall-clock time for the same fixed-depth search, so the number can't be borrowed from a
  different run. One real machine's median came back at ~20s -- meaning BOTH sides of this matchup
  spend real per-move time, so `arena.js`'s normal one-process/sequential-games behaviour turns a
  60-game sample into many hours. `l11-clock-match.js` (not `l11-clock.js` directly) is what menu 38
  actually runs: it measures the clock once, splits the game count across `cores-1` parallel
  `arena.js` lanes (same idea as the full loop's 12 lanes, applied to one matchup), and pools every
  lane's `--resultsJsonl` into one verdict — the same `komiLoss`-weighted scoring `arena.js`'s own
  summary line uses, so a merged run reads exactly like one long run would have.

- **park stop / park exemption** (`--parkStops`, `nnai.js`) — a **park** is a foot resting within
  `PARK_HI` (0.34) of a printed line but outside `PARK_LO` (0.05) — just off the centreline, magnet
  still on the ink. `ladderEval` pays 8 per parked foot, its second-heaviest term after `zone`.
  The band is *narrower than one 3° sweep step* (≈2.1 units of arc), so a park is **always** an
  isolated spike whose immediate neighbours are always unparked — which means `nnai.js`'s plateau
  smoothing, which exists to pull down exactly such spikes as probable evaluator noise, destroyed
  most of the term by construction. Measured under L11's weights: a park stop scoring 23.24 raw
  smoothed to 16.41, losing ~6.7 every time its neighbours were unparked. The ladder rungs hit this
  identical bug once already — `ladderRoots3`'s own comment records **L8 falling from ~63% to ~43%
  vs L7** when coarse sampling stopped landing real parks, which is why it grew a dedicated park
  recorder whose candidates ride along *exempt* from the `keepStops` cap. `--parkStops` gives
  `nnai.js` the same exemption (parks bypass smoothing exactly as throws do). **Off by default**, so
  every value-net search stays bit-identical: the value net reads parks through `features.js`'s
  `exp()` indicator rather than one heavy weight, and smoothing a *learned* evaluator's spikes is
  the behaviour that block was designed for. Deliberately NOT auto-enabled for `le:` brains either —
  `policyloop.js`'s running tournament pools `le:L11` results under a scheme tag, and silently
  changing what that brain *is* mid-run would mix two different brains into one number.
  Consequence worth keeping: `laddereval.js`'s premise that it "unwelds" L11's judgement from its
  search is only *partly* achievable — ladderEval's park term is only meaningful if the search
  generates park candidates, which is a property of the search, not the evaluator.

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
| `l11-clock.js` | measures L11's own median per-move think time on the local machine |
| `l11-clock-match.js` | multi-lane `leL11 vs L11` run at that budget -- menu 38's actual entry point |
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
- **engine-cache** (`nn/.engine-cache.json`) — same pattern applied to `engine.js`'s
  `buildEngineSource()`, which re-parses `index.html`'s top-level defs and re-walks their
  dependency closure (a fresh `RegExp` built and tested per candidate name, every call) to derive
  the sandboxed engine every `createEngine()` needs. Measured cost with no cache: 350-420ms, paid
  in full by *every* process that calls it — every retromine/selfplay worker at startup, and every
  `arena.js` matchup `policyloop.js` spawns fresh (19 per full-loop cycle) — none of it amortised
  against real game-playing time, all of it a pure function of bytes that rarely change. Cached on
  `(mtimeMs, size)` of `index.html`, same as mine-cache: 350-420ms cold, ~3ms warm, byte-identical
  output either way. A miss or unreadable/corrupt cache falls straight back to the unchanged
  rebuild path, so this can only make a run faster, never wrong.
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
