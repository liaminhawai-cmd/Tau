# Brief: the geometry of "dead" regions in Tau, and what shape they really are

This is a self-contained brief. You have no access to the code or the game; everything you need is in here. Numbers are in board units, written `u` (1u = 2 mm on the physical board). Angles are in degrees unless a formula says otherwise.

There are two jobs. **Job 1 is the one I want first: the dead-region geometry.** Job 2 (a diagram of the swing geometry) is background for Job 1 and a check on a derivation; do it second, or only as far as Job 1 needs it.

---

## 0. The game in one page

**Board.** A disc of radius 66.667u centred at the origin. A foot is "off the board" when its centre is further than **67.167u** from the origin (the rim plus a 0.5u tolerance). Printed on the disc are four lines, all circular arcs:

| id | shape |
|---|---|
| r0 | full circle, centre (0, 0), radius **40** |
| r1 | full circle, centre (0, 0), radius **53.3** |
| a0 | arc of the circle centred at **(-66.667, 0)**, radius **40**, only the part whose bearing from that centre is in **[-72.542°, +72.542°]** (a lens bulging into the board from the left rim; its ends land exactly on the rim) |
| a1 | arc of the circle centred at **(+66.667, 0)**, radius **40**, bearings in **[107.458°, 252.542°]** (the mirror image on the right) |

The lines meet at eight printed **corners**: (±33.33, ±22.11) where r0 meets a0/a1, and (±42.64, ±31.98) where r1 meets a0/a1. Everything is symmetric under x -> -x, y -> -y, and under a 180° rotation about the origin. The rings r0, r1 and the rim are symmetric under *any* rotation about the origin; the side arcs and corners are not.

**Pieces.** Two tripods, blue (piece 0) and red (piece 1). A piece's pose is three numbers `(x, y, rot)`: the hub position and a rotation. Its three feet are at

    foot_i = (x, y) + R * (cos(rot + i*120°), sin(rot + i*120°)),   i = 0, 1, 2,   R = 23.095u.

Each leg is a quarter-circle arc in 3-D from the hub (height 23.095u above the board) down to the foot, of tube radius 1.44u. Two legs touch when their tube axes come within **2.88u** of each other. A position is the joint pose of both pieces: six numbers `(bx, by, brot, rx, ry, rrot)`.

**A move.** The mover picks one of its three feet as the **pivot**, which stays put, and rotates the whole piece rigidly about it in one direction (clockwise or anticlockwise; no reversing), stopping wherever it likes. So a move is an **arm** `(pivot p, direction dir)` plus a **stop angle** s. There are six arms. A move must turn at least **2°** net, else it does not count. While rotating, the mover is kinematic: nothing stops it except the two rules below. If its legs meet the opponent's legs it **pushes** the opponent, which behaves as a free rigid body on the board (least-constraint contact law, no friction, no bounce; integrated in 0.4° substeps).

**Winning.** You win the moment any foot of the opponent is off the board (centre radius > 67.167u). You cannot swing one of your own feet off: the swing stops just before.

**The crossing rule (what limits a swing).** A foot is "on" a line while its centre is within **0.81u** of the line's centreline. Each foot's off-to-on transition opens a "crossing episode" and costs one crossing; a piece may spend **one crossing per turn**. Opening a second episode is refused: the engine rolls that substep back, and the swing stops there. Exceptions: feet that start the turn on a line may leave it for free; and where two printed lines meet, a foot on one line may pick up the other at the corner (within 0.81u of the intersection point) as part of the same episode. So each arm has a **limit**: the largest stop angle the rules allow. Beyond the pivot foot, only the two moving feet matter for the limit, and it depends only on the mover's own pose, never on the opponent.

