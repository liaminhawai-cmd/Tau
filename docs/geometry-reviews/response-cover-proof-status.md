# Response-cover proof status

**Date:** 2026-10-04  
**Branch:** `codex/rigorous-response-cover`

## What changed

This branch separates three things that had previously been mixed together:

1. sampled response-band discovery;
2. validated geometric enclosure;
3. a future formal theorem with numerical error control.

The sampled `gap-cover.js` result is explicitly not a proof. It found 135 apparent covers among 136 unresolved gaps, but the subsequent falsification corpus contradicted 25 of those 135 over engine probes. The apparent covers are therefore useful for discovering response topology only.

## Code tightening

`nn/throw-cert.js` now keeps the attacker chord attached to a parked-contact regime.

Previously, the park Jacobian re-discovered the attacker chord from the victim vertex alone. That is unsafe bookkeeping because a victim vertex can be near more than one attacker chord, while the Jacobian is a derivative of the contact map for one specific feature pair.

The research branch now:

- stores `sp.a` on each contact regime group;
- groups park regimes by attacker chord and victim vertex;
- passes that chord into `parkJacobian`;
- refuses the linearised park step unless the interval victim vertex projects strictly inside that same attacker segment over the complete box.

The change is intentionally conservative: failure falls back to the existing interval propagation rather than inventing a Jacobian for a different feature.

## Regression probe

`nn/throw-audit/park-jacobian-regime.js` replays the historical `ndpxhts24` post-reply pose and checks every sampled victim-vertex park encountered on arm `(0,-1)`.

For every selected park regime it requires the Jacobian regime attacker chord to equal the `analyse()` regime attacker chord, and requires the interval vertex projection to remain inside that segment.

This is a bookkeeping regression test, not a theorem.

## Claim-level status

| Layer | Status |
|---|---|
| Collision response law | exact algebraic rule |
| Contact-free rigid swing map | exact |
| Polyline/closest-feature geometry | exact engine-matched geometry |
| Park Jacobian formula | derived, now tied to its regime |
| Contact-regime interval enclosure | promising but not independently audited as a theorem |
| Throw endpoint bound | not yet a formal theorem |
| Response-patch cover | not implemented as a formal enclosure yet |
| Engine agreement | independent falsification only |
| Formal floating-point proof | **not yet** |

## Fundamental numerical issue

The interval functions in `throw-cert.js` use ordinary JavaScript arithmetic. They do not by themselves provide outward-rounded interval arithmetic, and `Math.sin/cos` do not provide a formal directed-rounding contract.

That is suitable for conservative empirical interval work only if some explicit numerical slack has been proved sufficient. It is not automatically a formal validated-computation system.

A formal certificate therefore needs one of:

- directed-rounding interval primitives for every endpoint operation, including safe transcendental bounds;
- a separately proved floating-point error budget that inflates every interval endpoint enough to dominate rounding and elementary-function error;
- an independent arbitrary/high-precision validated arithmetic implementation that reproduces the enclosure.

Until one of those exists, the right claim is:

> mathematically derived enclosure in a real-arithmetic model, numerically falsification-tested

not:

> machine-verified theorem.

## Remaining physics obligations

### 1. Newton residual / Hessian bound

The code uses `eta = M p^2 / (2 m^2)` from the Newton-step interpretation of the contact projection. The exact expression in `hessBound()` needs a written derivation from the three-dimensional closest-feature map, including the endpoint-clamped cases. Testing that it is conservative is not enough.

### 2. Gauss-Seidel accumulation

The engine may perform several pushes in one substep, with the normal and lever arm changing after each push.

The enclosure represents the total displacement as `Lambda a_c + v`, with `Lambda >= 0` and `v` bounded by the contact-normal cone. The representation is plausible, but the theorem needs an explicit proof that the cone and scalar bounds cover every sequence of nonnegative Gauss-Seidel pushes, including differing iteration counts and feature branches.

### 3. Response tube

A response patch needs the joint post-reply family `L(s)` enclosed directly as a one-dimensional tube. Turning it into an axis-aligned 6-D box loses the key correlation between the attacker's exact swing and the victim's response.

For a contact-free reply, `L(s)` is exactly a rigid one-parameter curve, so this is the cleanest first implementation target.

For a pushing reply, the tube must carry the same contact-regime branching used by `throw-cert`, but now with the reply parameter as the independent coordinate.

