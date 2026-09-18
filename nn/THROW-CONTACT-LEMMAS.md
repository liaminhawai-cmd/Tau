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

**Update, later the same day: it closes.** Sections 1 to 7 below are the state
before that, and they still describe the lemmas the certificate rests on. Section
8 is what finally made it a proof. At a victim box of +-0.0002u in position and
+-0.002 rad in rotation, every pose is thrown off the board by 28.33 degrees of
sweep, with the exposed foot's radius bounded below by 67.193u against a 67.167u
rim. Two thousand sampled poses, zero containment violations.

One number in that sentence invites a double take, so it is worth disarming here.
The box minimum at substep 85 is 67.1930u, and the CENTRE's radius at substep 84
is 67.1934u. They are not the same quantity and the agreement is a coincidence:
the centre advances 0.0923u a substep, and the enclosure's foot-radius slack at
substep 85 is 0.0927u. Substep 84 does not certify -- its bound is 67.158, nine
thousandths under the rim -- which is why the certificate needs 85 while the
centre leaves at 84.

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


## 8. The proof closes

Section 6 named the obstacle: through a chord-vertex park the enclosure grew by a
constant factor a substep. That diagnosis was right and the factor is measurable.
Starting the checker from a box of zero width, so that everything it carries is
its own slack and nothing is the box's, the geometric pad goes:

| substep | 65..72 | 73 | 74 | 75 | 76 | 77 | 78 | 79 | 80 | 81 | 82 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pad (u) | 0.009..0.012 | 0.019 | 0.032 | 0.033 | 0.038 | 0.045 | 0.052 | 0.061 | 0.073 | 0.110 | refused |

Flat for the whole interior stretch, a step at the crossing, and then a clean
geometric climb of about 1.4x a substep for as long as the contact is parked. The
centre is thrown at substep 84.

### The park's push direction is a function of the pose, not an interval

Each substep adds the WIDTH of the push-direction cone to the enclosure, and that
width is proportional to the enclosure's own size, so the enclosure multiplies.
The way out is not a tighter interval but a different object. While the contact
dwells on a vertex the push direction is an exactly differentiable function of
the pose: the dwelling vertex is a material point of the victim, and the
attacker's chord is fixed for the substep, so with `Q = Id - a a^T` the whole
contact is `w = Q(p(q) - A0)` and everything follows by the chain rule.

`parkJacobian()` returns `B = da/dq` at the centre and an enclosure of `B` over
the box. The linear part then goes into the enclosure's BASIS, Lohner-style:
where the update used to be

    u_next = u + M^-1 [ Lambda da - v_c ],    da an interval,

it becomes, with `N = Id + Lambda_c B` and `M' = N M`,

    u_next = u + M'^-1 [ Lambda_c dB dq + lambda da - v_c ],

and only the mean-value remainder widens the box. The growth factor falls from
about 1.4 to 1.11 a substep and the first five parked substeps go nearly flat.
Reach: substep 82 to 88.

Two details are load-bearing and neither is optional.

**The Jacobian's spread must be an interval evaluation.** The first draft sampled
the box's eight corners. That samples a nonlinear function; it does not bound it,
and a remainder built on it is not proved. `build()` is now evaluated in interval
arithmetic throughout, with the lever taken from the ROTATION interval rather
than by differencing the vertex box against the hub box, which would invent
translation uncertainty that is not there.

**Lambda has to stay on its own axis.** `a_c` is the basis's third column, so the
push magnitude's variation used to be exactly the third coefficient and cost
nothing. Sending `lambda a_c` through the new basis's inverse smears it over all
three, and that one detail made the linearised step WORSE than the interval step
it replaces: substep 76 against 82. Since `a_c = m3` and `N m3 = m3 + Lambda_c B m3`,

    lambda a_c = lambda N m3 - lambda Lambda_c B m3,

so lambda lands on the third axis of the new basis again and only the
second-order `lambda Lambda_c B m3` is left in the remainder.

