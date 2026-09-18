# Brief 4: the throw certificate is proved, six hundred times too small, and there is a way round it

Your last answer closed a proof. This one is about the fact that the proof does not yet do the job it was built for, by a margin no amount of tightening will cover, and about a route round it that measurement says is open. The ask at the end is specific: two hypotheses, over a box, proved.

Same conventions as briefs 2 and 3: board units `u`, degrees unless a formula says radians. Everything below was measured today against the engine's own code. Where a number is the checker's rather than the engine's, it says so. The checker's current source and the write-up it implements are attached, both at commit `dbee5e4a4` and both verified against the repository by blob hash.

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

| box, per axis | thrown | non-increasing steps, whole sweep | substeps with every pose in contact | partial-contact substeps | floor: smallest per-substep minimum over poses | smallest step over substeps 74-98 | box minimum clears the rim at |
|---|---|---|---|---|---|---|---|
| `+-0.1u / +-0.01 rad` | 200/200 | 0 | 124 | 5 | 1.4e-3u at substep 15 | 0.0836u | substep 85 |
| `+-0.125u / +-0.01 rad` | 200/200 | 0 | 123 | 7 | 6.5e-3u at substep 16 | 0.0628u | substep 85 |
| `+-0.125u / +-0.05 rad` | 200/200 | 0 | 119 | 15 | 4.7e-4u at substep 20 | 0.0616u | substep 89 |
| `+-0.25u / +-0.01 rad` | 200/200 | 0 | 121 | 12 | 3.8e-3u at substep 18 | 0.0605u | substep 86 |
| `+-0.5u / +-0.01 rad` | 200/200 | 0 | 116 | 21 | 9.6e-3u at substep 23 | 0.0594u | substep 87 |

The last column is the first substep at which the *minimum over the sampled box* exceeds the rim. It equals the latest individual throw in every row, which is what monotonicity forces, and unlike the other columns it is a property of the sample rather than of the box: a wider sample can only push it later.

Four things to read off it.

**The exposed foot's radius never falls.** Not only through the dwell: over the whole sweep, for every pose, at every box size. Zero decreasing steps in 27400 steps per box, three box sizes checked, and the throw-bound thread gets the same on the second throw arm independently.

**Through the dwell the increments are large relative to the widths in play, and they barely move with the box.** The smallest across 1000 park trajectories is 0.059u, against enclosure widths of 0.01 to 0.1u, and it falls only from 0.0628u to 0.0594u as the box grows fourfold. Through the dwell the gain runs 0.05 to 0.09u a substep.

**The floor at the hard end is of order 1e-3u, and it is worth being careful about which quantity that is.** The barrier sums, per substep, a lower bound valid for *every* pose in the box, so the quantity is the minimum over poses at each substep. Over a wide box the poses do not all begin touching at the same substep — at `+-0.125u` first contact ranges over substeps 9 to 16, at `+-0.5u` over 2 to 23 — and at a substep where some pose is not yet touching that minimum is exactly zero, because a pose that is not pushed does not move. Those substeps contribute nothing and the barrier cannot count them.

Over the substeps where every pose *is* in contact, the smallest such minimum is **4.7e-4u to 9.6e-3u** across the five boxes, always at the first qualifying substep — and that is a fact about the first substep, not about the box. Reading the profile rather than its minimum makes the point. At `+-0.125u / +-0.01 rad`, the per-substep minimum over the box runs

```
substep    16       17       18       20       22       25       30       35       50       74       84
gain     6.5e-3   9.0e-3   9.3e-3   1.0e-2   1.1e-2   1.2e-2   1.3e-2   3.5e-2   4.4e-2   6.0e-2   9.1e-2
```

The first qualifying substep is the grazing one: it is the substep at which the last pose of the box has only just begun to touch, so its gain is whatever that one pose picked up in the fraction of the substep it was in contact for. Raise the sample and only that substep moves. At 200, 600 and 2000 poses substep 16 gives 6.5e-3u, 6.5e-3u and 3.9e-3u, while every substep from 17 on is stable to three significant figures across all three. The throw-bound thread's independent run gets 9.2e-4u at substep 16 and the same profile as ours from 17 on, and re-ran at 600 poses to check: the difference at 16 is sampling, the agreement from 17 is geometry.

