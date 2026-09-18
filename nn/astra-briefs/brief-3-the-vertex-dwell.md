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

**The first crossing is passable.** Brief 2 said shrinking the pose box does not help, because the contact crosses the vertex a few substeps later either way. That is false for the first crossing: at a box of +-0.002u the checker passes it and reaches substep 73, 24.33 degrees, instead of 11.33. It is true for what comes next: shrinking the box a further fourfold, to +-0.0005u, buys exactly one substep. The numbers are in section 2, and they rule out a second explanation.

**The third "crossing" is not a crossing.** The victim's contact point arrives at the vertex at `phi = 30 degrees` on its leg 0 and **parks on it**: its arc angle reads 30.000000 degrees exactly at every substep from 74 to 98, which is eleven substeps to the throw at 84 and fourteen more past it. Not small: exactly the vertex, deviation 0.0. A closest point on a polyline parks at a vertex whenever neither adjacent chord has an interior perpendicular foot, and it is ordinary behaviour for a non-smooth curve. What brief 2 reported as a third crossing was the reported chord index flipping from 4 to 3, which happens at substep 74, the substep the park begins: from there the victim's contact is the clamped endpoint of chord 3 rather than an interior point of chord 4, and chords 3 and 4 share the `phi = 30` vertex, so the index changes while the point sits still.

**So the run ends at the combined event.** The checker's failure is at substep 73, 24.33 degrees. That substep is the attacker's own `phi = 15` chord-vertex crossing, and it is also the substep in which the victim's contact arrives at its `phi = 30` vertex, 0.005u from it; the victim is exactly on it from 74. So the run does not die before the park or inside it, it dies at the substep where both events happen. The remaining 3.67 degrees to the throw is that combined event followed by a park that covers the whole rest of the way.

That is the shape of the question. The traced geometry either side, on the search's own grid (the search swings a degree at a time and the engine splits each call into `ceil(1 / 0.4) = 3` equal substeps, so the 46-degree sweep is exactly 138 substeps of exactly 1/3 degree):

| substep | sweep | phi attacker / victim | u to nearest attacker vertex | u to nearest victim vertex | rn | hf |
|---|---|---|---|---|---|---|
| 70 | 23.333 | 15.930 / 30.676554 | 0.375 | 0.273 | -2.226 | 0.563 |
| 71 | 23.667 | 15.760 / 30.582516 | 0.306 | 0.235 | -2.165 | 0.562 |
| 72 | 24.000 | 15.590 / 30.488085 | 0.238 | 0.197 | -2.103 | 0.562 |
| 73 | 24.333 | **14.461** / 30.011915 | 0.217 | **0.005** | **+0.534** | 0.556 |
| 74 | 24.667 | 14.371 / **30.000000** | 0.254 | **0.000** | +0.569 | 0.552 |
| 76 | 25.333 | 14.191 / **30.000000** | 0.326 | **0.000** | +0.638 | 0.545 |
| 80 | 26.667 | 13.828 / **30.000000** | 0.472 | **0.000** | +0.765 | 0.530 |
| 84 | 28.000 | 13.458 / **30.000000** | 0.622 | **0.000** | +0.876 | 0.514 |

Substep 73 is where the attacker's `phi` drops from 15.590 to 14.461: its contact point steps across the vertex at `phi = 15` from chord 2 onto chord 1, while the victim's arrives at its own vertex at `phi = 30`. By the chord parameters, taken from the pre-push pose at each substep:

| substep | attacker chord, parameter | victim chord, parameter |
|---|---|---|
| 71 | 2 at 0.1033 | 4 at 0.0807 |
| 72 | 2 at 0.0802 | 4 at 0.0677 |
| 73 | **1** at 0.9291 | 4 at **0.0017** |
| 74 | 1 at 0.9172 | **3 at 1.0000** (clamped: the vertex) |
| 80 | 1 at 0.8456 | 3 at 1.0000 |

The attacker's parameter walks steadily down chord 1 at about 0.012 of a chord per substep and stays well inside it, which is what section 2 leans on.

A measurement convention worth stating, because it has caught both of us: all of this is read from the pose **entering** each substep, which is the pose the engine's contact search actually sees. Read from the pose after the push instead and the numbers change qualitatively, not just numerically: the victim's contact reads a few hundredths of a chord off its vertex rather than exactly on it, and the touching pair reads as not touching at all, because after the push it sits at exactly `D`.

