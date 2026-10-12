# Tau Target 1 proof: brief for Copilot

State as of 12 October 2026, branch `claude/serene-pasteur-psjoi2` at commit `1d6ba623`. **This document
supersedes** `TAU_OVERNIGHT_HANDOFF_ALL_CONTEXT`, `TAU_COMPLETE_PROGRESS_SUMMARY_2026-10-08`,
`TAU_DIRECT_U_TAYLOR_MODEL_INTEGRATION_2026-10-08`, `Tau-copilot-proof-research-slice-20261007` and
`TAU_COPILOT_AUTONOMOUS_MATH_HANDOFF` wherever they disagree. Section 6 lists what they got wrong.

## 1. Ground rules

- **You have no repository access and cannot run code.** Everything you produce is unverified until a person or an agent with the repository runs it. Label your output that way. Do not report proof status, do not say something "passed" or "was verified", and do not restate this document's numbers as your own findings.
- **When you claim something about code, give a runnable check.** Write a short Node.js snippet that someone with the repository can run from `docs/geometry-reviews/taylor-model/` (for example `node -e '...'` using `require('./iv.js')`). A claimed bug needs concrete numeric inputs that show it.
- **Do not change the target.** The certificates prove statements about a specific model (section 4). Do not swap in a different model (for example a continuous least-motion game) and present the results as progress on these certificates.
- **Prefer correctness over coverage.** One fully argued lemma is worth more than a broad plan. Do not produce roadmaps, decision trees or "next cycle" plans unless asked.

## 2. The game

Two tripod pieces, blue and red. Each piece is a hub with three feet at distance `footR = 23.095u` from the hub, at angles `rot`, `rot + 120°` and `rot + 240°`, joined by legs (12-segment polylines, leg radius 1.44u). The board is a disc of radius 66.667u with 0.5u tolerance: a piece loses when, at the end of a turn, any of its feet is farther than 67.167u from the centre.

- **A move.** The mover pins one foot and rotates its piece about that foot in one direction (an "arm": pivot foot 0, 1 or 2, direction + or −). Motion happens in substeps of at most 0.4°. The minimum move is 2°. Each substep pushes the other piece through a contact solver (`resolvePush`): ten Gauss–Seidel passes, hub–leg and hub–hub contacts, a 0.8u correction cap, horizontal-fraction floor 0.35.
- **The plan application.** This is how a stop angle α is played: full 3° calls of eight 0.375° substeps, then one partial call of ⌈r/0.4°⌉ equal substeps of the remainder r.
- **Limits on a swing.** A substep that would put the mover's own foot off the board is rolled back and the swing stops ("self-off"). The board has printed lines: rings of radius 40 and 53.3 about the centre, and two side arcs, centre (±66.667, 0), radius 40, over angular spans [−72.542°, 72.542°] and [107.458°, 252.542°]. A foot is "on" a line when its centre is within 0.81u of it.
  - A turn may make one crossing. The crossing is billed when a tripod-wide contact episode opens, meaning a non-pivot foot touches a line. Other feet touching lines while the episode is open are free. The episode closes when every non-pivot foot is clear of every line, and touching a line after that is a second crossing, which is refused (the swing stops, reason "cross").
  - A single foot may touch only one fresh line per turn, except when rounding a printed corner.
- **Other rules.** Ko: a position may not repeat without contact (tolerances 0.25u and 2°). Komi is 3. Move cap 300.

## 3. The question

**Target 1** is a mined position (`docs/dead-regions/dead-points-mined.jsonl`, line 176, on branch `claude/board-game-video-adaptation-cf8a93`), blue to move:

| Piece | x | y | rot (radians) |
| --- | --- | --- | --- |
| blue | 12.2195 | 37.7663 | 11.0497 |
| red | 2.8121 | 28.9609 | −13.703 |

**The claim.** For every blue move, red has a legal reply after which a blue foot is off the board. So blue loses in two plies; the position is "dead" for blue.

**Blue's moves.** Six arms, each a stop angle α in [2°, B]. B is the largest target the plan application executes in full. It was found by bisection on the float engine and checked monotone: one flip in a scan at 0.0002° steps near the limit and 0.0025° below it. No blue stop on any arm throws red or ends the game.

| Blue arm (pivot, dir) | B (degrees) |
| --- | --- |
| (0,−) | 31.014385516493906 |
| (0,+) | 38.74919310376795 |
| (1,−) | 27.6426619806354 |
| (1,+) | 20.71908458837398 |
| (2,−) | 29.758008056522694 |
| (2,+) | 14.334609564414993 |