Because each state now carries its own basis, two states can no longer be hulled
in coefficient space: the same `u` means different poses in different frames.
`mergeStates` re-expresses one onto the other's frame first, and that transform's
own widening is what the merge cost sees, so states whose frames have diverged
stay apart on their own account.

### Stop at a certified throw

The claim being proved is that every pose leaves the board, and the board's test
is the exposed foot's radius against the rim. The moment the worst state's lower
bound on that radius clears the rim, every pose in the enclosure is off and the
rest of the sweep proves nothing further. The checker had been asked to survive
fifty more substeps of a park it had already outlived the purpose of. This was
the outside review's fifth recommendation and it is plainly right.

### A bug that had been hiding the result

The foot index was being passed as `0.85`. It indexes an array, so
`feetOf(pose)[0.85]` is `undefined`, the comparison against the rim was against
`NaN`, and the check silently never ran. Every `--validate` run for a day printed
`final foot radius min Infinity` in plain view. The foot that leaves the board on
this seed is foot 1. A check that reports no failures because it never executed
looks exactly like a check that passes.

### Where it stops now

Certified at +-0.0002u / +-0.002 rad. One size up, +-0.0003u / +-0.003 rad, the
enclosure runs the whole park at 1.11x and dies at substep 85 -- the throw
substep itself -- with the foot-radius bound at 67.109u against the 67.167u rim,
0.058u short, one substep before it would have cleared.

The remaining width is not where the diagnosis above would suggest. Of the three
terms in the remainder, measured at substeps 80 to 84:

| term | width (u) |
|---|---|
| `lambda . da` | 5.2e-3 |
| `lambda Lambda_c B m3` | 2.6e-3 |
| `Lambda_c dB . dq` | 1.8e-4 |

The Jacobian's own spread, the thing the linearisation introduced, is the
smallest of the three by a factor of 29. What dominates is `lambda . da`, the
product of the push magnitude's range with the direction cone. It cannot be
linearised the same way: `da` hulls the direction over the whole substep, from
before the push to after it, while `B` is the pose derivative at one instant, so
`B . dq` does not enclose it. Tightening it needs either a bound on `B` over the
swept pre-and-post domain or a correlated treatment of `lambda` and `da`, which
are not independent -- both are determined by the same pose.

Two further things were fixed on the way and neither moved a reach, so neither is
the obstacle: the pre-push grouping was merging a parked regime with a
neighbouring interior one whenever their bearings fell within its 1.5 degree
window, which dropped the vertex identity and with it the Jacobian; and the
vertex regime's blanket cone bound, chosen whenever it beats the exact one, was
not carrying the vertex index, so every box large enough for the blanket to win
lost the Jacobian too.


## 9. A second arm, and a guard that was firing on noise

This seed has two throw arms. The second, attacker 1 about foot 2 in direction
-1, has a 110.3 degree limit and throws at substep 112 of 331. It also certifies,
at the same +-0.0002u / +-0.002 rad box: foot 1's radius at least 67.205u against
the rim, 500 poses, zero violations.

It did not certify at any box size until a guard was corrected, and the guard is
worth recording because its failure mode was invisible. The shell argument needs
the push solver to have stopped because nothing was under the contact distance,
not because it ran out of passes, so the checker refuses a substep where the
solver used all ten. On this arm it caps on 43 of its 331 substeps -- and it has
converged by pass two. The push magnitudes run

    9.99e-2,  2.04e-6,  1.28e-15,  1.28e-15,  ...

to the cap. It is grinding at the floating-point noise floor because its
termination test never fires there, not because a contact is unresolved. The
residual overlap at every one of those substeps is zero.

Judge the last push instead of the pass count. With `lambda = s/(1 + rn^2/I)` and
`s` the penetration along the normal, a final push of `lambda` leaves at most
`lambda (1 + R^2/I)` of penetration behind it, which at this noise floor is four
orders of magnitude inside the slack the shell's lower edge already carries. A
solver that caps with a substantial last push is still refused.

