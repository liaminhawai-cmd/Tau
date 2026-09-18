# Brief 3: the vertex dwell

A short follow-up to brief 2, on the throw proof only. Two things prompted it: your last answer found a real unsoundness in our bound, and checking the rest of it showed that the picture brief 2 gave you was wrong in a way that matters. Same conventions as before: board units `u`, degrees, the definitions of brief 2 section 1.1 and 1.2 unchanged.

**This time the checker's source is attached** (`throw-cert.js`, 616 lines) along with the write-up it implements. You noted, correctly, that you had never been given it, and two of your three criticisms were aimed at a scheme we are not running. That was my fault for describing the code instead of sending it.

---

## 0. What your last answer did

**The overshoot bound was unsound, and you were right to doubt it.** The claim was that after a substep the touching pair is left at distance D up to `eta = R(1 - cos eps) + R(eps - sin eps)`, about 8e-6u. Measured against the engine over the sweep it is exceeded, by about 10%, on 75 of the 138 substeps, starting at substep 32: true overshoot 8.838e-6u against a bound of 8.025e-6u. The error was the object being bounded. That argument follows one material point through the rotation, whereas what must be bounded is the shortest distance after the push, which is re-minimised over every chord pair and can settle on a different point. Your projection bound replaced it: in mass coordinates the one-contact update is a Newton step on the gap, `Phi(z) = z - G(z) a / |a|^2` with `a = grad G`, whose linear term cancels, so `|G(Phi(z))| <= M p^2 / (2 m^2)`. That is now `hessBound` in the attached code, about 0.226 per u with both contact points interior and 1.06 with an endpoint clamping, giving a residual near 1.1e-3u instead of 8e-6u. Two orders of magnitude looser, and proved. It costs about two substeps of reach. A related assumption came out of the same audit and is now checked rather than assumed: the shell argument needs the Gauss-Seidel solver to have stopped because no pair was under D, not because it hit its ten-pass cap (measured, it uses at most two passes and never exhausts them).

**Your counterexample is genuine and reproduces to every digit** you gave: the tie at 2.870742032284565 against ...564, the 0.119185 jump in the 3-D unit normal (6.833 degrees), the 0.359471 jump in the attacker's contact point, and a hub difference after the push of 0.002465181u. It is, though, an instance of the obstacle brief 2 already described: the two attacker chords involved are adjacent and share the phi = 22.5 degree vertex, which is the first crossing on this sweep. And the checker is sound on it, because it does not do what you warned against: at every box size from +-1e-7 to +-0.02 it keeps **both** tied branches and reports a 10.575-degree cone, which covers your 6.833-degree jump. Intersecting a cone about the centre's winning branch with a vertex fan, and dropping the second branch, is the failure you described; it is not the code.

**"Lemmas A and B are false globally" is true and not a refutation**, because neither is claimed globally. Both are stated per chord rectangle, in the write-up and in the code, and your own results table grants them for one nonparallel segment pair including endpoint clamping.

---

## 1. The picture brief 2 gave you was wrong

Brief 2 said the contact point crosses three polyline vertices on the way to the throw, at 10.67, 24.33 and 25.00 degrees of sweep, and that the checker dies at the first. Two corrections, both found after sending it.

**The first crossing is passable.** Brief 2 said shrinking the pose box does not help, because the contact crosses the vertex a few substeps later either way. That is false for the first crossing: at a box of +-0.002u the checker sails through it and reaches 24.33 degrees instead of 11.33. It is true for what comes next: every box from +-0.0005u to +-0.003u dies within half a degree of 24.5. So the open problem is not crossings in general. It is one place on the sweep.

**And that place is not a crossing.** Tracing which chord pair holds the global minimum, substep by substep at the engine's 1/3-degree substep, the victim's contact point arrives at the vertex at `phi = 30 degrees` on its leg 0 and **stays exactly on it**, for all 26 contact substeps from sweep 24.49 degrees to the throw at 28.13 and onwards to the sweep's end at 46. Exactly: the horizontal distance from the closest point to that vertex is 0.0, not small, at every one of those substeps, because the closest point on a polyline sits at a vertex whenever neither adjacent chord has an interior perpendicular foot. What brief 2 reported as "a third crossing at 25.00 degrees" was the reported chord index flipping between 3 and 4 while the point sat still on the vertex between them.

So the remaining 3.6 degrees between where the checker stops (24.33) and the throw (28.13) is **entirely inside a permanent vertex dwell**. That is the whole of the gap. It is not a crossing problem and no amount of subdividing the box will reach past it.

**Three things happen within 0.16 degrees of each other**, which is presumably why this spot is hard:

| what | at sweep |
|---|---|
| the attacker's contact crosses its own chord vertex, phi = 15.0 | 24.33 deg |
| the lever arm `rn` passes through **zero**, from -2.07 to +0.54 | 24.42 deg |
| the victim's contact arrives at its phi = 30 vertex and dwells there for good | 24.49 deg |

The traced geometry either side (1/3-degree substeps, centre pose):

