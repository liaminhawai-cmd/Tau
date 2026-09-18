# Brief 4: the throw certificate is proved, six hundred times too small, and there is a way round it

Your last answer closed a proof. This one is about the fact that the proof does not yet do the job it was built for, by a margin no amount of tightening will cover, and about a route round it that measurement says is open. The ask at the end is specific: two hypotheses, over a box, proved.

Same conventions as briefs 2 and 3: board units `u`, degrees unless a formula says radians. Everything below was measured today against the engine's own code. Where a number is the checker's rather than the engine's, it says so. The checker's current source and the write-up it implements are attached, both at commit `1cf90f63f` and both verified against the repository by blob hash.

---

## 0. What your last answer did

**The park work landed and the proof closes.** You gave exact projection formulas for a contact resting on a polyline vertex. Making both sides of the dwell exact — the victim's contact is a known material point, the attacker's is the perpendicular foot from that point onto a fixed chord — and then putting the *linear part* of the resulting push-direction map into the enclosure's basis Lohner-style, rather than carrying the direction as an interval, dropped the per-substep growth through the park from about 1.4x to 1.11x. (Both figures are measured from a starting box of zero width, so that everything the enclosure carries is its own slack; they are the checker's intrinsic rate, not the rate a real box sees.) With that, at a victim box of `+-0.0002u` in position and `+-0.002 rad` in rotation, every pose is certified thrown off the board. A second throw arm on the same seed certifies too.

**Two of your other recommendations were load-bearing and both were taken.** Stopping the moment the worst state's lower bound on the exposed foot's radius clears the rim, rather than running the sweep out — the certificate had been asked to survive fifty substeps of a dwell whose purpose it had already served. And, from the review before, the projection bound on the post-push residual, which replaced an unsound overshoot argument.

**One correction of yours that this brief depends on.** You said a certificate asserting the vertex park persists from substep 74 across its first push could not succeed, because it is false at the centre. That is right, and it is right for a reason worth stating precisely, because it caught us out twice. The park is not one interval. Measured from the pose *entering* each substep it runs substeps 74 to 98; measured from the pose *leaving* it, after the push, 79 to 104. Both are twenty-five substeps, offset by five. So a pose at substep 74 enters parked and leaves off the vertex. The interval that is parked both entering and leaving is the intersection, **79 to 98**, and it contains the throw at 84.

**The two mistakes we made in this round were the same mistake.** A guard that refused any substep where the push solver used all ten of its passes was firing on an arm where the solver had converged by pass two and was grinding out `1.28e-15` pushes at the floating-point noise floor, because its termination test never fires there. And the foot index in the rim check was being passed as `0.85`, which indexes an array, so `feetOf(pose)[0.85]` is `undefined`, the comparison was against `NaN`, and the check silently never ran while printing `final foot radius min Infinity` in plain view for a day. Both reported something true — the solver did use every pass, the radius was not below the bound — while the thing they were meant to test never happened. We mention it because it is the failure mode an outside reader catches fastest.

---

## 1. Where the certificate stands

The setting, in case this is read alone. Two tripod pieces on a disc of radius 66.667u; a foot is off the board past 67.167u. Each piece has three legs, each a quarter circle of radius `R = 23.095u` rendered as a 12-segment polyline, so a leg's chords are 3.023u long and the direction turns 7.5 degrees at each vertex. Contact holds at `D = 2.88u` between leg centrelines. The attacker rotates about a pinned foot in substeps of exactly 1/3 degree; the victim is a free planar rigid body, `m = 1`, `I = 0.7 R^2 = 373.37 u^2`, pushed by `lambda = s / (1 + rn^2/I)` along the contact normal, with `s` the penetration and `rn` the lever arm. On the position studied, seed `ndpxhts24`, the attacker's throwing arm sweeps 46 degrees, which is 138 substeps; the centre pose's exposed foot leaves the board at substep 84, 28.00 degrees.

The certificate:

