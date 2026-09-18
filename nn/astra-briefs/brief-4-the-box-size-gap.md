# Brief 4: the throw certificate is proved, and six hundred times too small

Your last answer closed a proof. This one is about the fact that the proof does not yet do the job it was built for, by a margin that no amount of tightening will cover, and about one idea that might.

Same conventions as briefs 2 and 3: board units `u`, degrees unless a formula says radians. Everything below was measured today against the engine's own code. Where a number is the checker's rather than the engine's, it says so. The checker's current source and the write-up it implements are attached, both at commit `1cf90f63f` and both verified against the repository by blob hash.

---

## 0. What your last answer did

**The park work landed and the proof closes.** You gave exact projection formulas for a contact resting on a polyline vertex. Making both sides of the dwell exact — the victim's contact is a known material point, the attacker's is the perpendicular foot from that point onto a fixed chord — and then putting the *linear part* of the resulting push-direction map into the enclosure's basis Lohner-style, rather than carrying the direction as an interval, dropped the per-substep growth through the park from about 1.4x to 1.11x. With that, at a victim box of `+-0.0002u` in position and `+-0.002 rad` in rotation, every pose is certified thrown off the board. A second throw arm on the same seed certifies too.

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

The sampled routine works on a victim box of half-width 0.5u with a grid step of 0.25u. One cell therefore has a per-axis half-width of about **0.125u**. The interval certificate closes at **0.0002u**. That is 600 times too small per axis; covering one cell by subdivision is on the order of `10^8` sub-certificates.

Subdivision does not bridge it, and neither, as far as we can see, does term-tightening. With the push's linear part in the basis the feedback is quadratic — the enclosure grows like `pad + c pad^2` per substep rather than by a constant factor — so `0.0002u` is a **threshold**, not a soft limit, and raising it 600-fold means cutting `c` 600-fold. Measured at substeps 80 to 84, the three terms of the remainder:

| term | width (u) |
|---|---|
| `lambda . da` | 5.2e-3 |
| `lambda Lambda_c B m3` | 2.6e-3 |
| `Lambda_c dB . dq` | 1.8e-4 |

The Jacobian's own spread, the term the linearisation introduced, is the smallest by a factor of 29. What dominates is `lambda . da`, the push magnitude's range times the direction cone, and it resists the same treatment: `da` hulls the direction over the whole substep, from before the push to after it, whereas `B` is the pose derivative at one instant, so `B . dq` does not enclose it. A careful re-derivation of that term looks likely to buy a factor of a few. The gap is three orders of magnitude wider than that.

---

## 3. The gap is bookkeeping, and here is the measurement that says so

This is the part we would most like you to take seriously, because it says the difficulty is not in the dynamics.

Sample victim start poses from a box about this position, run each through the sweep on the search's own substep grid, and watch the exposed foot's radius. 200 poses per box, the centre included, every start pose checked to be on the board and not already touching the attacker.

| box, per axis | thrown | poses with a non-increasing step over substeps 74-98 | smallest increment anywhere | box minimum clears the rim at |
|---|---|---|---|---|
| `+-0.1u / +-0.01 rad` | 200/200 | 0 | 0.0836u | substep 85 |
| `+-0.125u / +-0.01 rad` | 200/200 | 0 | 0.0628u | substep 85 |
| `+-0.125u / +-0.05 rad` | 200/200 | 0 | 0.0616u | — |
| `+-0.25u / +-0.01 rad` | 200/200 | 0 | 0.0605u | — |
| `+-0.5u / +-0.01 rad` | 200/200 | 0 | 0.0594u | substep 90 |

Three things to read off it.

**The exposed foot's radius increases at every substep of the dwell, for every pose, at every box size we can construct.** Not marginally: the smallest increment anywhere in 1000 sampled trajectories is 0.059u, which is two orders of magnitude above the enclosure widths the checker is fighting over. `+-0.125u` is one whole grid cell; `+-0.5u` is the entire box the sampled routine works on.

**The true spread barely grows.** At `+-0.125u` the spread of the foot radius across the box goes 0.2077u at substep 74 to 0.2386u at 98, which is **1.0058 per substep**. The checker's best enclosure grows at 1.11. At `+-0.5u` the spread *contracts* through the approach, 0.660u at substep 70 down to 0.363u at 82, then grows at about 1.011.