**Swing geometry (this is what Job 2 draws).** Rotating about pivot P, each other foot moves on a circle about P of radius

    rho = R * sqrt(3) = 40.00u    (the same radius as ring r0 and as the side arcs; that is not a coincidence in the game's design)

and the hub moves on a circle of radius R = 23.095u about P. Every input to the crossing rule is a distance from a moving foot to a fixed circle centre C (the origin for the rings and the rim, (±66.667, 0) for the side arcs, a corner point for the corners). Write u = P - C, |u| its length, psi = bearing of u, and phi = bearing of the moving foot from P at the start of the swing (phi = rot + a constant that depends only on which foot and which pivot). Then the foot's distance to C after turning by theta is

    d(theta)^2 = |u|^2 + rho^2 + 2 * rho * |u| * cos(phi + theta - psi).

The **events** where an input to the rule changes are the angles at which d equals a level D:

    theta = psi - phi ± arccos(c),     c = (D^2 - |u|^2 - rho^2) / (2 * rho * |u|)

with levels D = 40 - 0.81, 40, 40 + 0.81 for r0; 53.3 ± 0.81 and 53.3 for r1; 40 ± 0.81 and 40 about each side-arc centre; 0.81 about each corner point; 67.167 about the origin for the rim. A side arc also has two span **rays** (the bearings ±72.542° from its centre, and 107.458°, 252.542° for the other), crossed at theta = A - phi - arcsin(v) with v a linear function of P (`v = -(u_x sin A - u_y cos A) / rho`). About 44 events per arm per full turn. The limit is not one of these formulas: it is the first event at which the rule's little state machine (one crossing per turn, one line per foot, free corner merges, free departures) says no, and the engine then floors the stop to its **1/3° substep grid**. Computing the events in closed form and asking the rule only at the first substep past each event reproduces the engine's limit bit for bit on 5040 real arms, 620x faster than stepping.

**Dead position.** A position with the victim to move is **dead** when every legal reply (every arm, every stop from 2° to the arm's limit) leaves the attacker some arm whose swing to its own limit throws a victim foot off. The **throw margin** of an attacker swing is how far the furthest victim foot ends up beyond 67.167u (negative if none does). Note the replies themselves usually push the attacker, so a reply is not a rigid motion of the victim alone: it is a curve through the joint six-dimensional pose space.

**The certificate ("dead certificate").** Along each reply arm, the attacker's six throw margins are sampled every 2° of stop angle, and each gap between neighbouring stops must be bridged by *one* attacker arm whose margin at both ends exceeds `max(1, 3 * |Δm| / g) * g / 2` (g = the gap in u, 0.806u per degree of stop) with the same set of touching leg pairs at both ends. Gaps that fail are subdivided down to the engine's 0.4° substep. An escape is a stop where the best margin is below -0.75u. This is sampled evidence at a stated standard plus the engine played on random poses of the claim; it is not a proof, and there is no closed form for throws (a closed form frozen at first contact is off by 11% at the median and 48% at the 90th percentile of the push displacement; the push is an ODE).

---

## 1. Job 1: the dead-region geometry

### 1.1 What a region is, and the coordinates

A **dead region** is a set of positions all of which are dead. So far regions are built around one certified dead point by moving the victim's pose (3 axes: x, y, rot) with the attacker held fixed, or all six axes. Rotation is measured as arc length at the foot radius: a step of t u on the rot axis means rot changes by t / R radians, so that "1u" means the same thing on every axis. The metric on poses is L1: |dx| + |dy| + R * |drot| summed over the pieces.

### 1.2 The four certified dead points

Poses are `[bx, by, brot, rx, ry, rrot]` with rot in radians. In all four the pieces are already touching (clearance 0.00u, or 0.08u at 0r8c3cohc), and most replies push the attacker from the first substep, by up to 18u.

| name | victim | pose | certified margin W |
|---|---|---|---|
| ndpxhts24 | blue (piece 0) | [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442] | 2.19u |
| 6dgqa1fd8 | red (piece 1) | [2.6627, 33.2224, 2.2687, 4.2061, 47.1181, 4.4905] | 1.00u |
| l5807vazg | red (piece 1) | [37.6039, -3.2612, 1.8896, 50.4287, 10.5092, -0.859] | 0.85u |
| 0r8c3cohc | red (piece 1) | [0.8192, -30.3367, -3.2227, 19.4916, -35.329, 4.106] | 1.73u |

**ndpxhts24 in full (the point to draw).** Blue to move, blue is the victim.

Victim (blue): hub (-27.39, -36.41), radius 45.56 from the origin, rot 69.05°.

| foot | position | radius from origin | notes |
|---|---|---|---|
| 0 | (-19.14, -14.84) | 24.22 | deep inside r0 (15.8u inside its centreline), 9.8u outside side arc a0's circle |
| 1 | (-50.20, -40.04) | 64.21 | **2.95u from the rim**; 3.30u outside a0's centreline at bearing -68° from a0's centre (inside a0's span, which ends at -72.5°) |
| 2 | (-12.84, -54.34) | 55.84 | 2.54u outside r1's centreline |

Attacker (red): hub (-11.76, -23.28), rot 168.69°. Feet: (-34.41, -18.75) at radius 39.19, i.e. exactly at the inner edge of r0's band and 2.7u inside a0's circle; (-4.36, -45.16) at radius 45.37; (3.49, -5.94) near the board centre.

The victim's six reply arms at this point (limit, what stopped it; "crossed X" means the one crossing was spent on X earlier in the swing):

| arm (pivot, dir) | limit | stopping event |
|---|---|---|
| (0, +) | 44.33° | crossed r1; stopped when foot 2 reached r0's band (level 40.81 about the origin) |
| (0, -) | 63.67° | crossed a0; stopped when foot 2 reached a0's band (level 40.81 about (-66.667, 0)) |
| (1, +) | 14.67° | crossed r1; stopped when foot 0 reached a0's band |
| (1, -) | 16.67° | self-off: foot 2 reached the rim (level 67.167) |
| (2, +) | 4.67° | self-off: foot 1 reached the rim |
| (2, -) | 15.67° | crossed a0; stopped when foot 1 reached r1's band (level 54.11) |

Along every one of these arms the attacker's best throw margin stays between 3.1u and 13.1u at every substep; no stop is anywhere near escaping. The arm that does the throwing switches along the reply (14 times on arm (0, -)), and at those switches the best margin jumps by up to 9u between neighbouring substeps: these are grazing surfaces (a leg pair starting or ceasing to touch), where the margin is not continuous.

**The other three, briefly** (victim's feet; distances to the nearest line):

- 6dgqa1fd8 (red victim, hub (4.21, 47.12), rot 257.3°): feet at radii 24.60, 60.03 (7.1u from the rim, 6.7u outside r1) and 64.07 (**3.1u from the rim**). Reply limits 63.0°, 39.7°, 34.0°, 4.7° (self-off), 10.7° (self-off), 27.7°.
- l5807vazg (red victim, hub (50.43, 10.51), rot -49.2°): feet at radii 65.88 (**1.28u from the rim**) and 66.42 (**0.74u from the rim**) and 28.42. Two of the six arms are already illegal (limits 1.0° and 1.67°, under the 2° minimum, both self-off). Foot 1 sits at bearing 105° from a1's centre, 2.5° short of a1's span end at 107.5°, so a1's span ray is a live wall here. Legal limits 18.0°, 17.0°, 9.3°, 5.7°.
- 0r8c3cohc (red victim, hub (19.49, -35.33), rot 235.3°): feet at radii 54.67 (1.4u outside r1), 56.51 (3.2u outside r1) and 17.36. Reply limits 23.3°, 17.3° (self-off), 19.7° (self-off), 20.0°, 20.7°, 61.0°.

### 1.3 What is measured about the extent of the dead set

**Line scans.** Each point re-certified at pose + t * axis for t = -1.5u .. +1.5u in 0.25u steps on each of the six axes (13 poses per axis, 78 per point, each with its own limits):

| point | dead poses | W over them | where it stopped being dead |
|---|---|---|---|
| ndpxhts24 | 78 / 78 | 2.11 to 2.49u, flat | nowhere within ±1.5u on any axis |
| 6dgqa1fd8 | 78 / 78 | 0.56 to 1.18u | nowhere within ±1.5u |
| l5807vazg | 75 / 78 | 0.54 to 2.01u | victim x at +1.25u and victim rot at -1.5u: every arm's limit falls under 2°, "no legal reply" (a **limit wall**) |
| 0r8c3cohc | 72 / 78 | 0.27 to 3.90u | victim y at +1.5u: reply (1, -) to 22.4° leaves no throw, margin -7.56u (a **margin wall**); along victim x, W falls steadily 3.9 -> 0.27u so a margin wall sits just past +1.5u; attacker rot from -0.5 to -1.5u: unresolved, an arm-switch gap the certificate cannot bridge (a **certification wall**, not a wall of the dead set) |

So the dead set is a block **at least 3u wide on every axis** at two points and on most axes at the other two.

**Why the previously certified ball was only 0.17u.** The earlier method certified a ball by transporting the certificate's margin W with a finite-difference slope (13 certificates in a star, eps = min(h, W / slope) = min(0.4, 2.21 / 13.07) = 0.17u). But W is the margin of whichever attacker arc happens to pass the gap rule, and it switches with the pose: the same pose reads 2.2u under the code's bookkeeping and 0.8u under a strict one, and a probe 0.4u away read 0.47u because of phantom stops in an over-wide reach envelope. Its finite difference measures switching, not physics, so the ball says nothing about the dead set. **Do not treat 0.17u as a length scale of anything.**

**Cells (the current method, PR 18).** A box of the victim's pose is certified as a cell: exact reach envelopes per arm from interval arithmetic on the closed-form stopping event (refused if any wall runs through the box), a full certificate at 3 grid poses per axis, the gap rule applied between pose neighbours per arm and per stop, and a box that straddles a limit wall is bisected on the wall's axis down to 0.1u half-widths. Results at ±1.0u on the victim's three axes, attacker fixed, 4 threads:

| point | leaves dead / all | volume certified | time | walls found |
|---|---|---|---|---|
| ndpxhts24 | 8 / 37 | 59% | 28 min | one curved wall of arm (0, -): on one side its stopping event is foot 2 reaching a0's band, on the other side a different event on ring r1; the wall runs through x, y and rot |
| 6dgqa1fd8 | 4 / 20 | 16% | 18 min | walls of arm (0, +) (a0 / r1 / r0 events), plus three real escapes on the grid at victim y = -1.0 (reply (1, +) to 36°, margin -2.9u) |
| 0r8c3cohc | 5 / 56 | 5% | 21 min | a wall of arm (0, +) (r0 / a1 events) and rim walls of arm (1, +); three real escapes (margins -5.7 to -6.4u) |
| l5807vazg | 0 / 58 | 0% | 5 min | foot 1 is 0.74u from the rim: every sub-box has a foot reaching the rim or an arm that is illegal in part of it, and the enclosure refuses those |

At ndpxhts24 with ±0.4u the whole box certified as one cell in 3 minutes. At ±1.0u the 29 refused leaves are **0.25u-thick axis-aligned slabs hugging one curved surface**, 41% of the volume; each further level of bisection halves the slab volume and costs as much again. Every dead leaf passed the engine on 40 random poses times 8 random moves. So: the walls are real and closed-form, and the loss is entirely that axis-aligned boxes are the wrong primitive against curved walls.

**The free direction (azimuth).** Rotating both pieces together about the board centre leaves the push physics invariant to 4e-13u (rigid rotations, closest points and distances to the centre only). Only the crossing rule changes (the side arcs and corners are not rotation-symmetric), and that is the closed form. Rotating each point in 5° steps and certifying each azimuth: l5807vazg is dead at 60 of 72 azimuths (six arcs: 325° through 0°, 10 to 25, 35 to 120, 145 to 180, 190 to 205, 215 to 300), ndpxhts24 at 36 of 72. Every failure is on stops that the rotated limits *opened up* (a side arc no longer stops an arm, so the reply can go further), never on a transported stop. Around the circle l5807vazg's limits pass through 29 distinct stopping-event signatures. Note the scale: 300° of azimuth at hub radius 51u is over 250u of arc length, against a box 3u wide. **The dead set is long and thin: a tube around the azimuth circle, cut by side-arc events.**

### 1.4 The wall families, with their equations

A wall is a surface in the victim's pose space `(x, y, rot)` (or the joint 6-D space) on which the certificate's structure changes. They come in three kinds. Only the first kind is closed-form.

**Kind A: limit walls (closed form).** For an arm with pivot foot p, let P = (x, y) + R * (cos(rot + p*120°), sin(rot + p*120°)) be the pivot foot's position. The moving foot i has phi_i = rot + phi0_i with phi0_i a constant (its bearing from P at rot = 0: ±150° for the two non-pivot feet, depending on i and p). Each event angle is

    s_e(P, rot) = dir * ( psi(P) ± arccos(c(|P - C|)) - rot - phi0_i ),   c = (D^2 - |P - C|^2 - rho^2) / (2 rho |P - C|),   rho = 40.00

for a level event, and `dir * (A - arcsin(v(P)) - rot - phi0_i)` (or with pi - arcsin) for a ray event. The walls:

- **A1, event-order walls: two events on the same arm at the same angle**, `s_e1 = s_e2`. This is where the arm's stopping event changes (the wall found at ndpxhts24 is one of these). Observe that rot enters every event of one arm only through the same term `-dir * (rot + phi0_i)`, and phi0_i differs between the two moving feet by a constant. So **in the coordinates (P, rot), an event-order wall is `g_1(P) = g_2(P)`: a curve in the pivot-foot plane, extruded straight along rot.** I checked this numerically at ndpxhts24: holding the pivot foot P fixed and changing rot by up to ±3u, every event's `s + dir * rot` is constant to six decimals on all four arms tried. What rot does is choose *where on the foot circle the swing starts*: the events ahead of the start are the same ordered list, rotated, and an event drops off one end or joins the other when it passes the start (which is exactly a wall of kind A4 or A5 below). In hub coordinates an A1 wall is the planar curve translated by `-R * (cos(rot + p*120°), sin(rot + p*120°))`, a helical sweep, which is why it looks like "a curved surface through x, y and rot" to axis-aligned bisection.
- **A2, tangency walls: an event appears or vanishes**, c = ±1, i.e. `|P - C| = D ± rho`: circles in the pivot-foot plane about each circle centre C, again rot-independent in (P, rot).
- **A3, legality walls: an arm's limit equals the 2° minimum**, `s_stop(P, rot) = 2°`. These depend on rot. Two arms at l5807vazg are already on the wrong side of these.
- **A4, start-contact walls**: the set of lines a foot starts the turn on changes (a foot's centre at distance exactly 0.81u from a centreline, or at 0.81u from a corner point), which changes what the state machine forgives. For foot j this is `|foot_j - C| = D`, a circle of radius D about C in the foot-j plane, where foot_j = (x, y) + R * e(rot + j*120°).
- **A5, rim walls at the start pose**: a foot of the victim at radius 67.167 (the box is refused if any foot can reach the rim inside it): `|foot_j| = 67.167`, a circle of radius 67.167 in the (x, y) plane whose centre `-R * e(rot + j*120°)` moves on a circle of radius R as rot varies.
- **A6, substep walls**: two events inside one 1/3° substep (the engine's phase sensitivity); these are refused rather than bounded.

**Kind B: margin walls (sampled only).** The zero set of a reply stop's best throw margin. Known only through samples: the margin moves 0.4u per u of pose at the median, 0.85 at the 90th percentile, up to 9u per u at the worst, and is discontinuous across grazing surfaces. At ndpxhts24 and 6dgqa1fd8 no margin wall is within 1.5u of the point on any axis; at 0r8c3cohc one is at victim y = +1.5u (and real escapes exist inside the 1.0u box); at 6dgqa1fd8 real escapes exist inside the 1.0u box at victim y = -1.0. The margin along an arm at these points is 2.5 to 17.8u, so kind-B walls are far away except where noted.

**Kind C: certification walls (artefacts).** Where the gap rule gives up on an arm switch it cannot bridge. Not part of the dead set's shape.

### 1.5 What I want from you (Job 1)

1. **Draw the walls around ndpxhts24.** Using the data of 1.2 and the formulas of 1.4, compute and draw the kind-A walls of all six reply arms that pass within ±1.5u of the point, in the victim's pose space. I suggest two views: (a) slices of the (x, y) plane at rot = centre, centre ± 0.75u, centre ± 1.5u (rot steps of t/R radians), with the ±1.0u box and the ±0.4u box drawn on them; and (b) the same walls in the pivot-foot plane of each arm, where A1 and A2 walls should be plain curves. Colour by wall family and label each wall with its arm and the two events it separates. Mark which side of each wall the certified point lies on.

2. **Tell me what shape the dead set is.** Given the extents (over 3u on every axis at this point, no margin wall in sight), the azimuth tube, and the picture from item 1: what is the natural primitive to certify? Candidates I can see: a curvilinear cell bounded by the closed-form walls themselves in (P, rot) coordinates; a cell in the coordinates (azimuth, radius, rot of each piece) so the free direction is an axis; or the same axis-aligned boxes but oriented and split along the wall's own coordinate. I want a recommendation with a reason, and the coordinate change written down explicitly, so it can be coded. Each arm has its own pivot foot and hence its own P; say how you would handle six arms with three different pivots in one cell.

3. **Use, and if you can, sharpen the rot-independence fact** in A1 and A2. If every wall that matters near a point is either a planar curve in some arm's pivot-foot plane (A1, A2) or a circle in some foot's plane (A4, A5), then a wall-split is a 2-D curve problem, not a 3-D surface problem, and the split can follow the curve exactly. Tell me whether that covers all the walls in 1.4 except A3 and A6, and what the cell then looks like when the three pivot feet each bring their own plane.

4. **Say what to draw for the other three points** only if their walls differ in kind: l5807vazg sits against rim walls (A5) and a span-ray wall of a1, so its region is not a box but a sliver between the rim circle and the ray; 0r8c3cohc and 6dgqa1fd8 have kind-B walls inside 1.0u.

What you may assume is available to act on your answer: an exact per-arm limit (the closed form) at any pose in 0.13 ms; the full dead certificate at any pose in 1 to 10 s; interval enclosures of a single stopping event over a box; the engine as a final check on random poses. What is not available: any closed form for throw margins.

---

## 2. Job 2: a diagram of the swing geometry (background, and a check)

Draw one clean figure of a swing about a pivot P, for the arm (0, -) of the blue victim at ndpxhts24 (P = foot 0 = (-19.14, -14.84); the moving feet 1 and 2 start at (-50.20, -40.04) and (-12.84, -54.34) and move on the circle of radius 40.00 about P, clockwise for dir = -; the hub moves on the circle of radius 23.095 about P). Show:

- the board rim (radius 66.667, plus the 67.167 off-board level), the rings r0 and r1 with their 0.81u bands, the side arcs a0 and a1 with their bands and span rays, and the eight corners with their 0.81u discs;
- the two foot circles about P, and on each of them the **event angles**: every intersection with a band edge (levels D ± 0.81), with a centreline (level D), with a corner disc, with the rim level, and with a span ray, labelled by the foot and the line;
- the swing angle running from 0° at the start pose, and the engine's limit for this arm (63.67°, foot 2 reaching a0's band after the crossing of a0 was spent) marked on it.

Two things this doubles as. First, a readability aid for the write-ups. Second, a check on the derivation: the events you read off the drawing by intersecting circles with circles should match the arccos formula in section 0 (theta = psi - phi ± arccos(c)), and the ray events the arcsin one. If your picture puts an event somewhere the formula does not, that is worth reporting. A useful structural fact to make visible: the foot circle has radius 40.00, the same as r0 and as the side arcs, so a foot's circle and r0 are two equal circles, and a foot pivoting on a foot placed at the board centre rides exactly along r0 through every corner.

---

## 3. Facts to keep straight

- The closed form covers the **limits** (which stops exist), never the **throws** (whether a stop is punished). Dead "curves" cannot be read off the collision function; the walls of dead regions can.
- Certificates are sampled evidence plus the engine on random poses, at a stated standard; only the domain side (limits, envelopes, walls) is exact.
- The engine floors every limit to a 1/3° grid, and the throw sweep steps at 0.4°; both are deliberate and every existing certificate is built on them.
- The star's 0.17u ball measured a bookkeeping artefact, not the dead set; the scans show 3u or more per axis and hundreds of u along the azimuth.
- Rotation on a pose axis is quoted as arc length at R = 23.095u: "1u of rot" is 1/23.095 radians, 2.48°.