The lesson is the same one as the foot index in section 8. Both failures reported
something true -- the solver did use every pass, the foot radius was not below
the bound -- while the thing they were supposed to be testing never happened.

### The two arms stop for different reasons

Arm (0,-1) is limited by enclosure width through the chord-vertex park, as
section 8 describes. Arm (2,-1) is not: at +-0.001u it reaches substep 113 of
331, one past its own throw, and its own blow-up starts at substep 109 where the
cone goes from 0.20 to 5.32 degrees. So the method has more than one ceiling, and
the park is not the universal obstacle it looked like from one arm.


## 10. How far this is from replacing the sampled certificate

The point of an interval throw certificate is to replace the sampling argument in
`forced-win.js`: a grid of poses, each sample's throw margin required to clear
the cell diagonal times a Lipschitz allowance measured from the grid's own finite
differences, times a safety factor. That argument is falsifiable and well made,
but it is measurement, not proof, which is the whole reason this file exists.

`certifyThrowBox` works on a victim box of half-width 0.5u with a grid step of
0.25u, so one cell has a half-diagonal of about 0.217u and a per-axis half-width
of about 0.125u.

The interval certificate closes at a per-axis half-width of 0.0002u. That is
about **600 times too small per axis**. Covering one cell by subdivision would
take on the order of 10^8 sub-certificates. Subdivision does not bridge this.

It is worth being precise about why term-tightening will not either. With the
push's linear part in the basis the feedback is now quadratic -- the enclosure
grows like `pad + c pad^2` a substep rather than by a constant factor -- so there
is a threshold, and the threshold is what 0.0002u is. Raising it 600-fold means
cutting `c` 600-fold. The measurements in section 8 say `c` is dominated by
`lambda . da`, the push magnitude's range times the direction cone, and the best
that a careful re-derivation of that term looks likely to buy is a factor of a
few. The gap is three orders of magnitude wider than that.

So the honest position: the method is proved end to end and it certifies two
throws, but it does not currently scale to the cells the dead-region work needs,
and the shortfall is not a tuning problem.

What might actually close it is not a tighter step. It is not taking 25 steps.
Every substep of the park is a chance for the enclosure to grow, and the park is
where all the growth is. An argument that handles the park as a whole -- some
monotone quantity over the dwell, so that the exposed foot's radius can be shown
to increase for every pose in a large box without carrying an enclosure through
each substep -- would not pay the per-substep cost at all. That is a different
piece of work from anything in this file, and it is where the next effort should
go if the goal is to retire the Lipschitz sampling rather than to have proved
that it can be done at all.


## 11. The monotone quantity is there

Section 10 said the route that could close the gap is not to take twenty-five
steps through the park. `nn/throw-audit/park-monotone.js` measures whether that
route has anything to aim at, on the engine, over boxes far wider than the
certificate manages.

It does. Three cases, two arms:

| | arm (0,-1), +-0.1u | arm (0,-1), +-0.25u | arm (2,-1), +-0.1u |
|---|---|---|---|
| radius monotone in the substep | every pose | every pose | every pose |
| min radial gain, contact substeps | 0.0030u | 0.0040u | 0.0035u |
| gain through the park | 0.05..0.09u | 0.05..0.09u | ~0.08u |
| spread, first contact to throw | x1.038 | x1.043 | x1.045 |
| contact regimes across the box | 1 | 1 | 1 |
| thrown | 200/200 by 85 | 200/200 by 86 | 120/120 by 113 |

The radius never falls, for any sampled pose, at any box size tried. +-0.25u is
1250 times wider per axis than the certificate closes at.

**Why this is the right target.** The barrier theorem in `throw-theorem.md` needs
a lower bound on the radial gain and an INVARIANT box -- one that maps into
itself -- rather than an enclosure that says where inside the box each pose goes.
That difference is the whole thing. Propagation is what creates the feedback loop
that section 8 measured and section 10 showed is a threshold; invariance has no
loop, so there is nothing to fall off. The hypotheses are weaker and the boxes
they hold on are three orders of magnitude bigger.

