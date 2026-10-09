# Target 1 — proof status

Target 1 is the mined seed from `docs/dead-regions/dead-points-mined.jsonl` line 176
(`problems/target1.json`), blue to move. The claim being certified: **for every blue move, red has a
legal reply that throws blue off the board** (the position is lost for blue in two plies), in the same
real-arithmetic model and with the same move definitions as Brief 6 (see `../../README.md`).

## Blue's moves

Six arms (pin foot 0, 1 or 2; swing either way), each a stop angle in [2°, B], where B is the largest
target the engine's plan application executes in full. B was found by bisection on `applyPlanSearch`
and checked monotone (one flip in a scan at 0.0002° steps near the 3°-call limit, 0.0025° below).
No blue stop on any arm throws red or ends the game; on arms (0,+), (1,±), (2,−) blue's swing pushes
red, by up to 15.1u, and the cells model that push.

## Coverage by arm

Every red reply pins red's foot 2 and swings +; only the stop length differs. "Checks" means: every
cell re-run by `audit2.js` with 0 mismatches; `validate-cover2.js` 0 containment failures (engine
samples inside the cell enclosures), 0 legality failures, 0 stopped cells; and `tiling.js` shows the
cells tile the range with equal binary64 endpoints.

| Blue arm | Range [2°, B] | Red reply (substeps of 0.375°) | Status | Cells | Min margin |
| --- | --- | --- | --- | ---: | ---: |
| (2,+) | [2, 14.334609564414993] | (0,−) 120 on [2, 9.73]; (2,+) 36 on [9.73, B] | **covered, all checks** | 481 | 0.0977u |
| (1,−) | [2, 27.6426619806354] | 96 on [2, 21.2]; 90 on [21.2, B] | **covered, all checks** | 784 | 2.0836u |
| (1,+) | [2, 20.71908458837398] | 107 | [2, 12] covered, all checks; [12, B] running | 422 so far | 2.9172u so far |
| (2,−) | [2, 29.758008056522694] | 107 on [2, 15.25]; 128 on [15.25, B] | running | | |
| (0,−) | [2, 31.014385516493906] | 104 (red's limit) | queued | | |
| (0,+) | [2, 38.74919310376795] | 106 | queued | | |

The witnesses were found by an engine scan of every red arm and stop length at 0.01° steps over each
blue arm (`scratchpad` discovery, recorded in each fixture's `notes`); the cells are the certificate.

## Corrections made to the earlier arm (2,+) result

- **Uncovered top of the arm.** The earlier cover stopped at 14.33°, but blue can stop up to
  B = 14.334609564414993°. The sliver [14.33, B] is now one cell (margin 1.6217u), audited and validated.
- **Legality of the (2,+) witness was not checked.** `legal-red.js` hard-coded feet 1 and 2 as the
  moving feet, right only for a witness that pins foot 0. For red pins foot 2 it checked the stationary
  foot and never looked at foot 0. Fixed (moving feet = all but the pinned one, as the engine does);
  with the fix all 52 upper cells are legal (foot 1 crosses r1; other feet at least 10.49u from any line).
- **Episode rule.** The rule that demanded a certain contact at every substep of a multi-foot episode
  refused episodes whose first or last substep is uncertain. Replaced by a sound condition (each pair's
  contact contiguous, the certain substeps one unbroken block that every pair joins). One-pair cases use
  the Brief 6 rule unchanged; the Brief 6 regression reproduces all committed verdicts (arm (2,+) 498/498,
  arm (0,−) 233 sampled, 0 differences). The lower (2,+) cells re-check 429/429 legal.

## What is still not established

- Arms (1,+) above 12°, (2,−), (0,−) and (0,+): covers in progress.
- The scope limits of Brief 6 apply unchanged: blue's moves are the plan application's (a human drag
  with another substep sequence is not covered); blue's own legality up to B is imported from the
  float engine; red's fixed stop is modelled as exact 0.375° substeps; the certificate is for the
  real-arithmetic model, not a bound on floating-point execution; and the Taylor-model arithmetic is
  trusted as in Brief 6.
