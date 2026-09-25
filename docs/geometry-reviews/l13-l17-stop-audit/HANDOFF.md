# Handoff — Opus task A

21 September 2026. Companion to [README.md](README.md). Written for whoever picks up task B, and
for Astra on the two questions at the end.

## Completed

- **A1** `reproduce.js` re-run against the pinned checkout and against current `main`. Identical to
  `result.json` in both. Recorded that the two runs execute the same `nn/engine.js` bytes, so the
  second is not independent confirmation.
- **A2** Ladder mapping verified against the live `AI_LADDER` on both revisions, not from a
  document. Internal L17 is **not on `main`**; it exists only on
  `claude/board-game-video-adaptation-cf8a93`.
- **A2** Every defender stop L11, internal L13 and internal L17 examine at the audited post-root
  position, recorded at the line each search commits to a reply, against a 0.25° ground-truth escape
  set under both call schedules.
- **A3** `ladderDeadEscape`'s stride, budget and early exits audited; a dropped-mark defect found,
  quantified, and traced to three further sites that are on production `main`. On 150 frozen dev
  positions the aggregate false-dead rate falls from 3.5% to 1.4% with the epsilon — **but this is
  not a monotonic recovery**: the changed verdicts are four recovered counterexamples and one lost
  one (`arenamujedgps-1`, k=0 — flagged by Astra/GPT, verified: shipped marks land at 9°/15°/24° and
  catch a counterexample at 15°; tolerant marks land at 6°/12°/18°/24° and miss the same window
  entirely, because accepting one mark earlier resets `lastMark` and shifts every later one). See
  README.md's correction. The budget was never binding — 160 stops was not reached once — so "budget
  exhausted" and "no counterexample found" are cleanly separable in this corpus.
- **A4** Certificate table and loader audited. There is no loader.
- **A5** Development and held-out sets frozen by game family, with source hashes.
- **Equal-time gate** settled: ladder rungs ignore every `--timeMs` flag.

## Not done, and why

- **No arena match, no Elo.** Task A is an audit; the matrix in task B needs switches that do not
  exist yet (see below). Nothing here is a strength claim.
- **No selective interior-stop challenger.** The task says to implement it only after the existing
  searches are audited. That audit is this document; the challenger is the next patch.
- **No trainer restarted**, per the request.
- **The stride fix is supplied as a patch, not applied.** It changes how every rung from L3 up
  generates root candidates in the shipped game, and on 60 frozen dev positions it changes **56.7%
  of L11's moves** and 53.3% of internal L13's. Whether those moves are better is unmeasured — that
  needs an arena match, which task A does not run. "Preserve existing game rules and public ladder
  until an evidence-backed change is reviewed" applies squarely, so it sits in `patches/` with the
  move-change rate attached and waits for a decision. **It should be the first thing task B
  measures**, ahead of the L17 ablations: it is a bigger effect on the shipped ladder than anything
  the ablation matrix is designed to detect, and every ablation run before it is measuring a grid
  that is not the configured one.

## The component tests are now implemented

`claude/l17-ablations`, commit `d36c22548`, branched off the pinned revision. It closes blockers 2
and 4 below and adds one that was not on the list.

- **Switches.** `ladderPlanFor` takes a per-call options override; `nn/arena.js` reaches it as
  `L<n>+cfg:k=v`; `ladderPlanDead` honours `deadTable` / `deadDense` / `deadGuard`. All default on,
  `AI_LADDER` is never mutated, and the cfg string rides in the brain name so two option sets cannot
  pool as one row. The stride tolerance is exposed the same way as `markEps`, default 0 — so it is a
  measurable row rather than an unreviewed change to shipped play.
- **Self-test.** With all three off, `ladderPlanDead` must reduce to `ladderPlan3`.
  `ablation-matrix.js` asserts it against L11 move for move and aborts if it fails. It passes, and a
  bare `L17` reproduces this packet's pre-change numbers exactly.
