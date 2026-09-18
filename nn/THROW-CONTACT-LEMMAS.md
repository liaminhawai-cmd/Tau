# The contact lemmas, and why the throw checker stopped growing

2026-09-18, thread "Dead regions from closed-form curves". This is the sequel to
`throw-theorem.md` section 7, which recorded that the first interval checker was
sound but useless: it enclosed the victim's poses in a box that grew about 1.3x
per substep, so a second leg pair became impossible to exclude within twenty or
thirty substeps of a seventy-substep throw. That note listed three lemmas that
would be needed. Two of them are now proved and built. The checker no longer
grows. It still does not reach the end of a throw, and the reason it stops is
new and specific, so it is written down here too.

`nn/throw-cert.js` is the checker, `nn/throw-spread.js` the measurement tool.

## 1. What the measurement said

Before proving anything I measured what the checker was supposed to bound.
Take the certified dead point `ndpxhts24`, the attacker's throwing arm (0,-1),
and a box of victim poses of +-0.005u and +-0.02 degrees. Simulate 150 poses
drawn from that box through all 138 substeps of the 46-degree sweep and record,
at each substep, the true spread of everything the checker brackets.

| quantity | truth over the whole box | the old checker's bound |
| --- | --- | --- |
| contact normal, azimuth span | 0.014 deg | 7.8 deg |
| horizontal fraction hf, span | 0.0001 | 0.10 |
| lever arm rn, span | 0.005 | 2.3 |
| pose set, foot-displacement spread | 0.0239u at the first substep, 0.0246u at the 38th | grows without limit |

The engine's own trajectories do not spread at all. The old bound was not loose
by a factor of two; on the normal it was loose by a factor of five hundred, and
it had a floor: shrinking the starting box did not shrink it, because the bound
came from a fan of neighbouring chord directions on the twelve-segment polyline
leg, and one chord subtends 7.5 degrees no matter how small the box is.

## 2. Lemma 1, where the contact point can be

Write F(s, t) = |A(s) - V_q(t)|^2 for two chords in arclength, A the attacker's
(fixed through a substep) and V_q the victim's. The chords are straight, so F is
a quadratic whose Hessian is

    grad^2 F = 2 [[1, -c], [-c, 1]],    c = cos(crossing angle),

