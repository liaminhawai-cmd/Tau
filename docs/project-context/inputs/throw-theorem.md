# A throw as a theorem: the push law as mathematics, and what it proves

Thread "Dead curves and regions", 2026-09-18, after liam's "make it a proof for 2". Everything below is read off the engine's own code (`resolvePush` and `applySwing` in index.html on the search branch, reproduced bit for bit by `swing` in nn/contact-law.js) and checked numerically with scripts in the session scratchpad (`lemmas.js`, `throwstats.js`, `broom.js`, `broom2.js`). Nothing in the repository was changed.

## 0. Short answer

The push law is exact enough to reason about: every push moves the touched point of the victim by exactly the separation the solver asked for, along the contact normal, and splits that motion between sliding and spinning by one fixed formula. From that, the radial gain of the exposed foot in one substep is a closed-form function of five numbers (the attacker's advance along the normal, the normal's angle to the outward radial at the foot, the lever arm of the contact, and the foot's direction), and on a real throw at the ndpxhts24 dead point that formula reproduces the engine to 0.01u per substep and to 0.01u over the whole sweep (3.18u predicted, 3.17u simulated, 3.15u needed).

So a throw is provable by a barrier argument: choose a box of victim poses, bound those five numbers over the box and over the sweep, and sum. The hypotheses are geometric (which tubes touch, from which side, with what lever) and checkable by interval arithmetic on the engine's own polyline legs; the dynamics need no simulation. What is not yet done is the interval checker itself; the four dead points and 300 random throws say its hypotheses hold where throws happen (one tube pair, normal within 60 degrees of radial, the solver's cap, floor and deep-crossing rules never firing, zero residual overlap).

## 1. The law, as the code has it

The attacker is kinematic: it rotates rigidly about its pinned foot P by delta = 0.4 degrees per substep. The victim is a rigid body in the plane with hub c, orientation theta, mass 1 and inertia I = 0.7 R^2 = 373.4 u^2 (R = 23.095u, the hub-to-foot distance). Its feet are F_j = c + R e_j with e_j the unit vector at angle theta + 120 j degrees. Each leg is a quarter-circle tube of radius rho = 1.44u in the vertical plane from the hub (height H = R) down to the foot, drawn as a 12-segment polyline; two tubes touch when their closest points are less than D = 2 rho = 2.88u apart in 3D.

After each substep of the attacker, the solver runs up to 10 passes. In a pass, for every touching pair it computes the 3D closest points p_A (on the attacker) and p (on the victim), the 3D normal from p_A to p, its horizontal part n (a unit vector in the plane) and horizontal fraction hf, and the separation s = (D - dist) / max(hf, 0.35), capped at 0.8u. Then, with r = p - c and rn = r x n (the lever arm, the signed distance of the hub from the line of the push):

    lambda = s / (1 + rn^2 / I),     c <- c + lambda n,     theta <- theta + lambda rn / I.

Hub-against-leg and hub-against-hub contacts use the same update with the hub as p. A pass with no touching pair ends the solver. That is the whole law.

## 2. Three lemmas, proved from the update

**Lemma 1 (the touched point moves the separation).** After one update the point p moves by Delta p with Delta p . n = s - eta, where 0 <= eta <= (1 - cos e) |r| + (e^2 / 6)(s - lambda), e = lambda rn / I. With s <= 0.8 and |r| <= R this is eta <= 0.005u.

Proof. Delta p = lambda n + (Rot(e) - 1) r = lambda n + sin(e) J r - (1 - cos e) r, with J the quarter turn. Dot with n, using (J r) . n = rn: Delta p . n = lambda + sin(e) rn - (1 - cos e)(r . n). And lambda + e rn = lambda (1 + rn^2 / I) = s. So the deficit is (e - sin e) rn + (1 - cos e)(r . n), bounded as stated since |e| <= 0.8 R / I = 0.0495 and e - sin e <= e^3 / 6. Numerically the worst deficit over 200000 random updates is 0.0034u.