- **A blocker that was not on the list: the arena had no shared openings.** `opening.js`'s header
  already says deterministic brains replay one game per colour without forced opening plies — but
  `openingPlies` defaults to 0 and a bare `L<n>` spec pins the corner coin off, so nothing varies.
  Measured: **L4 vs L5 over six games produced exactly two distinct games** (30 and 120 plies, three
  times each) and printed "3-3, +0 +/- 284 Elo" from an n of 6 when the real n was 2. `--openingSeed`
  / `--openings` / `--openingsOut` now give a seeded, saved, shared list, paired so that games `2i`
  and `2i+1` are one opening with the seats swapped. `paired-elo.js` resamples those pairs.
- **60-position readings, complete.** L13 differs from L11 on 13/60 moves at 2.73x cost; L17 on
  4/60 at 1.38x, entirely from the guard (guards=63, guardHits=53, declined=53); dense and the
  table each independently produce 0/60 differing moves. `markEps=1e-9` changes 34/60 L11 moves
  (56.7%) — an exact match to `claude/l13-l17-stop-audit`'s independently-written `root-stride.js`
  on the same frozen split, a useful cross-check between the two scripts.
- **Dense's 0/60 needed a second look, and it was a fixture problem, not an L17 problem.**
  `screened-not-dead.jsonl`'s `mover` is by construction the endangered/escaping side (its own
  header says so), never the side with a winning continuation — and dense only fires on a candidate
  the ASKED mover's own `ladderScore3` already scores as a forced win, which that mover essentially
  never has. Asking the OPPONENT's move on `dead-points-mined.jsonl` (mover there is CERTIFIED
  dead, so 1-mover is the winning side) fires dense on **60 of 60 positions**, 827 total
  activations, refuting 442 (53%) — L11's own forced-win claim is wrong more than half the time when
  actually challenged on the right corpus. Confirmed again in real play: the 16-game smoke match's
  `--deadStats` line shows dense firing 91 times in-game, refuting 48 (53% — same rate).
  `dense-ablation.js` is the matching component run on that corpus/perspective.
- **L17 is now ported onto a main-based harness** (`claude/l17-on-main`, commit `382b03f5f`),
  closing blocker 1 below. Verified against the research branch with a 420-call cross-branch
  comparison, not just self-tested; one gap found (the `markEps` patch had only reached
  `ladderDeadEscape`, not the two root-sampler sites) and fixed, then re-verified both in isolation
  and in-sequence. See `claude/l17-on-main`'s `docs/geometry-reviews/l17-ablations/PORT-README.md`.

Rows whose `moves != L11` is 0 (dense, table) cannot differ in a game either and should not be
bought matches on this corpus; the guard row and L13 can. The frozen protocol for the match stage is
`docs/geometry-reviews/l17-ablations/PROTOCOL.md` on `claude/l17-ablations`.

## Failed checks and blockers for task B

1. **~~The L17 ablation matrix cannot run on `main`.~~ Done — see above; `claude/l17-on-main`.**
   Originally: four of the eight rows in the task's table name internal L17. It has to be run on the
   L17 branch, and that branch has neither the Committee nor the Champion rung, so "the best
   challenger against the strongest rung we have" has no revision to run on. Someone has to decide
   whether to port L17 forward onto `main` or to port the Committee back; porting L17 forward is the
   smaller diff and is what the rest of this assumes.
2. **~~The ablation switches do not exist.~~ Done — see above.** Originally: `deadDeg`, `deadStops`, `guardCands` and `guardReplies`
   are already per-rung options, so "dense only" and "guard only" are option values — but there is
   no flag that bypasses `deadCertVerdict`, so the "table off" rows need one line in
   `ladderPlanDead`. That is the first patch task B needs.
3. **The 2° fixture cannot be the L13/L17 regression example.** Both already refute it. It remains
   a valid L11 regression example and nothing more.
4. **No equal-time comparison is possible for ladder rungs today** (the protocol now labels every
   comparison "fixed search plus measured runtime" instead). Either the first comparison is
   labelled fixed search plus measured runtime, or someone adds a real clock to the ladder path —
   which means a budgeted search with a legal completed fallback, i.e. a change to how the rungs
   play, not a flag.