## Next proof experiment

The correct first experiment is:

**contact-free response patch → fixed attacker throw witness → validated one-dimensional tube → throw enclosure.**

No sampled sliver acceptance. No empirical Lipschitz multiplier. No engine probe as part of the proof.

Once one complete interval closes this way, subdivide only at actual event boundaries and cover one complete reply arm. Then do all six arms of a dead point. Only after that return to recursive WIN(3)/LOST(4).

## Current branch commits

- `697a8e9` — response-patch mathematical specification
- `048c246` — bind park Jacobian to its regime chord
- `ed4511d` — expose Jacobian for the audit probe
- `f12570b` — park-Jacobian regime regression probe

## Additional Newton-step obligation

There is a subtle domain condition behind

eta = M p^2 / (2 m^2).

Taylor's theorem applies along the segment joining the pre-push pose to the corrected pose. Therefore the quoted M must bound the Hessian throughout that entire segment, not merely at the pre-push set.

The current implementation computes M from the pre-contact geometry and later refreshes it using pre/post summaries during the fixed-point rounds. That may be sufficient, but the written proof still needs the missing lemma:

> every Newton correction used by the enclosure remains inside a domain on which the same active feature branch is valid and the stated Hessian bound controls the Hessian.

A clean proof would bound the correction length by p/m, enlarge the feature-domain box by that amount, and show the active chord pair, endpoint regime, and nonzero-distance lower bound survive on the enlarged domain. If the enlarged domain crosses a feature wall, the step must branch rather than reuse the single-branch Hessian bound.

This is precisely the kind of issue that can make a numerically stable enclosure look rigorous while leaving a gap in the proof.

## Therefore

The research branch currently has a stronger and cleaner implementation than the historical checker, but it is not yet entitled to the word theorem. The right standard is to close the analytic lemmas first, then add directed/validated arithmetic, then run the engine falsification suite as an independent correspondence check.

## Contact-regime key correction

A second regime-separation issue was found during audit.

The propagation loop previously grouped `segPairs` using attacker chord `a`, victim vertex `vk`, and normal azimuth. That is insufficient for ordinary interior/interior closest-point contacts: two distinct victim chords `b` can have similar normal azimuth while defining different closest-feature maps and different derivatives.

The branch now uses attacker chord `a`, victim chord `b`, and normal azimuth for ordinary contacts. A parked victim vertex uses `(a, vertex vk)` because the vertex itself is the active feature and its incident chord is not part of the point-contact derivative.

This is a conservative split: it can increase the number of states, but it cannot manufacture a contact regime by merging two different closest-feature maps.

The commit implementing this is `e3282f9`.

The invariant the eventual proof should state explicitly is:

> every propagated state is associated with one fixed closest-feature branch, and no state is allowed to cross a feature boundary without subdivision.

## Exact chord-feature walls

For two fixed chord pieces A(s)=A0+s uA and V(t)=V0+t uV, write
A = uA·uA, E = uV·uV, B = uA·uV, C = uA·(A0-V0), F = uV·(A0-V0).
For nonparallel chords, Delta = A E - B^2 > 0, and the unconstrained closest-point parameters are
  s* = (B F - C E) / Delta,    t* = (A F - B C) / Delta.

The exact feature walls are the four zero sets:
  B F - C E = 0,
  B F - C E - Delta = 0,
  A F - B C = 0,
  A F - B C - Delta = 0.

An interior/interior feature regime is precisely
  0 < B F - C E < Delta,
  0 < A F - B C < Delta.

A wall-crossing is therefore a sign change of one of these four scalar functions. For a rigid one-parameter reply family these become one-variable trigonometric functions, so interval subdivision can be driven by their signs.

### Consequence for the proof architecture

For each proposed response patch we should carry four feature margins for every active chord pair. If an interval enclosure proves all four have a strict common sign, the closest-point feature cannot change inside that patch. If any margin enclosure contains zero, the patch must be subdivided or split into the adjacent endpoint/vertex regime.

This is stronger than the existing dmax drift test. The existing test is a useful conservative localisation lemma, but it should not be treated as the final feature-wall certificate until its drift bound is independently derived and checked against the exact parameter margins above.

The next implementation step is to expose these four margins from the geometry layer and make them first-class branch conditions in the response-cover validator.