the same matrix for every pose, with smallest eigenvalue mu = 2(1 - |c|).
Moving the victim's pose inside the set moves each of its leg points by at most
delta (the set's point-displacement radius) and turns its tangent by at most the
set's rotation span, so grad F changes by at most a computable |g|.

Let z_c minimise F_c over the chord rectangle and z* minimise F_q over the same
rectangle. Both are constrained minima of a convex function on a convex set, so
each satisfies a variational inequality; adding the two gives

    mu |z* - z_c|^2  <=  -g . (z* - z_c),   hence   |z* - z_c| <= |g| / mu.

Two things matter about this. It is **linear** in the set's size, where the
obvious strong-convexity argument through the function values only gives the
square root, which at delta = 0.024u is 0.75u of leg rather than 0.05u. And it
holds for a minimiser on the rectangle's **boundary** as well as an interior
one, which is what makes the vertex bookkeeping below possible.

## 3. Lemma 2, and why the normal is then exact

At an interior minimum the closest-point vector is perpendicular to both chords,
so it is parallel to uA x uV. For a polyline, uA and uV are constant per chord.
So once Lemma 1 shows the closest point stays inside one chord pair, the contact
normal is not merely bounded, it is **exact** up to the set's own rotation span.
The checker's cone went from 7.8 degrees to 0.03-0.06 degrees, matching the
measured 0.014.

Two bookkeeping rules make that usable.

**The stale-neighbour test.** Two chords meeting at a vertex both report a
minimiser at that vertex, and only one of them is a real local minimum of the
polyline pair. The distance from a victim point sliding along its chord has
derivative n . uV, so if at the vertex the distance rises into chord b and falls
into chord b-1, then, because the partial minimum over the other chord is convex
along a straight chord, the minimum over pair (a, b) is exactly its value at the
vertex, which chord b-1 strictly beats. Pair (a, b) can be dropped.

**The gap test.** A pair only matters if it can hold the *global* minimum for
some pose. Comparing each pair's distance against the minimum using each one's
own Lipschitz slack discards the fact that the two move together: near a shared
vertex their contact points are close, so their gradients -- the closest-point
unit vectors (hf n, hf rn) -- nearly coincide, and the gap between the two
distances barely moves across the set even though each distance moves a lot.
From

    d_ab(q) - d_min(q) = gap(centre) + integral of (G_ab - G_min) . dq

a pair is dropped when the centre's gap exceeds what the **difference** of the
gradients can accumulate over the set. Through a vertex crossing each pair's own
slack is several times the gap between them, so this is the test that bites.

## 4. What else had to change

- **The enclosure's basis.** The set is carried as a parallelotope around the
  centre pose's own simulated trajectory. Building its basis by projecting the
  previous columns left the rotation direction reachable only through the push
  direction, so a 0.005u wobble cost 0.03u of the first column: a 1.6x inflation
  every substep from pure bookkeeping. The basis is now built from the contact
  itself -- the tangential slide, the spin-led tangent, the push -- which are
  mutually orthogonal in the foot-displacement metric.
- **The overshoot.** See section 7: the first answer here was wrong and has been
  replaced by a proved one.
- **The push magnitude, from below as well as above.** A pose already inside D
  must be pushed until it is not, so when the whole set is under D the magnitude
  has a floor. Without it every substep handed the set 0.06u of free slack along
  the push direction.
- **Branching on contact regime.** When the contact crosses a chord vertex two
  chords are live and their exact normals differ by the polyline's turn, about
  7.5 degrees. Hulling them into one cone before the push gives the push that
  much slack, which widens the set, which admits more chords. No pose has both
  normals, so the regimes are carried separately and unioned afterwards.
- **A real bug.** `segClosest3` solves for the second segment's parameter from
  the first, so passing a point as the *second* argument pair silently returns
  the other chord's start instead of its closest point. The stale-neighbour test
  was reading the wrong vector, which is why it kept failing on the very cases
  it was written for.

## 5. Where it gets to

On `ndpxhts24`, arm (0,-1), a +-0.005u / +-0.02-degree box, 138 substeps of
1/3 degree each (the search swings a degree at a time and the engine splits each
degree into three, so 1/3 degree is the real substep, not the 0.4 degree the
first checker used):

| | first checker | this one |
| --- | --- | --- |
| set size while in contact | grows ~1.3x per substep | flat, 0.014u to 0.042u over 47 substeps |
| contact normal cone | 7.8 deg, with a floor | 0.03-0.06 deg |
| stops at | 11.6 deg, set already ~1.8u wide | 11.3 deg at this box size |

That last row is the one that changed most on re-measurement, and not in the
direction section 6 first claimed. Reach against the starting box:

| starting box | reaches | stopped by |
| --- | --- | --- |
| +-0.005u / +-0.02 deg | 11.33 deg | the first chord-vertex crossing |
| +-0.003u / +-0.012 deg | 23.00 deg | the second crossing |
| +-0.002u / +-0.008 deg | 24.33 deg | the second crossing |
| +-0.001u / +-0.004 deg | 24.33 deg | the second crossing |
| +-0.0005u / +-0.002 deg | 24.67 deg | the second crossing |

The centre pose is thrown at 28 degrees. So a box of +-0.002u survives the first
crossing outright -- the set bumps from 0.019u to 0.024u across it and settles
back to 0.018u -- and gets to within 3.7 degrees of the throw before the second
crossing does the same thing it used to do at the first. Shrinking below
+-0.001u buys almost nothing, because the second crossing is not a box-size
problem either.

Soundness was checked the whole way: 200 simulated poses at each of five box
sizes, every per-substep enclosure and every bound asserted against the engine's
own contact law, **zero violations**. The `--validate` check itself had a bug
worth naming, since it is the thing that is supposed to catch bugs: it compared
each pose against the row's *printed* box, which is rounded to 1e-3 for display.
At a +-0.005u box that is invisible; at +-0.001u the rounding is the same size as
the box, and it reported 3 to 36 phantom containment failures. It now checks the
unrounded enclosure and reports the overshoot in units.

So the mechanism is fixed and the two lemmas hold, but the sweep coverage is
about what it was, because a different obstacle now binds. The centre pose is
thrown at 28 degrees of the 46-degree sweep, and the checker reaches 12.

## 6. What stops it now

The contact point walks down the attacker's leg at about 0.06u per substep. When
it approaches a chord vertex, the neighbouring chord's minimum converges on the
live one (2.9041, 2.8963, 2.8886, 2.8804 against a steady 2.8801 over four
substeps) and for a few substeps the two are genuinely within the set's own
width of each other. Both regimes are then live, their pushes differ by about
Lambda times 10.5 degrees, or 0.01u, and the union widens by that much per
substep. That alone would be survivable; what is not is that a wider set raises
the localisation radius, which puts more chord ends in play, which widens the
vertex cones, which widens the set. From 0.027u it runs 0.033, 0.046, 0.090,
0.122, 0.226, 0.401 and then refuses.

`nn/throw-crossings.js` traces the closest pair over a sweep. On this throw the
contact is in touch for 24.00 degrees, from 4.00 to 27.67, and walks 5.030u down
the attacker's leg and 2.751u down the victim's, so 0.0708u per substep against a
chord of 3.021u. There are **two** crossings and **one park** before the throw:

- the attacker transits its phi = 22.5 vertex at substep 32 (10.67 degrees),
- the attacker transits its phi = 15.0 vertex at substep 73 (24.33), and in that
  same substep the victim's contact arrives 0.005u from its own phi = 30 vertex,
- the victim is **parked** exactly on that vertex from substep 74 to 98, leaving
  it at 99: twenty-five substeps, eleven to the throw at 84 and fourteen past it.

The third of those was called a crossing at 25.00 in the first version of this
note, and that was wrong in kind, not just in the number. A closest point on a
polyline sits still on a vertex whenever neither adjacent chord has an interior
perpendicular foot, and while it does, the chord index it is reported under flips
between the two chords sharing the vertex. That index flip is what the tracer was
reading. Measured directly, the victim's contact arc angle is 30.000000 degrees
exactly for every substep from 74 to 98 -- twenty-five substeps of dwell, not a
transit. The tracer now classifies by arc position rather than
index and reports parks separately.

That distinction matters because a park should be the *easy* regime. While it
holds, the victim's contact point is a known material point of the victim -- the
vertex at arc angle 30 on leg 0 -- so its position and lever arm are exact
functions of the pose with no interval at all, and the attacker's side is the
perpendicular foot from a known point onto a fixed chord. That is strictly fewer
unknowns than ordinary interior contact. If the checker treats a vertex as a
transient special case carrying a cone, it is paying for uncertainty that is not
there. (Credit to the sibling thread working the second brief, which found the park,
made this argument, and caught that the crossing and the park arrival fall in the
same substep rather than two apart.)

The +-0.005u run refuses 1.3 degrees **past** the first crossing,
and the set starts growing at 9.33, which is 1.3 degrees **before** it. So the
box straddles the vertex for about eight substeps either side while the centre
pose is still safely inside one chord. A branching scheme cannot simply split at
the crossing substep: it has to split when the neighbouring chord's minimum
first comes within the set's own width of the live one, and re-merge when it
leaves again.

Shrinking the starting box gets past the *first* crossing (the table in section
5), because a narrow enough set never has two chords live at once there. It does
not get past the second: at every box size from +-0.0005u to +-0.003u the run
ends within half a degree of 24.5. So subdivision buys one crossing and then
stops buying. The crossing has to be handled, not dodged.

And the second spot is not one event, it is two on opposite legs in the *same
substep*. At 73 the attacker's contact steps across its phi = 15 vertex (arc
angle 15.60 -> 14.47, chord 2 to chord 1) and the victim's contact arrives 0.005u
from its own phi = 30 vertex, parking on it from 74. Nothing about it is gradual:
across that one substep the lever arm rn goes -2.1033 -> +0.5342 and the contact
normal's azimuth goes -95.32 -> -108.34 degrees. Compare the first crossing,
where one leg has an event and the other's nearest vertex is 1.4u away. That is
the candidate explanation for why a small box walks through the first and not the
second.

