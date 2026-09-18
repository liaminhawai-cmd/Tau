# Brief 2: the last obstacle in the throw proof, and the oriented split at the jumping walls

> **Sent, answered, and superseded in part on the throw side (see `brief-3-the-vertex-dwell.md`).** Two statements in section 1 turned out to be wrong, and are left here as written rather than edited, since this is the text that was sent. First, "shrinking the starting box does not help" is false for the first crossing: at a +-0.002u box the checker passes it and reaches 24.33 degrees. Second, the third item in the vertex table is not a crossing at 25.00 degrees; the victim's contact point arrives at its phi = 30 vertex at 24.49 and dwells on it exactly for the rest of the sweep. Job 2, the oriented split, is unaffected.

This is a self-contained follow-up to the dead-region brief. You have no access to the code or the game; everything you need is in here (the first brief's definitions are repeated where they are needed, so this can be read alone). Units: board units `u` (1u = 2 mm); angles in degrees unless a formula says radians. Every number below was recomputed today from the engine's own code at the commit you pinned last time (e32f09d), not copied from earlier notes.

There are three jobs. **Job 1 is the one I want first**: it is the one thing left between us and a machine-checked proof that a throw works over a whole region of poses. Job 2 is the open question left from your first answer. Job 3 is optional.

A note on Job 1: an earlier draft of this brief asked you for three contraction lemmas. Between writing it and sending it, two of the three were proved and built here, and the third turned out to be nearly free, so Job 1 below asks instead about the single obstacle that now binds. Sections 1.4 and 1.6 say what was proved and what broke, in case the proofs are wrong.

---

## 0. What came back from the first brief, in three lines

Your geometry was right and every number that could be re-derived here was re-derived to the printed digit (24 arm limits, the 40 events on arm (0,-), E01 at 63.6927 against 68.7636 degrees, grad H = (-3.9884, +1.6929, +4.3300) deg per u, nearest point 1.1606u). Two things you said changed what we do: the E01 wall at ndpxhts24 is an event-order curve where **both** events stop the arm, so the limit is continuous across it and the box needs no split at all (enclose both events, take the minimum: the whole +-1u box became one cell, 476 poses dead, in 6.5 minutes against 28 minutes for 59% before); and the "no legal reply" points at l5807vazg were off the board at the start, not limit walls. Your three corrections to the throw note (the deficit is two-sided, the foot-gain error is 5e-4u not 1e-4u, "s = a" is first order) all stand and are folded in below. Your conjectured Lipschitz constant for the closest-point vector also pointed the right way, though the answer turned out to be sharper than Lipschitz: see 1.4.

---

## 1. Job 1: the last obstacle in the throw proof

Since your first answer this has moved a long way: the two geometric lemmas that were wanted are proved and built, the checker's normal bound improved by a factor of two hundred and its pose set stopped growing. It still does not reach the end of a throw, and what stops it now is one specific, well-localised thing. That is the question.

### 1.1 The objects in 3-D (this is what the first brief left out)

A piece is a tripod: hub at `(x, y)` at height `H = 23.095u` above the board, three feet on the board at

    foot_i = (x, y) + R (cos(rot + 120 i deg), sin(rot + 120 i deg)),   R = 23.095u,  i = 0, 1, 2.

Each leg is a quarter circle in the vertical plane through the hub and its foot: the point at arc angle `phi` (0 at the hub, 90 degrees at the foot) is

    L_i(phi) = ( x + R sin(phi) cos(psi_i),  y + R sin(phi) sin(psi_i),  H cos(phi) ),   psi_i = rot + 120 i deg.

Since H = R the leg is a true quarter circle of radius R. **The engine draws it as a 12-segment polyline**, vertices at `phi_k = 7.5 k` degrees, k = 0..12. A chord is `R . 7.5 deg = 3.023u` long, its direction is the arc tangent at its middle angle, the direction jumps by 7.5 degrees at every vertex, and the chord's sagitta against the true arc is 0.0494u. **Those vertices are the whole of Job 1.** The leg is a tube of radius `rho = 1.44u` about the polyline; two legs are in contact when their polylines' closest points are less than `D = 2.88u` apart in 3-D. The hub is a sphere of radius 2.736u; no hub contact occurs in anything below.

The unit tangent of leg i at arc angle phi is

    u_i(phi) = ( cos(phi) cos(psi_i),  cos(phi) sin(psi_i),  -sin(phi) ).

### 1.2 The push law, exactly as the code has it

The attacker is kinematic: it rotates rigidly about its pinned foot P by a substep of `1/3 degree`, in one direction. The victim is a free rigid body in the plane: hub c, orientation theta, mass 1, inertia `I = 0.7 R^2 = 373.37 u^2`.

After each substep the solver runs up to 10 passes. A pass visits each leg pair whose polylines are closer than D and, for each, takes the **single globally closest** segment pair, its 3-D closest points `p_A` (attacker) and `p` (victim), the 3-D unit vector `n3` from p_A to p, its horizontal part `n = (n3_x, n3_y) / hf` with `hf = |(n3_x, n3_y)|`, and the separation

    s = (D - dist) / max(hf, 0.35),   capped at 0.8u.

Then with `r = p_xy - c` and `rn = r x n` (the lever arm: the signed distance of the hub from the line of the push),

    lambda = s / (1 + rn^2 / I),     c <- c + lambda n,     theta <- theta + lambda rn / I.

A pass with no pair under D ends the solver. (A deep-crossing rule for dist < 0.3u exists and has never fired; the 0.8u cap and the 0.35 floor have never fired in 300 measured throws; no friction, no restitution.) Note the consequence of "globally closest": **which segment pair wins decides the push direction outright**, so where two pairs are nearly tied the applied push is genuinely discontinuous in the pose. That is not a modelling artefact to be smoothed; it is what the engine does.

### 1.3 The dynamics lemmas, proved earlier

- **Lemma 1.** One update moves the touched point p by `Delta p . n = s - eta` with `|eta| <= 0.005u`, two-sided (measured range over 5e5 updates: -0.0035 to +0.0035u).
- **Lemma 2.** `lambda` is in `[0.4118 s, s]`, and the spin is at most `0.02588 s` radians, i.e. 1.48 degrees per u of separation.
- **Lemma 3.** For a foot `F = c + R f` with outward unit `u = F/|F|`, the radial gain of one update is `lambda [ n . u + (rn / I) R (J f) . u ]` up to 5.1e-4u (J the quarter turn). The bracket is the **gain coefficient g**.
- **The theorem (barrier form).** Over a set B of victim poses and a sweep, if at every substep exactly one leg pair touches with interior closest points and hf >= 0.35 (H1), the attacker advances into it by `a >= a_min(k) > 0` (H2), `g >= g_min(k) > 0` with `rn^2 <= L^2` (H3), and B is invariant under the pushes (H4), then the victim is thrown once `sum_k a_min(k) g_min(k) / (1 + L^2/I)` reaches the exposed foot's distance to the rim (plus 0.005u per contact substep). Nothing in the proof runs the solver; the hypotheses are geometry over B.

### 1.4 The geometry lemmas, now proved (these were Job 1 of the draft you are not being sent)

The first checker bounded H1 to H3 by interval arithmetic over an axis-aligned box and was sound but useless: the box grew about 1.3x per substep. Measurement showed why. On the throw of 1.5, over a box of victim poses of +-0.005u and +-0.02 degrees, 150 simulated poses through all 138 substeps of the sweep:

| quantity | true spread over the box | the old bound |
|---|---|---|
| contact normal, azimuth | 0.014 deg | 7.8 deg |
| horizontal fraction hf | 0.0001 | 0.10 |
| lever arm rn | 0.005u | 2.3u |
| pose set, foot-displacement spread | 0.0239u at substep 1, 0.0246u at substep 38 | grew without limit |

The normal bound was loose by a factor of five hundred **and had a floor**: it came from a fan of neighbouring chord directions, and one chord subtends 7.5 degrees however small the box is. Two lemmas removed that.

**Lemma A (where the contact point can be).** For two chords parameterised by arclength, `F(s, t) = |A(s) - V_q(t)|^2` is a quadratic with the pose-independent Hessian

    grad^2 F = 2 [[1, -c], [-c, 1]],    c = cos(crossing angle),    mu = 2(1 - |c|),

so with `z_c` the constrained minimiser for the centre pose and `z*` that for any pose in the set, adding the two variational inequalities gives

    mu |z* - z_c|^2 <= -g . (z* - z_c),   hence   |z* - z_c| <= |g| / mu,

where `|g|` bounds the change in grad F over the set. This is **linear** in the set's size, where the obvious argument through function values gives only the square root (0.75u of leg rather than 0.05u at a set radius of 0.024u), and it holds for a minimiser on the rectangle's boundary as well as inside.

**Lemma B (the normal is then exact).** At an interior minimum the closest-point vector is perpendicular to both chords, so it is parallel to `u_A x u_V`, and on a polyline those are constant per chord. So once Lemma A confines the closest point to one chord pair, the contact normal is not merely bounded but exact up to the set's own rotation span: the cone went from 7.8 degrees to 0.03 to 0.06, against the measured truth of 0.014. Two bookkeeping rules make it usable: a **stale-neighbour test** (two chords meeting at a vertex both report a minimiser at that vertex; the one whose distance rises into its own chord is not a real local minimum of the pair and is dropped) and a **gap test** (a rival pair is dropped when the centre pose's gap exceeds what the *difference* of the two pairs' gradients can accumulate over the set; near a shared vertex the two contact points are close, so their gradients nearly coincide and the gap barely moves even though each distance moves a lot).

Your third lemma, the contraction along the normal, turned out to be nearly free once the first two were in hand: the push moves the touched point by exactly the gap along the normal, so the pair ends at D up to the difference between the finite rotation and its linearisation, `R(1 - cos eps) + R(eps - sin eps)`, about **1e-5u**; the engine agrees, post-push pair distances over 200 poses all in [2.88000, 2.88001]. The blanket 0.005u the first checker used was the floor on how thin the set could ever be.

Three other things had to change: the enclosure is a **parallelotope** around the centre pose's own simulated trajectory, with its basis built from the contact frame (tangential slide, spin-led tangent, push) rather than by projecting the previous columns, which alone was inflating the set 1.6x per substep; the push magnitude is bounded **from below** as well as above (a pose already inside D must be pushed out of it); and within a substep the checker **branches on contact regime** when two chords are live, since no pose has both normals.

Result, on the same throw, a +-0.005u / +-0.02-degree box, 138 substeps:

| | first checker | with the lemmas |
|---|---|---|
| set size while in contact | grows 1.3x per substep | flat at 0.021 to 0.027u from 4.7 to 9.0 degrees |
| contact normal cone | 7.8 deg, with a floor | 0.03 to 0.06 deg |
| stops at | 11.6 deg, set already 1.8u wide | 12.0 deg, set 0.25u |

Soundness was checked throughout: 200 simulated poses over two box sizes, every per-substep enclosure and bound asserted against the engine's own law, **zero violations**.

### 1.5 The throw the proof has to reach

ndpxhts24, a certified dead point (blue victim). Blue replies with arm (pivot foot 0, anticlockwise) to 8 degrees; that reply pushes nothing. The position after it:

| | hub (x, y) | rot | feet (x, y) [radius] |
|---|---|---|---|
| blue (victim) | (-24.3113, -37.3480) | 77.053 deg | f0 (-19.137, -14.840) [24.217]; **f1 (-46.391, -44.121) [64.021]**; f2 (-7.406, -53.083) [53.597] |
| red (attacker) | (-11.7593, -23.2838) | 168.689 deg | **f0 (-34.406, -18.755) [39.185]** = the pivot P; f1 (-4.358, -45.161); f2 (3.486, -5.936) |

Clearance at the start 0.498u. Red swings arm (pivot foot 0, clockwise); the closed-form limit of that arm is 46.00 degrees. The engine throws blue's foot 1 at 28.0 degrees with margin 6.71u; foot 1 needs 3.146u of radial gain from 64.021u. Contact is red leg 0 against blue leg 0 only, from 4.0 degrees of sweep to the throw. Traced (0.4-degree substeps here, so the sweep angles are what to read, not the substep numbers):

| sweep (deg) | phi on red leg / blue leg (deg from the hub) | 3-D crossing angle of the tangents | hf | lever rn (u) | bearing of n (deg) | n . u at foot 1 | foot-1 gain (u) |
|---|---|---|---|---|---|---|---|
| 4.0 | 26.0 / 36.8 | 73.0 | 0.632 | -7.91 | -68.1 | 0.37 | 0.0004 |
| 8.0 | 24.2 / 35.3 | 72.0 | 0.622 | -7.20 | -70.9 | 0.41 | 0.0139 |
| 12.0 | 21.4 / 33.6 | 71.2 | 0.578 | -4.29 | -84.7 | 0.62 | 0.0430 |
| 16.0 | 19.5 / 32.6 | 69.5 | 0.572 | -3.57 | -88.2 | 0.67 | 0.0517 |
| 20.0 | 17.6 / 31.6 | 67.5 | 0.566 | -2.84 | -91.7 | 0.72 | 0.0612 |
| 24.0 | 15.6 / 30.5 | 65.5 | 0.562 | -2.10 | -95.3 | 0.75 | 0.0714 |
| 28.0 | 13.5 / 30.0 | 62.9 | 0.509 | +0.82 | -109.7 | 0.89 | 0.1101 |

The engine's gains sum to 3.170u and Lemma 3's formula to 3.18u, worst single-substep difference 0.009u. The legs never come near parallel: the crossing angle stays between 63 and 73 degrees.

**Where the polyline vertices fall.** The contact walks about 5.0u down the attacker's leg and 2.75u down the victim's over those 24 degrees, that is 0.070u per 1/3-degree substep against a chord of 3.023u. So in the whole contact phase the contact point crosses exactly three vertices (traced by watching which chord pair holds the global minimum, substep by substep; two independent traces agree):

| vertex | chord pair | at sweep |
|---|---|---|
| attacker's leg, phi = 22.5 deg | (3,4) to (2,4) | **10.67 deg** |
| attacker's leg, phi = 15.0 deg | (2,4) to (1,4) | 24.33 deg |
| victim's leg, phi = 30.0 deg | (1,4) to (1,3) | 25.00 deg |

The checker refuses at 12.0 degrees, so it dies on the first of them; the other two are two substeps apart, just before the throw.

### 1.6 What stops it now, exactly

As the contact point approaches a vertex, the neighbouring chord's minimum converges on the live one: over four substeps, 2.9041, 2.8963, 2.8886, 2.8804, against a steady 2.8801. For a few substeps the two are genuinely within the set's own width of each other, so both regimes are live. Their exact normals differ by the polyline's turn, and the resulting pushes differ by about 0.01u. That alone would be survivable. What is not survivable is the feedback: a wider set raises Lemma A's localisation radius, which puts more chord ends in play, which widens the vertex cones, which widens the set. From 0.027u it runs 0.033, 0.046, 0.090, 0.122, 0.226, 0.401, and then refuses.

**The window is wider than the crossing.** The checker refuses at 12.00 degrees, which is 1.3 degrees *past* the crossing at 10.67, and its set starts growing at 9.33, which is 1.3 degrees *before* it. So the set straddles the vertex for about 2.7 degrees, eight substeps, while the centre pose is still safely inside one chord the whole time. A branching scheme therefore cannot split at the crossing substep: it has to split when the neighbouring chord's minimum first comes within the set's own width of the live one, and re-merge when it leaves. The two branches then coexist for eight substeps, not one.

Shrinking the starting box does not help: at +-0.001u the contact crosses the vertex a few substeps later and the same thing happens. **Subdividing the box is not the answer; the crossing has to be handled.** There is also a third regime in play: while the closest point dwells exactly on a shared vertex the vector to it is perpendicular to neither chord, and lies in the vertex's normal fan (the checker carries this case with a cone computed from the vertex's known position; only one endpoint is uncertain when the vertex is the attacker's, since the attacker is fixed through the substep).

The obvious next step is to carry the regimes as genuinely separate sets across substeps rather than unioning them into one parallelotope at the end of each, so that a crossing costs one 0.01u step and nothing compounds. Before building that, I want the geometry checked.

### 1.7 What I want from you (Job 1)

1. **Is separating the regimes the right answer, and does it terminate?** The regime partition is by which chord pair holds the global minimum, that is by the sign of a gap function on the pose set; carrying regimes separately means carrying the set intersected with a moving half-space of that kind, splitting when the rival's minimum comes within the set's width and re-merging when it leaves (1.6). Over the sweep there are three crossings, so eight branches if each splits once and nothing re-merges -- but that is a floor, not a ceiling: the branches coexist for eight substeps each time, and a pose can in principle cross back. Is the count bounded by the number of vertices crossed, and under what condition? Can the partition refine faster (a pose oscillating across the boundary, a third pair entering while two are tied)?
2. **Do the branches re-converge, and can that be proved?** (Of the five, this is the one that decides whether the scheme works, because of the eight-substep window.) Two poses that differ only by regime get pushes differing by about 0.01u once, and thereafter the contact constraint pins both to distance D from the same attacker. The engine says the difference does not accumulate: measured spreads over the whole box are flat at 0.024u through substep 38, and boxes spanning a crossing are inside that measurement. I would like either (a) a contraction statement for the difference of two branches, so the union's width is bounded by the largest single-crossing cost rather than their sum, or (b) a clear statement that no such contraction holds and the branches must be carried to the end separately.
3. **The right state to carry.** The set is currently a parallelotope in pose space around the centre trajectory, and one of its three directions is pinned by the contact constraint to about 1e-5u, so the live set is effectively two-dimensional (tangential slide and spin). Is the better object a set in a contact chart, with the normal coordinate pinned and the chart changing at a vertex crossing? If so, give the chart, the transition map at a crossing, and what happens to the vertex-dwell regime in it (in the chart it should be an interval of the chart's own boundary rather than a separate case).
4. **The vertex-dwell regime, cleanly.** The polyline's distance function is a max-type non-smooth function whose closest-point vector at a vertex lies in a normal cone. Is there a formulation in which the three regimes (chord a, vertex, chord a-1) are one set-valued map with enough monotonicity that the pushed set stays convex, so the checker carries one convex set through the crossing instead of a union? If the push map is monotone in the right sense, the crossing costs nothing at all.
5. **Can the polyline be traded for the arc, with an explicit error?** The polyline is a discretisation of the true quarter circle: chord 3.023u, sagitta 0.0494u, direction error up to 3.75 degrees. On the arc there are no vertices and Lemma B's normal is smooth in the pose, so the proof would run to the end. The transfer has to be of the applied push, not of the geometry: for a pose whose polyline contact is at or near a vertex, how far can the polyline's push (direction and magnitude) be from the arc's, and is that bound small against the set width of 0.027u? My guess is that it is not, because the sagitta alone is twice that width, and that this route is dead; I would like it either killed properly or rescued.
6. If you see a proof shape that avoids carrying a set through the crossing at all, say so. One candidate: prove the exposed foot's radius is monotone in the sweep for every pose in the region, so that only a per-substep lower bound is needed and the normal's exact direction stops mattering near the vertices. The engine's per-substep gains are all positive from 4 degrees on (1.5).

What we can do with your answer: the checker (580 lines) has a `--validate` mode that simulates random poses from the set with the engine's own law and asserts every per-substep enclosure and bound, so any lemma you state can be tested against hundreds of real trajectories before it is trusted; there is a measurement tool that reports the true spread of every bracketed quantity; the engine's contact law is reproduced bit for bit by a 200-line function; the closed-form limit of any arm at any pose costs 0.13 ms.

## 2. Job 2: the oriented split at the three points where the limit really jumps

### 2.1 The crossing rule, exactly (this is what generates every wall)

The first brief paraphrased the rule; here is what the code does, because the walls below come from its details. All bands are `0.81u`.

- A foot is **on** a line while its centre is within 0.81u of the line's centreline (for a side arc, also within the arc's angular span). Contact is tracked **per foot**, at every 1/3-degree substep of the swing.
- The **budget is one crossing per turn for the whole tripod**. The counter goes from 0 to 1 the moment any non-pivot foot goes from off a line to on one. While any non-pivot foot is still on some line, further feet going onto lines are part of that same crossing and cost nothing. The moment every non-pivot foot is off every line, the crossing is spent; the next off-to-on transition would be a second crossing and is refused (the substep rolls back and the swing stops there).
- **Departure from a start line.** A foot that begins the turn on a line may leave it for free only on the side it started on. If it leaves on the other side (it crossed the centreline), that departure is billed like a fresh entry. So the side of the centreline a foot starts on is a rule input.
- **One line per foot per turn.** A foot already on a line freshly entered this turn must stop short of a different line, unless it is rounding a printed corner: within 0.81u of the point where the two lines meet, while still on the first line. That corner merge is validated when the second centreline is crossed (the first line must still be within 0.81u there), else billed.
- The pivot foot is excluded throughout.
- A move must turn at least 2 degrees net.

The closed-form event list (level events at distances `D - 0.81, D, D + 0.81` from each circle centre, the rim at 67.167, corner discs of radius 0.81 about the eight intersection points, the side arcs' span rays) asked at the first substep after each event reproduces the engine's limit and stopping reason bit for bit on 5040 real arms.

Circle centres and the eight corners: r0 and r1 are circles of radius 40 and 53.3 about the origin; a0 is the arc of radius 40 about (-66.667, 0) with bearings in [-72.542, 72.542] degrees, a1 the arc of radius 40 about (66.667, 0) with bearings in [107.458, 252.542]; the corners are K1 (-33.33, -22.11), K2 (-33.33, 22.11), K3 (33.33, 22.11), K4 (33.33, -22.11) (r0 with a0/a1) and K5 (-42.64, -31.98), K6 (-42.64, 31.98), K7 (42.64, 31.98), K8 (42.64, -31.98) (r1 with a0/a1). Rotating about pivot foot P, each other foot moves on the circle of radius `rho = 40.0017u` about P; `psi` is the bearing of P from a circle centre C, `phi` the start bearing of the moving foot from P, and a level event is at `theta = dir (psi - phi +- arccos c)`, `c = (D^2 - |P - C|^2 - rho^2) / (2 rho |P - C|)`. The **rot-independence fact** you confirmed: with P held fixed, every event angle plus `dir . rot` is constant, so any wall built from events of one arm is a curve in that arm's pivot-foot plane extruded along rot. Walls built from a foot's **start** position (the side it starts on, whether it starts on a line, the rim) are circles in that foot's plane instead, and do depend on rot in hub coordinates.

### 2.2 How a cell is certified, and why a wall through it is fatal

A cell is a box of the victim's pose (x, y, and rotation measured as arc length t = R dtheta, so 1u means the same on every axis). For each of the six reply arms an interval enclosure of the arm's stopping event over the box gives the **reach envelope** (the set of stop angles some pose in the box can legally reach). Then a full dead certificate is run at a grid of poses (3 per axis), and between grid neighbours a gap rule checks that the same attacker throw covers both. The envelope is exact only while the arm's stopping **program** (which lines get crossed, which event stops it) is the same throughout the box. Where a program-changing wall crosses the box, one side of it has a limit tens of degrees longer than the other: an envelope taken over the union would contain stops that are illegal on one side, and the certificate would have to show those stops are punished when in fact the attacker may have no throw against them (they are not real replies). So a box that straddles such a wall must be split along it, and the current code bisects on a coordinate axis, leaving 0.25u slabs that hug the curved wall and eat 41 to 100% of the volume.

At ndpxhts24 that is now moot (both events stop, union envelope, one cell). At the other three points the walls are genuine program changes. Today I mapped every arm's program on a 21^3 grid over the +-1u box (victim's three axes, attacker fixed) and fitted a plane to each wall (the midpoints of grid-neighbour pairs whose program differs); then matched the plane's normal and offset against the closed-form candidates, so each wall below has an equation, checked to three digits.

### 2.3 The map, with the wall equations

Poses are `[bx, by, brot, rx, ry, rrot]`, rot in radians; the victim is red (piece 1) at all three points. Plane normals are unit vectors in the victim's `(dx, dy, t)` with t = R dtheta in u; "at ..u" is the distance from the seed to the wall along that normal.

**6dgqa1fd8**, pose [2.6627, 33.2224, 2.2687, 4.2061, 47.1181, 4.4905]. Victim feet f0 (-0.88, 24.59) [24.60], f1 (26.26, 53.98) [60.03], f2 (-12.76, 62.78) [64.07]. Seed limits 63.00, 39.67, 34.00, 4.67, 10.67, 27.67 degrees for arms (0,+), (0,-), (1,+), (1,-), (2,+), (2,-). Five arms have one program over the whole box. Arm **(0,+)** has two:

| share of box | program | limit at seed side |
|---|---|---|
| 96.9% | crossed r1 (foot 2 at 53.2 to 58.5 deg); stopped when foot 2 reaches a0's band, level 40.81 about (-66.667, 0), at 63.24 deg | 63.0 |
| 3.1% | foot 2 crosses r1, then **rounds the corner K6** and picks up a0 for free; stopped when foot 2 reaches r0's band at 90.7 deg | up to 35 deg longer |

The wall is a **corner-merge tangency**: the foot-2 circle about the pivot P = foot 0 grazes the 0.81u disc about K6 = (-42.64, 31.98): `|P - K6| = rho + 0.81 = 40.81`. At the seed |P - K6| = 42.41, so the wall is 1.13u away in the pivot plane (gradient in (dx, dy, t): (0.697, -0.123, 0.707) per u, normalised); the grid's plane fit puts it at 1.02 +- 0.14u with normal (-0.697, 0.102, -0.710) (opposite sign convention), the residual being the wall's curvature. The exact condition is slightly stronger than tangency: foot 2 must enter a0's band while still within 0.81u of r1's centreline and within 0.81u of K6. Rot-independent in the pivot plane. Also inside this box: three real escapes at victim y = -1.0 (reply (1,+) to 36 degrees, margin -2.9u), so a margin wall (kind B) is near the box's y = -1 face.

**0r8c3cohc**, pose [0.8192, -30.3367, -3.2227, 19.4916, -35.329, 4.106]. Victim feet f0 (6.33, -54.31) [54.67], f1 (42.51, -37.24) [56.51], f2 (9.64, -14.44) [17.36]. Seed limits 23.33, 17.33, 19.67, 20.00, 20.67, 61.00. Four walls, three of them identified:

| wall | equation | where | arms it cuts, and the jump |
|---|---|---|---|
| **C: start side of foot 0 on r1** | `|foot0| = 53.30` (r1's centreline, in the foot-0 plane; foot 0 starts 1.37u outside it) | 1.146u from the seed, normal (0.097, -0.829, 0.552) | (1,-): 13.0 deg (on the far side foot 0 leaves r1 free, the crossing is spent on r0 and the arm stops at a1); (2,-): 24 to 30 deg (far side: crossed r0 and r1, stops at a0); (2,+): 1.0 deg; (1,+): 0.33 deg. The same plane on all four arms, to three digits. |
| **D: tangency of foot 1's circle to a1's outer band edge** | `|P - (66.667, 0)| = rho + 40.81 = 80.81` with P = foot 0 (at the seed 81.17) | 0.356u, normal (-0.724, -0.652, -0.224) | (0,+): 10.7 deg. On the seed side foot 1 never reaches a1 and the arm stops at r0's band (23.3 deg); on the far side an a1-band event appears near 12 deg and stops it. 28.8% of the box. |
| **E: corner-merge tangency at K8** | `|P - K8| = rho + 0.81` with P = foot 0 (at the seed 42.63) | 1.68u by the equation, 1.44 +- 0.04u by the plane fit (61 pairs in the box corner) | (0,+): 17.7 deg (crossed a1 and r1, stops at r0). |
| unidentified | corner merge on arm (2,+): crossed a1 and r1, stops when foot 0 reaches a1 at 65 deg | 1.36u, normal (0.899, -0.338, -0.279), 43 pairs in the box corner (-0.9, +0.8, +0.9) | (2,+): 59.7 deg |

Three real escapes inside the box (margins -5.7 to -6.4u), and the earlier line scans found a margin wall at victim y = +1.5u.

**l5807vazg**, pose [37.6039, -3.2612, 1.8896, 50.4287, 10.5092, -0.859]. Victim feet f0 (65.51, -6.98) [65.88, **1.28u from the rim**], f1 (58.03, 32.32) [66.42, **0.74u from the rim**], f2 (27.74, 6.19) [28.42; 39.42 from a1's centre, i.e. **0.58u inside a1's centreline**, on a1's band]. Seed limits 18.00, 1.00 (illegal), 1.67 (illegal), 17.00, 9.33, 5.67. 20.2% of the +-1u box has foot 0 or foot 1 off the board at the start (radius > 67.167): those are not positions. Arm (0,-) is illegal (limit under 2 degrees) on 57.1% of the box and arm (1,+) on 36.2%; those legality walls (`limit = 2 degrees`, rot-dependent) move the limit by one substep only, and an arm illegal throughout a sub-box simply has no stops. The multi-event signatures on arms (0,-), (2,+), (2,-) (a rim event and an a1 event in the same substep) shift the limit by at most 1.67 degrees and are substep coincidences, not walls. Two real walls:

| wall | equation | where | arms and jump |
|---|---|---|---|
| **A: start side of foot 2 on a1** | `|foot2 - (66.667, 0)| = 40.00` (a1's centreline, in the foot-2 plane) | 0.555u, normal (-0.935, 0.149, -0.321) | (0,+): 19.7 deg and (1,-): 19.7 deg, the same plane to three digits; also (1,+): 0.33 deg. On the seed side foot 2 starts inside the centreline, its outward departure across it is billed, and the arm stops when foot 1 reaches r1 (18.0 / 17.0 deg). On the far side foot 2 starts outside the centreline, leaves a1 free on its own side, foot 1 crosses r1 and the arm runs on to r0 (37.3 / 36.6 deg). |
| **B: two-foot event order on (0,+)** | `s[foot 1 enters r1's band, level 54.11] = s[foot 2 leaves a1's band, level 40.81]` (at the seed 18.00 versus 11.39 deg, gap 6.62 deg, gradient (-0.812, 0.050, -0.582) x 8.67 deg per u) | 0.76u | (0,+): 19.7 deg. When foot 1 reaches r1 while foot 2 is still on a1, the entry joins the open crossing ("crossed a1, r1") and the arm runs on to r0 at 37 deg. With the pivot fixed and rot varied by +-3u the gap changes by 4e-14 deg: rot-independent in the pivot plane, as you predicted for event-order walls, here between two different feet. |

### 2.4 Your proposal from the first answer, as I understood it

Certify one local chart per cell: for the arm whose wall matters, coordinates `(u, v, t)` with u tangential along the wall curve in the pivot plane, `v = H / lambda` the signed distance to the wall (H the difference of the two event angles, lambda its gradient's length), `t = R (theta - theta*)`; recover the hub from the pivot foot; pull the other arms' walls back into the same chart as constraints; an oriented box along grad H as the cheap prototype; a separate chart (azimuth, radius, relative attacker pose) for the long direction. The cost you noted: inverting H numerically per cell and proving the inversion is unique over the cell.

### 2.5 What I want from you (Job 2)

1. **The primitive along a wall the limit jumps across.** For each of the three wall families found above, give the cell as an explicit set and the coordinate change to code it:
   - a **start-side circle in a foot plane** (A, C): `|foot_j(pose) - C| = D`, which in hub coordinates is the circle of radius D about C translated by `-R e(rot + 120 j)`, a helix in (x, y, rot);
   - a **tangency circle in the pivot plane** (D, E, the K6 wall): `|P(pose) - C| = rho +- eps`, rot-independent given P;
   - an **event-order curve in the pivot plane** (B, and E01 before it): `g_1(P) = g_2(P)`.
   Say how to lay the certificate's grid (3 poses per axis today) and apply the gap rule between neighbours inside a curvilinear cell, and how to bound the wall's own position given that the engine floors every limit to a 1/3-degree substep: on a band around the wall the two programs' events fall in the same substep and the engine's state machine, not the geometry, decides (the "both in one substep" signatures above, 1.6% of the box at ndpxhts24). Is the right treatment to exclude that band, to certify it as both programs, or to shrink it below the certificate's resolution?
2. **Several walls from different arms in one box.** At 0r8c3cohc walls C, D and E cut the same +-1u box, from two different pivots and two different families (a foot-plane circle and two pivot-plane circles). A cell is then an intersection of half-spaces bounded by curves living in different planes. Give the recipe with this point's numbers: oriented boxes first (one axis along each wall's normal, which for C is (0.097, -0.829, 0.552) and for D (-0.724, -0.652, -0.224), 87 degrees apart), or a chart, and where each stops paying.
3. **l5807vazg.** The first job there is the domain: clip the box to `|foot_0| <= 67.167` and `|foot_1| <= 67.167` (two rim circles, in the foot-0 and foot-1 planes, 1.28u and 0.74u from the seed), accept arms that are illegal throughout a sub-box, then split on wall A (a foot-plane circle 0.555u away) and wall B (a pivot-plane curve 0.76u away). What does that cell look like, and is a sliver between the rim circle and wall A worth certifying at all, given that the far side of A has 20 degrees more reply on two arms?
4. **The far side of a program-changing wall.** On the far side the reply is 13 to 35 degrees longer, and those extra stops need their own throw evidence; two of the three boxes already contain real escapes. Your first answer suggested bracketing the margin wall between an accepted pose and an escaping pose inside one program cell. Say how that combines with the cell primitive: is the far side a separate cell with its own grid, or is the wall simply the cell's boundary and the far side left to a later search?
5. **Check the identifications** in 2.3 from the rule in 2.1 (the K6 corner-merge wall at 1.13u against the grid's 1.02u is the least clean; if the true condition is the corner-disc entry while still on r1 rather than the tangency, write it down), and say whether the four families above (start-side circles, start-on-line circles, tangency circles, event-order curves) plus the rim circles and the legality surfaces exhaust what the rule in 2.1 can produce. If they do, every wall is either a circle in a foot plane or a curve in a pivot plane, and a splitter needs only those two objects.

What is available to act on your answer: the closed-form limit with its stopping events at any pose (0.13 ms); interval enclosures of one event over a box; the full certificate at any pose (1 to 10 s); the engine on random poses as a final check; the 21^3 maps above (the scripts are beside this brief). Not available: any closed form for throw margins.

---

## 3. Job 3 (optional): the swing-event diagram

Unused from the first brief, still useful as a visual check on the closed-form derivation: one clean figure of a swing about a pivot, for arm (0,-) of the blue victim at ndpxhts24 (P = foot 0 = (-19.14, -14.84); the moving feet 1 and 2 start at (-50.20, -40.04) and (-12.84, -54.34) and move clockwise on the circle of radius 40.00 about P; the hub on the circle of radius 23.095 about P). Show the rim (66.667 and the 67.167 level), r0 and r1 with their 0.81u bands, a0 and a1 with bands and span rays, the eight corner discs; on each foot circle every intersection with a band edge, centreline, corner disc, rim level or span ray, labelled by foot and line; the swing angle from 0 at the start and the limit 63.67 degrees marked. The events you read off by intersecting circles should match the arccos formula (you confirmed the 40 level events on this arm last time; the figure is for the write-ups, and any event the picture puts where the formula does not is worth reporting).

---

## 4. Facts to keep straight

- The closed form covers the **limits** (which stops exist), never the **throws** (whether a stop is punished). The throw is the push law of 1.2; its per-substep formula is exact to 0.01u but its inputs must be bounded over sets, which is Job 1.
- The checker's bounds are sound (zero violations against simulation, every run); correctness has never been the problem. It was width, and since the lemmas of 1.4 it is the vertex crossing of 1.6.
- Every wall at the three jumping points is closed-form and identified above, to three digits, except one corner merge in a box corner at 0r8c3cohc.
- The engine floors every limit to a 1/3-degree substep grid, and a swing is integrated in 1/3-degree substeps; the 0.4 degrees in the traced table of 1.5 is a cap an older tool used, not what real play does. Every certificate is built on those.
- Rotation on a pose axis is quoted as arc length at R = 23.095u: 1u of rot is 1/23.095 radians, 2.48 degrees.
- The corrections from your first answer are in force: Lemma 1's deficit is two-sided (|eta| <= 0.005u), Lemma 3's error is 5e-4u, "s = a" is first order, the theorem sums contact substeps only, the ndpxhts24 wall needs no split, and l5807vazg's "no legal reply" points were off the board.