| | |
|---|---|
| certified box, per axis | `+-0.0002u` position, `+-0.002 rad` rotation |
| certified at | substep 85, 28.33 degrees |
| exposed foot's radius, lower bound over the box | 67.193u against a 67.167u rim |
| validation | 2000 sampled poses, zero containment violations |
| second arm, attacker 1 about foot 2 | certifies at the same box, substep 112 of 331 |

One size up, at `+-0.0003u / +-0.003 rad`, it dies at substep 85 itself with the foot-radius bound at 67.109u — 0.058u short, one substep before it would have cleared.

---

## 2. The gap, and why tightening will not close it

The certificate exists to replace a sampling argument in the search: a grid of poses, each sample's throw margin required to clear the cell diagonal times a Lipschitz allowance measured from the grid's own finite differences, times a safety factor. That argument is falsifiable and carefully made, but it is measurement, not proof.

The sampled routine works on a victim box of half-width 0.5u with a grid step of 0.25u. One cell therefore has a per-axis half-width of about **0.125u**. The interval certificate closes at **0.0002u**. That is 600 times too small per axis; covering one cell by subdivision is on the order of `10^8` sub-certificates. (The 0.125u is read from that routine's demo defaults, which is the scale it is worked at but not confirmed against whatever the production pipeline runs, so treat the 600 as an order of magnitude rather than a measured constant. Nothing below turns on the exact figure.)

Subdivision does not bridge it, and neither, as far as we can see, does term-tightening. With the push's linear part in the basis the feedback is quadratic — the enclosure grows like `pad + c pad^2` per substep rather than by a constant factor — so `0.0002u` is a **threshold**, not a soft limit, and raising it 600-fold means cutting `c` 600-fold. Measured at substeps 80 to 84, the three terms of the remainder:

| term | width (u) |
|---|---|
| `lambda . da` | 5.2e-3 |
| `lambda Lambda_c B m3` | 2.6e-3 |
| `Lambda_c dB . dq` | 1.8e-4 |

The Jacobian's own spread, the term the linearisation introduced, is the smallest by a factor of 29. What dominates is `lambda . da`, the push magnitude's range times the direction cone, and it resists the same treatment: `da` hulls the direction over the whole substep, from before the push to after it, whereas `B` is the pose derivative at one instant, so `B . dq` does not enclose it. A careful re-derivation of that term looks likely to buy a factor of a few — that last is a judgement, not a measurement, and it is the judgement on which the whole "tightening will not close it" conclusion rests, so it is fair game. The gap is three orders of magnitude wider than it.

---

## 3. The gap is bookkeeping, not dynamics

This is the part that decides what to ask you, because it says the difficulty is in the accounting rather than in the motion.

Sample victim start poses from a box about this position, run each through the sweep on the search's own substep grid, and watch the exposed foot's radius. 200 poses per box, the centre included, every start pose checked to be on the board and not already touching the attacker. Position and rotation half-widths are given independently below rather than tied together through a metric.

| box, per axis | thrown | poses with a non-increasing step, whole sweep | whole box in sustained contact from | smallest step from there on | smallest step over substeps 74-98 | box minimum clears the rim at |
|---|---|---|---|---|---|---|
| `+-0.1u / +-0.01 rad` | 200/200 | 0 | substep 15 | 0.0087u | 0.0836u | substep 85 |
| `+-0.125u / +-0.01 rad` | 200/200 | 0 | substep 16 | 0.0090u | 0.0628u | substep 85 |
| `+-0.125u / +-0.05 rad` | 200/200 | 0 | substep 20 | 0.0099u | 0.0616u | substep 89 |
| `+-0.25u / +-0.01 rad` | 200/200 | 0 | substep 18 | 0.0095u | 0.0605u | substep 86 |
| `+-0.5u / +-0.01 rad` | 200/200 | 0 | substep 23 | 0.0107u | 0.0594u | substep 87 |

The last column is the first substep at which the *minimum over the sampled box* exceeds the rim. It equals the latest individual throw in every row, which is what monotonicity forces, and unlike the other columns it is a property of the sample rather than of the box: a wider sample can only push it later.

Four things to read off it.

**The exposed foot's radius never falls.** Not only through the dwell: over the whole sweep, for every pose, at every box size. Zero decreasing steps in 27400 steps per box, three box sizes checked, and the throw-bound thread gets the same on the second throw arm independently.

**Through the dwell the increments are large relative to the widths in play, and they barely move with the box.** The smallest across 1000 park trajectories is 0.059u, against enclosure widths of 0.01 to 0.1u, and it falls only from 0.0628u to 0.0594u as the box grows fourfold. Through the dwell the gain runs 0.05 to 0.09u a substep.

**The early gains are small, and where the slab should start is the interesting part.** Over a wide box the poses do not all begin touching at the same substep: at `+-0.125u` the first contact ranges over substeps 9 to 16, and at `+-0.5u` over 2 to 23. In the window where some poses of the box are touching and others are not, the minimum gain over the box is of course near zero, and quoting it as a bound on the gain is meaningless — it is a statement about the slab boundary, not about the contact.

The right question is what the floor is once the *whole* box is in contact, and there the picture is clean. **No pose's contact ever lapses once it has begun**, at any box size tried, so "in contact" is an interval per pose. From the substep at which the whole box is in sustained contact, the smallest per-substep gain is **0.0087u to 0.0107u** across the five boxes — and it *rises* slightly with box size, because a wider box starts its slab later and so skips more of the grazing phase. That is the number a per-slab (H2)/(H3) has to work with at the hard end: 0.009u a substep near the start, rising to 0.059u through the dwell. That matters because `throw-theorem.md` already found that uniform bounds over the sweep give a total of only 0.44u by 28 degrees, dominated by the early substeps where the normal is still 68 degrees off radial, and that per-slab bounds would follow the engine's real 3.18u closely. Per-slab is precisely what this measurement says is available.

**The spread of the outcome contracts.** From first contact to the last pose's throw, the spread of the exposed foot's radius across the box goes 0.4408u to 0.2008u at `+-0.125u` (a factor of 0.456), 0.7443u to 0.2509u at `+-0.25u`, and 1.3697u to 0.3824u at `+-0.5u`. Meanwhile the pose box itself expands by only 1.04x over the same window (the throw-bound thread's measurement, not ours). So the dynamics do not merely fail to blow up; in the quantity the proof cares about they pull the box together.

And at `+-0.125u`, one whole grid cell, the minimum over the box clears the rim at substep 85 — the same substep the interval certificate reaches at a box 600 times smaller. A non-stepping argument over a whole cell would not need a longer sweep.

**This is sampling, and sampling is not proof.** Two hundred poses per box say the hypotheses below are *true*; they say nothing about whether they are *provable*. Sampling is exactly the argument the certificate exists to replace, and it is offered here as evidence about where the difficulty lies, not as a substitute.

---

## 4. The questions

**1. How do we prove the barrier hypotheses over a box of order 0.1u?** This is the one that matters, and it is not "is there a monotone quantity" — section 3 answers that empirically. The monotone quantity is the exposed foot's radius, and the structure it needs is already written down. `throw-theorem.md` states a barrier theorem whose hypotheses are, over a box `B` of victim poses and until the throw:

- **(H1)** the touching pair is one tube pair with closest points interior to both tubes, `hf >= 0.35`, and no hub contact;
- **(H2)** the attacker's contact point advances into the victim: `a(alpha, pose) >= a_min(alpha) > 0`;
- **(H3)** the gain coefficient `g = n . u + (rn / I) R (J f) . u` satisfies `g >= g_min(alpha) > 0`, with `rn^2 <= L^2`;
- **(H4)** `B` is invariant until the throw: it contains the start pose and every pose reached from it by slides along normals of the cone (H1) allows over `B`, of total length at most the attacker's total advance, together with spins of at most 0.02588 times that length.

Given those, the foot gains `lambda g = a g / (1 + rn^2/I) >= a_min g_min / (1 + L^2/I)` a substep, and summing over the sweep reaches the rim. No enclosure is carried.

The structural reason this route can work where the stepping method cannot: **invariance replaces propagation**. A box that maps into itself needs nothing carried from substep to substep, so there is no feedback loop, so there is no threshold to fall off. The `pad + c pad^2` recursion of section 2 simply does not arise.

So the question is how to prove (H2), (H3) and (H4) over a box of order `+-0.1u`. Two parts, and we would push hardest on the second:

- **(H2) and (H3) per slab.** Uniform-over-the-sweep bounds give 0.44u, which fails. The measurement says the gain is stable through the dwell and worst at the early contacts, so the bound wants to be per slab of a few degrees, with the first slab beginning where the whole box is in contact rather than where the centre first touches. What is the right way to get a rigorous per-slab `a_min` and `g_min` over a box, given that during the dwell the victim's contact is a known material point — the vertex at arc angle 30 degrees on leg 0, at `p(q) = (x, y) + R sin(30) (cos rot, sin rot)`, height `R cos(30)` — and the attacker's is the perpendicular foot from that point onto a chord that is fixed within a substep?
- **(H4), invariance.** This is where we do not know the answer. The Jacobian machinery from the park work is the right tool — the push direction is an exactly differentiable function of the pose during a dwell — but whether the mean-value remainder is small enough for a box of 0.1u to be shown to map into itself, we cannot say. If it is not, is there a different shape of set, or a different coordinate system, in which invariance is checkable?

A clear argument that (H4) cannot hold at this box size would also be worth having, before more effort goes into it.

**2. Can `lambda . da` be handled without stepping?** If the invariance route does not close, this is the term that decides how far the stepping method can be pushed. `lambda` is the push magnitude and `da` the hull of the push direction over the substep, from before the push to after it. They are not independent — both are determined by the same pose — but the checker bounds them separately and multiplies, which is where the factor comes from. Is there a form of the one-contact update in which the product appears as a single quantity with a bound tighter than the product of the parts? The update itself, in mass coordinates, is the Newton step you gave us: `Phi(z) = z - G(z) a / |a|^2`.

**3. Does the method have one ceiling or several?** We assumed the dwell was the universal obstacle because it was the obstacle on the arm we studied. It is not: the second throw arm, attacker 1 about foot 2, is not limited by the dwell at all. At `+-0.001u` it reaches substep 113 of 331, one past its own throw, and its blow-up begins at substep 109 where the direction cone goes from 0.20 to 5.32 degrees. We have not diagnosed that one. If the two ceilings have different causes, a method that fixes the dwell fixes half the problem, and we would rather know that now than after building it.

---

## 5. Facts to keep straight

- The engine's substep is a function of the call, not a global grid: one swing call of `x` degrees is split into `ceil(x / 0.4)` **equal** substeps. The search always swings one degree at a time, so its substeps are exactly 1/3 degree and this 46-degree sweep is exactly 138 of them. Every number here is on that grid.
- The throw on the studied arm is at substep 84, 28.00 degrees, for the centre pose. The certificate needs 85.
- The park runs substeps 74 to 98 measured entering each substep, 79 to 104 measured leaving it. The stable intersection is 79 to 98.
- All contact geometry here is read from the pose **entering** a substep, which is what the engine's contact search sees. Read from the post-push pose instead and the victim's contact sits a few hundredths of a chord off its vertex rather than exactly on it, and a touching pair reads as not touching at all, since after the push it sits at exactly `D`.
- The checker has a `--validate` mode that simulates poses from the box with the engine's own law and asserts every per-substep enclosure and bound, so anything proposed here can be tested against real trajectories before it is trusted. It has itself had a bug: it compared each pose against the *printed* enclosure, rounded to 1e-3 for display, which is invisible at a `+-0.005u` box and the size of the box at `+-0.001u`. It checks the unrounded enclosure now.
- The barrier theorem and its hypotheses predate all of this work; what is new here is the evidence that its per-slab form is within reach. The earlier verdict on it was that the interval checker was the way forward, which is the method sections 1 and 2 describe.
- Attached: `throw-cert-at-1cf90f63f.js`, the checker as it stands; `THROW-CONTACT-LEMMAS-at-1cf90f63f.md`, the write-up it implements, whose sections 8 to 10 cover the park work, the second arm and the gap (that file is byte-identical at the thread's later head `fbad09315`, so it is current); and `park-monotone.js` with its output, the measurement in section 3.
