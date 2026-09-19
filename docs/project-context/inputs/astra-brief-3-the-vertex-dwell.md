# Brief 3: one crossing, then a vertex park

A short follow-up to brief 2, on the throw proof only. Two things prompted it: your last answer found a real unsoundness in our bound, and checking the rest of it showed that the picture brief 2 gave you was wrong in a way that matters. Same conventions as before: board units `u`, degrees, the definitions of brief 2 sections 1.1 and 1.2 unchanged.

**This time the checker's source is attached** (`throw-cert.js`, 616 lines) along with the write-up it implements. You noted, correctly, that you had never been given it, and two of your three criticisms were aimed at a scheme we are not running. That was my fault for describing the code instead of sending it.

---

## 0. What your last answer did

**The overshoot bound was unsound, and you were right to doubt it.** The claim was that after a substep the touching pair is left at distance D up to `eta = R(1 - cos eps) + R(eps - sin eps)`, about 8e-6u. Measured against the engine over the sweep it is exceeded, by about 10%, on 75 of the 138 substeps, starting at substep 32: true overshoot 8.838e-6u against a bound of 8.025e-6u. The error was the object being bounded. That argument follows one material point through the rotation, whereas what must be bounded is the shortest distance after the push, which is re-minimised over every chord pair and can settle on a different point. Your projection bound replaced it: in mass coordinates the one-contact update is a Newton step on the gap, `Phi(z) = z - G(z) a / |a|^2` with `a = grad G`, whose linear term cancels, so `|G(Phi(z))| <= M p^2 / (2 m^2)`. That is now `hessBound` in the attached code, about 0.226 per u with both contact points interior and 1.06 with an endpoint clamping, giving a residual near 1.1e-3u instead of 8e-6u. Two orders of magnitude looser, and proved. It costs about two substeps of reach. A related assumption came out of the same audit and is now checked rather than assumed: the shell argument needs the Gauss-Seidel solver to have stopped because no pair was under D, not because it hit its ten-pass cap (measured, it uses at most two passes and never exhausts them).

**Your counterexample is genuine and reproduces to every digit** you gave: the tie at 2.870742032284565 against ...564, the 0.119185 jump in the 3-D unit normal (6.833 degrees), the 0.359471 jump in the attacker's contact point, and a hub difference after the push of 0.002465181u. It is, though, an instance of the obstacle brief 2 already described: the two attacker chords involved are adjacent and share the phi = 22.5 degree vertex, which is the first crossing on this sweep. And the checker is sound on it, because it does not do what you warned against: at every box size from +-1e-7 to +-0.02 it keeps **both** tied branches and reports a 10.575-degree cone, which covers your 6.833-degree jump. Intersecting a cone about the centre's winning branch with a vertex fan, and dropping the second branch, is the failure you described; it is not the code.

**"Lemmas A and B are false globally" is true and not a refutation**, because neither is claimed globally. Both are stated per chord rectangle, in the write-up and in the code, and your own results table grants them for one nonparallel segment pair including endpoint clamping.

---

## 1. The picture brief 2 gave you was wrong

Brief 2 said the contact point crosses three polyline vertices on the way to the throw, at 10.67, 24.33 and 25.00 degrees of sweep, and that the checker dies at the first. Three corrections, all found after sending it.

**The first crossing is passable.** Brief 2 said shrinking the pose box does not help, because the contact crosses the vertex a few substeps later either way. That is false for the first crossing: at a box of +-0.002u the checker passes it and reaches 24.33 degrees instead of 11.33. It is true for what comes next: every box from +-0.0005u to +-0.003u dies within half a degree of 24.5.

**The third "crossing" is not a crossing.** The victim's contact point arrives at the vertex at `phi = 30 degrees` on its leg 0 and **parks on it**: its arc angle reads 30.000000 degrees exactly at every substep from 74 through the throw and past it, eleven substeps to the throw and on to the sweep's end at 46. Not small: exactly the vertex. A closest point on a polyline parks at a vertex whenever neither adjacent chord has an interior perpendicular foot, and it is ordinary behaviour for a non-smooth curve. What brief 2 reported as a third crossing at 25.00 degrees was the reported chord index flipping from 4 to 3 while the point sat still on the vertex between them.

**So the run ends just before the park, not inside it.** The checker's failure is at substep 73, 24.33 degrees, which is the attacker's own `phi = 15` chord-vertex crossing; the victim's park begins at substep 74. The remaining 3.8 degrees to the throw is one ordinary attacker-side crossing followed by a park that lasts the rest of the way.

