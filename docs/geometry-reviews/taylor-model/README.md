# Taylor-model cover of defender arm (1,−)

4 October 2026. A prototype that certifies whole intervals of defender angles at once by running
the engine's push law on polynomials instead of numbers. It is new code and **has not been
independently reviewed**; treat its outputs as program results until someone checks it.

## Result

Position: the Brief 6 seed `[-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442]`, blue
(defender) to move. Blue replies on arm (1,−) to stop angle α, anywhere from the 2° minimum move
to the arm's 16.5° limit. Red replies with arm (0,−): it pins foot 0 and swings to its limit,
123 substeps of 0.375° (46.125°), exactly the reply that
[ARM1-ONE-DEGREE](https://github.com/liaminhawai-cmd/Tau/blob/codex/brief6-single-reply-proof/docs/geometry-reviews/brief6-single-reply/ARM1-ONE-DEGREE.md)
certifies on 8°–9°.

**For every α in [2°, 16.5°], in the real-arithmetic model below, red's reply leaves blue's foot 1
off the board, by at least 2.296743u** (the weakest cell is [15.25°, 15.40625°]), and blue's hub
moves by at least 4.4089u, far over the 0.25u ko threshold. 456 proved cells tile the arm with
no gaps and no failures; 32 of them carry separate branches.

![Proved throw margin across arm (1,−)](results/arm-cover.svg)

| Band | Cells | Widest cell | Cells with separate branches | Smallest proved margin | Smallest hub move |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2°–4° | 83 | 0.0625° | 0 | 3.770786u | 8.53u |
| 4°–6° | 74 | 0.125° | 5 | 3.509777u | 7.73u |
| 6°–8° | 73 | 0.125° | 10 | 3.265390u | 7.00u |
| 8°–10° | 61 | 0.125° | 7 | 3.011362u | 6.30u |
| 10°–12° | 75 | 0.125° | 6 | 2.741741u | 5.64u |
| 12°–14° | 58 | 0.125° | 4 | 2.480320u | 5.04u |
| 14°–16.5° | 32 | 0.15625° | 0 | 2.296743u | 4.41u |
| **2°–16.5°** | **456** | **0.15625°** | **32** | **2.296743u** | **4.41u** |

The whole cover took about 15 CPU-minutes (seven bands on four cores, about 10 minutes of wall
time). `results/cover_*_d6.json` lists every cell; `summary.js` checks the tiling.

### Against ARM1-ONE-DEGREE

ARM1-ONE-DEGREE covers 8°–9° with 240 cells and a minimum lower margin of 3.137016072573885u.
Here 8°–9° takes 35 cells, minimum 3.139467u. ARM1's two contact-switch gaps (8.2374414° and
8.6814807°) sit inside ordinary cells, [8.1875°, 8.25°] and [8.625°, 8.75°], carrying 3 and 6
separate branches; the switches near 9.116°, 9.541° and 9.957° likewise sit inside cells 0.03°
to 0.06° wide. Run as tiny single cells around ARM1's two gaps, the bounds agree with ARM1's to
about 1e-7: margins 3.2347737u and 3.1791326u here against 3.2347736u and 3.1791334u there; hub
moves 6.915739u and 6.757760u against 6.915739u and 6.757762u.

Past 10° the same kind of switch recurs once per substep, at 10.870°, 11.129°, 11.387°, 11.644°,
11.900°, 12.154°, 12.406° and 12.656° (substeps 70 to 77). There the branches still had to be
merged past the cap of eight, which only works in narrow cells (1.2e-4° to 4.9e-4°), so those
eight points are where the cover is finest.

`freemotion.js` also proves that blue's reply never touches red anywhere on the arm, φ in
[0°, 16.5°].

### Degree matters

Two cells, run at increasing polynomial degree:

| Degree | [8.0625°, 8.125°] | [8.75°, 8.875°] |
| ---: | --- | --- |
| 1 (straight-line formulas) | fails at substep 57 | fails at substep 61 |
| 2 | fails at substep 107 | fails at substep 62 |
| 3 | proved, margin ≥ 3.249282 | proved, margin ≥ 3.154863 |
| 4, 6, 8 | proved, margin ≥ 3.249282 | proved, margin ≥ 3.154860–3.154864 |

From degree 3 up, the enclosure of the margin is as wide as the margin's true change across the
cell (0.008u and 0.018u); the bound itself adds almost nothing.

## Method

- **Taylor models in one variable.** Every quantity is a polynomial in t ∈ [−1, 1] (t maps
  linearly onto the cell's α interval), degree 6 by default, plus affine noise symbols and an
  interval remainder (`tm.js`). Truncated terms, products of noise symbols, every coefficient's
  floating-point rounding and every Lagrange remainder (sqrt, 1/x, sin, cos) are bounded and added
  to the remainder with outward rounding (`iv.js`).
- **The engine's push program** (`push-tm.js`): `resolvePush` with its ten Gauss–Seidel passes,
  snapshot geometry per pass, 12-segment leg polylines, `segClosest3` with every clamp branch,
  red-hub/blue-leg and blue-hub/red-leg pushes, the horizontal-fraction floor and the 0.8u
  separation cap, and `apply` exactly as written. Red is kinematic: its pose at each substep is a
  constant.
- **Branches.** Each program branch (closest segment pair, clamp case, touch or not, floor or
  cap active) is either decided uniformly over the cell or all its outcomes are kept: enclosed in
  one hull with fresh noise symbols, or carried as separate exact branches (outcomes closer than
  1e-7u are hulled). A contact that starts somewhere inside the cell uses the exact relaxation
  max(0, g) = a·g + w, w ∈ [0, W].
- **Excluded paths**, which must be ruled out uniformly or the cell fails: the deep-crossing shove
  (dist ≥ 0.3 required), near-vertical contacts (hf ≥ 1e-4 required) and hub–hub contact.
- **Symbol reduction** after each contact substep: a Lohner-style re-basis with a rigorous 3×3
  interval inverse.
- **Cover** (`cover.js`, `modes.js`): try a cell with every outcome hulled. If that fails, retry
  (cells up to 0.25°) keeping separate branches, giving up rather than merge distinct ones past
  eight; then (cells up to 0.002°) allowing that merge; then halve.

What the proof actually used, per `audit.js`: red's hub pushes blue's leg in all 456 cells; 210
cells use the contact-start relaxation; 32 carry separate branches (20 within the cap, 12 merged
past it). The floor and the cap never activated: in every cell they were inactive throughout, so
the result also holds under the stricter reading that excludes them.

## Model and imported assumptions

- The engine program (`index.html` at commit `ee6a6f4`: `Piece`, `segClosest3`, `resolvePush`,
  `applySwing`) in exact real arithmetic, with numeric literals and `Math.PI` taken as their
  binary64 values and real sin, cos and sqrt. The leg table entries are the real values of their
  defining expressions. This is the same kind of model as the ARM1 certificates; it is not a bound
  on floating-point execution.
- **Red's stopping schedule is imported, not proved here.** Red's 123 substeps depend only on
  red's own pose. ARM1-CROSSING certifies them in the real model; the engine reports the same
  limit at every sampled α.
- **Blue's reply legality is imported.** Its own limit on this arm is 16.5° (self-off) per the
  engine; the crossing rule is not re-checked here. That the reply never touches red *is* proved
  here (`freemotion.js`).
- **Floating point.** The scripts assume correctly rounded + − × ÷ and sqrt (IEEE 754) and
  `Math.sin`/`Math.cos` within one ulp (V8's fdlibm port). Results are moved outward by at least
  one ulp per operation, two for sin/cos.

## Checks run

- `audit.js` re-ran all 456 cells independently, each in the mode that proved it: every bound
  reproduced exactly.
- `contain.js` replays the float engine at sample angles in a cell and requires its blue pose
  after every substep to lie inside a branch of the model. On 28 cells spread over the arm (the
  first, middle and weakest cell of each band and its branch cells), 35,916 substep checks found
  none outside by more than 1e-9; the largest excess was 1e-15, the engine's own rounding
  (`results/containment.txt`).
- The segment-distance lower bound used for screening was checked against a brute-force
  reference on 20,000 random segment pairs, a third of them nearly parallel: none exceeded it.
- Containment and these unit checks are evidence that the code does what it says, not a proof of
  that. The first thing worth doing with this package is an independent review of `tm.js` and
  `push-tm.js`.

## The other five arms: sampled, not yet proved

A lost position needs a winning red reply to every legal blue move, not only arm (1,−).
`six-arms/` samples all six arms with the engine itself (`arms.js`, summary in
`arms-summary.js`, data in `six-arms/data/`). Blue's stop angle runs from the 2° minimum to the
arm's legal limit: 63.375° for (0,−), 44.25° for (0,+), 16.5° for (1,−), 14.625° for (1,+),
15.75° for (2,−), 4.875° for (2,+). Blue's reply is played by the engine's own planner call
schedule (3° calls and a final partial one), and red swings to its legal limit in the same way.

| Blue arm | Stops (0.01°) | Red (0,−) throws at | Smallest margin | Blue's reply pushes red |
| --- | ---: | ---: | ---: | --- |
| (0,−) | 6,139 | all | 2.1829u at 8.32° | 2.00°–63.38° |
| (0,+) | 4,227 | all | 4.8530u at 2.00° | 43.83°–44.25° |
| (1,−) | 1,452 | all | 2.3028u at 15.36° | never |
| (1,+) | 1,264 | all | 5.2738u at 2.00° | 2.00°–14.63° |
| (2,−) | 1,377 | all | 2.2988u at 11.88° | 2.00°–15.75° |
| (2,+) | 289 | all | 4.6608u at 2.00° | 2.00°–4.88° |

**Red's (0,−) reply throws blue off the board at all 14,748 sampled stops on all six arms**, and no
blue reply wins outright by pushing red off. The same table at 0.1° with all six red replies is in
`six-arms/data/all-replies-*`: red (2,−) also throws everywhere on (1,−), (2,−) and (2,+), and
covers most of (0,+); the other four red arms do not win everywhere. Red's legal limit after blue's
push stays at 46.125° (123 substeps) on four arms and rises to 54.75° and 55.5° on (0,−) and (1,+),
so the 123-substep swing the proofs use is legal at every sampled stop.

This is sampled evidence at a stated resolution, not a proof: a gap narrower than 0.01° could
hide between samples, though the largest step between neighbouring margins is 0.16u against a
smallest margin of 2.18u. The proof so far covers arm (1,−) only. On the other five, blue's reply
pushes red (arm (0,+) only after 43.83°), so red starts its reply from a pose that depends on
blue's stop angle; the cover above assumes red starts from the seed pose.

## Not shown

Proofs for blue's other five arms (sampled above, not covered), any bound relating the
real-arithmetic model to floating-point execution, and the imported pieces above.

## Reproduce

Node 22; run from this directory (`contain.js` and `figure.js` load `../../../nn/engine.js`).

    node cover.js 8 10 6           # cover a band; writes results/cover_8_10_d6.json (about 25 s)
    node summary.js 2 16.5         # check the bands tile the arm
    node audit.js 2 16.5           # re-run every cell; writes results/audit_2_16.5.json
    node cert.js 8.625 8.75 6      # one cell (BRANCH=1 for separate branches)
    node contain.js 8.625 8.75 1 9 # engine containment: cell, branches on/off, sample angles
    node freemotion.js 0 16.5      # blue's reply never touches red
    node figure.js 2 16.5          # results/arm-cover.svg
