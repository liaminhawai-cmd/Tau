# Brief 5 update: what the new Claude work establishes

Date: **2026-09-19**

The new Claude run recovered 261 sampled dead points, 63 sampled six-dimensional
balls, 1,045 screened controls and an L17-versus-L11 measurement. The useful
question is how to turn the points into reusable dead classes or regions.

The review found a source mismatch that changes the interpretation of the match:
the published L17 index has eight old hard-coded point entries and twelve old
entry arcs. It does not load `dead-points-mined.jsonl` or `dead-balls.jsonl`.
Thus 23,804 consultations and zero hits show that the old embedded table did not
fire in that run. They do not show that the new 261/63 corpus was useless in
play. The reported score, 56–40, has a 95% Elo interval of −11 to +133; the
saved run does not establish a large strength advantage or its absence.

The 63 new balls perturb both pieces in the six-dimensional joint pose. Under
the implemented metric, a local radius-ε ball has volume `(π²/45)ε⁶` in
coordinates `(bx,by,Rθb,rx,ry,Rθr)`. The summed ambient volume of the 63 balls
is 0.00184559u⁶ before overlap and board clipping. This is positive volume, but
the labels remain sampled: point and ball engine agreement is falsification that
did not fire, not an enclosure theorem. The current sampler visits an L1
cross-polytope occupying about 40.5% of the hybrid metric ball.

There are 261 points, 63 balls, 1,045 controls, 10,440/10,440 recorded point
checks and 1,575 recorded ball checks. The controls are screen-biased unknowns;
`escape` means no certificate was found within budget. “All 136 unresolved rows
have the same cause” is too strong because the generic failure string is emitted
without testing whether the winning arm changed. Clearance claims should state a
tolerance: 10 points exceed 0.05u, while 187 exceed zero including tiny residuals.

The constructive route is a finite reply cover. For every legal victim reply in
a region, one of a finite set of verified attacker policies must have a positive
winning margin. Policies may change across guarded patches. A two-response
margin bridge gives a radius formula when endpoint margins and full-map
Lipschitz bounds are verified. A phase-indexed moving tube handles trajectories
that leave a fixed initial box. For deeper results, use the bounded-horizon
attractor `W_(n+1) = W_n ∪ predecessor(W_n)` with the correct existential and
universal turn quantifiers and explicit terminal/no-move rules.

The package's nine-stop diagnostic uses the frozen engine on one reported
unresolved gap. At 4.80 through 5.20 degrees, the attacker arm `(1,+1)` throws
at all nine tested stops; the victim does not throw. This is a reproducible
regression case, not an interval proof.