**Red's replies (witnesses).** A witness is (red pivot, direction, k): red swings k substeps of 0.375°. Witnesses were found by engine scans at 0.01° steps, and each certificate is checked for its own witness. Red can use different witnesses on different intervals of α, because red only needs some winning reply for each α.

## 4. What "proved" means here

**The model.** It is the shipped engine's program run in exact real arithmetic: the same substep schedule, the same 12-segment legs, the same ten Gauss–Seidel passes, cap and floor. It is **not** a continuous-motion or smooth-contact idealisation.

**Method** (`docs/geometry-reviews/taylor-model/`):

- **Taylor models** (`tm.js`, `iv.js`, appended below). Every quantity is a degree-4 polynomial in t ∈ [−1, 1], where t maps linearly onto a cell [α₀, α₁], plus affine noise symbols and an interval remainder. Truncation, products of noise symbols, coefficient rounding and Lagrange remainders (sqrt, 1/x, sin, cos) all go into the remainder, with outward rounding.
- **The push program** (`push-tm.js`, 702 lines, not appended) encodes `resolvePush` branch by branch. Each branch, such as the closest segment pair or which clamp is active, is either decided over the whole cell or all its outcomes are kept. A contact that starts or stops inside the cell uses max(0, g) = a·g + w with w ∈ [0, W]. Two paths stop a cell unless they are excluded over it: the deep-crossing shove, and near-vertical contact (horizontal fraction below 1e-4).
- **Two phases** (`cert2.js`). Phase A: blue plays α by the call schedule and red is pushed. Phase B: red swings the witness from its pushed pose and blue is pushed. A cell is proved when blue's worst foot is off the board with a positive margin over the whole cell.
- **Cover** (`cover2.js`): try the whole interval as one cell; if that fails, retry with separate branches, then halve, down to 1e-5°.
- **Checks on every accepted cell:**
  - `audit2.js` re-runs the cell and compares margins bit for bit.
  - `validate-cover2.js` compares float-engine states at sample angles against the cell's enclosures (containment) and runs `legal-red.js`. That proves, inside the model, that red's witness swing makes at most one crossing episode, never touches two lines with one foot, never starts on a line and never swings itself off.
  - `tiling.js` checks that the cells tile the interval with equal binary64 endpoints.

**Assumptions** (the scope of every certificate here and in Brief 6):

1. IEEE 754 + − × ÷ and sqrt are correctly rounded; `Math.sin` and `Math.cos` are within 1 ulp.
2. Blue's moves are the plan application's moves. A human drag with another substep sequence reaches other positions, which are not covered.
3. B and blue's own legality up to B come from the float engine.
4. Red's k-substep stop is modelled as k exact 0.375° substeps.
5. The certificate is about the real-arithmetic program, not a bound on floating-point execution. Containment checks are samples.
6. Ko and the move cap do not interfere: red's reply moves blue's hub by at least 2.38u, far above the 0.25u ko contact threshold.

## 5. Current status of Target 1