That is the shape of the question. The traced geometry either side, by substep index (a note on angles: this trace divides the 46-degree sweep into 139 substeps of 0.3309 degrees, while the checker's own run divides it into 138 of 0.3333, so at the same substep index its sweep angle reads about 0.18 degrees higher; the indices are what to compare, and both runs put the last ordinary substep at 73 and the first parked one at 74):

| substep | sweep (this trace) | phi attacker / victim | u to nearest attacker vertex | u to nearest victim vertex | rn | hf |
|---|---|---|---|---|---|---|
| 70 | 23.165 | 16.023 / 30.730 | 0.394 | 0.294 | -2.257 | 0.563 |
| 72 | 23.827 | 15.686 / 30.543 | 0.277 | 0.219 | -2.135 | 0.562 |
| 73 | 24.158 | 15.517 / 30.449 | 0.208 | 0.181 | -2.074 | 0.562 |
| 74 | 24.489 | 14.397 / **30.000000** | 0.243 | **0.000** | +0.542 | 0.554 |
| 76 | 25.151 | 14.219 / **30.000000** | 0.315 | **0.000** | +0.610 | 0.546 |
| 80 | 26.475 | 13.858 / **30.000000** | 0.460 | **0.000** | +0.737 | 0.532 |

**What is different from the first crossing.** At the first crossing the victim's contact is **1.408u** from its nearest vertex and the two legs' contacts are nowhere near each other's corners: one thing happening, in isolation, and a small box gets through it. At substep 73, the last one before the attacker's crossing, the victim's contact is **0.181u** from its own vertex and lands on it at the very next substep. So the crossing that kills the run is an ordinary crossing on one leg happening while the other leg's contact is already within a fifth of a unit of its own corner. That coincidence, not the crossing by itself, is my candidate explanation for why one is passable at a smaller box and the other is not at any box size we have tried.

**One thing ruled out.** The lever arm `rn` also passes through zero in the same window, at 24.42, from -2.074 to +0.542, and I suspected that degenerated the checker's enclosure basis, which is built from the tangential slide, a spin-led tangent, and the push. That was checked and is false: the spin-led column uses `kappa = rn / (1 + rn^2/I)`, whose denominator never vanishes, so it goes smoothly to zero with `rn`, and at `rn = 0` the three columns are the horizontal tangent, the horizontal normal and pure rotation, an orthogonal triple. Measured through the crossing, the basis Gram cosines are 0, 0, -0.04 at condition number 1.008, against 1.086 earlier in the sweep. It is the best-conditioned point on the sweep. The width there is geometry, not bookkeeping, so please do not spend effort on it.

---

## 2. What I think this means, and where I want you to check me

A park looks at first like the hardest case, since it is the one regime where the closest-point vector is perpendicular to neither of the victim's chords and Lemma B says nothing. I suspect it is actually the **easiest**, and that the checker is treating a simplification as a special case. The reason: during a park the victim's contact point is not something to be localised at all. It is a **known material point of the victim**, the vertex at arc angle 30 degrees on leg 0, whose position is an exact function of the pose,

    p(q) = (x, y) + R sin(30 deg) (cos(rot), sin(rot)),   at height R cos(30 deg),

so the lever arm `r = p_xy - c` is exact, with no interval at all, and `rn` is exact once the normal is. On the attacker's side the closest point is interior to a chord, so it is the foot of the perpendicular from a known point to a fixed segment, which is again exact for a fixed attacker pose. If that is right, a park has *fewer* unknowns than ordinary contact, not more, and the width the checker would report through it is bookkeeping rather than geometry.

The questions, in the order I care about them:

1. **Why is the crossing at 24.33 hard when the one at 10.67 is easy?** Both are ordinary attacker-side chord-vertex crossings. The difference visible in the data is that the second happens while the victim's contact is 0.18u from its own vertex and about to park, against 1.41u at the first. Is that the mechanism, and if so what exactly goes wrong: does the victim's near-corner make its own closest point ill-localised by Lemma A (the minimiser is approaching a constraint boundary of the chord rectangle), so that the attacker-side branching then has a wider set to work with? Or is it something else? If it is the near-corner, the remedy may be to enter the park regime *early*, before the attacker's crossing, rather than after it.

2. **Is a park contact exactly determined?** With the victim's closest point pinned at a known vertex and the attacker's interior to a known chord, the closest-point vector is the perpendicular from that vertex to the attacker's chord: perpendicular to the attacker's tangent only, not to the victim's. Write down what it is exactly as a function of the pose, and say what replaces Lemma B — an exact formula, or a cone, and if a cone, how wide over a set of radius 0.024u.

3. **When does a park hold, provably?** The closest point sits at a vertex exactly when the vector to the other curve lies in the vertex's normal cone, which is a pair of inequalities `v . u_before >= 0 >= v . u_after` on the two adjacent chord tangents. Give that as an interval-checkable test over a set of poses, and the condition under which it persists across a push, so the checker can certify "the park holds for the rest of the sweep" once rather than re-deciding every substep. Our numbers: it holds from substep 74 for the eleven substeps to the throw and onwards past it, with the geometry drifting slowly and monotonically (the attacker's contact moves 0.036u per substep, hf falls from 0.554 to 0.532, and the lever arm rises steadily from +0.54 to +0.74).

4. **Does any of this go away on the true arc?** Brief 2 asked whether the polyline could be traded for the smooth quarter circle, and you may have answered it; if the park is an artefact of the discretisation with no counterpart on the arc, that is an argument for a different proof strategy, and I would like to know whether the transfer error can be made small enough to be worth it. The relevant scale is unchanged: chord 3.023u, sagitta 0.0494u, set width 0.024u.

What is attached: `throw-cert.js` as it now stands (616 lines, including `hessBound` from your projection argument and the vertex handling in `analyse`), the write-up it implements, and the short scripts behind the tables above. The checker has a `--validate` mode that simulates poses from the set with the engine's own law and asserts every per-substep enclosure and bound, so anything you propose can be tested against real trajectories before it is trusted.

---

## 3. Facts to keep straight

- The engine's substep is 1/3 degree; the throw lands at 28.13 degrees of a 46-degree sweep (28.00 at the 0.4-degree substep an older tool used), which is substep 84 dividing the sweep into 138 and 85 dividing it into 139.
- The checker reaches substep 73, 24.33 degrees, at a +-0.001u box, and 11.33 degrees at +-0.005u. The two-substep cost of the sound projection bound is included in both.
- Every bound in the checker has been validated against the engine, on 200 simulated poses at two box sizes, with zero violations; the unsound overshoot bound was caught by measuring the engine directly after your review, not by the validator, which did not test that quantity.
- The park is the engine's own behaviour, not a modelling choice: `arcClosest` returns the closest point between two 12-segment polylines, and on a polyline a closest point at a vertex is ordinary.
- The lever arm's zero crossing at 24.42 has been checked and is not a source of trouble (section 1).
