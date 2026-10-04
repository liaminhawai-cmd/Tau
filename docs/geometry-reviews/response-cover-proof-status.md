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
