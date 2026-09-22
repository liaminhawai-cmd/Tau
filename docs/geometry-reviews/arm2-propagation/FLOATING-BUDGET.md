# A quantitative target for floating-point correspondence

22 September 2026. This advances the remaining numerical obligation without claiming to finish it.

## New result

The composed local real-map throw survives an arbitrary coordinate disturbance of at most **1e-8u in each mass coordinate after every one of 380 passes**, including inactive passes. Here z=(x,y,sqrt(I) theta); the third tolerance is a scaled angular error, not 1e-8 radians. The disturbed enclosure retains a final exposed-foot radius lower bound **67.19296212818695u**, exceeding the edge upper bound by **0.025962128186932883u**.

`robustness.py` reuses the existing interval geometry, adds the disturbance cube at every pass, and recomputes branch candidates, ordinary-push guards and other-contact exclusions on the enlarged sets. All 380 passes and 454 exclusion checks complete. It does not merely subtract 380 errors from the old final margin.

| Run | Passes completed | Clearance lower (u) | Interpretation |
| --- | ---: | ---: | --- |
| Original unmodified propagation | 380 | 0.03513881297003251 | Archived real-map enclosure |
| Robustness wrapper, zero disturbance | 380 | 0.030356860428611295 | Additional repacking/reduction is conservative but looser |
| Disturbance 1e-8 per coordinate/pass | 380 | 0.025962128186932883 | Conditional disturbed-map throw established |
| Disturbance 1e-7 per coordinate/pass | 378 | Not a completed throw bound | Exploration radius exceeded at k112, iteration 8 |

The zero control differs because the wrapper calls `pack` again, which can change generator reduction and future interval widths even at zero added disturbance. These changes are enclosure conservatism, not measured physical sensitivity. The failed larger run is not an escape witness, an upper bound on robustness, or proof that 1e-8 is optimal.

## Exact disturbance theorem

Let F_j be the stated real contact/no-contact map at pass j, including the guarded feature alternatives already covered by the enclosure. Suppose a sequence satisfies

    z_(j+1) = F_j(z_j) + e_j,   |e_(j,i)| <= epsilon, i=1,2,3.

If Z_j contains z_j and the existing branch enclosure contains F_j(Z_j), then its Minkowski sum with [-epsilon,epsilon]^3 contains z_(j+1). Induction through 380 passes gives the computed final set. The code adds this cube through three outward-rounded axis generators. Branch-image unions and generator reduction remain outer enclosures. No independence or randomness of errors is assumed; errors may depend adversarially on prior states.

The first 74 substeps remain exact free motion of the victim in this conditional model. The attacker still follows the fixed recorded poses. This result does not budget errors in the attacker path, starting pose, contact discovery or early free-motion decisions.

## A sharper local error lemma

For nonzero vectors a,b, inversion in the unit sphere obeys the EXACT identity

    ||a/||a||^2 - b/||b||^2|| = ||a-b|| / (||a|| ||b||).

Square both sides: the left becomes 1/||a||^2 + 1/||b||^2 - 2(a dot b)/(||a||^2 ||b||^2), which is the right squared.

For the ordinary contact map write

    F(z) = z + p_+ h(g),  p=D-d(z),  g=gradient d(z),
    h(g)=g/||g||^2,  p_+=max(p,0).

Suppose at the SAME input state and for a covered smooth branch:

    ||g|| >= m > 0,
    |p_tilde-p| <= delta,
    ||g_tilde-g|| <= eta < m,
    computed output = z + (p_tilde)_+ h(g_tilde) + r,
    ||r|| <= rho.

Then the local output error in Euclidean mass norm is at most

    delta/(m-eta) + p_+ eta/[m(m-eta)] + rho.

Proof: positive part is 1-Lipschitz; ||g_tilde|| >= m-eta; split the correction difference into the scalar error times h(g_tilde), plus p_+ times the inversion difference, then add r. This handles a roundoff-induced active/inactive switch through the scalar error. No Hessian or same-sign penetration assumption is needed for this local lemma.

On the successful disturbed enclosure, all active branch records have m >= 1.163218842254502 and p <= 0.14481296702833737. Conservatively choose m=1.16 and p_+<=0.15. IF a runtime proof establishes delta<=1e-9, eta<=1e-9 and rho<=1e-9 in the quantities above, then the formula is less than 2e-9u. This Euclidean bound implies each coordinate is below the demonstrated 1e-8 budget. These are proposed sufficient error allocations, NOT measured or proved engine-error bounds. The stored `budget-allocation.json` evaluates the expression outwardly.

For purely inactive regions use the identity map directly. If finite arithmetic makes a false contact, it still needs a local error bound; the active-branch m minimum above must not be silently extended to unrecorded inactive branches.

## What must still be established for the engine

1. **Geometry and closest-point calculations.** Bound errors in constructed vertices, sin/cos, dot products, the segment denominator, clamping, contact points and distance. The engine does not compute g and h symbolically: convert its normal/lever-arm expressions into the lemma's quantities and include arithmetic evaluation error in rho. A runtime-specific transcendental bound is needed; the two-runtime replay is not such a bound.
2. **Branch selection.** The current candidates and shared-endpoint dominance are exact real-geometry tests. A floating comparator may choose a nearly tied alternative that exact dominance discards. Either prove robust selection margins or enlarge the branch cover and show a selected-alternative correction stays within the disturbance budget. The inversion lemma cannot excuse an unbounded jump between two distinct branches.
3. **Pruning and exceptional guards.** Audit `segClosest3`'s 1e-12 denominator/fallback, `arcClosest`'s sphere pruning and strict distance ordering, flat-chord gates, piece early returns, deep-contact/horizontal-floor/cap guards, and hub tests. A comment saying a skip has slack is not a verified error bound. The positive real exclusion margins help but must be compared with computed-distance errors.
4. **Early solver exit.** Pad an actual stopped solve to ten passes only after showing the repeated unchanged state remains within the local disturbance relation. A false-negative near-zero contact can be covered by the scalar-error lemma when its hypotheses hold; a larger missed push cannot.
5. **Terminal and input correspondence.** Establish the initial binary state is in the initial box and that the prescribed attacker command sequence is legal with the recorded poses on the targeted runtime. Bound terminal foot evaluation error below the remaining 0.02596u margin. A portability theorem for every runtime is separate from a certificate for a pinned runtime.

This is a new conditional robustness result and a concrete local error theorem. It is not yet a floating-engine certificate, all-reply cover, or six-dimensional dead region.

## Reproduce

From a checkout containing the existing source-pinned trace and attacker path:

```sh
python docs/geometry-reviews/arm2-propagation/robustness.py 0
python docs/geometry-reviews/arm2-propagation/robustness.py 1e-8
python docs/geometry-reviews/arm2-propagation/robustness.py 1e-7
python docs/geometry-reviews/arm2-propagation/check_budget.py
```

The larger-disturbance run intentionally exits 1 because it is unresolved. Summary results are in `robustness-summary.json`; the full successful pass/exclusion log is in `robustness-1e-08.json`. Generated timing fields can vary. The original propagation artifacts and their canonical fingerprints are unchanged.