| Blue arm | Red witness | Status | Cells | Smallest margin |
| --- | --- | --- | ---: | ---: |
| (2,+) | (0,−) k120 on [2, 9.73]; (2,+) k36 on [9.73, B] | proved on all of [2, B] | 481 | 0.0977u |
| (1,−) | (2,+) k96 on [2, 21.2]; (2,+) k90 on [21.2, B] | proved on all of [2, B] | 784 | 2.0836u |
| (1,+) | (2,+) k107 | proved on [2, 12.24] and [16.5, B]; [12.24, 16.5] still computing | 661 | 2.8653u so far |
| (2,−) | (2,+) k107 on [2, 15.25]; (2,+) k128 on [15.25, B] | engine samples only; certificate not computed | | samples ≥ 1.99u |
| (0,−) | (2,+) k104 (red's limit) | engine samples only; certificate not computed | | samples ≥ 3.93u |
| (0,+) | (2,+) k106 | engine samples only; certificate not computed | | samples ≥ 0.668u |

- **Sampling.** Every blue stop sampled at 0.01° on every arm loses to the listed witness. Single 0.01° probe cells on the last three arms prove, except the end cells of (2,−), which need narrower cells ("near-vertical contact not excluded" at that width).
- **What's left is compute**, not new mathematics. Earlier runs on those arms were killed by container restarts.
- **Brief 6** (a different seed) is proved on all six arms with smallest margin 1.86u; all 5,710 cells were re-audited.

## 6. Corrections to the older handoffs

1. **The hubV chart is superseded.** The hubV-only push chart (`throw-cert.js`, the "mixed hubV + leg-leg regime", the refusal at substep 22/23 near α ∈ [2.4°, 2.6°]) was replaced by the general Taylor-model certificate `cert2.js`. That certificate proved the whole of arm (2,+), including [2.4°, 2.6°]. Do not extend `throw-cert.js`.
2. **"The deep interval 2°–9.68° is open" is false.** It is proved: 427 cells, smallest margin 5.41u.
3. **There is no square-root defect.** Commit `344e35c` rewrote the Lagrange-remainder bound for sqrt and its message claimed the old one was too small. It was not:
   - The old code computed √x_min / x_min / x_min^n and the new code computes 1 / √x_min / x_min^n. Both are x_min^(−n−1/2).
   - In 200,000 random cases the old bound was never smaller than the new one (equal in 5%, larger by at most 1.3×10⁻¹⁵ relative in the rest).
   - So certificates made before the change used a remainder at least as large as today's and remain sound under the current code. Re-running them is a reproducibility exercise, not a repair. See `results/target1/SQRT-REMAINDER-REVIEW.md`.
4. **"The 12.02°–16.5° gap" is unfinished computation.** It is now [12.24°, 16.5°] on arm (1,+), not a mathematical obstacle.
5. **"427 vs 480 cells" are cell counts, not positions.**
   - 427 cells cover [2°, 9.6828°].
   - 480 = 427 + 2 (gap [9.6828°, 9.73°]) + 51 ([9.73°, 14.33°]).
   - One more cell covers [14.33°, B] = [14.33°, 14.3346°], a sliver the earlier cover had missed. Arm (2,+) now has 481 cells.
6. **The [2.4°, 2.6°] refusal** of a single `cert2.js` run meant the cell was too wide. The adaptive cover splits it.
7. **The legality checker had a bug, now fixed.** It treated feet 1 and 2 as the moving feet, which is right only when red pins foot 0. For witnesses pinning foot 2 it checked the stationary foot and never looked at foot 0. Fixed in `3d3557d4` (moving feet = every foot but the pinned one, as in the engine). The multi-foot episode rule was also replaced with a sound one. All affected cells were re-checked and pass. Brief 6 legality is unchanged: 731 checked cells, 0 differences.
8. **Result-path isolation is done.** Each named problem writes under `results/<problem>/`; Brief 6 keeps `results/arm_*`.
9. **The "idealised game" in the certificates is the real-arithmetic shipped program** (section 4). A continuous least-motion / KKT model is a different object; no existing certificate applies to it.

## 7. Open obligations

1. **Compute:** arm (1,+) on [12.24°, 16.5°], and arms (2,−), (0,−) and (0,+) in full. This is mechanical and not your job.
2. **Soundness of the arithmetic.** A written proof that every operation in `iv.js` and `tm.js` returns an enclosure of the exact result under assumption 1, including every Lagrange remainder and the composition (`compose`) machinery. **This is the best use of your time** (task A).
3. **Faithfulness of the encodings.** Does `push-tm.js` encode the engine's `resolvePush`, and does `legal-red.js` encode the engine's crossing rule (`crossingSubstep`)? This needs those files and the engine source, which are not attached.
4. **The theorem statement.** One precise statement of what is proved for Target 1, with every assumption from section 4 named (task B).

## 8. Tasks for you

**Task A — soundness of `iv.js` and `tm.js` (appended below).** For each exported operation:
- state the enclosure property it must satisfy;
- prove it from assumption 1, step by step, naming every rounding direction;
- for each Lagrange remainder (sqrt, inv, sin, cos), derive the remainder term and show the code bounds it, including the worst-case ξ;
- check `compose`, `range` and the noise-symbol handling (`fold` lives in `push-tm.js`; note it as out of scope).

Deliverable:
- one lemma per function, then a list of **defects**. Each defect gives exact inputs, the expected enclosure and the code's output, as a runnable `node -e` snippet;
- a separate list of places where the code is sound but relies on an unstated assumption.

If you find no defects, say so and say what you could not check.

**Task B — the theorem statement.** Using sections 2–5, write the exact statement for Target 1 as it would stand once the remaining arms are computed:
- quantifiers over arms and α;
- the witness map;
- the model;
- the assumption ledger, numbered, each assumption with what would discharge it.

Keep it to one page.

**Task C — only if the user asks: the continuous idealised game.** This is a separate research track. Every result must say it is about the continuous model and does not transfer to the certificates above.

**Do not:** re-plan the project, re-derive the status above, design new certificate machinery, or extend `throw-cert.js`.

## 9. Output format

Markdown, with these sections:
- **Claims:** numbered, each marked *proved here*, *argued*, or *conjecture*.
- **Arguments.**
- **Defects found:** with runnable checks.
- **Assumptions relied on.**
- **What I could not check.**

---

## Appendix 1: `iv.js` (verbatim, 82 lines)

```js
// Interval arithmetic with outward rounding.
//
// JS floating point gives correctly rounded + - * / and sqrt (IEEE 754, round to nearest), so a
// computed value is within half an ulp of the exact one. dn()/up() move a computed value outward by
// at least one ulp (|x| * 2^-52 is at least one ulp of x), which therefore encloses the exact value.
// Math.sin / Math.cos are not required to be correctly rounded; V8's are fdlibm ports (error under
// one ulp), and they get two outward steps here.
'use strict';
const EPS = 2.220446049250313e-16;   // 2^-52
const TINY = 5e-324;
const dn = x => x - (Math.abs(x) * EPS + TINY);
const up = x => x + (Math.abs(x) * EPS + TINY);

// pi lies strictly between Math.PI and the next double up
const PI_LO = Math.PI, PI_HI = 3.1415926535897936;

const I = (lo, hi = lo) => [lo, hi];
const add = (a, b) => [dn(a[0] + b[0]), up(a[1] + b[1])];
const sub = (a, b) => [dn(a[0] - b[1]), up(a[1] - b[0])];
const neg = a => [-a[1], -a[0]];
function mul(a, b) {
  const p1 = a[0] * b[0], p2 = a[0] * b[1], p3 = a[1] * b[0], p4 = a[1] * b[1];
  return [dn(Math.min(p1, p2, p3, p4)), up(Math.max(p1, p2, p3, p4))];
}
function div(a, b) {
  if (b[0] <= 0 && b[1] >= 0) throw new Error('interval division by an interval containing 0');
  const q1 = a[0] / b[0], q2 = a[0] / b[1], q3 = a[1] / b[0], q4 = a[1] / b[1];
  return [dn(Math.min(q1, q2, q3, q4)), up(Math.max(q1, q2, q3, q4))];
}
function sqrt(a) {
  if (a[1] < 0) throw new Error('sqrt of a negative interval');
  return [a[0] <= 0 ? 0 : Math.max(0, dn(Math.sqrt(a[0]))), up(Math.sqrt(a[1]))];
}
function sqr(a) {
  const l = a[0] * a[0], h = a[1] * a[1];
  if (a[0] >= 0) return [dn(l), up(h)];
  if (a[1] <= 0) return [dn(h), up(l)];
  return [0, up(Math.max(l, h))];
}
const hull = (a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
const mid = a => 0.5 * a[0] + 0.5 * a[1];
const rad = a => up(Math.max(a[1] - mid(a), mid(a) - a[0]));
const mag = a => Math.max(Math.abs(a[0]), Math.abs(a[1]));
const scale = (a, k) => mul(a, [k, k]);

// cos / sin of an interval: endpoint values, widened, plus any extremum the interval might contain.
// k*pi is tested against the interval using both ends of the pi enclosure, so a critical point is
// never missed.
function maybeContainsMultiple(a, step) {
  // does [a0, a1] possibly contain k*step for some integer k (step given as [lo, hi], positive)?
  const kLo = Math.floor(a[0] / step[1]) - 1, kHi = Math.ceil(a[1] / step[0]) + 1;
  for (let k = kLo; k <= kHi; k++) {
    const pLo = k >= 0 ? k * step[0] : k * step[1], pHi = k >= 0 ? k * step[1] : k * step[0];
    if (up(pHi) >= a[0] && dn(pLo) <= a[1]) return k;
  }
  return null;
}
function trigEnds(f, a) {
  const v0 = f(a[0]), v1 = f(a[1]);
  return [dn(dn(Math.min(v0, v1))), up(up(Math.max(v0, v1)))];
}
function cos(a) {
  if (a[1] - a[0] > 3) return [-1, 1];
  let r = trigEnds(Math.cos, a);
  // maxima at 2k*pi, minima at (2k+1)*pi
  const twoPi = [2 * PI_LO, 2 * PI_HI];
  if (maybeContainsMultiple(a, twoPi) !== null) r[1] = 1;
  if (maybeContainsMultiple([a[0] - PI_HI, a[1] - PI_LO], twoPi) !== null) r[0] = -1;
  return [Math.max(-1, r[0]), Math.min(1, r[1])];
}
function sin(a) {
  // sin x = cos(x - pi/2)
  if (a[1] - a[0] > 3) return [-1, 1];
  let r = trigEnds(Math.sin, a);
  const twoPi = [2 * PI_LO, 2 * PI_HI];
  // maxima at pi/2 + 2k pi, minima at -pi/2 + 2k pi
  if (maybeContainsMultiple([a[0] - PI_HI / 2, a[1] - PI_LO / 2], twoPi) !== null) r[1] = 1;
  if (maybeContainsMultiple([a[0] + PI_LO / 2, a[1] + PI_HI / 2], twoPi) !== null) r[0] = -1;
  return [Math.max(-1, r[0]), Math.min(1, r[1])];
}

module.exports = { EPS, dn, up, PI_LO, PI_HI, I, add, sub, neg, mul, div, sqrt, sqr, hull, mid, rad, mag, scale, cos, sin };
```

## Appendix 2: `tm.js` (verbatim, 261 lines)

```js
// Taylor models in one variable t in [-1, 1], with affine noise symbols.
//
// A model stands for the set of functions
//     q(t) = P0(t) + sum_j Pj(t) * e_j + r,     t in [-1,1], e_j in [-1,1], r in [lo, hi]
// P0 and the Pj are polynomials of degree <= N with double coefficients. The guarantee is
// pointwise: for every t the true value equals q(t) for SOME choice of the e_j and r. Every
// operation keeps that guarantee: truncated high-order terms, products of two noise symbols,
// floating-point rounding of every coefficient and every Lagrange remainder are bounded and added
// to [lo, hi] with outward rounding. Noise symbols carry errors whose DIRECTION matters (so a later
// projection can cancel them); the interval part [lo, hi] carries the rest.
'use strict';
const iv = require('./iv.js');
const { dn, up } = iv;
const U = 1.1102230246251565e-16;   // 2^-53: half an ulp, relative

let OPS = 0;          // number of linear combinations and products so far: a work measure for budgets
let N = 6;            // polynomial degree in t
let KSUB = 16;        // subintervals for tight range bounds
let symCount = 0;
const setDegree = n => { N = n; };

// Outward upper bound for the Lagrange remainder of sqrt's Taylor polynomial through the requested order.
// |f^(order+1)(xi)/(order+1)!| * h^(order+1)
// = |binom(1/2, order+1)| * h^(order+1) * xmin^(-order-1/2).
// Use 1/sqrt(xmin), then divide by xmin exactly order times.
function sqrtRemainderBound(xmin, h, order) {
  let b = [1, 1];
  for (let k = 0; k <= order; k++)
    b = iv.div(iv.mul(b, [Math.abs(0.5 - k), Math.abs(0.5 - k)]), [k + 1, k + 1]);
  let v = iv.div([1, 1], iv.sqrt([xmin, xmin]));
  for (let k = 1; k <= order; k++) v = iv.div(v, [xmin, xmin]);
  let hp = [1, 1];
  for (let k = 0; k <= order; k++) hp = iv.mul(hp, [h, h]);
  return iv.mul(iv.mul(b, v), hp)[1];
}

const newSym = () => ++symCount;

// sum of |coefficients|, rounded up (a bound on |p(t)| for |t| <= 1)
function norm1(p) {
  let s = 0;
  for (let k = 0; k < p.length; k++) s += Math.abs(p[k]);
  return s === 0 ? 0 : up(s * (1 + (p.length + 2) * U));
}

class TM {
  constructor(c, s, lo, hi) {
    this.c = c || new Float64Array(N + 1);
    this.s = s || new Map();
    this.lo = lo || 0; this.hi = hi || 0;
  }
  static const(v) { const m = new TM(); m.c[0] = v; return m; }
  static constI(a) {           // an interval constant [a0, a1]
    const m = new TM(); const md = iv.mid(a); m.c[0] = md;
    m.lo = dn(a[0] - md); m.hi = up(a[1] - md);
    if (m.lo > 0) m.lo = 0; if (m.hi < 0) m.hi = 0;
    return m;
  }
  static linearI(c0, c1) {      // c0 + c1 * t with interval coefficients
    const m = TM.constI(c0); const md = iv.mid(c1); m.c[1] = md;
    const r = iv.rad(c1); m.lo = dn(m.lo - r); m.hi = up(m.hi + r);
    return m;
  }
  clone() {
    const s = new Map(); for (const [k, p] of this.s) s.set(k, Float64Array.from(p));
    return new TM(Float64Array.from(this.c), s, this.lo, this.hi);
  }
  isConst() { if (this.s.size) return false; for (let k = 1; k <= N; k++) if (this.c[k] !== 0) return false; return true; }
  symMag() { let m = 0, n = 0; for (const p of this.s.values()) { m += norm1(p); n++; } return m === 0 ? 0 : up(m * (1 + (n + 2) * U)); }
  // |P0(t) + sum Pj e_j| bound, without the interval part
  polyMag() { return up(norm1(this.c) + this.symMag()); }
  remMag() { return Math.max(Math.abs(this.lo), Math.abs(this.hi)); }
  widen(e) { this.lo = dn(this.lo - e); this.hi = up(this.hi + e); return this; }
  addRem(a) { this.lo = dn(this.lo + a[0]); this.hi = up(this.hi + a[1]); return this; }

  // ---- linear operations ----
  static lin(A, ka, B, kb) {    // ka*A + kb*B, ka and kb exact doubles
    OPS++;
    const out = new TM(); let err = 0;
    for (let k = 0; k <= N; k++) { const v = ka * A.c[k] + kb * B.c[k]; out.c[k] = v; err += Math.abs(v) + Math.abs(ka * A.c[k]) + Math.abs(kb * B.c[k]); }
    const keys = new Set([...A.s.keys(), ...B.s.keys()]);
    for (const j of keys) {
      const pa = A.s.get(j), pb = B.s.get(j), p = new Float64Array(N + 1);
      for (let k = 0; k <= N; k++) {
        const a = pa ? ka * pa[k] : 0, b = pb ? kb * pb[k] : 0, v = a + b;
        p[k] = v; err += Math.abs(v) + Math.abs(a) + Math.abs(b);
      }
      out.s.set(j, p);
    }
    // two roundings per coefficient at most (a scaled product, then the sum)
    err = up(err * 2 * U * (1 + 1e-10));
    const ra = iv.scale([A.lo, A.hi], ka), rb = iv.scale([B.lo, B.hi], kb);
    out.lo = dn(ra[0] + rb[0] - err); out.hi = up(ra[1] + rb[1] + err);
    return out;
  }
  add(B) { return TM.lin(this, 1, B, 1); }
  sub(B) { return TM.lin(this, 1, B, -1); }
  neg() { const o = this.clone(); for (let k = 0; k <= N; k++) o.c[k] = -o.c[k]; for (const p of o.s.values()) for (let k = 0; k <= N; k++) p[k] = -p[k]; o.lo = -this.hi; o.hi = -this.lo; return o; }
  scale(k) {
    const out = new TM(); let err = 0;
    for (let i = 0; i <= N; i++) { const v = k * this.c[i]; out.c[i] = v; err += Math.abs(v); }
    for (const [j, p] of this.s) { const q = new Float64Array(N + 1); for (let i = 0; i <= N; i++) { const v = k * p[i]; q[i] = v; err += Math.abs(v); } out.s.set(j, q); }
    err = up(err * 2 * U * (1 + 1e-10));
    const r = iv.scale([this.lo, this.hi], k);
    out.lo = dn(r[0] - err); out.hi = up(r[1] + err);
    return out;
  }
  scaleI(a) {                    // multiply by an interval constant
    const md = iv.mid(a), r = iv.rad(a);
    const o = this.scale(md);
    if (r > 0) o.widen(up(r * up(this.polyMag() + this.remMag())));
    return o;
  }
  addC(v) { const o = this.clone(); const s = o.c[0] + v; const e = up(Math.abs(s) * U); o.c[0] = s; o.widen(e); return o; }
  addI(a) { return this.add(TM.constI(a)); }

  // ---- multiplication ----
  mul(B) {
    OPS++;
    const A = this;
    if (B.isConst() && B.lo === 0 && B.hi === 0) return A.scale(B.c[0]);
    if (A.isConst() && A.lo === 0 && A.hi === 0) return B.scale(A.c[0]);
    const out = new TM();
    let bound = 0;      // truncation + rounding, symmetric
    const pm = (a, b, dst) => {
      // dst += a*b truncated to degree N; returns the error bound of this product
      let tr = 0, abs = 0;
      for (let i = 0; i <= N; i++) {
        const ai = a[i]; if (ai === 0) continue;
        for (let j = 0; j <= N; j++) {
          const bj = b[j]; if (bj === 0) continue;
          const v = ai * bj;
          if (i + j <= N) { dst[i + j] += v; abs += Math.abs(v) + Math.abs(dst[i + j]); }
          else tr += Math.abs(v);
        }
      }
      return tr * (1 + 4 * N * U) + abs * 2 * U * (1 + 1e-10);
    };
    bound += pm(A.c, B.c, out.c);
    const keys = new Set([...A.s.keys(), ...B.s.keys()]);
    for (const j of keys) {
      const p = new Float64Array(N + 1);
      const pa = A.s.get(j), pb = B.s.get(j);
      if (pb) bound += pm(A.c, pb, p);
      if (pa) bound += pm(pa, B.c, p);
      out.s.set(j, p);
    }
    // products of two noise symbols
    const sa = A.symMag(), sb = B.symMag();
    bound += sa * sb;
    // the interval parts
    const ma = up(norm1(A.c) + sa), mb = up(norm1(B.c) + sb);
    // A = a + rA, B = b + rB:  AB = ab + a rB + rA b + rA rB
    const rr = iv.add(iv.add(iv.mul([A.lo, A.hi], [-mb, mb]), iv.mul([-ma, ma], [B.lo, B.hi])), iv.mul([A.lo, A.hi], [B.lo, B.hi]));
    bound = up(bound * (1 + 1e-10));
    out.lo = dn(rr[0] - bound); out.hi = up(rr[1] + bound);
    return out;
  }
  sqr() { return this.mul(this); }

  // ---- ranges ----
  // range of P0 over t in [-1, 1], by subdivision and the mean-value form, in interval arithmetic
  polyRange(p) {
    p = p || this.c;
    let deg = N; while (deg > 0 && p[deg] === 0) deg--;
    if (deg === 0) return [p[0], p[0]];
    const dp = new Float64Array(deg);
    for (let k = 1; k <= deg; k++) dp[k - 1] = k * p[k];   // exact for small k (k*p is a double times a small int; rounding handled below)
    const horner = (q, d, x) => {          // interval Horner on [x0, x1]
      let r = [q[d], q[d]];
      for (let k = d - 1; k >= 0; k--) r = iv.add(iv.mul(r, x), [q[k], q[k]]);
      return r;
    };
    // derivative coefficients may have rounded (k * p[k]); widen each by an ulp
    const dpI = Array.from(dp, v => [dn(v), up(v)]);
    const hornerI = (x) => { let r = dpI[deg - 1]; for (let k = deg - 2; k >= 0; k--) r = iv.add(iv.mul(r, x), dpI[k]); return r; };
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < KSUB; i++) {
      const a = -1 + 2 * i / KSUB, b = -1 + 2 * (i + 1) / KSUB, m = 0.5 * (a + b), h = 0.5 * (b - a);
      const pm = horner(p, deg, [m, m]);
      const d = hornerI([a, b]);
      const r = iv.add(pm, iv.mul(d, [-h, h]));
      // the plain Horner enclosure is also valid; take the intersection
      const r2 = horner(p, deg, [a, b]);
      lo = Math.min(lo, Math.max(r[0], r2[0])); hi = Math.max(hi, Math.min(r[1], r2[1]));
    }
    return [lo, hi];
  }
  range() {
    const pr = this.polyRange(), sm = this.symMag();
    return [dn(dn(pr[0] - sm) + this.lo), up(up(pr[1] + sm) + this.hi)];
  }
  rangeCrude() {
    let v = 0; for (let k = 1; k <= N; k++) v += Math.abs(this.c[k]);
    v = up(up(v * (1 + (N + 2) * U)) + this.symMag());
    return [dn(dn(this.c[0] - v) + this.lo), up(up(this.c[0] + v) + this.hi)];
  }
  // value enclosure at a given t (used by the containment checks)
  at(t) {
    const ev = p => { let r = [p[N], p[N]]; for (let k = N - 1; k >= 0; k--) r = iv.add(iv.mul(r, [t, t]), [p[k], p[k]]); return r; };
    let r = ev(this.c);
    for (const p of this.s.values()) { const v = ev(p); const m = iv.mag(v); r = iv.add(r, [-m, m]); }
    return iv.add(r, [this.lo, this.hi]);
  }

  // ---- elementary functions, by Taylor expansion about the constant coefficient ----
  // coef(k) gives the k-th Taylor coefficient (an interval) at x0; lag(X, h) bounds the Lagrange
  // remainder |f^(n+1)(xi)/(n+1)!| * h^(n+1) for xi in X.
  compose(coef, lag, order) {
    const x0 = this.c[0];
    const H = this.clone(); H.c[0] = 0;
    const X = this.range();
    const Hr = [dn(X[0] - x0), up(X[1] - x0)];
    const h = Math.max(Math.abs(Hr[0]), Math.abs(Hr[1]));
    let res = TM.constI(coef(order));
    for (let k = order - 1; k >= 0; k--) res = res.mul(H).add(TM.constI(coef(k)));
    const L = lag(X, h);
    return res.widen(L);
  }
  sqrt(order = N + 2) {
    const X = this.range(); if (X[0] <= 0) throw new Error('sqrt: range not positive ' + X);
    const x0 = this.c[0];
    const cf = [iv.sqrt([x0, x0])];
    for (let k = 1; k <= order; k++) cf.push(iv.div(iv.mul(cf[k - 1], [0.5 - (k - 1), 0.5 - (k - 1)]), iv.mul([k, k], [x0, x0])));
    return this.compose(k => cf[k], (Xr, h) => {
      // |binom(1/2, n+1)| * xi^(1/2-n-1) * h^(n+1), worst at the smallest xi
      let b = [1, 1]; for (let k = 0; k <= order; k++) b = iv.div(iv.mul(b, [Math.abs(0.5 - k), Math.abs(0.5 - k)]), [k + 1, k + 1]);
      return sqrtRemainderBound(Xr[0], h, order);
    }, order);
  }
  inv(order = N + 2) {
    const X = this.range(); if (X[0] <= 0 && X[1] >= 0) throw new Error('inv: range contains 0 ' + X);
    const x0 = this.c[0];
    const cf = [iv.div([1, 1], [x0, x0])];
    for (let k = 1; k <= order; k++) cf.push(iv.neg(iv.div(cf[k - 1], [x0, x0])));
    return this.compose(k => cf[k], (Xr, h) => {
      const m = Math.min(Math.abs(Xr[0]), Math.abs(Xr[1]));
      let v = [1, 1]; for (let k = 0; k <= order + 1; k++) v = iv.div(v, [m, m]);
      let hp = [1, 1]; for (let k = 0; k <= order; k++) hp = iv.mul(hp, [h, h]);
      return iv.mul(v, hp)[1];
    }, order);
  }
  div(B) { return this.mul(B.inv()); }
  trig(which, order = N + 2) {   // which: 'cos' or 'sin'
    const x0 = this.c[0];
    const c = iv.cos([x0, x0]), s = iv.sin([x0, x0]);
    // derivatives of cos: cos, -sin, -cos, sin, ...; of sin: sin, cos, -sin, -cos, ...
    const cyc = which === 'cos' ? [c, iv.neg(s), iv.neg(c), s] : [s, c, iv.neg(s), iv.neg(c)];
    const cf = []; let fact = [1, 1];
    for (let k = 0; k <= order; k++) { if (k > 0) fact = iv.mul(fact, [k, k]); cf.push(iv.div(cyc[k % 4], fact)); }
    return this.compose(k => cf[k], (Xr, h) => {
      let f = [1, 1]; for (let k = 1; k <= order + 1; k++) f = iv.mul(f, [k, k]);
      let hp = [1, 1]; for (let k = 0; k <= order; k++) hp = iv.mul(hp, [h, h]);
      return iv.div(hp, f)[1];
    }, order);
  }
  cos() { return this.trig('cos'); }
  sin() { return this.trig('sin'); }
}

module.exports = { TM, setDegree, newSym, norm1, getN: () => N, opCount: () => OPS, setKsub: k => { KSUB = k; }, sqrtRemainderBound };
```
