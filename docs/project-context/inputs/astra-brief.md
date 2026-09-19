# Two questions about a rigid-body contact law (self-contained)

## The objects

Two identical *tripods* on a horizontal plane. A tripod is a hub at height **H = 23.095** above the plane with three legs at 120° intervals. Each leg is a **quarter-circle arc of radius R = 23.095 = H** in the vertical plane through the hub axis and the foot: a point on the leg at parameter φ ∈ [0, π/2] is at horizontal distance s = R sin φ from the hub axis and height h = H cos φ (φ = 0 the hub, φ = π/2 the foot on the plane). Legs are tubes of radius **ρ = 1.44**; the hub is a ball of radius 1.9ρ. A pose is (x, y, θ): hub position and the direction of leg 0; feet are at hub + R(cos(θ + 2πk/3), sin(θ + 2πk/3)). (In the simulation the arcs are polylines of 12 chords, chord sag ≈ 0.05; the normals jump at the vertices.)

The plane is a disc of radius **E = 66.667** centred at the origin. A **throw** is any foot of the pushed tripod at radius > E + 0.5 at any instant.

## The law

The **mover** rotates rigidly about one of its own feet (the pivot) by an angle α that increases monotonically. Contact never stops it; the swing ends at α_end, which is set by the mover's own rules (its feet may not leave the disc, and may cross at most one printed line per move) — a function of the mover's initial pose and pivot only. The **pushed** tripod is a free planar rigid body (translation (x, y), rotation θ) with mass m = 1 and moment of inertia **I = 0.7 R²** about its hub. The constraints are: every leg-tube pair at distance ≥ 2ρ, every hub–leg pair ≥ 2.9ρ, hub–hub ≥ 3.8ρ (horizontal). After each small increment of α the pushed tripod is projected back onto the constraint set by sequential position projections, one contact at a time; for a **single** contact the projection is exactly the least motion in the metric m|v|² + I ω² (Gauss's principle) and is closed form: with the 3-D contact normal n₃ (unit, from the mover's contact point to the pushed tripod's), its horizontal unit part n and horizontal fraction hf = |n₃ₓᵧ|, the pushed tripod's contact point b, r = b − hub, and the lever arm rn = r × n:

  slide = λ n / m, spin = λ rn / I, λ = (gap / hf) / (1/m + rn² / I),

where gap is the current penetration. A hub–hub contact acts at the hub (rn = 0, pure slide). Contacts are frictionless (no tangential force) and there is no restitution (the pushed tripod stops when the push stops); the contact points slide along both legs during a push (measured: the angle between the legs changes 17° at the median over a push). The simulation adds three guards: the horizontal fraction is floored at **hf ≥ 0.35** (so 1/hf ≤ 2.86; contacts with hf < 10⁻⁴ are dropped), the demanded horizontal separation gap/hf is capped at 0.8 per contact per iteration, and tube centrelines closer than 0.3 are shoved apart perpendicular to the mover's leg. None of the three fired in 200 sampled swings.

**Validation.** A continuous version of the law (0.1° steps, 24-chord legs, no guards) reproduces the simulation's pushed pose over 200 recorded swings to a median 0.6% of the push (p90 3.5%; worst 0.63 in position, 1.15° in rotation), with every throw agreed (24/24). The remaining difference is attributable to the simulation's 12-chord legs and 0.4° step. **The certified object is the simulation's version** (guards on, 12 chords, 0.4° steps); questions may be answered for the continuous law if the difference is stated.

So a swing defines a map **F: (initial pose of the pushed tripod, initial pose of the mover, pivot, direction) → pose of the pushed tripod at α**, piecewise smooth; the pushed tripod is stationary until first contact. Define the **throw margin** of a swing as M = (max over α ∈ [0, α_end] of the max foot radius of the pushed tripod) − (E + 0.5); M > 0 iff the swing throws.

## How the margin is currently used (what a theorem has to replace)

Regions of poses are certified as "thrown" or "not thrown" from a grid of samples: with grid spacing h along each of x, y and Rθ, the steepest finite difference between axis-neighbours is taken, L̂ = max(1, 3 × that), and every sample's margin must exceed L̂ × (half the Euclidean cell diagonal in (x, y, Rθ)). Samples must also share a *contact signature* (the deepest leg pair at each step, and the angle of first touch within 5°), which is meant to keep grazing surfaces out of a cell; hub contacts and secondary pairs are invisible to that signature. Along a one-parameter family of the pushed tripod's own moves (it moves, the other tripod then swings), the same rule is applied with the pushed tripod's rigid displacement 2R·Δα as the distance, although both poses vary along the family.

## Question 1 — regularity of the margin

(a) As a function of the pushed tripod's initial pose q = (x, y, θ), with the other tripod's pose, pivot and direction fixed: where is M continuous and where does it jump? (Conjecture: only across grazing surfaces — poses where the swept mover tube is tangent to a pushed tube, so a contact appears or disappears — and where the contact sequence changes.)

(b) On a region with a fixed contact sequence, a **rigorous bound on the gradient of M** in Euclidean (x, y, Rθ), in terms of R, ρ, I, α_end and hf ≥ 0.35 — or a proof that no such bound holds and where it fails. What would justify the "3 × observed finite difference" rule is a curvature-type bound: a constant κ such that sup over a cell of |∇M| ≤ (observed finite difference) + κh. Empirically, under the continuous law, the finite-difference slope of M is 0.4 at the median, 0.85 at the 90th percentile, up to ≈ 9 at the extreme (units: margin per unit of Euclidean distance in (x, y, Rθ)).

(c) The same for F (the pushed pose at the end of the swing), so that a box of initial poses can be carried through a push as a box.

(d) The dependence of M on the **mover's** initial pose and pivot, composed with F: along a family of the pushed tripod's own moves both poses change, and the current rule counts only the pushed tripod's rigid displacement.

## Question 2 — the swept walls

Let D ⊂ ℝ² × S¹ be an axis-aligned box of poses of tripod A, with tripod B fixed and not touching A. For a foot k of A and a direction, let T be the set of poses p such that: p is q rotated about its own foot k by −s for some q ∈ D and some s ≥ 2° (0.035 rad); rotating p forward about that foot by s is a legal swing from p (its α_end, a property of p, is ≥ s); and A touches nothing during that forward swing. Give the **envelope surfaces** bounding T in closed form or as explicit parametrised surfaces, and a membership test that avoids sampling. Note that rotating a pose about *its own* foot is a pose-dependent rigid motion.

## What is wanted

Proofs or derivations, not code. Where a bound is loose, say so and give the tight constant where possible. Where a claim cannot hold, a counterexample in the geometry above (a specific pair of poses) is as valuable as a proof.
