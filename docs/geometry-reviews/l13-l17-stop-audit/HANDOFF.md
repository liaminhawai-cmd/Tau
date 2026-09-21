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
  positions the defect accounts for **more than half of the dense test's false-dead rate** (3.5% →
  1.4% with the epsilon). The budget was never binding — 160 stops was not reached once — so
  "budget exhausted" and "no counterexample found" are cleanly separable in this corpus.
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

## Failed checks and blockers for task B

1. **The L17 ablation matrix cannot run on `main`.** Four of the eight rows in the task's table
   name internal L17. It has to be run on the L17 branch, and that branch has neither the Committee
   nor the Champion rung, so "the best challenger against the strongest rung we have" has no
   revision to run on. Someone has to decide whether to port L17 forward onto `main` or to port the
   Committee back; porting L17 forward is the smaller diff and is what the rest of this assumes.
2. **The ablation switches do not exist.** `deadDeg`, `deadStops`, `guardCands` and `guardReplies`
   are already per-rung options, so "dense only" and "guard only" are option values — but there is
   no flag that bypasses `deadCertVerdict`, so the "table off" rows need one line in
   `ladderPlanDead`. That is the first patch task B needs.
3. **The 2° fixture cannot be the L13/L17 regression example.** Both already refute it. It remains
   a valid L11 regression example and nothing more.
4. **No equal-time comparison is possible for ladder rungs today.** Either the first comparison is
   labelled fixed search plus measured runtime, or someone adds a real clock to the ladder path —
   which means a budgeted search with a legal completed fallback, i.e. a change to how the rungs
   play, not a flag.
5. **The historical 96-game L17 result cannot be re-run against the advertised corpus** without
   writing a loader. Its "no hits" number is about 8 hard-coded poses.

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
`freeze-sets.js`, `frozen-sets.json`, `results/` (raw JSON from each run), `patches/`.