Two natural explanations for that contrast are both wrong, which is worth
recording because it narrows what is left.

**Not the size of the discontinuity.** The closest-point normal's azimuth jumps
by about the same amount at both: -72.61 to -83.57 degrees at substep 32, and
-95.32 to -108.34 at 73. Eleven degrees against thirteen. Whatever separates the
passable crossing from the blocking one, it is not how much normal the enclosure
has to span. (Measured by the sibling thread, confirmed here.)

**Not the width of the set arriving.** The obvious story is that 40 substeps of
slow growth leave the set too wide by the time it reaches the second event. The
set does arrive wider, and it does shrink with the starting box, but the reach
does not follow:

| starting box | pad at k12 | at k31 (first crossing) | at k71 (before the second) | stops at |
| --- | --- | --- | --- | --- |
| +-0.005u | 0.045 | 0.093 | - | 34 |
| +-0.003u | 0.028 | 0.027 | - | 69 |
| +-0.002u | 0.019 | 0.019 | 0.042 | 73 |
| +-0.001u | 0.009 | 0.010 | 0.025 | 73 |
| +-0.0005u | 0.004 | 0.006 | 0.018 | 74 |

At +-0.0005u the set enters the second event at 0.018u, which is *narrower* than
the 0.019u that walks straight through the first event at +-0.002u, and it still
fails. Shrinking the box fourfold from there buys one substep. So the second
event is not the first event with a fatter set.

What is left is the thing that is actually different about it: two legs have a
vertex event in the same substep, where at 32 one leg moves and the other's
nearest vertex is 1.4u away. Whether that needs its own treatment, or is just two
independent branchings that happen to coincide, is the open question.