**At one grid cell the margin is available at the same substep the certificate already needs.** At `+-0.125u` the minimum over the box clears the rim at substep 85 — the same substep the interval certificate reaches at a box 600 times smaller. A monotone argument over a whole cell would not need a longer sweep. It would need different accounting.

So the dynamics through the dwell are neutral to contracting and the margin is enormous, and essentially the whole 600x is the cost of carrying an enclosure through twenty-five substeps one at a time.

(Sampling is of course not proof — it is exactly the argument the certificate exists to replace. It is offered as evidence about where the difficulty is, not as a substitute for one.)

---

## 4. The questions

**1. Is there a monotone quantity over the whole dwell?** This is the one we care about. Every substep of the park is a chance for the enclosure to grow, and the park is where all the growth is. What we want is an argument that does not step: some quantity, defined on the pose, that can be shown to increase at every substep for every pose in a box of order 0.125u, so that the exposed foot's radius at the end of the dwell is bounded below without carrying a set through each substep.

The structure that makes this look possible: during the dwell the victim's contact point is a fixed material point of the victim, the vertex at arc angle 30 degrees on its leg 0, at `p(q) = (x, y) + R sin(30) (cos rot, sin rot)` and height `R cos(30)`. The attacker's chord is fixed within a substep and rotates by 1/3 degree between them. The push is always along the perpendicular from that vertex to that chord, which is a direction that points, broadly, outward. The exposed foot is a different material point of the same body. So the question has a concrete form: is `d/dk` of the exposed foot's radius expressible as something sign-definite over a box, given the dwell holds — a Lyapunov-style argument on the sweep index rather than an enclosure?

What would count as an answer, in descending order of usefulness: a quantity and a proof that it is monotone; a quantity and the conditions under which it is monotone, interval-checkable over a box; or a clear argument that no such quantity exists on this dynamics, which would be worth knowing before more effort goes in.

**2. Can `lambda . da` be handled without stepping?** If the answer to 1 is no, this is the term that decides how far the stepping method can be pushed. `lambda` is the push magnitude and `da` the hull of the push direction over the substep, from before the push to after it. They are not independent — both are determined by the same pose — but the checker bounds them separately and multiplies, which is where the factor comes from. Is there a form of the one-contact update in which the product appears as a single quantity with a bound tighter than the product of the parts? The update itself, in mass coordinates, is the Newton step you gave us: `Phi(z) = z - G(z) a / |a|^2`.

**3. Does the method have one ceiling or several?** We assumed the dwell was the universal obstacle because it was the obstacle on the arm we studied. It is not: the second throw arm, attacker 1 about foot 2, is not limited by the dwell at all. At `+-0.001u` it reaches substep 113 of 331, one past its own throw, and its blow-up begins at substep 109 where the direction cone goes from 0.20 to 5.32 degrees. We have not diagnosed that one. If the two ceilings have different causes, a method that fixes the dwell fixes half the problem, and we would rather know that now than after building it.

---

## 5. Facts to keep straight

- The engine's substep is a function of the call, not a global grid: one swing call of `x` degrees is split into `ceil(x / 0.4)` **equal** substeps. The search always swings one degree at a time, so its substeps are exactly 1/3 degree and this 46-degree sweep is exactly 138 of them. Every number here is on that grid.
- The throw on the studied arm is at substep 84, 28.00 degrees, for the centre pose. The certificate needs 85.
- The park runs substeps 74 to 98 measured entering each substep, 79 to 104 measured leaving it. The stable intersection is 79 to 98.
- All contact geometry here is read from the pose **entering** a substep, which is what the engine's contact search sees. Read from the post-push pose instead and the victim's contact sits a few hundredths of a chord off its vertex rather than exactly on it, and a touching pair reads as not touching at all, since after the push it sits at exactly `D`.
- The checker has a `--validate` mode that simulates poses from the box with the engine's own law and asserts every per-substep enclosure and bound, so anything proposed here can be tested against real trajectories before it is trusted. It has itself had a bug: it compared each pose against the *printed* enclosure, rounded to 1e-3 for display, which is invisible at a `+-0.005u` box and the size of the box at `+-0.001u`. It checks the unrounded enclosure now.
- Attached: `throw-cert-at-1cf90f63f.js`, the checker as it stands; `THROW-CONTACT-LEMMAS-at-1cf90f63f.md`, the write-up it implements, whose sections 8 to 10 cover the park work, the second arm and the gap; and `park-monotone.js` with its output, the measurement in section 3.
