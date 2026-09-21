# Arm-2 derivative bounds and the contact/no-contact boundary

21 September 2026. Continuation of the [full contact-map lemma](../contact-map/README.md).
This package adds outward-rounded local geometry bounds and an activation-aware enclosure lemma. It does not certify the complete throw or a dead region.

## Main result

For the first correction at each of the 38 contact-bearing substeps k75–112, construct a proposed input box centred on the recorded pre-correction pose, with half-widths 0.0002u in x/y and 0.002 DEGREES in rotation. These are independently proposed local boxes, not a propagated reachable tube.

Outward-rounded branch checks and second-order interval differentiation establish:

| Domain | Boxes fully bounded | Common gradient lower m | Common gradient upper G | Common Hessian norm upper B |
| --- | ---: | ---: | ---: | ---: |
| Input neighborhood | 36/38 | 1.1632188422555858 | 1.2005528076942749 | 0.033697844500897474 |
| Hull of nominal before/after correction, plus those half-widths | 26/38 | 1.1631075785495952 | 1.2000518897900179 | 0.033299263140784935 |

The constants apply to the bounded boxes only, in mass coordinates z=(x,y,sqrt(I) theta). For conservative rounded use, take m=1.1632, G=1.2006, B=0.03370 for the input boxes.

All input boxes k75–110 pass. k111–112 remain unresolved because competing chord bounds cannot be separated. No claim is made that those boxes are actually nonsmooth everywhere or impossible to certify.

The correction-hull boxes that pass are k75 and k83–107. k79, k111 and k112 fail the single-interior-branch guard; the other failures retain competing chord possibilities. The original coarse calculation passed nine hulls; subdivision raised that to 26.

## What is verified

The attacker pose is fixed at its recorded substep pose. The distance is the minimum over all 144 chord pairs of attacker leg 1 and victim leg 0. The calculation verifies that one chosen chord pair stays strictly interior/interior and wins against every other pair throughout each accepted box.

For its unit chord directions a,b and relative starting-point vector w:

    n = (a cross b) / ||a cross b||,
    d = signed w dot n,

with sign chosen uniformly to make distance positive. The infinite-line distance equals the segment distance only after the interior projection guards pass.

Second-order interval automatic differentiation bounds gradient and Hessian of this explicit formula. Since n depends only on theta, d is affine in x,y. Its mass-coordinate Hessian has the exact structure

    H = [[0,0,A], [0,0,B], [A,B,C]].

Its spectral norm is (|C| + sqrt(C^2+4(A^2+B^2)))/2. The implementation encloses this expression, rather than using a generic sum of absolute Hessian entries.

Competitor exclusions enumerate all nine endpoint/interior active sets per competing chord pair, retaining every branch not ruled out by interval projection/KKT conditions. A conservative axis-box distance test skips pairs already farther away. Subdivision is limited to depth nine; failure is reported as unresolved.

The interval arithmetic uses outward nextafter rounding and Taylor bounds for sin/cos. The constants R and I are the source's recorded binary64 values treated as real constants. This is a real-geometry calculation; it does not bound the engine's complete floating-point execution.

No other leg pair, hub interaction, floor/cap/deep branch, solver stopping decision or reachable-set inclusion is established by this package.

## Why the 36-box result matters more than the 26-box result

The derivative of ONE correction F(z) depends on the feature selected at its INPUT. The same feature need not remain closest throughout the displacement produced by F.

Thus, for a centred image bound using DF along segments between uncertain INPUTS, the input-neighborhood proof is the relevant one. A feature change during the correction does not, by itself, invalidate that image bound: the next solver pass can choose a different feature.

By contrast, using Taylor's theorem to claim a residual for the SAME distance branch at the OUTPUT requires validity along the correction segment, or an explicit treatment of branch changes. This is what the larger correction-hull check tests.

Do not require one chord pair to last through the entire throw. Do not use the input-only bound to justify a same-branch residual across an unverified correction path.

## New lemma: handle contact activation without injecting constant width

The previous centred projection bound assumed that every input uses the active correction. Late solver passes can contain both touching and non-touching inputs.

On a smooth valid distance branch with g=gradient d, s=||g||^2>0, write

    p(z)=D-d(z),   h(z)=g(z)/s(z),
    Fplus(z)=z + max(p(z),0) h(z).

This includes the no-contact branch. Let zc be the centre, pc=p(zc), gc=g(zc), hc=gc/||gc||^2, and ||e||<=r. Suppose the convex input domain has

    ||g|| >= m > 0,    ||g|| <= G,    ||Hessian d|| <= B.

Define the clipped linear model

    Lc(e) = e + [max(pc-gc dot e,0)-max(pc,0)] hc.

Then

    Fplus(zc+e)-Fplus(zc) belongs to Lc(e) + Ball(E(r)),

where

    E(r) = B r^2/(2 ||gc||)
           + max(0,pc+G r) B r/m^2.

Proof:
1. Taylor's theorem gives |p(zc+e)-(pc-gc dot e)| <= B r^2/2.
2. The positive-part function is 1-Lipschitz.
3. Dh=(Id-2uu^T)Hessian(d)/s, so ||Dh|| <= B/m^2.
4. Decompose the error into the positive-part scalar error times hc, plus max(p(zc+e),0)[h(zc+e)-hc]. Bound the two terms separately.

At pc=0, Lc is exactly the orthogonal projection onto the tangent half-space gc dot e >= 0: it leaves outward errors unchanged and removes the inward normal component. The error is quadratic in r. At any pc, E(0)=0. This avoids adding fixed shell slack when an uncertain set straddles contact activation.

This is a conditional real-arithmetic lemma. It does not cover the engine's early-return horizontal threshold, cap, deep rule or different contact branch without guards. It also does not select the finite solver's iteration count. Keep actual stop/continue states separate or verify that an overapproximation contains every possible count.

For scale only: the proposed input box has mass-radius approximately 0.0007314u. Combining the recorded maximum centre penetration with the hull constants in the earlier active-only formula gives a remainder around 2.52e-6u. This is an illustrative substitution, not a bound on the composed trajectory or its floating-point errors.

## Reproduction and validation

First regenerate the source-pinned trace using the UPDATED trace.js, which now records each correction's before AND after pose:

    node ../contact-map/trace.js /path/to/pinned/Tau
    python check_jets.py
    python bounds.py ../contact-map/trace.json --input-only
    python bounds.py ../contact-map/trace.json

The pinned source and initial pose are documented in ../contact-map/source-loader.js. Raw traces are regenerated; bounds.json and input-bounds.json record all proposed domains, accepted bounds, subdivision counts and unresolved reasons.

check_jets.py checks product, chain, reciprocal, square-root and mixed-Hessian identities against known expressions. The earlier independent Node finite-difference check also records nominal gradient/Hessian norms; these diagnostics do not replace the interval calculations.

## What to do next

1. Treat k111–112 with explicit attacker-vertex / adjacent-chord branches, or tighter verified competitor bounds. Do not widen tolerances until the check passes.
2. Use input-domain derivative bounds and the activation-aware map to propagate actual uncertainty through EVERY internal correction, not only each substep's first correction.
3. Establish exclusions/branches for every other contact and the actual finite solver's cached geometry and termination rules.
4. Verify that the propagated sets stay inside their proposed input domains, account for numerical execution, and verify all terminals.
5. Only after a local throw certificate is complete, cover every legal defender reply and vary both pieces to prove a dead region.

The new results remove an unknown uniform-derivative assumption on 36 specified input neighborhoods. They do not remove the remaining trajectory, branch and engine-correspondence obligations.