5. **The historical 96-game L17 result cannot be re-run against the advertised corpus** without
   writing a loader. Its "no hits" number is about 8 hard-coded poses.

## Independent replay of the arm-2 propagation

[`verify-arm2-propagation.md`](verify-arm2-propagation.md). The composed enclosure at
`codex/l11-stop-audit` `e65124f9d` reproduces bit-for-bit on a different machine and a different
Node major version: across ~31,800 lines the only differences are two timing fields, one runtime
string, and the hashes those change. Clearance `0.03513881297003251u`, 380 corrections, 41 engine
cases with 4,592 containment checks and no failures — all identical.

It also discharges part of one of that package's own open obligations: the 112 recorded attacker
poses are byte-identical on Node v22.22.2 and v24.19.0, so the path is not a v24 artefact. Two
runtimes is not the uniform floating-point bound obligation 1 asks for, and the note says so.

Also recorded there: the geometry proof's pinned source and internal L17 are **the same revision**,
`claude/board-game-video-adaptation-cf8a93`, and it is not `main`.

**22 September addendum**, same file: `codex/arm2-replay-continuation` `62cb75ac2`'s 1e-8-per-mass-
coordinate disturbance result also reproduces exactly (clearance `0.025962128186932883u`, the 1e-7
failure mode, and `check_budget.py`'s `1.9735434015526995e-09` local error bound) — verifying the
reported numbers, not the argument connecting them to engine arithmetic, which the document itself
lists as still open.

## Reply-band maps

Astra's request, answered in full: [`reply-band-maps/`](reply-band-maps/) — the Brief 6 original
seed, 10 frozen development families, and a 3-position certified-dead spot check, all swept under
both call schedules. **Zero of 14 positions have a single stop where all six attacker endpoints
throw the defender** — not even on the certified-dead positions. Confirms Astra's D_E/D_1
distinction empirically: covering these positions the way the L11-audit fixture worked (contiguous
D_E bands) will not work; the real winning replies are apparently interior stops far more often than
swing-to-jam endpoints. See `reply-band-maps/SUMMARY.md`.

## Questions for Astra

1. **Is the escape band a fact about this position or about the punishment test?** At the audited
   position the defender escapes on a contiguous 2°–20.5° band on one arm and 2°–18° on another, by
   the operational test "no single swing-to-the-jam answer throws me". That is a one-ply test. The
   dead certificates are defined over the same shape. If a dead region is meant to be a statement
   about *every* continuation rather than about one reply ply, then the dense test's notion of
   "escape" and the certificate's notion are not the same predicate, and the rung is falsifying
   L11's claims against a weaker standard than the corpus was certified to. Which predicate should
   the in-game test use?

2. **What tolerance is sound for a stop grid over a finite map?** The mark rule
   `a - lastMark >= step` fails by one ULP because `|netRad|` is accumulated through `applySwing`'s
   substep loop. Widening it to `step - 1e-9` restores the intended grid, but it also changes which
   finite positions the search can reach, and the handoff is explicit that changing the calling
   schedule changes the finite map. Is a tolerance on the *mark* (which only chooses which reachable
   stops get examined, never which stops exist) safe to treat as a pure coverage change, or does
   anything downstream depend on the current mark set?

## Files in this packet

`README.md`, `HANDOFF.md`, `stop-coverage.js`, `dense-stride.js`, `root-stride.js`, `move-cost.js`,
`freeze-sets.js`, `frozen-sets.json`, `verify-arm2-propagation.md`, `reply-band-maps/` (mapper,
results, `SUMMARY.md`), `results/` (raw JSON from each run), `patches/`.

Related branches: `claude/l17-ablations` (component switches + protocol, on the research branch),
`claude/l17-on-main` (the same switches, with L17 ported onto a main-based harness so it coexists
with the Committee/Champion rungs).