So the honest line is a rule and not a number. **The first slab should not begin at the first substep where the whole box is in contact; it should begin one substep later.** From there the barrier carries about 9e-3u a substep, rising past 5.7e-2u by substep 70 and 9e-2u through the park. A second caution still applies: all of this is a different quantity from the smallest gain any single pose ever has, which is 2.8e-7u to 1.1e-4u and which nothing ever sums.

**Contact does not lapse before the throw.** On this arm it never lapses at all: 0 of 200 poses at `+-0.125u` and at `+-0.5u`, over the whole 138-substep sweep. On the seed's other throw arm (attacker about foot 2, direction -1, 333 substeps) every one of 200 poses does lose contact, first at substep 211 at `+-0.125u` and 209 at `+-0.5u` — but the throw is at substep 111 to 113 there, and 0 of 200 lapse before their own throw, at either box. So "in contact" is a single interval per pose up to the throw, which is all the obligation below needs, and the unscoped claim is false. That matters because `throw-theorem.md` already found that uniform bounds over the sweep give a total of only 0.44u by 28 degrees, dominated by the early substeps where the normal is still 68 degrees off radial, and that per-slab bounds would follow the engine's real 3.18u closely. Per-slab is precisely what this measurement says is available.

**The spread of the outcome contracts.** From first contact to the last pose's throw, the spread of the exposed foot's radius across the box goes 0.4408u to 0.2008u at `+-0.125u` (a factor of 0.456), 0.7443u to 0.2509u at `+-0.25u`, and 1.3697u to 0.3824u at `+-0.5u`. Meanwhile the pose box itself expands by only 1.04x over the same window (the throw-bound thread's measurement, not ours). So the dynamics do not merely fail to blow up; in the quantity the proof cares about they pull the box together.

**And the set is not a box. It is a thin sheet.** This is the newest result and it changes the question. Every pose that has been pushed sits on the contact shell, at distance exactly `D` from the attacker's leg, so the box's poses are spread across the plane but present the attacker with almost the same separation. Measured entering each substep at `+-0.1u`, over the 124 substeps where the whole box is in contact: the poses span 0.19u of the plane, while the range of their separation from the attacker is 2.2e-3u on average and 1.9e-4u through the park — a ratio of 86. The throw-bound thread measures the pre-push distance instead and gets 3.3e-3u mean, 9.3e-4u mid-sweep, against the 0.2414u blanket pad an axis-aligned `+-0.1u` box carries: the pad overstates the distance uncertainty by 73x on average and 259x at its best. Two different readings of the same fact. The dynamics pin the set onto the shell, so an invariant set should be **thin along the contact normal and wide across it**, and an axis-aligned box is the wrong shape by that factor.

That is not a refinement. It is the difference between certifying nothing and certifying the throw. Computed rigorously rather than sampled, the per-substep gain bound (H3) over a tube of `+-0.1u` passes **not one substep**, because whole-box contact demands the box's entire distance range under `D` and the pad is 0.2414u against a penetration of a few hundredths — while the sampling says every pose is in contact at 123 of 131 substeps. Both are correct, and together they say the shape is wrong. Supply the shape — distance range taken as 0.005u, 1.5x the measured value, every other bound still over the full tube — and from a starting box of `+-0.0125u` into a tube of `+-0.025u` the certified gain sums to **3.5144u against the 3.2026u needed**, clearing the rim at substep 92, with the 200 sampled poses staying inside the tube. Put in the thickness the argument of question 1(b) derives rather than the measured one, 6.13e-3u, and it still closes: 3.4195u against 3.2026u, surviving up to 8e-3u. That box is 62x wider per axis than the enclosure certificate and within 5x of the cell `certifyThrowBox` works on. With no shape assumption at all, a `+-0.01u` tube certifies 2.113u of the 3.168u needed: two thirds, and the whole shortfall is the pad. It dies at `+-0.05u` (2.65u of 3.26u), where the normal cone opens far enough to cost more than the extra width buys.

And at `+-0.125u`, one whole grid cell, the minimum over the box clears the rim at substep 85 — the same substep the interval certificate reaches at a box 600 times smaller. A non-stepping argument over a whole cell would not need a longer sweep.

**This is sampling, and sampling is not proof.** Two hundred poses per box say the hypotheses below are *true*; they say nothing about whether they are *provable*. Sampling is exactly the argument the certificate exists to replace, and it is offered here as evidence about where the difficulty lies, not as a substitute.

---

## 4. The questions

**1. How do we prove that a thin slab maps into itself, and how do we bound its thickness?** This is the one that matters. It is not "is there a monotone quantity" — section 3 answers that empirically, the quantity is the exposed foot's radius. It is also no longer "can the hypotheses be proved over a box of order 0.1u", because the set is not a box and the margins are not the obstacle: H3 is computed rigorously and, given the right shape, it closes with room to spare — with a thickness the second part below now derives rather than assumes. The structure is already written down. `throw-theorem.md` states a barrier theorem whose hypotheses are, over a box `B` of victim poses and until the throw:

- **(H1)** the touching pair is one tube pair with closest points interior to both tubes, `hf >= 0.35`, and no hub contact;
- **(H2)** the attacker's contact point advances into the victim: `a(alpha, pose) >= a_min(alpha) > 0`;
- **(H3)** the gain coefficient `g = n . u + (rn / I) R (J f) . u` satisfies `g >= g_min(alpha) > 0`, with `rn^2 <= L^2`;
- **(H4)** `B` is invariant until the throw: it contains the start pose and every pose reached from it by slides along normals of the cone (H1) allows over `B`, of total length at most the attacker's total advance, together with spins of at most 0.02588 times that length.

Given those, the foot gains `lambda g = a g / (1 + rn^2/I) >= a_min g_min / (1 + L^2/I)` a substep, and summing over the sweep reaches the rim. No enclosure is carried.

The structural reason this route can work where the stepping method cannot: **invariance replaces propagation**. A set that maps into itself needs nothing carried from substep to substep, so there is no feedback loop, so there is no threshold to fall off. The `pad + c pad^2` recursion of section 2 simply does not arise.

So the two things a certificate now actually owes are the shape and its thickness, and they are what we would ask you about:

- **(a) Does a slab map into itself?** Thin along the contact normal, wide across it. This replaces (H4) over a box, and with (b) answered it is the one hypothesis left: what has to hold is invariance in the two *tangential* directions, since the normal direction is handled below. The thinness is not an assumption about where the poses happen to be; it is what the contact shell does to them, and section 9's shell argument already pins the distance from both sides. Is the slab the right object, is there a better one, and what is the shape of a proof that the push maps such a set into itself?
- **(b) Here is our argument for the thickness. What is wrong with it?** This was an open question an hour ago and now it has a candidate answer, so we would rather have it attacked than asked. It needs no enclosure. After substep `k-1`'s push the solver leaves *every* pose on the shell, `g = D` to its own tolerance, so the set's thickness in the separation is reset each substep and does not accumulate — the structural reason there is no threshold on this side, and the same fact section 9's shell argument establishes, used differently. The attacker then turns once and the separation falls by that substep's advance:

  `pen_k(q) = D - g_k(q) = LIM_SUB * [ z x (p_A - P) ] . n + (within-substep variation)`

  with `p_A` the attacker's contact point, `P` its pivot foot, `n` the unit normal and `LIM_SUB` the 1/3-degree substep, 0.00582 rad. Everything on the right is contact geometry, so the *spread* of the penetration across the set is one substep's worth of a quantity that varies only as much as the contact point does. A 0.13u-wide set presents a 1e-3u-thin profile because 0.00582 rad multiplies a moment arm that differs by a tenth of a unit between its poses.

  One trap, and it is yours from brief 2: **the rate is not constant within a substep.** Taken at the substep's end it understates the spread by up to 1.7x at a vertex crossing, because the contact point jumps chords inside the substep — two events of one foot in one substep, exactly what you warned about for the stopping program. Hulled over the substep's own sweep, the prediction bounds the engine everywhere tried: worst measured-over-predicted 0.984, 0.995, 0.995, 0.996 at boxes of `+-0.0125`, `+-0.025`, `+-0.05` and `+-0.1u`. The thickest the slab ever gets after the entry substep is 5.98e-3, 6.13e-3, 6.35e-3 and 7.14e-3u at those four boxes — almost independent of the box, because the peak is the vertex crossing at substep 74 rather than the width; away from it about 1e-3u. Sampling the separation entering each substep independently here gives the same picture: spread 1e-4 to 8e-4u away from the crossing, 4.6e-3 to 6.0e-3u at it, peaking at the same place and likewise flat in the box.

  Two things we would like read hard. The step from "the solver stopped with nothing under `D`" to "`g = D` to tolerance for every pose" is the whole argument, and it is section 9's shell lemma; is it strong enough to carry the *spread* rather than a one-sided bound? And the within-substep hull is a patch on a discretisation, not a theorem; is there a cleaner object? What this would still leave open is tangential invariance of the tube, and an interval version of the moment arm's range over the box, for which Lemma 1's contact-point localisation looks like the tool.

Two further parts, secondary now:

- **(H2) and (H3) per slab.** Uniform-over-the-sweep bounds give 0.44u, which fails. The measurement says the gain is stable through the dwell and worst at the early contacts, so the bound wants to be per slab of a few degrees, with the first slab beginning one substep after the whole box is in contact, not where the centre first touches and not at the grazing substep itself.
- **The partial-contact substeps, which (H1) to (H4) do not mention.** Between the first pose of the box touching and the last, there are 5 to 21 substeps, depending on the box, at which some poses are being pushed and others are not. Sampled, that is where the problem ends. Computed with the blanket pad it is not 5 to 21 substeps but every substep, since the test "the whole box is in contact" is exactly the one the pad fails; so this question and question 1's (b) are the same question seen twice. The theorem as stated assumes a touching pair throughout; it has no clause for a substep where the box straddles first contact. A certificate therefore owes two things nobody has written down: an interval test establishing "every pose in the box is in contact at this substep" before it may count that substep's gain, and a rule that assigns zero to the substeps that fail it. Is that the right way to handle it, and is the resulting test the natural one — the box's maximum separation over the candidate pair below `D` — or is there a better formulation that does not need a special case at the slab boundary? What is the right way to get a rigorous per-slab `a_min` and `g_min` over a box, given that during the dwell the victim's contact is a known material point — the vertex at arc angle 30 degrees on leg 0, at `p(q) = (x, y) + R sin(30) (cos rot, sin rot)`, height `R cos(30)` — and the attacker's is the perpendicular foot from that point onto a chord that is fixed within a substep?
The tool we would reach for on (a) is the Jacobian machinery from the park work, since the push direction is an exactly differentiable function of the pose during a dwell. Whether its mean-value remainder is small enough to show a slab maps into itself, we cannot say. A clear argument that no such set exists at this width would be worth having too, before more effort goes into it.

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
- Attached: `throw-cert-at-dbee5e4a4.js`, the enclosure checker as it stands; `THROW-CONTACT-LEMMAS-at-dbee5e4a4.md`, the write-up it implements, whose sections 8 to 10 cover the park work, the second arm and the gap, whose section 13 is the rigorous H3 bound and the slab result, and whose section 14 is the thickness argument of question 1(b); `gain-bound-at-dbee5e4a4.js`, `slab-shape-at-dbee5e4a4.js` and `thickness-at-dbee5e4a4.js` with their outputs, the three programs behind those sections; and the scripts behind section 3, `park-monotone.js`, `sustained-contact.js`, `gain-floor.js`, `slab-start.js`, `lapse.js` and `gap-spread.js`, with their outputs.

  The write-up is pinned at the commit whose results this brief quotes, and every attachment was verified against the repository by blob hash. Its section 11 is that author's independent run of the section 3 measurement, which agrees with ours on every headline.
