# Target 1 — proof status

## Square-root remainder review — 11 October 2026

Commit [344e35c](https://github.com/liaminhawai-cmd/Tau/commit/344e35c05d554af0930c62245dca613ed6cb922c) rewrote the square-root Lagrange-remainder expression and [d8b9d13](https://github.com/liaminhawai-cmd/Tau/commit/d8b9d13f2a32026667fde2f52c54dd376ddd7871) added analytic regression cases. A follow-up review found that the old and new expressions are algebraically equivalent: both yield \`xmin^(-order-1/2) * h^(order+1)\` times the same binomial coefficient. The old expression also passed the regression's four analytic inputs and a separate 5,000-case seeded diagnostic. See the [review note](SQRT-REMAINDER-REVIEW.md).

The earlier cover corpus predates this source refactor and has not all been regenerated/replayed against the current source. That is a worthwhile reproducibility check because interval operation order can alter stored margins, but the available code diff does **not** establish that the old expression was mathematically too small or that every prior cover was invalid. The global two-ply claim remains unestablished as a full theorem: other move families are outstanding, and the interval arithmetic, engine correspondence, and idealised-rule obligations still need independent justification.

The [post-fix rebuild workflow](https://github.com/liaminhawai-cmd/Tau/blob/claude/serene-pasteur-psjoi2/.github/workflows/target1-post-sqrt-rebuild.yml) regenerates the historical Target1 ranges for (2,+), (1,−), and the disconnected portions of (1,+), with arithmetic regression first and exact tiling, margin replay, sampled containment, and Red-legality gates. The [gap workflow](https://github.com/liaminhawai-cmd/Tau/blob/claude/serene-pasteur-psjoi2/.github/workflows/target1-b1p-gap-certificate.yml) now starts at 12.02° and targets the remaining [12.02°, 16.5°] gap.

**New post-fix result:** the [12°, 12.02° slice](GAP-PROBE-12.00-12.02.md) has been rebuilt using the corrected square-root remainder bound and passed exact tiling, margin replay (6/6), sampled engine-containment (5,844 checks, 0 outside), and Red-legality (0 bad, 0 stopped). Its six-cell JSON is committed. This is an isolated certified slice; the pre-fix covers on [2°, 12°] and [16.5°, B] remain historical until their rebuilds pass.


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

The Red witness is **not the same on every interval**: the table records the pivot, direction, and
substep count used for each covered range. In particular, the complete (2,+) Blue arm switches Red
witness at 9.73°. "Checks" means: every cell re-run by `audit2.js` with 0 mismatches;
`validate-cover2.js` reported 0 containment failures (sampled engine states inside cell enclosures),
0 legality failures, and 0 stopped cells; and `tiling.js` shows the saved cells tile each stated interval
with matching binary64 endpoints. These are recorded program checks, not independent validation of the
Taylor-model implementation or a universal proof of binary64 engine correspondence.

| Blue arm | Range [2°, B] | Red reply (substeps of 0.375°) | Prior status (historical; rebuild required) | Cells then | Min margin then |
| --- | --- | --- | --- | ---: | ---: |
| (2,+) | [2, 14.334609564414993] | (0,−) 120 on [2, 9.73]; (2,+) 36 on [9.73, B] | covered before arithmetic fix; rebuild | 481 | 0.0977u |
| (1,−) | [2, 27.6426619806354] | 96 on [2, 21.2]; 90 on [21.2, B] | covered before arithmetic fix; rebuild | 784 | 2.0836u |
| (1,+) | [2, 20.71908458837398] | 107 | earlier ranges await current-source rebuild/replay; [12, 12.02] validated; [12.02, 16.5] open | 644 prior-run cells | 2.8653u prior run |
| (2,−) | [2, 29.758008056522694] | 107 on [2, 15.25]; 128 on [15.25, B] | not established post-fix | | |
| (0,−) | [2, 31.014385516493906] | 104 (red's limit) | not established post-fix | | |
| (0,+) | [2, 38.74919310376795] | 106 | not established post-fix | | |

The previously recorded degree-4 covers tile [2°, 7°] (174 cells), [7°, 12°] (248 cells), and
[16.5°, 20.71908458837398°] (222 cells), for 644 cells across two disjoint ranges. They predate the
square-root expression refactor and remain pending current-source reproduction/replay; the review has
not shown that they are mathematically invalid. The new six-cell cover tiles [12°, 12.02°] and passed
replay, sampled containment and Red-legality. Until the adjoining [2°, 12°] range is freshly replayed or
re-certified, this new slice is isolated as current-source evidence. The residual central gap is
[12.02°, 16.5°] (4.48°).

The original in-memory six-cell probe over [12°, 12.02°] was generated before the source refactor and is not proof evidence. It has been superseded by the current-source [six-cell CI certificate](GAP-PROBE-12.00-12.02.md), which passed replay, sampled containment, and Red-legality. The dedicated [gap-certificate workflow](https://github.com/liaminhawai-cmd/Tau/blob/claude/serene-pasteur-psjoi2/.github/workflows/target1-b1p-gap-certificate.yml) now targets [12.02°, 16.5°] in three bands, with the first band starting at 12.02° so it abuts but does not overlap the validated slice.

Candidate witnesses were found by an engine scan of every red arm and stop length at 0.01° steps over each
blue arm (`scratchpad` discovery, recorded in each fixture's `notes`). The saved pre-fix cells are historical;
current proof coverage requires regenerated cells and fresh audits with the corrected arithmetic.

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

- The full Target1 cover corpus needs regenerated with the corrected square-root remainder bound.
- Arm (1,+) still has the gap [12.02°, 16.5°]. The [12°, 12.02°] slice has six cells with exact tiling, margin replay, sampled containment and Red-legality passed; the older [2°, 12°] and [16.5°, B] ranges await current-source rebuild and replay. The formula refactor alone is not evidence those intervals fail.
- Arms (2,−), (0,−) and (0,+) have no established post-fix cover.
- The scope limits of Brief 6 apply unchanged: blue's moves are the plan application's (a human drag
  with another substep sequence is not covered); blue's own legality up to B is imported from the
  float engine; red's fixed stop is modelled as exact 0.375° substeps; the certificate is for the
  real-arithmetic model, not a bound on floating-point execution; and the Taylor-model arithmetic requires independent review; the square-root remainder correction does
  not by itself establish the soundness of the entire interval library.
