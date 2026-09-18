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
- **The overshoot.** The push moves the touched point by exactly the gap along
  the normal, so to first order the pair ends at exactly D; what is left is the
  difference between the finite rotation and its linearisation, R(1 - cos eps) +
  R(eps - sin eps) with eps the substep's total turn. That is about 1e-5u, and
  the engine agrees: post-push pair distances measured over 200 poses all lie in
  [2.88000, 2.88001]. The blanket 0.005u bound the first checker used was the
  floor on how thin the set could ever be; the pin is now 70x tighter.
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
| set size while in contact | grows ~1.3x per substep | flat at 0.021-0.027u from 4.7 to 9.0 degrees |
| contact normal cone | 7.8 deg, with a floor | 0.03-0.06 deg |
| stops at | 11.6 deg, set already ~1.8u wide | 12.0 deg, set 0.25u |

Soundness was checked the whole way: 200 simulated poses across two box sizes,
every per-substep enclosure and every bound asserted against the engine's own
contact law, **zero violations**.

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

`nn/throw-crossings.js` traces the closest pair's chord indices over a sweep and
says how many crossings there are. On this throw the contact is in touch for
24.00 degrees, from 4.00 to 27.67, and walks 5.030u down the attacker's leg and
2.751u down the victim's, so 0.0708u per substep against a chord of 3.021u.
There are exactly **three** crossings before the throw: the attacker's leg at
phi = 22.5 degrees, crossed at 10.67 degrees of sweep; the attacker's at
phi = 15.0, at 24.33; and the victim's at phi = 30.0, at 25.00.

The checker refuses at 12.00, which is 1.3 degrees **past** the first crossing,
and the set starts growing at 9.33, which is 1.3 degrees **before** it. So the
box straddles the vertex for about eight substeps either side while the centre
pose is still safely inside one chord. A branching scheme cannot simply split at
the crossing substep: it has to split when the neighbouring chord's minimum
first comes within the set's own width of the live one, and re-merge when it
leaves again.

Shrinking the starting box does not avoid this -- at +-0.001u it simply crosses
the vertex a few substeps later -- so subdividing the box is not the answer
either. The crossing has to be handled, not dodged.

The honest next step is to carry the regimes as genuinely separate sets rather
than unioning them into one parallelotope at the end of each substep, so that a
crossing costs one 0.01u step and nothing compounds. That is a real change to
the checker's state, not another bound, and it is the last thing between this
and a throw proof over a box.