The rn sign change was worth ruling out separately as a cause, since the
enclosure basis is built from the tangential slide, the spin-led tangent and the
push, and the spin-led direction is the one that would degenerate at rn = 0. It
is not a cause, for two independent reasons. First, rn never gets near zero: it
jumps across from -2.10 to +0.53 in one substep and is never evaluated in
between. Second, the basis would be fine even if it did. It uses
kappa = hf rn / (G . a) = rn / (1 + rn^2/I), whose denominator never vanishes, so
kappa goes smoothly to zero with rn, and at rn = 0 the three columns are the
horizontal tangent, the horizontal normal and pure rotation -- a perfectly
orthogonal triple. Measured through the crossing the basis Gram cosines are 0, 0
and -0.04 at a condition number of 1.008, the best of the whole sweep. The width
there is geometry, not bookkeeping.

The honest next step is to carry the regimes as genuinely separate sets rather
than unioning them into one parallelotope at the end of each substep, so that a
crossing costs one 0.01u step and nothing compounds. That is a real change to
the checker's state, not another bound, and it is the last thing between this
and a throw proof over a box.


## 7. The overshoot bound was wrong

The bound above -- the push moves the touched point by exactly the gap along the
normal, so all that is left over a substep is the difference between the finite
rotation and its linearisation,

    eta = R(1 - cos eps) + R(eps - sin eps),

about 8e-6u -- is **not sound**, and an outside review is what prompted checking
it. Measured against the engine over this sweep it is exceeded, by about 10%, on
75 of the 138 substeps, starting at substep 32, which is exactly the first
chord-vertex crossing: true overshoot 8.838e-6u against a bound of 8.025e-6u.

The error is the object being bounded. That argument follows one material point
through the rotation. What has to be bounded is the *shortest distance* between
the two polylines after the push, which is re-minimised over every chord pair,
so it can settle on a different point than the one the push moved. At a vertex
crossing it does.

The replacement is a projection argument. In mass coordinates -- so that the
push direction is the gradient of the gap -- the one-contact update is a Newton
step on the gap,

    Phi(z) = z - G(z) a / |a|^2,     a = grad G,

whose linear term cancels exactly, so Taylor's theorem with the remainder gives

    |G(Phi(z))|  <=  M p^2 / (2 m^2),

with p the penetration entering the substep, m a lower bound on
|a| = hf sqrt(1 + rn^2/I), and M a bound on the gap's Hessian over the set. For
one chord pair, with alpha = R/sqrt(I), p0 = sqrt(1 + alpha^2), cbar the worst
|cos(crossing angle)| and sigma = sqrt(1 - cbar^2),

    b0  = p0/sigma + d/(sqrt(I) sigma^2)
    k_n = 1/(sqrt(I) sigma)                    both contact points interior
    k_n = p0/d + 1/(sqrt(I) sigma)             if an endpoint may clamp
    M   = sqrt( k_n^2 + [alpha k_n + alpha/sqrt(I) + b0/sqrt(I)]^2 )

which is about 0.226/u interior and 1.06/u with clamping, and a residual near
1.1e-3u rather than 8e-6u. Two orders of magnitude looser, and actually proved.
It is `hessBound` in `nn/throw-cert.js`.

It costs about two substeps of reach at every box size (12.00 -> 11.33 at
+-0.005u, 24.67 -> 24.33 at +-0.001u), which is a cheap price for a bound that
holds.

One unstated assumption came out of the same audit and is now checked. The shell
argument needs the Gauss-Seidel solver to have stopped because no pair was under
D, not because it ran out of its ten passes: at the cap the post-push distance is
not bounded below by D at all. Measured, the solver uses at most two passes over
this sweep and never exhausts them, but the checker now refuses rather than
assuming it.

### What the review got wrong

Two other claims in it do not land.

Its counterexample -- two interior chord contacts tied at 2.8707, where a 1e-7
translation switches the selected pair and jumps the 3D unit normal by 0.119, or
6.833 degrees -- reproduces against our engine to every digit it gave, including
the 0.002465181u hub difference. But it is an instance of the obstacle already in
section 6: the two attacker chords involved are adjacent, sharing the phi = 22.5
degree vertex, which is the first crossing. And the checker is sound on it: at
every box size from +-1e-7 to +-0.02 it keeps *both* tied branches and reports a
10.575-degree cone, which covers the 6.833-degree jump. The specific failure it
warns of -- intersecting a cone about the centre's winning branch with a vertex
fan, and wrongly dropping the second branch -- is not what the code does.

Its "lemmas A and B are false globally" is true and not a refutation, because
neither is claimed globally: both are stated per chord-rectangle, above and in
the code, and its own results table grants them for one nonparallel segment pair
including endpoint clamping. It also says it was never given `throw-cert.js`, so
none of it is an audit of the checker that exists.