The theorem's earlier verdict was that uniform bounds give only 0.44u and
per-slab bounds are needed. Per-slab is exactly what the table shows is
available: through the park the gain is stable at 0.05 to 0.09u, and the 0.003u
minimum sits at an early grazing contact where the normal is far off radial, not
in the park at all.

**What this does not say.** Two hundred sampled poses establish that the
hypotheses are true, not that they are provable. Proving the gain bound is an
interval computation per substep with no accumulation, which is the easy half.
Proving invariance is the open half, and the Jacobian from section 8 is the right
tool for it, since invariance is a statement about the deviation map being
non-expansive plus a remainder that fits inside the margin.

**A correction to the first reading of this measurement.** Taken to the end of
the sweep the spread appeared to contract. That included the substeps after the
throw and, on arm (2,-1), the 74 substeps before first contact where the victim
is not pushed at all and therefore cannot spread. Over the contact window it
expands, slightly. For the same reason a gain bound taken over every substep
reads as "not positive" while saying nothing: the barrier sums the substeps that
push, and that is where the bound has to hold.


## 12. Two things the barrier's bookkeeping has to get right

Both came out of cross-checking section 11's measurement against a second,
independently written probe. They agreed on the headline and disagreed on two
numbers, and both disagreements were about WHICH quantity was being measured
rather than about the engine.

### The gain the theorem sums is the minimum over poses, not over pushes

The barrier needs, at each substep, a lower bound on the radial gain valid for
EVERY pose in the box. Three different numbers are available at +-0.125u /
+-0.01 rad over 200 poses, and only one of them is that:

| quantity | value |
|---|---|
| min over poses, over the 123 substeps where the WHOLE box is in contact | 9.22e-4u at substep 16 |
| min over poses, over the park window 74-98 | 5.8e-2 to 6.1e-2u |
| smallest nonzero gain any SINGLE pose ever has | 4.2e-6u at substep 11 |

The first is what the sum uses. The second is the comfortable one and is true
only of the dwell. The third is never summed by anything, and reading it as "the
minimum gain" makes the hypothesis look about twenty times harder than it is.

**But 9.22e-4u is itself a boundary artefact, and quoting it was wrong.** It is
the gain at substep 16, the first substep of the window, and nowhere else. Taking
the minimum over poses from the throw back to a slab starting at substep s:

| s | 16 | 17 | 18 | 20 | 22 | 25 | 30 |
|---|---|---|---|---|---|---|---|
| min gain (u) | 9.2e-4 | 9.0e-3 | 9.3e-3 | 9.9e-3 | 1.1e-2 | 1.2e-2 | 1.3e-2 |

One substep of patience is worth a factor of ten, and the profile is smooth
everywhere after it. The same profile comes out of 200 and 600 sampled poses to
two significant figures, so this is a property of the geometry and not of the
sample. The useful statement for a proof is therefore not a single number: the
first slab should not begin at the first substep where the whole box is in
contact, because that substep is grazing and contributes almost nothing. Begin it
one later and carry about 9e-3u a substep, rising to 5.8e-2u through the dwell.

### The partial-contact substeps

Of the 131 substeps where anything is in contact, 8 have only SOME poses in
contact. At those the minimum over poses is exactly zero, because a pose that is
not pushed does not move at all, so the barrier cannot count them.

This is a proof obligation that H1 to H4 in `throw-theorem.md` do not state. A
barrier certificate has to establish "every pose in the box is in contact at
substep k" before it may count substep k's gain, and give the partial substeps
zero. That is an interval test over the box, and it is separate from the gain
bound and from invariance.

What makes that test tractable is that contact does not come and go: on arm
(0,-1), at every box size tried, no pose's contact lapses once it has begun, so
contact is a single interval per pose and the test only has to find where the
last pose joins. The unqualified version of that -- contact never lapses -- is
false, and arm (2,-1) refutes it: there every one of 200 poses loses contact,
first at about substep 210. But all of those lapses happen after that pose has
already been thrown, at substep 113 or earlier. So the statement a certificate
can lean on is the scoped one, contact does not lapse BEFORE the throw, which is
all the barrier sums over anyway.