**What is different from the first crossing: the two events coincide.** At the first crossing, substep 32, the victim's contact is **1.419u** from its nearest vertex and neither leg's contact is anywhere near a corner: one thing happening, in isolation, and a small box gets through it. At substep 73 the attacker's contact crosses its `phi = 15` vertex **and** the victim's contact arrives at its `phi = 30` vertex in the same substep: at 73 the victim's contact is 0.005u from that vertex, and from 74 it is exactly on it. Two vertex events, on opposite legs, in the same substep; what happens one substep later is only the victim settling exactly onto its vertex. The lever arm shows it too: `rn` does not drift through zero, it jumps from -2.103 to +0.534 between substeps 72 and 73.

That coincidence, not the crossing by itself, is my candidate explanation for why the first crossing is passable at a smaller box and this one is not at any box size we have tried.

**One thing ruled out.** The lever arm `rn` changes sign in the same substep, from -2.103 to +0.534, and I suspected that degenerated the checker's enclosure basis, which is built from the tangential slide, a spin-led tangent, and the push. That was checked and is false: the spin-led column uses `kappa = rn / (1 + rn^2/I)`, whose denominator never vanishes, so it goes smoothly to zero with `rn`, and at `rn = 0` the three columns are the horizontal tangent, the horizontal normal and pure rotation, an orthogonal triple. Measured through the crossing, the basis Gram cosines are 0, 0, -0.04 at condition number 1.008, against 1.086 earlier in the sweep. It is the best-conditioned point on the sweep. The width there is geometry, not bookkeeping, so please do not spend effort on it.

---

## 2. What I think this means, and where I want you to check me

A park looks at first like the hardest case, since it is the one regime where the closest-point vector is perpendicular to neither of the victim's chords and Lemma B says nothing. I suspect it is actually the **easiest**, and that the checker is treating a simplification as a special case. The reason: during a park the victim's contact point is not something to be localised at all. It is a **known material point of the victim**, the vertex at arc angle 30 degrees on leg 0, whose position is an exact function of the pose,

    p(q) = (x, y) + R sin(30 deg) (cos(rot), sin(rot)),   at height R cos(30 deg),

so the lever arm `r = p_xy - c` is exact, with no interval at all, and `rn` is exact once the normal is. On the attacker's side the closest point is interior to a chord, so it is the foot of the perpendicular from a known point to a fixed segment, which is again exact for a fixed attacker pose. If that is right, a park has *fewer* unknowns than ordinary contact, not more, and the width the checker would report through it is bookkeeping rather than geometry.

The questions, in the order I care about them:

1. **Does a simultaneous two-leg vertex event need different treatment from a single one?** This is the question I most want answered, and it is sharper than "how do I handle a crossing". At substep 32 one leg has a vertex event and the other leg's contact is 1.42u of arc from its nearest vertex: one thing happening, in isolation, and a small box gets through it. At substep 73 both legs have one in the same substep. Are those just two independent branchings that happen to coincide, so that a scheme handling each separately handles both, or does the pair need something the single case does not?

    Two obvious explanations are already dead. It is **not the size of the discontinuity**: the closest-point normal's azimuth goes -72.61 to -83.57 degrees across the first crossing and -95.32 to -108.34 across the second, 11.0 degrees against 13.0. And it is **not the width of the set arriving**, which is the natural story, since forty substeps of growth do leave the enclosure fatter by substep 73. The checker's own runs, at five starting boxes (pad is the enclosure's half-width in u at that substep):

    | starting box | pad at k12 | pad at k31, the first event | pad at k71, before the second | last substep reached |
    |---|---|---|---|---|
    | +-0.005u | 0.045 | 0.093 | — | 34 |
    | +-0.003u | 0.028 | 0.027 | — | 69 |
    | +-0.002u | 0.019 | 0.019 | 0.042 | 73 |
    | +-0.001u | 0.009 | 0.010 | 0.025 | 73 |
    | +-0.0005u | 0.004 | 0.006 | 0.018 | 74 |

    The last row decides it. At +-0.0005u the set reaches the second event at a half-width of 0.018u, **narrower** than the 0.019u that walks straight through the first event at +-0.002u, and it still fails. A set demonstrably narrow enough to survive a single-leg vertex event of the same magnitude does not survive the two-leg one. So the difference does not look quantitative at all: something categorical changes when both legs have an event in the same substep.

    One structural point that may be the whole answer. The two events are on **opposite pieces**: the attacker's contact crosses a vertex of the attacker's own leg while the victim's contact arrives at a vertex of the victim's leg. It is not one contact point negotiating a corner, it is both ends of the same closest-point pair doing it at once, and the two ends are coupled through the single distance function they jointly minimise. That is the reason I doubt "two independent branchings that coincide", but it is a guess, and the guess is what I want you to confirm or break.

    And if the near-corner is the mechanism — the victim's minimiser approaching a constraint boundary of its chord rectangle, so Lemma A localises it less well just as the attacker-side branching needs it — then the remedy may be to enter the park regime *early*, before the attacker's crossing, rather than after it.

2. **Is a park contact exactly determined?** With the victim's closest point pinned at a known vertex and the attacker's interior to a known chord, the closest-point vector is the perpendicular from that vertex to the attacker's chord: perpendicular to the attacker's tangent only, not to the victim's. Write down what it is exactly as a function of the pose, and say what replaces Lemma B — an exact formula, or a cone, and if a cone, how wide over a set of radius 0.024u.

3. **When does a park hold, provably?** The closest point sits at a vertex exactly when the vector to the other curve lies in the vertex's normal cone, which is a pair of inequalities `v . u_before >= 0 >= v . u_after` on the two adjacent chord tangents. Give that as an interval-checkable test over a set of poses, and the condition under which it persists across a push, so the checker can certify "the park holds for the rest of the sweep" once rather than re-deciding every substep. Our numbers: it holds from substep 74 to 98 without a break, which is eleven substeps to the throw at 84 and fourteen past it, with the geometry drifting slowly and monotonically throughout (the attacker's contact moves 0.036u per substep along its chord, hf falls from 0.552 to 0.514 by the throw, and the lever arm rises steadily from +0.57 to +0.88).

4. **Does any of this go away on the true arc?** Brief 2 asked whether the polyline could be traded for the smooth quarter circle, and you may have answered it; if the park is an artefact of the discretisation with no counterpart on the arc, that is an argument for a different proof strategy, and I would like to know whether the transfer error can be made small enough to be worth it. The relevant scale is unchanged: chord 3.023u, sagitta 0.0494u, set width 0.024u.

What is attached: `throw-cert.js` as it now stands (616 lines, including `hessBound` from your projection argument and the vertex handling in `analyse`), the write-up it implements as of the same commit, and the short scripts behind the tables above. The checker has a `--validate` mode that simulates poses from the set with the engine's own law and asserts every per-substep enclosure and bound, so anything you propose can be tested against real trajectories before it is trusted.

---

## 3. Facts to keep straight

- The engine's substep is a function of the call, not a global grid: one `applySwing` call of `x` degrees is split into `ceil(x / 0.4)` **equal** substeps. The search always swings one degree at a time, so its substeps are exactly 1/3 degree and this 46-degree sweep is exactly 138 of them. A different call pattern integrates a different trajectory (asking for the 46 degrees in one call moves the final victim pose by 0.0086u), so every number here is on the search's grid.
- The throw lands at substep 84, 28.00 degrees of the 46-degree sweep. Contact begins at substep 12 and never breaks after that.
- The checker reaches substep 73, 24.33 degrees, at a +-0.001u box, and 11.33 degrees at +-0.005u. The two-substep cost of the sound projection bound is included in both.
- Every bound in the checker has been validated against the engine, on 200 simulated poses at each of five box sizes, with zero violations. Two caveats, both worth having: the unsound overshoot bound was caught by measuring the engine directly after your review, not by the validator, which did not test that quantity. And the validator itself had a bug, which is a bad thing for the bug-catcher to have: it compared each pose against each row's *printed* enclosure, which is rounded to 1e-3 for display, invisible at a +-0.005u box but the size of the box itself at +-0.001u, where it was reporting up to 36 phantom containment failures. It checks the unrounded enclosure now, and the five-box result is from after that fix.
- The park is the engine's own behaviour, not a modelling choice: `arcClosest` returns the closest point between two 12-segment polylines, and on a polyline a closest point at a vertex is ordinary.
- The lever arm's sign change at substep 73 has been checked and is not a source of trouble (section 1).