| sweep | phi attacker / victim | u to nearest attacker vertex | u to nearest victim vertex | rn | hf | chord crossing angle |
|---|---|---|---|---|---|---|
| 23.83 | 15.69 / 30.54 | 0.277 | 0.219 | -2.135 | 0.562 | 63.9 |
| 24.16 | 15.52 / 30.45 | 0.208 | 0.181 | -2.074 | 0.562 | 63.7 |
| 24.49 | 14.40 / **30.00** | 0.243 | **0.000** | +0.542 | 0.554 | 67.3 |
| 24.82 | 14.31 / **30.00** | 0.279 | **0.000** | +0.576 | 0.550 | 67.0 |
| 25.48 | 14.13 / **30.00** | 0.351 | **0.000** | +0.643 | 0.543 | 66.4 |
| 26.47 | 13.86 / **30.00** | 0.460 | **0.000** | +0.737 | 0.532 | 65.6 |

For contrast, at the first crossing (10.59) the victim's contact is 1.4u from its nearest vertex and the lever arm is -4.5: one thing happening, in isolation, which is consistent with a small box getting through it.

---

## 2. What I think this means, and where I want you to check me

The dwell looks at first like the hardest case, since it is the one regime where the closest-point vector is perpendicular to neither of the victim's chords and Lemma B says nothing. I suspect it is actually the **easiest**, and that the checker is treating a simplification as a special case. The reason: during the dwell the victim's contact point is not something to be localised at all. It is a **known material point of the victim**, the vertex at arc angle 30 degrees on leg 0, whose position is an exact function of the pose,

    p(q) = (x, y) + R sin(30 deg) (cos(rot), sin(rot)),   at height R cos(30 deg),

so the lever arm `r = p_xy - c` is exact, with no interval at all, and `rn` is exact once the normal is. On the attacker's side the closest point is interior to a chord, so it is the foot of the perpendicular from a known point to a fixed segment, which is again exact for a fixed attacker pose. If that is right, the dwell has *fewer* unknowns than ordinary contact, not more, and the width the checker reports through it is bookkeeping rather than geometry.

The questions, in the order I care about them:

1. **Is the dwell contact exactly determined?** With the victim's closest point pinned at a known vertex and the attacker's interior to a known chord, the closest-point vector is the perpendicular from the vertex to the attacker's chord: perpendicular to the attacker's tangent only, not to the victim's. That is one constraint on a 3-vector, so the vector has one degree of freedom less than free but one more than the two-perpendicularity case of Lemma B. Write down what it is exactly, as a function of the pose, and say what replaces Lemma B: an exact formula, or a cone, and if a cone, how wide over a set of radius 0.024u.

2. **When does the dwell hold, provably?** The closest point sits at a vertex exactly when the vector to the other curve lies in the vertex's normal cone, which is the pair of inequalities `v . u_before >= 0 >= v . u_after` on the two adjacent chord tangents. Give that as an interval-checkable test over a set of poses, and the condition under which it persists across a push, so the checker can certify "the dwell holds for the rest of the sweep" once rather than re-deciding every substep. Our numbers: the dwell holds for 26 consecutive substeps and the geometry is drifting slowly and monotonically through it (the attacker's contact moves 0.036u per substep, the crossing angle 65 to 67 degrees, hf 0.55 falling to 0.53).

3. **Does `rn = 0` break the enclosure basis?** The checker carries its pose set as a parallelotope whose basis is built from the contact itself: the tangential slide, the spin-led tangent, and the push. The lever arm passes through zero at 24.42, which is where the spin term of the update vanishes and, I suspect, that basis degenerates or becomes ill-conditioned exactly where the trouble is. Is that a real failure mode? What basis is well conditioned through a sign change of `rn`?

4. **The entry.** Between 24.16 and 24.49 the attacker crosses its own vertex, `rn` changes sign, and the victim's contact lands on its vertex. Can these be separated in the argument, or is one of them causing the others? (My guess is the attacker's vertex crossing and the dwell onset are the same event seen from two sides, because a vertex crossing on one leg moves the contact point discontinuously along the other, but I have not shown that.)

5. **Does any of this go away on the true arc?** Brief 2 asked whether the polyline could be traded for the smooth quarter circle, and you may have answered it; if the dwell is an artefact of the discretisation with no counterpart on the arc, that is an argument for a different proof strategy entirely, and I would like to know whether the transfer error can be made small enough to be worth it. The relevant scale is unchanged: chord 3.023u, sagitta 0.0494u, set width 0.024u.

What is attached: `throw-cert.js` as it now stands (616 lines, the checker itself, including `hessBound` from your projection argument and the vertex-regime handling in `analyse`), the write-up it implements, and the two short scripts behind the tables above. The checker has a `--validate` mode that simulates poses from the set with the engine's own law and asserts every per-substep enclosure and bound, so anything you propose can be tested against real trajectories before it is trusted.

---

## 3. Facts to keep straight

- The engine's substep is 1/3 degree; the throw lands at 28.13 degrees of a 46-degree sweep (28.00 at the 0.4-degree substep an older tool used).
- The checker reaches 24.33 degrees at a +-0.001u box, 11.33 at +-0.005u. The two-substep cost of the sound projection bound is included in both.
- Every bound in the checker has been validated against the engine, on 200 simulated poses at two box sizes, with zero violations; the unsound overshoot bound was caught by measuring the engine directly after your review, not by the validator, which did not test that quantity.
- The dwell is the engine's own behaviour, not a modelling choice: `arcClosest` returns the closest point between two 12-segment polylines, and on a polyline a closest point at a vertex is ordinary.