### And a genuine pair of readings, both right

The POSE box expands by about 1.04x from first contact to the throw. The spread
of the exposed foot's RADIUS across the box -- the quantity the theorem actually
sums -- contracts hard over the same window: 0.5596 to 0.2375u at +-0.125u,
0.9131 to 0.3160u at +-0.25u, 1.6199 to 0.4799u at +-0.5u, so by a factor of
0.42, 0.35 and 0.30, strengthening as the box grows. Neither reading is the other
one's correction. Quoted together they are a better argument for invariance than
either alone: the poses barely spread and their outcomes converge.

## 13. H3 computed rather than sampled, and what it says the set's shape is

Section 11 measured the barrier's two hypotheses on 200 sampled poses and found
both true. Sampling says they hold, not that they are provable. Of the two, H3
-- a lower bound on the exposed foot's radial gain per substep valid for EVERY
pose in the set -- is the half that needs no accumulation, so it can be computed
now, before anyone has proved H4. `nn/throw-audit/gain-bound.js` computes it.

The bound per substep. `analyse` over the tube box gives the contact pair, the
normal cone, `hf` and the lever `rn` as intervals, and the engine's push is
`lambda = sep / (1 + rn^2/I)` with `sep = (D - dist)/max(hf, hfFloor)`, capped.
With `F` the exposed foot and `Fhat` its radial unit vector at the START of the
substep, `|v| >= u.v` for any unit `u` gives

    r_after >= Fhat . F_after
             = r + lambda [ n.Fhat + (rn/I) R (-sin th, cos th).Fhat ] - R dth^2/2

exactly, the last term being the foot's own rotation remainder. Every quantity in
the bracket is an interval over the box, so its minimum is a bound over every
pose in it. Bounding `dth` through the push model costs a factor of `iters^2` and
at the early grazing substeps that penalty alone exceeds the gain; the tube gives
it for nothing instead, since the pose's rotation change differs from the
centre's, which is known exactly, by at most the tube's own width.

### The first run certifies nothing, and the reason is the result

At a tube of +-0.1u not one substep passes, because whole-box contact needs the
box's whole distance range under `D` and the blanket pad of that box is 0.2414u
against a penetration of a few hundredths. But section 11 measured the opposite
on the same box: 123 of 131 substeps have every pose in contact. Both are right,
and together they say the reachable set is not a box around the centre.
`nn/throw-audit/slab-shape.js` measures the shape directly:

| | value |
|---|---|
| poses' spread across the plane, +-0.1u box | 0.13u |
| their distance range to the attacker's leg, mean over the 74 contact substeps | **0.0033u** |
| the same range in the park, substeps 40 to 70 | 0.00093u |
| the blanket pad a +-0.1u box carries | 0.2414u |
| so the pad overstates the distance uncertainty by | 74x on average, 260x in the park |

The dynamics PIN every pose onto the contact shell. The set is a thin sheet: as
wide as the box across the push, as thin as the shell along it. An axis-aligned
box is the wrong shape, and the factor above is what it costs.

### What H3 certifies once the shape is right

Unconditionally, with the box's own pad as the distance uncertainty and no
assumption about shape, at a tube of +-0.01u: 86 substeps bounded, and the
certified gain sums to **2.113u** against the 3.168u needed to lift the box's
minimum starting radius over the rim. Two thirds of the way, and the whole
shortfall is the pad.

With the slab hypothesis -- the distance range taken as 0.005u, which is 1.5x
the measured 0.0033u, every other bound still over the full tube -- from a
starting box of +-0.0125u into a tube of +-0.025u:

    certified sum 3.5144u  against  3.2026u needed;  clears the rim at substep 92

and the 200 sampled poses stay inside that tube (worst deviation 0.0170u at
substep 84). The first refusal from `analyse` is at substep 99, seven substeps
after the bound has already closed.

