# A continuous local throw on defender arm (1,−)

2 October update: [the crossing and stopping certificate](ARM1-CROSSING.md)
now validates the shared response path and, for this local family, excludes a
ko violation from the enclosed displacement. This closes the rule-legality
obligation left open below in the specified real model. The full-arm cover and
floating-engine correspondence remain open. The original contact result and
its artifacts below are unchanged.

1 October 2026. **The contact enclosure now completes a nonzero interval.**
It covers all defender angles from 8° to the stored binary64 value of 8.01°,
through the entire prescribed response. The previous box propagation stopped
during contact even for a single 8° start.

This is a computer-assisted result for the specified real-arithmetic contact
model. The whole arm, crossing-rule legality and floating-engine correspondence
remain open. It is not yet a lost-position theorem for the game.

## Exact local statement

Use the stored seed and constants in the parent README. For every angle α in
the closed interval with binary64 endpoints `8.0` and `8.01`, place the defender
at the exact real rotation of its original pose about original foot 1 through
−α degrees. The attacker remains at its original pose. The earlier continuous
defender-motion certificate justifies this initial family in the real contact
model. No uncertainty in the original rounded recording is included.

Prescribe attacker foot 0, negative rotation, with attacker poses at
β_k = 0.375k degrees for k=1,…,123, each computed as a real rotation from the
original attacker pose. At each pose, apply the source-ordered contact program
with up to ten passes, using cached start-of-pass leg/hub geometry and live
defender coordinates for the correction lever arm and final hub–hub check.
Threshold comparisons and the closest-point algorithm's conditional branches
are included. Exceptional deep pushes, horizontal floors, correction caps,
degenerate divisions and hub–hub contacts must be excluded; otherwise the
computation returns unresolved.

The final radius of defender foot 1 is at least **70.4287474851884u**. The rim
threshold is at most **67.16700000000002u**. The outward-rounded lower margin is
therefore **3.2617474851883794u**. One enclosure covers this entire initial-angle
interval, including endpoints, without assuming the closest contact features
remain constant.

The complete run has 123 substeps, 214 evaluated contact maps, 136 lifted
positive-part switches, 20 closest-feature unions and one clamp switch. These
are enclosure-program counts, not the number of physical contacts on any one
trajectory. The archived final pose box is:

| Coordinate | Lower | Upper |
| --- | ---: | ---: |
| x | −30.30572554958434 | −30.304528737753873 |
| y | −45.84770898233579 | −45.84702529698255 |
| rotation, radians | 1.0504713213293788 | 1.0506137173317265 |

## How the enclosure works

The state is a zonotope `q = c + M ε`, with each noise coordinate in [−1,1].
The initial rotation uses one shared angle generator, plus outward bounds on
the second-order rotational remainder. It does not start by replacing that
curve with an independent x/y/rotation box.

`reply_jet.py` evaluates each retained branch extension using interval values,
interval first derivatives and an interval centre value. All distance exclusions
use outward bounds. Conditional closest-point branches are retained whenever
their guards permit them; the calculation never imports a nominal contact trace
as its branch list. Potential winning segment pairs can be discarded only using
a valid full-domain upper bound on the minimum and a strict lower-distance bound.
For a pair with several conditional branches, the upper bound is the maximum
over all of its branches before any distance filtering.

For the positive part p(t)=max(t,0), suppose t∈[l,u] straddles zero. Choose a
binary64 proposal a∈[0,1], and outward-bound

    E ≥ max(−a l, (1−a)u).

Then `p(t)` belongs to `a t + E/2 + (E/2)η`, η∈[−1,1]. Each such lift introduces
a shared auxiliary noise variable. This keeps the same uncertain push linked
across the x, y and rotation updates. The lifted function family is allowed to
contain unphysical extensions; its range is **not** intersected with the original
clipped range before taking derivative bounds. Such an intersection could
invalidate the mean-value argument along the auxiliary-variable paths.

For each retained smooth family F, compute a centre enclosure F(c,0), an interval
Jacobian G, and a binary64 proposal matrix J₀. The linear part propagates the
existing generators and the new auxiliary generators. A remainder encloses
`(G−J₀)` applied to those generators. Crucially, both the intermediate value
enclosures and the final remainder multiply Jacobian rows by each generator
**before** taking absolute values. This preserves cancellations between linked
translation and rotation instead of replacing them with axis-box radii.

The mean-value paths stay inside the convex input zonotope times the auxiliary
cube. Every algebraic extension's denominator, square-root and ordinary-push
guards must hold over that domain. Alternative extensions are unioned by
bounding their centre values and derivative rows. Coefficient-storage error is
added as outward axis generators. When more than 48 generators accumulate,
45 are retained and the others are enclosed by three axis generators; no
discarded uncertainty is omitted.

