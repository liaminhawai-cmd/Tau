# Closing the last two arm-2 input boxes

21 September 2026. This supplements the [36-box result](README.md) and closes its k111–112 input-domain gaps. **All 38 independently proposed FIRST-correction input boxes now have uniform distance-gradient and Hessian bounds.** This is not a propagated tube or a throw certificate.

## The missing relationship

At k111 the selected pair is attacker chord 4 / victim chord 4. The only retained competitor is attacker chord 5's starting endpoint against victim chord 4. That endpoint is already the END of attacker chord 4.

At k112 the selected pair is attacker chord 5 / victim chord 4. The retained competitor is attacker chord 4's ending endpoint against victim chord 4, which is already the START of attacker chord 5.

For each entire input box, interval checks establish that the selected pair has a strictly interior/interior, nonparallel closest pair. Therefore its minimum is strictly closer than forcing the attacker contact onto that shared endpoint. Comparing independent distance intervals obscured this relationship.

## Quantitative dominance lemma

Let a,b be unit directions of two chords and c=a dot b, with 1-c^2>0. Write their squared point-pair distance as

    Q(s,t) = ||r + t b - s a||^2.

Suppose the unconstrained minimizer (s*,t*) is strictly inside both segments. Then stationarity and completing the square give

    Q(s,t) = Q(s*,t*)
             + (1-c^2)(s-s*)^2
             + [(t-t*)-c(s-s*)]^2.

If a competing branch fixes the attacker point to a shared endpoint s=e while keeping the same victim chord,

    Q(e,t) - Q(s*,t*) >= (1-c^2)(e-s*)^2.

This holds for every victim parameter t, including endpoints. With interval lower bounds on 1-c^2 and |e-s*|, it supplies a strict uniform dominance margin.

The proof is specific to an actually shared endpoint and the SAME opposing chord. The implementation does not discard a different interior/interior competitor or a different victim chord using this argument.

## Verified margins and bounds

Chord indices are zero based. The boxes are the original independently proposed neighborhoods: xy half-width 0.0002u, rotation half-width 0.002 degrees, around each recorded first-correction input.

| Quantity | k111 | k112 |
| --- | ---: | ---: |
| Selected attacker/victim chord | 4 / 4 | 5 / 4 |
| Lower bound on 1-c^2 | 0.8647331709 | 0.9403925982 |
| Lower distance along selected chord to shared endpoint | 0.0186776787u | 0.0032033415u |
| Lower squared-distance advantage | 0.00030166707999u^2 | 0.000009649741787u^2 |
| Gradient norm lower | 1.2006122872 | 1.2059810118 |
| Gradient norm upper | 1.2007886257 | 1.2061687676 |
| Hessian spectral-norm upper | 0.033926764553 | 0.035560704930 |

Use the full outward-rounded endpoints in dominance-bounds.json for computation, not rounded display values.

All 144 chord pairs and their endpoint/interior regimes are covered by the candidate enumeration. After geometric exclusions, the only additional candidate in each box is the shared endpoint above. Removing it by strict dominance leaves one smooth selected distance branch across the whole box.

Combined with the preceding 36-box calculation, conservative common constants in mass coordinates are:

    m = 1.1632
    G = 1.2062
    B = 0.035561

The curvature bound rises slightly to include chord 5 at k112. The different selected chords at k111 and k112 do not imply that either INPUT box itself crosses a feature boundary.

## Reproduction

Regenerate the updated source-pinned trace as described in README.md, then run:

    python branch_bounds.py ../contact-map/trace.json
    python dominance_bounds.py ../contact-map/trace.json
    python check_dominance.py ../contact-map/trace.json

branch_bounds.py conservatively retains and differentiates every possible closest-feature formula in the two boxes; its branch-bounds.json is exploratory and does not claim a smooth minimum across all retained branches. dominance_bounds.py supplies the missing exact comparison and writes the combined result.

check_dominance.py independently evaluates the endpoint/interior squared-distance difference at the nominal centres and checks enclosure agreement with the completed-square identity. This is a consistency check; the symbolic identity plus interval guards establish the uniform result.

## Remaining proof obligations

This closes the two previously unresolved input boxes only. It does not close the twelve larger correction-hull boxes, propagate the initial region, bound all 140 internal corrections, prove exclusions for other leg/hub contacts, handle every solver stopping state, or establish floating-point correspondence.

The next mathematical target is a composed enclosure through all internal corrections, using verified input domains and the activation-aware map. If that closes and all terminals are verified, it establishes a local throw result. All-reply coverage is still needed to prove a dead region.