That box is **62x wider per axis** than the enclosure certificate of section 8,
and within 5x of the 0.125u cell that `certifyThrowBox` works on. The route is
not blocked by the throw's own margins. It dies at +-0.05u (2.65u of 3.26u) and
at +-0.1u (0.29u of 3.37u), where the normal cone opens far enough to cost more
than the extra width buys.

### What this makes the open question

Not "can the barrier hypotheses be proved over a box of order 0.1u". The set is
not a box. The two things a certificate now owes are a proof that a SLAB -- thin
along the contact normal, wide across it -- maps into itself, and a rigorous
bound on its thickness that is not the blanket pad. The thinness is not an
assumption about the poses; it is what the contact shell does to them, and
section 9's shell argument already pins the distance from both sides. H3 is
otherwise done.

## 14. Why the slab stays thin, and by how much

Section 13 leaves a certificate owing two things: invariance of a slab, and a
bound on its thickness that is not the blanket pad. The second one has an answer,
and it does not need an enclosure. `nn/throw-audit/thickness.js` checks it.

Write `g_k(q)` for the distance from the attacker's leg at substep `k` to the
victim's. After substep `k-1`'s push the solver leaves EVERY pose on the shell,
`g_{k-1} = D` to its own tolerance, so the set's thickness in `g` is reset to the
shell's width every substep. **It does not accumulate.** That is the structural
reason there is no threshold on this side, and it is the same fact section 9's
shell argument already establishes, used for a different purpose. The attacker
then turns by one substep and the distance falls by that substep's advance:

    pen_k(q) = D - g_k(q) = LIM_SUB * [ z x (p_A - P) ] . n  + (within-substep variation)

with `p_A` the attacker's contact point, `P` its pivot foot and `n` the unit
contact normal. Everything on the right is contact geometry, so the SPREAD of the
penetration across the set is one substep's worth of a quantity that varies only
as much as the contact point does. A 0.13u-wide set presents a 1e-3u-thin
profile because 0.00582 rad multiplies a moment arm differing by a tenth of a
unit between its poses.

**The rate is not constant within the substep**, and taking it only at the
substep's end understates the spread by up to 1.7x at a vertex crossing -- the
same trap the outside review named for the stopping program, two events of one
foot inside one substep. Hulling the rate over the substep's own sweep is what
the integral sees, and with that the prediction bounds the measurement at every
substep of every box tried:

| box | substeps checked | worst measured/predicted | thickest, after the entry substep |
|---|---|---|---|
| +-0.0125u | 72 | 0.984 | 5.982e-3u at substep 74 |
| +-0.025u | 72 | 0.995 | 6.128e-3u at substep 74 |
| +-0.05u | 72 | 0.995 | 6.346e-3u at substep 74 |
| +-0.1u | 71 | 0.996 | 7.139e-3u at substep 75 |

Two things to read off. The thickness is **almost independent of the box**,
because its peak is the vertex crossing at substep 74, not the box's width; away
from the crossing it is about 1e-3u. And the entry substep is again the odd one
out -- there the poses are not all on the shell yet, so its residual is the box's
own width rather than the solver's tolerance, which is section 12's grazing
substep arriving for the third time and for the same reason.

**Put the derived thickness back into H3 and it still closes.** With 6.13e-3u --
the worst the argument predicts anywhere after the entry substep, not the
measured 0.0033u -- from a starting box of +-0.0125u into a tube of +-0.025u, the
certified gain sums to 3.4195u against 3.2026u needed. It survives 8e-3u as well
(3.2625u). So the thickness is not what limits the box: at +-0.1u the predicted
thickness is still only 7.1e-3u, and what fails there is the normal cone opening,
which is a different obligation.

What is left of the barrier route is therefore one hypothesis and one piece of
bookkeeping: that the tube is invariant in the two TANGENTIAL directions, and an
interval version of the moment arm's range over the box, for which Lemma 1's
contact-point localisation is the tool.