More explicitly, with the first three Jacobian columns for the input pose and
the remaining columns for unit-radius lifted variables, each output remainder
is bounded by

    sum over old generators m of sup |(G_i,pose − J₀_i,pose) · m|
    + sum over auxiliary columns a of sup |G_i,a − J₀_i,a|.

The proposed linear coefficients themselves are stored only after their outward
rounding error has been enclosed. The initial second-order rotation bound is
`R δ²/2` in each planar coordinate, where δ bounds the half-width in radians;
the rotation coordinate is affine in the same shared angle variable.

At a possible no-contact state, identity is retained unless a full-domain
contact bound excludes it or a full-domain candidate's clipped map already
covers identity. Hub–segment projections have that full-domain property. A
conditional segment-branch extension alone is not enough to remove identity.

All leg-pair and both directions of hub–leg contacts are processed in the source
order. Geometry remains cached within each pass; the live correction lever arm
does not. The live hub–hub exclusion is checked after the earlier corrections.
When all contact maps are excluded, further passes at the same attacker pose
are identities, so the early-exit case is covered.

## Verification and practical limits

`arm1-local-reply-cover.json` records source hashes, exact numerical endpoints,
the final bounds, and a hash of the full canonical propagation (elapsed time
excluded). `check_reply_cover.py` re-executes every covered interval and compares
the complete canonical result hash. It checks coverage and rejects a missing
cell, an altered claimed margin, and an altered propagation hash. It shares the
propagator and interval evaluator with the generator; it is not a separately
implemented formal proof checker.

`check_jet_controls.py` additionally exercises the new operations with 303
exact-rational clipping checks, 27 high-precision smooth value/derivative checks,
and 15 initial-family coordinate checks. These are implementation controls;
they are not the proof of the continuous domain.
Another 22 controls check cancellation and quadratic values for explicitly
anti-correlated generators, independently of the contact code.

`decimal_reply.py` is a separate scalar implementation using 80-digit Decimal
arithmetic, its own trigonometric series and closest-point/contact solver. It
imports none of the interval, jet or propagation implementations. The companion
checker compares all 123 substeps at the two domain endpoints and midpoint
against the continuous enclosure. These finite trajectories check consistency
with the declared real contact model; they do not establish a floating-engine
error bound or replace the interval argument.

The archived run on Python 3.12.14 passes the complete canonical replay, all
three rejection controls and all **1,107** independent 80-digit coordinate
containment checks, with zero failures. `arm1-local-validation.json` records the
runtime and artifact hashes. Independent reproduction on another machine has
not yet been performed for this new packet.

The enclosure still relies on the arithmetic platform assumptions stated in
`interval_core.py`: binary64 basic operations and sqrt, outward expansion with
nextafter, and the Taylor trigonometric bounds. This is transparent executable
mathematics, not a theorem checked in a proof assistant.

## What this does and does not finish

This closes the contact-propagation obstruction for one nonzero defender-angle
band. The attacker-rim certificate already covers the prescribed response arc.
The band is small: **0.01°**, compared with the 2°–18° geometric domain we want
to cover. No fraction of full proof completion is inferred from its width.

Still required are a cover of the remaining legal defender stops, certification
that the prescribed response is legal under the crossing and stopping rules,
and a uniform correspondence with the floating engine and chosen command
protocol. The exact-real initial family differs slightly from the floating
defender trajectory; the numerical mismatch documented in ARM1-PROGRESS.md has
not been erased by these new bounds.

The next computational task is to extend the adaptive cover, splitting at the
feature changes that make larger cells unresolved. Enlarging the cell is allowed
only when the same checks succeed; successful samples never fill a gap.
For scale, the archived attempt at [8°,8.1°] becomes unresolved at substep 72,
pass index 6, on the 1u enclosure-width exploration guard. This is a limitation
of the enclosure, not an escape or a counterexample to the proposed reply.

## Reproduce

From the repository root:

```sh
python docs/geometry-reviews/brief6-single-reply/cover_arm1_reply.py
python docs/geometry-reviews/brief6-single-reply/check_reply_cover.py
python docs/geometry-reviews/brief6-single-reply/check_jet_controls.py
python docs/geometry-reviews/brief6-single-reply/check_decimal_reply.py
```

All dependencies are Python standard library. Diagnostic and generator elapsed
times can change. Source and canonical-propagation hashes identify the checked
arithmetic. No production physics, trainer or ladder code changes.
