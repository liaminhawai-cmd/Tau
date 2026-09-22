# Covering nearly tied contact features

22 September 2026. This addresses branch coverage within the conditional floating-point budget; it does not yet bound the engine's arithmetic.

## Result

On all 380 input boxes of the successful disturbed enclosure, every exact closest-point feature of every leg-(1,0) segment pair whose distance is within **2e-6u of the true leg-pair minimum** is either:

- already represented by a branch image in that enclosure; or
- excluded by a uniform distance gap strictly greater than 2e-6u.

The second alternative is a proof step: after excluding it, every genuinely near-minimum feature is represented. No extra branch images or enlarged reachable sets are needed for this target. The same check also passes at 2e-9u.

| Check | Result |
| --- | ---: |
| Enlarged pass input boxes checked | 380 |
| Dominated branch occurrences excluded by strict gap | 60 |
| Smallest such distance gap | 1.1563511855528839e-5u |
| Passes whose existing enclosure retains multiple branches | 10 |
| Unresolved near-minimum features | 0 |

The counts refer to branch occurrences across passes, not distinct global features. The minimum gap is attained at k111, iteration 0, for branch (5,4,-1,0). This is a uniform bound over that input box, not a sampled distance difference.

## Why the near-minimum enumeration covers the right set

Let d_*(z) be the true minimum between the two polylines at state z, and let U be an interval upper bound on the distance of a FEASIBLE pair of points, one on each polyline. Then d_*(z)<=U throughout the box.

A segment pair that could satisfy d_pair(z)<=d_*(z)+tau must therefore satisfy d_pair(z)<=U+tau somewhere in the box. `candidates(row, box, distance_slack=tau)` uses U+tau for its distance rejection tests. It still enumerates all nine exact endpoint/interior active sets and excludes only those ruled out by interval feasibility or KKT conditions. Thus this is an outer cover, not an exact list of near ties. The code now checks that the recorded witness fractions lie in [0,1].

For some surviving shared-endpoint competitors, the earlier dominance identity gives

    d_other^2 - d_selected^2 >= gamma > 0.

If S bounds d_other+d_selected from above, then

    d_other-d_selected >= gamma/S.

`selection_cover.py` evaluates this quotient outwardly. Only gaps strictly greater than tau are removed. Since d_selected>=d_*, such a competitor is also more than tau above the global minimum. Every remaining branch must already appear in the disturbed enclosure's recorded image union; otherwise the audit reports unresolved.

The extension to `branch_bounds.py` adds an optional nonnegative distance slack. Its default is zero and leaves the existing geometric calculation unchanged for valid inputs. It does not change game or search code.

## The approximate-minimizer bridge

Suppose the segment-pair distance estimates satisfy

    |d_hat_i-d_i| <= delta

for all eligible pairs, and the selection procedure returns an index j with smallest estimate. If i_* minimizes the true distances, then

    d_j <= d_hat_j+delta
        <= d_hat_i_*+delta
        <= d_*+2 delta.

Therefore a 2e-6 cover is sufficient for selection error delta<=1e-6, PROVIDED the true best pair was not unsafely pruned and returned segment distances meet those error bounds. Exact ranking of nearly tied pairs is unnecessary. This is a useful proof simplification: verify an approximate minimum, then use the existing branch union.

These constants are sufficient conditional targets, not established engine errors. In particular, the earlier local correction allocation uses much smaller penetration/gradient errors (1e-9); the looser selection allowance does not relax those requirements.

## What this does and does not settle

The exact-real dominance exclusions are now protected by explicit margins large enough for the stated near-minimum tolerance. The ten multi-feature passes remain covered without forcing a single branch across a transition.

The audit does NOT yet establish that the engine computes accurate segment-pair minima. `segClosest3` has arithmetic, clamping and denominator fallback paths. Its returned point and normal must be linked to an exact covered segment minimizer, with the local correction error bounded separately. Small distance error alone does not bound contact-normal or lever-arm error.

Likewise, the engine uses geometric pruning and a strict contact cutoff. The approximate-minimizer lemma assumes no unsafe loss of the true best pair. False-negative contact/early exit, falsely admitted contacts, pruning, and choices among other leg/hub pairs remain separate obligations. The real other-contact exclusions are already positive but their floating implementations still require error bounds.

The next narrow target is an interval error analysis of `segClosest3` on these domains, including its denominator and clamp decisions, followed by the bounding-sphere and flat-chord pruning tests. Runtime transcendental bounds and terminal evaluation are also still open. No full floating-engine certificate or dead region is claimed here.

## Reproduce

```sh
python docs/geometry-reviews/arm2-propagation/selection_cover.py 2e-9
python docs/geometry-reviews/arm2-propagation/selection_cover.py 2e-6
```

The outputs contain all 380 per-pass candidate covers, distance-gap exclusions and unresolved lists. Each pins the exact disturbed enclosure bytes with SHA-256. If that source is regenerated, timing/formatting can change its byte hash; compare numerical contents separately. The archived propagation and its four canonical fingerprints remain unchanged.
