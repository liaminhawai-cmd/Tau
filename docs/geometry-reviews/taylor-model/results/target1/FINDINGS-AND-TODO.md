# Target 1: findings and to-do list

12 October 2026. Branch `claude/serene-pasteur-psjoi2`. Companion to `PROOF-STATUS.md` (status) and
`../../COPILOT-BRIEF.md` (single-file brief for Copilot). Nothing here is new calculation; it records what is
known and what is left.

## Findings

### Proof status (see PROOF-STATUS.md for the table)
- Arms (2,+) and (1,−) are covered over their whole range [2°, B] with all checks clean (481 and 784 cells).
- Arm (1,+): [2°, 12.24°] and [16.5°, B] covered; [12.24°, 16.5°] still being computed (another agent, CI).
- Arms (2,−), (0,−), (0,+): red replies found by engine scan (all red stops are foot 2, swing +); single
  0.01°-wide probe cells prove; the full covers are not computed. Earlier runs were killed by container restarts.
- Engine scans at 0.01° steps found a throwing red reply at every blue stop on every arm; no blue stop throws red.

### Things fixed
- `legal-red.js` assumed red pins foot 0; for red pinning foot 2 it checked the wrong feet. Fixed (`3d3557d4`); the
  multi-foot crossing-episode rule was replaced by a sound one. Brief 6 legality unchanged (731 cells, 0 differences).
  All Target 1 (2,+) cells and the arm (1,−) cells re-check legal.
- Arm (2,+) cover stopped at 14.33° but blue can stop up to 14.3346°: sliver covered, audited, validated.
- `close-holes.js` and `audit-parallel.js` wrote Target 1 results into Brief 6's folder: fixed.
- Result isolation, problem-aware tools, `tiling.js`, `legal-refine.js` added.

### Square-root remainder (no defect)
Commit `344e35c` claimed the old bound was too small. The old and new expressions are equal in real arithmetic;
in 200,000 random cases the old bound was never smaller (equal in 5%, larger by at most 1.3e-15 relative otherwise).
Earlier covers stay sound; re-running them is a reproducibility exercise only.

### Arithmetic audit (Copilot, static analysis; checked on the real code)
- **Latent API gap:** `TM.compose` bounds the Lagrange remainder over `range()`, but ξ lies between the centre x0 and
  points of the range. Valid only when x0 is in the range, i.e. the remainder interval contains 0. Not stated or
  checked in `tm.js`. Runtime check on 105,500 `compose` calls over 8 real cells: 0 violations
  (`check-compose-invariant.js`).
- **Real defect (reproduced):** subnormal underflow. `scale`, arbitrary-scalar `lin`, `mul` (and so `sqr`,
  `scaleI`) take their error bound from the rounded product, so a product that is nonzero but rounds to 0
  (around 1e-323) records no error. A degree-4 `mul` example returns an enclosure that misses the true value.
  Not reachable so far: 3.1M calls over 10 real cells, 0 products below 2^-1022, smallest 1.5e-114
  (`check-underflow-reach.js`). Evidence on those cells, not a proof over every accepted cell.
  Repair (not made): add one smallest-subnormal unit per product to the error total
  (|fl(ab) − ab| ≤ u|ab| + η/2); expected to change no stored bound, to be confirmed by a full re-audit.
- Other items are API guards, not reachable in the certificate path: overflow to ±Infinity gives NaN endpoints,
  invalid `KSUB`, negative `widen`, changing degree while models are live, negative order, constructor
  `lo || 0` hiding NaN, aliasing of caller arrays, 53-bit counters.
- Conditionally sound (Copilot's proofs): finite interval operations, `constI`, `linearI` (degree ≥ 1), `add`, `sub`,
  `addI`, `addC`, `neg`, degree-4 `polyRange` at `KSUB = 16`, the sqrt/inv/sin/cos recurrences and Lagrange formulas.

### Scope that is still not established
Not inspected by anyone with the source: `fold`/`remToSym`, `hullStates`, `vertexDedup`, correspondence of
`push-tm.js` with the engine's ordered `resolvePush`, correspondence of `legal-red.js` with the engine's crossing
rule, ko and move-cap discharge, exact terminal-event precedence. (I have the repository but have not audited
these either; the Brief 6 README states the assumptions.)

## To-do (nothing started unless marked)

### Compute (needs the repo and CPU time)
1. Arm (1,+) [12.24°, 16.5°]: another agent's CI is slicing it; check its progress.
2. Arms (2,−), (0,−), (0,+): finish the covers. Queue is `scratchpad/ext/jobs.txt` in the cloud session (chunks of
   about 5°, resumable, each runs cover, legality refine, audit, validation). Run the same chunks on a local machine
   with `node cover2.js` + `legal-refine.js` + `audit2.js` + `validate-cover2.js` (with `PROBLEM=<fixture> SYMREM=1 VTX=1`).
   Ends of arm (2,−) need narrower cells.
3. After each arm: `tiling.js` over the full range; then update `PROOF-STATUS.md`.
4. Re-audit the older covers on the current source (2°–12° and 16.5°–B on (1,+); optional, since the sqrt change is
   equivalent).

### Soundness work
5. Decide on the underflow repair: make the 10-line change in `lin`, `scale`, `pm`, run the full re-audit, confirm
   all stored margins are bit-identical. Alternative: add a run-time assertion for "no product below 2^-1022" to
   `cert2.js`, so each cell certifies its own reachability.
6. Prove the invariant lo ≤ 0 ≤ hi by induction over every producer of remainders in `tm.js`.
7. Prove aggregate rounding bounds in `norm1`, `symMag`, `lin`, `scale`, `mul` (Copilot's open items), or replace the
   `(1 + 1e-10)` fudge factors with derived bounds.
8. Audit `push-tm.js` against the engine's `resolvePush`, `fold`, `remToSym`, `hullStates`, `vertexDedup`.
9. Audit `legal-red.js` against `crossingSubstep` (line-contact episodes, corner exception, rollback).
10. Discharge ko and move cap for every blue stop; confirm terminal-event order (off-board at end of turn).

### Writing
11. One-page theorem statement with a numbered assumption ledger (Copilot task B).
12. Update `COPILOT-BRIEF.md` with the Copilot audit results above before the next Copilot round.

### Research track (separate, do not mix)
13. The continuous idealised game (least-motion KKT model) is a different object from the certified program.
    If pursued, state clearly that its results do not transfer to these certificates.

## Operational notes
- The cloud container restarts and kills background jobs; anything unfinished is lost, so keep chunks small.
- The in-progress chunk results in the cloud container are hidden from git on purpose and auto-commit when clean;
  they exist only while the container is up.
- Copilot cannot run code or see the repository; give it `COPILOT-BRIEF.md` and expect unverified analysis.