**Lemma 2 (how the push splits).** The hub slides by lambda in [0.4118 s, s], because |rn| <= |r| <= R (a leg's horizontal projection is its hub-to-foot chord, so every contact point is within R of the hub, and 1 / (1 + R^2 / I) = 0.7 / 1.7). The victim spins by |lambda rn / I| = s |rn| / (I + rn^2) <= s / (2 sqrt I) = 0.02588 s radians, that is at most 1.48 degrees per u of separation.

**Lemma 3 (the exposed foot's radial gain).** For a foot F = c + R f with outward unit u = F / |F|,

    Delta |F| = lambda [ n . u + (rn / I) R (J f) . u ] + O(e^2 R) + O(|Delta F|^2 / |F|).

Proof. Delta F = lambda n + (Rot(e) - 1) R f = lambda n + e R J f + O(e^2 R), and |F + Delta F| - |F| = Delta F . u + O(|Delta F|^2 / |F|). The error terms are below 1e-4 u at the separations a substep produces (s <= 0.32u, see below).

The first term is the slide, the second the spin: the foot gains from the spin when the lever arm rn and (J f) . u have the same sign, and loses otherwise. Both signs are geometry, fixed over a box of poses.

## 3. What one substep of the attacker does

The attacker's points lie within 2R of P, so a substep moves any of them by at most 2R delta = 0.3225u. If a pair was touching at distance exactly D (Lemma 1 leaves it there) and the attacker's contact point advances by a along n (a = delta . dir . (J(p_A - P)) . n, the component of its rotation about P along the normal), the 3D gap closes by a hf and the solver asks for s = a hf / max(hf, 0.35) = a whenever hf >= 0.35. The cap (0.8u) can never bind, since a <= 0.3225u. So while the attacker keeps advancing into the same pair, each substep applies exactly the advance: s = a, up to eta.

Measured on 300 engine throws (random rim-biased and throw-biased poses, 16141 sampled swings): the cap fired 0 times, the horizontal-fraction floor 0 times (hf never below 0.44), the deep-crossing rule 0 times; the residual overlap after the solver was 0.0000u on every substep of every sweep checked; 264 of 293 throws involve one leg pair only from first touch to the throw; contact sits mid-leg (closest points a median 28 to 34 degrees down each leg from the hub, first to last touch), never at the feet (only 37 of 293 have both closest points in the lower third); the normal is outward, n . u >= 0.5 for 90% of throws at the last touch and 0.88 at the median; and the foot that leaves is the leg being pushed in only 5 of 293 throws: the whole piece is shoved and a different foot goes over.

## 4. The theorem

Fix the attacker's pivot P, direction dir and sweep [0, alpha*] (alpha* the closed-form swing limit). Let B be a set of victim poses (c, theta) and F the victim's exposed foot. Suppose that for every alpha in [0, alpha*] and every pose in B that touches the attacker at alpha:

- (H1) the touching pair is one tube pair with closest points interior to both tubes, hf >= 0.35, and no hub contact;
- (H2) the attacker's contact point advances into the victim: a(alpha, pose) >= a_min(alpha) > 0;
- (H3) the gain coefficient g = n . u + (rn / I) R (J f) . u satisfies g >= g_min(alpha) > 0, and rn^2 <= L^2;
- (H4) B is invariant until the throw: it contains the start pose and every pose reached from it by slides along normals of the cone that (H1) allows over B, of total length at most the attacker's total advance, together with spins of at most 0.02588 times that length.

Then the victim is thrown no later than the first alpha_T with

    sum over substeps k up to alpha_T of  a_min(alpha_k) g_min(alpha_k) / (1 + L^2 / I)  >=  EDGE - |F_0| + (number of substeps) x 0.005u.

Proof. By (H4) the pose is in B at every substep, so (H1) to (H3) hold. At the start of a substep the touching pair is at distance D (Lemma 1, from the previous substep) and the attacker's point advances a >= a_min into it, so the pair touches again with the same kind of contact (H1) and the solver applies s = a (section 3). By Lemma 3 the foot gains lambda g = a g / (1 + rn^2 / I) >= a_min g_min / (1 + L^2 / I), less the 0.005u that Lemma 1 can leave behind. Summing over substeps, |F| reaches EDGE by alpha_T. A foot past EDGE is a throw by `endTurn`.

Nothing in the proof runs the solver. The hypotheses are statements about geometry: which polyline segments of the attacker's legs at angle alpha come within D of which segments of a victim in B, from which side, and where the closest points sit. Each is an interval computation over B x [alpha, alpha + d alpha], the same kind `limitEnclosure` already does for the crossing rule.

## 5. The real throw, substep by substep

ndpxhts24 (blue to move, the dead point). Blue replies with arm (0,1) to 8 degrees. Red's best throw is arm (0,-1), limit 46.0 degrees; the engine throws blue's foot 1 at 28.0 degrees with margin 6.71u. Foot 1 starts at radius 64.02u and needs 3.15u.

| | value |
|---|---|
| substeps to the throw / in contact | 70 / 61, one tube pair (red leg 0 on blue leg 0) throughout |
| closest points | 26 to 28 degrees down red's leg; 37 sliding to 8 degrees down blue's leg |
| attacker advance a per substep | 0.072 to 0.117u, sum 5.66u |
| separation the solver applied, summed | 5.59u |
| n . u at the foot | 0.37 rising to 0.91 |
| lever arm rn | -7.9 to 0.8u; (J f) . u 0.45 to 0.52 (the spin costs gain early, then not) |
| foot radial gain, engine | sum 3.17u |
| foot radial gain, Lemma 3 formula | sum 3.18u, worst single-substep difference 0.009u |

A box of victim poses around the post-reply pose, +-1u in x and y and +-3 degrees, 150 random samples with the same red swing: 127 valid poses (the rest overlap red or have a foot off already), all 127 thrown, all by the same single tube pair, n at the hub's radial within 60 degrees throughout, worst margin 5.79u. That is (H1) to (H3) holding across a box on a sample; the theorem needs them on the whole box, which is the interval step.

With the crude uniform bounds from the table (a_min 0.072, g_min 0.37 - 7.9 x 23.1 x 0.52 / 373.4 = 0.116, L = 7.9) the theorem gives only 0.44u by 28 degrees: the early substeps, where the normal is still 68 degrees off radial, dominate a uniform bound. Split the sweep into slabs of a few degrees, as the checker would, and the bound follows the engine's 3.18u closely; and the swing runs on to 46 degrees, so the bound has 18 more degrees of push to reach 3.15u than the engine needed.

## 6. What is proved, what is assumed, what is next

Proved from the code: Lemmas 1 to 3, section 3's "one substep applies the advance", and the theorem given its hypotheses.

Assumed about the engine, measured but not proved: the solver leaves no residual overlap (0.0000u on every substep checked; it can leave up to 0.005u per Lemma 1, which the theorem already charges); a substep cannot carry the victim through a tube it is not touching (each update moves the touched point away from the tube that touches it, by at most 0.8u against a tube 2.88u across, and the deep-crossing rule exists for that case and never fired). Both can be made engine assertions so that a game which broke them would say so.

Next, in order: (a) the interval checker for (H1) to (H3) over a victim box and a sweep slab, on the polyline legs; (b) run it on the four dead points' throw arms with the boxes the dead cells already certified; (c) then a certified dead cell needs no throw simulation at all: the reply envelopes are closed form, the throws are theorem instances, and only the choice of which throw to use per reply stop remains a search.
