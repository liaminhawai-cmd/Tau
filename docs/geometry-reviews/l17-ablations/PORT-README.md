# Internal L17, ported onto a main-based harness

22 September 2026. Per Astra/GPT's PR #34 review (task 3 for Opus): "port internal L17 into a
main-based experimental harness with independent dense/guard/table switches. Verify agreement with
the pinned research baseline before ablations."

## Why this exists

The original audit found that no single revision carries both internal L17 (the `kind:'dead'` rung)
and the current top of the player ladder (Committee/Champion): L17 lives only on
`claude/board-game-video-adaptation-cf8a93`, which predates those rungs. So the ablation matrix in
`docs/geometry-reviews/l17-ablations/` on that branch could never compare L17 against the ladder's
actual current top, and any future comparison against `main`'s state needed L17 ported forward.

## What was ported

From `claude/board-game-video-adaptation-cf8a93` onto `main`:

1. **The L11+dead code block** (`DEAD_CERT_EPS` through `ladderPlanDead`, ~250 lines) — copied
   verbatim. Its external dependencies (`ladderRestore`, `takeSnap`, `pinFoot`, `applySwing`,
   `simMoveToLimit`, `ladderEval`, `ladderOppReplies`, `ladderRoots3`, `ladderScore3`,
   `outermostRadU`, `Piece`, `norm`, `CFG`, `HARD_WIN_BONUS`, `HARD_MIN_MOVE_RAD`,
   `AI_SAFETY_CAP_RAD`, `AI_STEP_RAD`) were all confirmed present and, where it mattered
   (`ladderRoots3`, `ladderOppReplies`, `ladderEval`, `simMoveToLimit`), byte-identical to `main`
   before porting -- so the block's behavior does not depend on anything that silently changed
   between the two revisions.
2. **One new `AI_LADDER` entry**, appended after Champion (so every existing index keeps its
   meaning) -- `kind:'dead'`, identical weights/options to the research branch's entry. This makes
   it `AI_LADDER[16]`, i.e. internal L17, on this branch too.
3. **The dispatch line** `if (def.kind==='dead') return ladderPlanDead(idx, def.w, def.o);` in
   `ladderPlanRungGen`, matching the non-generator dispatcher's line on the research branch (the two
   branches' ladder-plan calling conventions had already diverged: the research branch's is a plain
   synchronous `ladderPlanFor`/`ladderPlanRung`, `main`'s is generator-based with `drainPlan`.
   `ladderPlanDead` has no yield points, so `return`ing it directly from inside the generator is
   correct either way).
4. **The `oOverride` per-call options mechanism** in `ladderPlanFor`/`ladderPlanForGen`, and the
   matching `L<n>+cfg:k=v` parser in `nn/arena.js` -- the ablation door. `main`'s prior ladder-spec
   syntax (`L<n>:nets`) is preserved and composes with `+cfg:` (`L15:champion,second+cfg:...` would
   be legal, though nothing currently needs both at once).
5. **The `markEps` stride tolerance** in `ladderRoots3` / `ladderSampledPlanGen` (two sites) --
   separate from the L11+dead block itself, since these functions predate it and sit far earlier in
   the file. Missing this was caught by the branch-agreement check below (`L11-eps`/`L17-eps` rows
   silently no-opped without it).
6. **The explicit clock-flag guard**: passing `--timeMs`/`--timeMsA/B`/`--timeMsLo+Hi` to any ladder
   rung spec now throws, instead of silently doing nothing (Astra/GPT's task 2).
7. **`nn/engine.js`'s export list**: `DEAD_CERTS`, `DEAD_STATS`, `ladderDeadEscape` added, matching
   the research branch's additions (needed for the lab tooling to read them at all).
8. **Corpus files** `docs/dead-regions/screened-not-dead.jsonl` and `dead-points-mined.jsonl` copied
   over so the harness is runnable standalone on this branch without cross-referencing another
   worktree.

## Verification: does the port agree with the original?

Two checks, not one -- a self-test only proves internal consistency of the copy, not that the copy
matches the thing it was copied from.

**Self-test** (`ablation-matrix.js`'s own check): with `deadTable`/`deadDense`/`deadGuard` all off,
`ladderPlanDead` must reduce to `ladderPlan3` and play L11's exact move on every sampled position.
Passed on this branch, at both `--n 10` and `--n 60`.

**Direct cross-branch agreement** (`agreement-check.js`, ad hoc -- not committed, reproducible from
this description): loads BOTH branches' `nn/engine.js` in one process and calls
`ladderPlanFor(16, mover, cfg)` on the identical starting pose for every position × every ablation
config, comparing the returned plan tag byte-for-byte.

The first full run (60 positions x 7 ablation configs, 420 calls) found 3 mismatches, all under
the `markEps: 1e-9` config specifically. Traced to a real gap in the port: the `markEps` stride
tolerance had been added to `ladderDeadEscape` (part of the L11+dead block, ported verbatim) but not
to `ladderRoots3` / `ladderSampledPlanGen` (two call sites that predate that block and sit far
earlier in the file, and were not part of the verbatim copy). Fixed by porting those two sites too
(see the `markEps` bullet above). Re-verified two ways after the fix:

1. **Isolated cross-branch check** on the specific failing case (`wwwinvlgc-0`, k=1,
   `markEps: 1e-9`): both branches now return `2+@25.500000`, byte-identical.
2. **In-sequence check**: replayed the full 420-call sequence in one process on this branch alone
   and confirmed the same case still returns `2+@25.500000` mid-sequence, not just as the first call
   -- ruling out a separate state-leak bug (already ruled out on the research branch itself by the
   same test, run first, which is what made "the port introduced a leak" the live hypothesis worth
   checking).

No further mismatches expected; a full re-run of the 420-call cross-branch comparison after the fix
was not repeated (the targeted checks above cover the specific failure mode found and its two
plausible root causes -- a missing patch, or a process-lifetime state leak -- and both are closed).

## What is NOT ported

`ladderPlanVeto`, `oppTwoForOneAvailable` (the corner-crossing veto feature) and the `p4`/`p5`/`opp`
experimental kinds (L12a/L12b/L12c on the research branch) -- none of these are dependencies of L17,
and porting them was out of scope for this task. `+corner`/`+veto` ladder-spec suffixes are therefore
not available on this branch; only `L<n>:nets` and `L<n>+cfg:k=v`.

## Running it

Same scripts as `claude/l17-ablations`' harness (`ablation-matrix.js`, `frozen-sets.json` copied
over verbatim -- same salted split, same witness family). From
`docs/geometry-reviews/l17-ablations/` on this branch:

    node ablation-matrix.js --n 60 --split dev --json results/matrix-dev-60.json
