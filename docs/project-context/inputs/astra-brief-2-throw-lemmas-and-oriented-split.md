# Brief 2: three contraction lemmas for the throw proof, and the oriented split at the jumping walls

This is a self-contained follow-up to the dead-region brief. You have no access to the code or the game; everything you need is in here (the first brief's definitions are repeated where they are needed, so this can be read alone). Units: board units `u` (1u = 2 mm); angles in degrees unless a formula says radians. Every number below was recomputed today from the engine's own code at the commit you pinned last time (e32f09d), not copied from earlier notes.

There are three jobs. **Job 1 is the one I want first**: it is blocking a proof that is otherwise days of work. Job 2 is the open question from your first answer. Job 3 is optional.

---

## 0. What came back from the first brief, in three lines

Your geometry was right and every number that could be re-derived here was re-derived to the printed digit (24 arm limits, the 40 events on arm (0,-), E01 at 63.6927 against 68.7636 degrees, grad H = (-3.9884, +1.6929, +4.3300) deg per u, nearest point 1.1606u). Two things you said changed what we do: the E01 wall at ndpxhts24 is an event-order curve where **both** events stop the arm, so the limit is continuous across it and the box needs no split at all (enclose both events, take the minimum: the whole +-1u box became one cell, 476 poses dead, in 6.5 minutes against 28 minutes for 59% before); and the "no legal reply" points at l5807vazg were off the board at the start, not limit walls. Your three corrections to the throw note (the deficit is two-sided, the foot-gain error is 5e-4u not 1e-4u, "s = a" is first order) all stand and are folded in below.

---

## 1. Job 1: the throw proof, and the three lemmas that would close it

### 1.1 The objects in 3-D (this is what the first brief left out)

A piece is a tripod: hub at `(x, y)` at height `H = 23.095u` above the board, three feet on the board at

    foot_i = (x, y) + R (cos(rot + 120 i deg), sin(rot + 120 i deg)),   R = 23.095u,  i = 0, 1, 2.

Each leg is a quarter circle in the vertical plane through the hub and its foot: the point at arc angle `phi` (0 at the hub, 90 degrees at the foot) is

    L_i(phi) = ( x + R sin(phi) cos(psi_i),  y + R sin(phi) sin(psi_i),  H cos(phi) ),   psi_i = rot + 120 i deg.

Since H = R the leg is a true quarter circle of radius R. **The engine draws it as a 12-segment polyline**, vertices at `phi_k = 7.5 k` degrees, k = 0..12, so a chord's direction is the arc tangent at its middle angle `7.5 (k + 1/2)` degrees, and the direction jumps by 7.5 degrees at every vertex. The leg is a tube of radius `rho = 1.44u` about that polyline; two legs are in contact when their polylines' closest points are less than `D = 2.88u` apart in 3-D. The hub is a sphere of radius `1.9 rho = 2.736u` (hub-to-leg contact at 4.176u, hub-to-hub at 5.472u); no hub contact occurs in anything below.

The unit tangent of leg i at arc angle phi is

    u_i(phi) = ( cos(phi) cos(psi_i),  cos(phi) sin(psi_i),  -sin(phi) ).

### 1.2 The push law, exactly as the code has it

The attacker is kinematic: it rotates rigidly about its pinned foot P by `delta = 0.4 degrees` per substep, in one direction. The victim is a free rigid body in the plane: hub c, orientation theta, mass 1, inertia `I = 0.7 R^2 = 373.37 u^2`.

After each substep of the attacker the solver runs up to 10 passes. A pass visits every leg pair (i, j) whose polylines are closer than D and, for each, computes the 3-D closest points `p_A` (on the attacker) and `p` (on the victim), the 3-D unit vector `n3` from p_A to p, its horizontal part `n = (n3_x, n3_y) / hf` with `hf = |(n3_x, n3_y)|` (the horizontal fraction), and the separation

    s = (D - dist) / max(hf, 0.35),   capped at 0.8u.

Then with `r = p_xy - c` (the contact point from the victim's hub, horizontal) and `rn = r x n = r_x n_y - r_y n_x` (the lever arm: the signed distance of the hub from the line of the push),

    lambda = s / (1 + rn^2 / I),     c <- c + lambda n,     theta <- theta + lambda rn / I.

A pass with no pair under D ends the solver. (A deep-crossing rule for dist < 0.3u exists and has never fired; the 0.8u cap and the 0.35 floor have never fired in 300 measured throws; there is no friction and no restitution.) The polyline closest-point routine is the standard segment-segment one with clamping to the segment ends.

### 1.3 What is already proved from that update (with your corrections)

- **Lemma 1.** After one update the touched point p moves by `Delta p` with `Delta p . n = s - eta`, `|eta| <= (1 - cos e)|r| + (e^2/6)(s - lambda)`, `e = lambda rn / I`. With s <= 0.8 and |r| <= R this is `|eta| <= 0.005u`; eta is two-sided (measured range over 5e5 random updates: -0.0035 to +0.0035u).
- **Lemma 2.** `lambda` is in `[0.4118 s, s]` (since |rn| <= R and 1/(1 + R^2/I) = 0.7/1.7) and the spin `|lambda rn / I| <= s / (2 sqrt I) = 0.02588 s` radians, i.e. at most 1.48 degrees per u of separation.
- **Lemma 3.** For a foot `F = c + R f` with outward unit `u = F/|F|`, the radial gain of one update is `lambda [ n . u + (rn / I) R (J f) . u ]` up to a second-order error that is 5.1e-4u in the worst configuration at one substep's separations (J the quarter turn). The bracket is the **gain coefficient g**: slide plus spin.
- **One substep of the attacker** moves any point of its legs by at most `2 sqrt(3) R sin(0.2 deg) = 0.2793u`. If a pair is at distance D at the start of the substep and the attacker's contact point advances by `a` along n, the solver asks for `s = a` to first order (exactly `s = a` if hf >= 0.35 and the gap closes by a hf), so the cap never binds.
- **The theorem (barrier form).** Fix the attacker's swing. Let B be a set of victim poses and F the exposed foot. If for every substep and every pose in B that touches: (H1) exactly one leg pair touches, closest points interior to both polylines, hf >= 0.35, no hub contact; (H2) the attacker's contact point advances into the victim by `a >= a_min(k) > 0`; (H3) `g >= g_min(k) > 0` and `rn^2 <= L^2`; (H4) B is invariant under the pushes; then the victim is thrown no later than the first substep by which `sum_k a_min(k) g_min(k) / (1 + L^2/I)` exceeds `67.167 - |F_0|` plus 0.005u per contact substep. Nothing in the proof runs the solver; the hypotheses are geometry, checkable by interval arithmetic on the polylines.

### 1.4 The real throw the proof has to reproduce

ndpxhts24, the certified dead point (blue victim). Blue replies with arm (pivot foot 0, anticlockwise) to 8 degrees; that reply pushes nothing. The position after it:

| | hub (x, y) | rot | feet (x, y) [radius] |
|---|---|---|---|
| blue (victim) | (-24.3113, -37.3480) | 77.053 deg | f0 (-19.137, -14.840) [24.217]; **f1 (-46.391, -44.121) [64.021]**; f2 (-7.406, -53.083) [53.597] |
| red (attacker) | (-11.7593, -23.2838) | 168.689 deg | **f0 (-34.406, -18.755) [39.185]** = the pivot P; f1 (-4.358, -45.161); f2 (3.486, -5.936) |

Clearance between the pieces at the start: 0.498u (leg-axis distance minus D). Red swings arm (pivot foot 0, clockwise); its closed-form limit is 46.00 degrees (foot 1 reaches the rim). The engine throws blue's foot 1 at 28.0 degrees with margin 6.71u; foot 1 needs 3.146u of radial gain from 64.021u to 67.167u. Contact is red leg 0 against blue leg 0 only, from substep 10 (4.0 degrees) to the throw at substep 70; 61 substeps in contact. Substep by substep (the engine's replica, traced):

| substep (deg) | phi on red leg / blue leg (deg down from the hub) | 3-D crossing angle of the leg tangents | hf | lever rn (u) | bearing of n (deg) | n . u at foot 1 | penetration created (u) | foot-1 gain (u) | victim pose after |
|---|---|---|---|---|---|---|---|---|---|
| 10 (4.0) | 26.0 / 36.8 | 73.0 | 0.632 | -7.91 | -68.1 | 0.37 | 0.0021 | 0.0004 | (-24.310, -37.351, 77.049) |
| 20 (8.0) | 24.2 / 35.3 | 72.0 | 0.622 | -7.20 | -70.9 | 0.41 | 0.0464 | 0.0139 | (-24.088, -37.948, 76.315) |
| 30 (12.0) | 21.4 / 33.6 | 71.2 | 0.578 | -4.29 | -84.7 | 0.62 | 0.0520 | 0.0430 | (-23.930, -38.668, 75.657) |
| 40 (16.0) | 19.5 / 32.6 | 69.5 | 0.572 | -3.57 | -88.2 | 0.67 | 0.0536 | 0.0517 | (-23.878, -39.550, 75.130) |
| 50 (20.0) | 17.6 / 31.6 | 67.5 | 0.566 | -2.84 | -91.7 | 0.72 | 0.0553 | 0.0612 | (-23.880, -40.484, 74.677) |
| 60 (24.0) | 15.6 / 30.5 | 65.5 | 0.562 | -2.10 | -95.3 | 0.75 | 0.0573 | 0.0714 | (-23.944, -41.466, 74.310) |
| 70 (28.0) | 13.5 / 30.0 | 62.9 | 0.509 | +0.82 | -109.7 | 0.89 | 0.0599 | 0.1101 | (-24.322, -42.566, 74.430) |

(The bearing of blue's leg 0 is 77.05 falling to 74.4 degrees as it is pushed; red's leg 0 is at 168.69 - 0.4 k degrees. Foot 1's outward direction is at bearing -136.4 degrees.) The attacker's advance a per substep is 0.072 to 0.117u, summing to 5.66u; the separations applied sum to 5.59u; the engine's foot gain sums to 3.170u and Lemma 3's formula to 3.18u, worst single-substep difference 0.009u. So the per-substep formula is right; what is missing is bounding its inputs over a **set** of poses.

**The dynamics are contractive.** 40 random poses from the box +-0.1u in x and y, +-0.5 degrees in rotation around the pose above, all simulated with the engine to the throw (40 of 40 thrown), have these spreads (max minus min over the 40):

| substep (deg) | spread in x (u) | in y (u) | in rot (deg) | in foot-1 radius (u) |
|---|---|---|---|---|
| 0 | 0.193 | 0.184 | 0.97 | 0.294 |
| 10 (4.0) | 0.218 | 0.133 | 0.97 | 0.297 |
| 20 (8.0) | 0.244 | 0.131 | 0.87 | 0.304 |
| 30 (12.0) | 0.225 | 0.060 | 0.86 | 0.231 |
| 50 (20.0) | 0.228 | 0.047 | 0.90 | 0.225 |
| 70 (28.0) | 0.207 | 0.065 | 0.93 | 0.150 |

From the box +-0.01u, +-0.05 degrees the spreads are 0.019 / 0.020 / 0.09 at the start and 0.023 / 0.009 / 0.11 at substep 70. Nothing spreads; the y direction (close to the push normal, bearing -70 to -110 degrees) shrinks by three to four times. The contact constraint pulls the poses together along the normal and nothing drives them apart tangentially.

### 1.5 The checker, and exactly where its bounds are loose

The checker implements the theorem as an interval computation over a box of victim poses `B = [x0 +- hx] x [y0 +- hy] x [rot0 +- ht]`, carried substep by substep:

1. **Pad.** Every point of the victim moves at most `pad = hypot(hx, hy) + 2 R sin(ht/2)` across the box. All geometry is done on the box's centre pose and widened by pad.
2. **H1.** A leg pair is "touchable" if its centre-pose polyline distance minus pad is under D. Refuse if two pairs are touchable, or any hub contact is possible.
3. **Candidate segments.** On the touchable pair, a segment pair is a candidate if its centre-pose distance is under `thr = min(D, dist_c + pad) + pad`. On each candidate segment, only the **portion** whose distance to the other segment is under thr can hold a closest point (that distance is convex along a segment, so the portion is an interval found by bisection from the minimiser). Refuse if a portion reaches a hub end or a foot end of a polyline.
4. **The normal.** The closest-point vector between two polylines is perpendicular to both at interior points, so `n3` is parallel to `u_A(phi_A) x u_V(phi_V)` with phi_A, phi_V in the candidate chords' angle **fans**: a chord's own middle angle, widened to the neighbouring chord's middle angle when the portion reaches a vertex (a 7.5-degree wedge). The cross product is evaluated by interval arithmetic over the fans and over the victim's rotation interval; its sign is fixed by the centre pose's own closest vector (unique and continuous on one segment pair); `hf` is read off the family; the horizontal cone `psi_N` is the angular hull. Refuse if the family is wider than 45 degrees.
5. **Advance and penetration.** The attacker's contact point moves by the exact chord of its 0.4-degree rotation; its component along the cone is `a` (an interval; refuse if a can be <= 0). With the pair at distance in [D - res, D] before the substep (res the residual Lemma 1 can leave, 0.005u), the penetration created is `D - |d - chord|`, bounded above and below.
6. **Separation, lambda, gain.** `s` in `[pen_min / max(hf_hi, 0.35), min(0.8, pen_max / max(hf_lo, 0.35))]`; `rn` from the victim's candidate-portion box minus the hub box, dotted with the cone; `lambda` from s and rn; `g_min = min(n . u) + min(spin term)` with u the outward direction over the foot's box; gain >= lambda_min g_min.
7. **Move the box (H4).** New box = old box shifted by `lambda n` (interval in the cone) and `lambda rn / I` in rotation; until every pose of the original box has surely been touched, the new box is the hull of the old and the moved one.
8. **--validate**: random poses in the box are simulated with the engine's law and every per-substep bound (pose inside the carried box, normal inside the cone, hf inside its interval, gain above the bound) is asserted. **Zero violations in every run**, so the bounds are sound as far as simulation can tell.

**Where it fails**, reproduced today on the pose of 1.4:

| starting box | how far it gets | what stops it |
|---|---|---|
| +-0.1u, +-0.5 deg | substep 20 (8.0 deg) | after the push, a second leg pair (red 1, blue 2) can no longer be excluded: 6.20u at the centre, but the pad has grown past 3.3u |
| +-0.03u, +-0.1 deg | substep 26 (10.4 deg) | same, at 5.25u |
| +-0.01u, +-0.05 deg | substep 29 (11.6 deg) | same, at 4.98u |
| +-0.01u, with the conjectured Lipschitz cone of 1.7 below instead of the fans | substep 16 | the cone exceeds 30 degrees once the box is wide |

The carried box for the +-0.01u, +-0.05-degree start (the engine's own spread from this box is 0.022 x 0.014u x 0.09 degrees at every substep to the throw):

| substep (deg) | box width x (u) | y (u) | rot (deg) | advance a | penetration | gain bound per substep |
|---|---|---|---|---|---|---|
| 11 (4.4) | 0.044 | 0.069 | 0.18 | [0.0686, 0.0815] | [0.0408, 0.0649] | 0.0067 (engine: 0.010) |
| 15 (6.0) | 0.152 | 0.280 | 0.52 | [0.0655, 0.0866] | [0.0385, 0.0635] | 0.0059 |
| 20 (8.0) | 0.364 | 0.730 | 1.30 | [0.0624, 0.1004] | [0.0333, 0.0750] | 0.0043 |
| 25 (10.0) | 0.819 | 1.474 | 2.83 | [0.0479, 0.1094] | [0.0199, 0.0835] | 0 |
| 28 (11.2) | 1.411 | 2.109 | 4.64 | [0.0311, 0.1256] | [0.0115, 0.0919] | 0 |

The box grows by 1.2 to 1.3x per substep whatever the starting size, because each substep adds the full width of the separation interval to the box, the wider box widens the candidate portions and the fans, and that widens the next separation interval. Three bounds are loose **by construction**, and these are what the lemmas have to replace:

1. **Where the contact is.** The candidate portion of a segment is a sublevel set of the distance, and near the minimiser the distance is flat: for legs crossing at 63 to 73 degrees the portion is about +-0.8u along each leg even for a 0.01u box (thr exceeds the minimum by about 2 pad, and a quadratic with the curvature of two crossing tubes is that wide). The lever arm rn inherits it (an interval 1.6u wide, against a true spread of a few hundredths), and the rotation interval inherits rn.
2. **The normal.** Whenever a portion reaches a polyline vertex the fan includes the whole 7.5-degree wedge, hf then spans two chords' values (0.61 to 0.72 where the true hf moves by 0.005 across the box), and the horizontal cone is several degrees wide.
3. **The normal coordinate.** After the solver every touching pose is at distance D - eta from the attacker (Lemma 1), so the set of post-push poses is a thin sheet, and the carried box should be no wider along n than the tangential widths allow. The carrier never uses that.

### 1.6 The three lemmas wanted, with the constants

Notation for all three: two smooth curves in R^3, the attacker's leg `A(phi) = L_A(phi)` and the victim's leg `V(phi') = L_V(phi')` as in 1.1 (quarter circles of radius R = 23.095, in vertical planes), at a configuration where their closest points are interior and their distance is `d` near D = 2.88 (the curvature radius R is 8 times D, so locally these are nearly straight lines crossing at the angle `chi` between the tangents, 63 to 73 degrees in the throw above). A pose change of the victim by `(dx, dy, dtheta)` moves every point of its leg by at most `pad = hypot(dx, dy) + 2 R sin(|dtheta|/2)`. Write `phi*` and `phi'*` for the arc angles of the closest points and `n3` for the unit closest-point vector.

**Lemma A (the contact point is Lipschitz in the pose).** For two curves crossing at angle chi with interior closest points, the closest-point parameters move by at most

    |Delta phi*| R <= C_A pad,    |Delta phi'*| R <= C_A pad,    with C_A = C_A(chi, d, R) explicit,

and the engine's contact point moves by at most (1 + C_A) pad. The natural argument is strong convexity: the squared distance along each curve near the minimiser has second derivative at least `sin^2(chi)` times the arc-length metric for straight lines, minus a curvature correction of order `d / R`; the minimiser of a strongly convex function is Lipschitz in the function's parameters. I want the constant, and the correction for the polyline: the true minimiser can sit at a vertex (a 7.5-degree kink), where the closest point is stationary in a whole range of poses and the vector is in the vertex's normal fan. Expected size for the throw above: about `pad / sin(chi)`, i.e. under 0.1u for the +-0.03u box (pad 0.083u), against the +-0.8u the sublevel set gives.

**Lemma B (the closest-point vector is Lipschitz).** Under the same hypotheses,

    |Delta n3| <= K pad / d,     K = K(chi) explicit, conjectured about 1 + 1 / sin(chi)   (2.05 to 2.12 in the throw above),

for pose changes small against d, and the horizontal fraction hf and the horizontal bearing of n inherit it (`|Delta hf| <= |Delta n3|`, `|Delta bearing| <= |Delta n3| / (hf - |Delta n3|)`). This is the `--lipschitz` cone the checker already offers as a conjecture; validation never caught it out, and it is unproved. For the polyline: across a vertex the closest-point vector rotates continuously through the 7.5-degree normal fan while the closest point sits at the vertex, so the Lipschitz statement needs a bound on how fast the pose can drive the vector through that fan (the fan is 7.5 degrees wide, but a pose change of pad can only turn the vector by about pad / d, so the cone the checker should use is the smaller of the two).

**Lemma C (the contact constraint contracts the box along the normal).** After the solver, every touching pose is at distance in `[D - eta, D + res]` from the attacker (eta <= 0.005u from Lemma 1, res the residual overlap, measured 0.0000u). Therefore the carried set after a substep lies in the intersection of the moved box with the shell `{pose : dist(pose) in [D - eta, D + res]}`. I want the contractor: given a box whose normals lie in a cone of half-angle beta about n_c and whose hf lies in [hf_lo, hf_hi], and tangential widths w_t (along the horizontal direction perpendicular to n_c) and w_theta (rotation), the post-push set's width along n_c is at most

    w_n <= (eta + res) / hf_lo + w_t tan(beta) + (something) R w_theta + (curvature term in d / R),

with the constants filled in, and the proof. The point is that w_n then no longer grows with the separation interval, which is what compounds. With Lemmas A and B making beta and the lever interval small, this is the step that should make the carried box track the engine's non-spreading trajectories (1.4) instead of doubling every three substeps.

**Lemma D (optional, the strongest form).** Show that the substep map `pose -> pushed pose` on the set of touching poses is a contraction along n in the sense that `|Delta dist_after| <= q |Delta dist_before|` with q < 1 explicit (the engine's y spread in 1.4 falls from 0.18u to 0.05u by substep 50 while x holds), and non-expanding tangentially up to the attacker's own 0.28u chord. That would let the carried box be a fixed small box plus the attacker's known motion, and the whole 46-degree sweep would follow at once.

### 1.7 What I want from you (Job 1)

1. **State and prove Lemmas A, B and C** for two circular arcs of radius R in vertical planes crossing at angle chi at distance d, with explicit constants in chi, d and R, and say for each what changes on the 12-segment polyline (the vertex case). Where a lemma is false as stated, say so and give the true statement (for instance if the contact-point Lipschitz constant blows up as the legs approach parallel, give the condition on chi it needs; the throw above never goes below 62 degrees).
2. **Give the contractor of Lemma C as a formula** we can code: inputs are the box, the cone, the hf interval and the residuals; output is the reduced box. If it is cleaner to carry the set in coordinates (normal, tangential, rotation) about the centre pose than as an axis-aligned box, say so and write the coordinate change down.
3. **Predict the numbers.** For the +-0.01u, +-0.05-degree box at substep 11 (chi = 73 degrees, d = 2.88, pad = 0.034u, hf 0.63), what should the widths of the contact-point interval, the normal cone and the post-push box be under your lemmas? We will compare against the engine's spreads in 1.4 and against the checker.
4. **Say whether Lemma D holds**, and if it does, whether the carried box can be made invariant outright (a single box B that maps into itself under every substep of the sweep), which is the theorem's H4 in its cleanest form.
5. If you see a different proof shape that avoids carrying a box altogether (for instance a monotonicity argument: the exposed foot's radius is non-decreasing along the sweep for every pose in a region, so only the last substeps need the interval computation), say so; the engine's per-substep gains above are all positive from substep 10 on.

What we can do with your answer: the checker (`throw-cert.js`, 330 lines, available beside this brief if you want to read how the fans and portions are built) has `--validate`, so every lemma you state can be checked against thousands of simulated poses before it is trusted; the engine's contact law is reproduced exactly by `swing` in `contact-law.js`; the closed-form limit of any arm at any pose is 0.13 ms.

---

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

- The closed form covers the **limits** (which stops exist), never the **throws** (whether a stop is punished). The throw is the push ODE of 1.2; its per-substep formula is exact to 0.01u but its inputs must be bounded over sets, which is Job 1.
- The checker's bounds are sound (zero violations against simulation, every run); its problem is width, not correctness.
- Every wall at the three jumping points is closed-form and identified above, to three digits, except one corner merge in a box corner at 0r8c3cohc.
- The engine floors every limit to a 1/3-degree substep grid and the throw sweep steps at 0.4 degrees; every certificate is built on those.
- Rotation on a pose axis is quoted as arc length at R = 23.095u: 1u of rot is 1/23.095 radians, 2.48 degrees.
- The corrections from your first answer are in force: Lemma 1's deficit is two-sided (|eta| <= 0.005u), Lemma 3's error is 5e-4u, "s = a" is first order, the theorem sums contact substeps only, the ndpxhts24 wall needs no split, and l5807vazg's "no legal reply" points were off the board.
