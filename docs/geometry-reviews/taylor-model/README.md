# Taylor-model cover of the arm (1,−) reply band

4 October 2026. A prototype that certifies whole intervals of defender angles at once by running
the engine's push law on polynomials instead of numbers. It is new code and **has not been
independently reviewed**; treat its outputs as program results until someone checks it.

## Result

Position: the Brief 6 seed `[-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442]`, blue
(defender) to move. Blue replies on arm (1,−) to stop angle α. Red replies with arm (0,−): it pins
foot 0 and swings to its limit, 123 substeps of 0.375° (46.125°), exactly the reply that
[ARM1-ONE-DEGREE](https://github.com/liaminhawai-cmd/Tau/blob/codex/brief6-single-reply-proof/docs/geometry-reviews/brief6-single-reply/ARM1-ONE-DEGREE.md)
certifies.

| Band | Cells | Widest cell | Cells with separate branches | Smallest proved margin | Smallest hub move | Run time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 8°–9° | 35 | 0.125° | 3 | 3.139467u | 6.6455u | 3.6 min |
| 9°–10° | 26 | 0.125° | 4 | 3.011362u | 6.2990u | 0.9 min |

For every α in each band, in the real-arithmetic model below, blue's foot 1 ends red's swing
outside the board by at least the stated margin, and blue's hub moves by at least the stated
amount (the ko threshold is 0.25u). The cells tile each band with no gaps (`results/*.json` list
them).

For comparison, ARM1-ONE-DEGREE covers 8°–9° with 240 cells and a minimum lower margin of
3.137016072573885u. Its two contact-switch gaps (8.2374414° and 8.6814807°) sit here inside
ordinary cells, [8.1875°, 8.25°] and [8.625°, 8.75°], which carry 3 and 6 separate branches.
The three contact switches in 9°–10° (near 9.116°, 9.541° and 9.957°) likewise sit inside cells
with 2, 3 and 2 branches. Run as tiny single cells around ARM1's two gaps, the results agree
with ARM1-ONE-DEGREE's to about 1e-7: margins 3.2347737u and 3.1791326u here against
3.2347736u and 3.1791334u there; hub moves 6.915739u and 6.757760u against 6.915739u and
6.757762u.

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
  red-hub/blue-leg and blue-hub/red-leg pushes, and `apply` exactly as written. Red is kinematic:
  its pose at each substep is a constant.
- **Branches.** Each program branch (closest segment pair, clamp case, touch or not) is either
  decided uniformly over the cell or all its outcomes are kept: enclosed in one hull with fresh
  noise symbols, or carried as separate exact branches (at most 8; outcomes closer than 1e-7u
  are hulled). A contact that starts somewhere inside the cell uses the exact relaxation
  max(0, g) = a·g + w, w ∈ [0, W].
- **Guards that must hold uniformly** or the cell fails: the deep-crossing shove (dist ≥ 0.3),
  the horizontal-fraction floor (hf ≥ 0.35), the 0.8u separation cap, and hub–hub contact.
- **Symbol reduction** after each contact substep: a Lohner-style re-basis with a rigorous 3×3
  interval inverse.
- **Cover** (`cover.js`): try a cell; if it fails, retry with separate branches; if that fails
  too, halve it.

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

- `contain.js` replays the float engine at sample angles in a cell and requires its blue pose
  after every substep to lie inside a branch of the model. On seven cells (five with branches),
  11,685 substep checks found none outside by more than 1e-9; the largest excess was 6.7e-16,
  the engine's own rounding.
- The segment-distance lower bound used for screening was checked against a brute-force
  reference on 20,000 random segment pairs, a third of them nearly parallel: none exceeded it.
- Containment and these unit checks are evidence that the code does what it says, not a proof of
  that. The first thing worth doing with this package is an independent review of `tm.js` and
  `push-tm.js`.

## Not shown

Other defender arms, the rest of arm (1,−), other attacker replies, the whole lost-position
theorem, and any bound relating the real-arithmetic model to floating-point execution.

## Reproduce

Node 22; run from this directory (the containment check loads `../../../nn/engine.js`).

    node cover.js 8 9 6            # cover a band; writes results/cover_8_9_d6.json (about 4 min)
    node cert.js 8.625 8.75 6      # one cell (BRANCH=1 for separate branches)
    node contain.js 8.625 8.75 1 9 # engine containment: cell, branches on/off, sample angles
    node freemotion.js 0 16.5      # blue's reply never touches red
