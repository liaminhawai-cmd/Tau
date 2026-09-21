# Full contact-map bound and arm-2 implementation target

21 September 2026. This is a mathematical lemma plus nominal diagnostics, **not a new dead-region certificate**.

## Source and reproduction

The numerical replay pins the six source blobs in source-loader.js, from research commit 18efad5398798b65b477f9af4be17947a358d3ce. The research branch head checked today was 4c94c1f29f5d3b125f770f43b54fa0825b5c4f80; its throw-cert.js blob is still e321f0ab70e729874f61d5dba17b30959ea38ae7. The full dependency set is pinned to the earlier commit; do not infer that all current dependencies were audited.

With that source checkout available separately:

    node trace.js /path/to/pinned/Tau
    node jacobian-check.js /path/to/pinned/Tau

trace.js regenerates trace.json and trace-summary.json. The numerical derivative check reads trace.json. No game/search rules are edited. Source hashes are checked before either run.

The initial position is the exact **post-blue-8-degree-reply pose** from Brief 6, not the original seed. The attacker is piece 1, arm (2,-1).

## 1. Exact form of one ordinary correction

Use mass-scaled coordinates z=(x,y,sqrt(I) theta). Keep the attacker fixed for one correction. Let d(z) be the distance of the active closest-feature branch, D the contact distance, p=D-d, g=gradient d, s=g^T g and u=g/sqrt(s).

Assume a smooth, freshly computed closest-feature branch, positive distance, positive penetration, and that no deep rule, cap, horizontal-normal floor or other contact changes the update. Closest-point stationarity gives

    g = hf (nx, ny, rn/sqrt(I)).
    F(z) = z + p g/s.

This is exactly the ordinary real-arithmetic push law. The Newton/projection interpretation already appears in the checker's residual argument; it is not a newly discovered rule.

The useful extension is its FULL derivative. Writing H=Hessian d:

    DF = P + (p/s) Q H,
    P  = Id - u u^T,
    Q  = Id - 2 u u^T.

Proof: Dp=-g^T and D(g/s)=(Id-2gg^T/s)H/s. Substitute in D(z+p g/s).

P is the orthogonal tangent projection; Q is a Householder reflection, so ||Q||_2=1. Consequently, on a domain with ||g|| >= m > 0 and ||H||_2 <= B,

    ||DF - P||_2 <= |p| B/m^2,
    ||DF||_2 <= 1 + |p| B/m^2.

At p=0 the active-map limit is exactly P: normal perturbations disappear to first order, while tangent perturbations remain. This does NOT say a finite-penetration step is globally contracting. Splitting the two Hessian terms and adding norms unnecessarily loses the reflection cancellation.

## 2. A centred enclosure that retains this projection

Let zc be a reference, e an initial error with ||e|| <= r. Suppose every line segment zc+t e stays in the same guarded smooth active domain, where

    m <= ||g|| <= G,    ||H||_2 <= B,    p >= 0.

Let pc=p(zc), Pc=Id-uc uc^T. Then

    F(zc+e) - F(zc) belongs to Pc e + Ball(b(r)),

where

    b(r) = B pc r/m^2 + (B/(2m) + B G/(2m^2)) r^2.

Derivation: along the segment, ||du/dt|| <= B||e||/m. Because du is perpendicular to u, the operator norm of d(uu^T)/dt equals ||du/dt||, giving ||P(t)-Pc|| <= Bt||e||/m. Also p(t) <= pc+Gt||e||. Integrate [DF(zc+t e)-Pc]e from 0 to 1 and use the full derivative bound above.

Thus a proposed error set E fits in Pc E plus this ball. At a reference on the shell, pc=0 and the remainder is quadratic. At any reference, b(0)=0: the real-map enclosure injects no pose-independent shell width into a singleton.

This is a proved conditional real-arithmetic inclusion, not a measured slope multiplier. It can be conservative; whether it closes the actual arm-2 tube remains to be tested with verified B,m,G and guards.

The no-contact branch is F(z)=z. Split it from the active branch. Do not apply Pc across the activation kink without a branch-aware union. Nonunique closest pairs also require justified branch handling.

## 3. Residual bound and its scope

If the entire correction segment z+t(F(z)-z) stays in a smooth domain with Hessian norm at most Bstep, Taylor's theorem gives

    |d(F(z))-D| <= Bstep p^2/(2 ||g(z)||^2).

Here g(z)^T(F(z)-z)=p, so the first-order residual cancels. The domain for this bound is the actual correction segment, which need not equal the initial uncertainty box.

If another feature wins after moving, a single branch's residual is insufficient for the minimum distance. Either establish its continued validity or handle all reachable branch changes. The same warning applies to the centred enclosure. Nominal final tiny lambdas do not establish a uniform residual bound over an input region.

## 4. What the arm-2 trace establishes

Through substep 112 of the nominal replay:

| Quantity | Result |
| --- | ---: |
| First correction substep | 75 |
| Corrections | 140 |
| Leg pair, attacker/victim | (1,0) |
| Passes with more than one correction | 0 |
| Hub/deep/cap/horizontal-floor flags | 0 |
| Minimum recorded hf | 0.9879536332340944 |
| Maximum input penetration | 0.13887101426186277 |
| Maximum absolute single-correction residual | 0.000060013286864446513 |
| Maximum discrepancy between push and Newton expression | 4.11e-15 |

These are nominal observations, not interval bounds. In particular, do not use the recorded minimum hf as m for a neighborhood without proof.

The central-difference derivative check covers 35 nominal interior/interior configurations. The largest Frobenius discrepancy from the formula is 6.60e-11 at step size 1e-4 in scaled coordinates. This checks implementation consistency; the algebra establishes the identity.

The last nominal first correction approaches the end of attacker chord 4 at k111, then selects chord 5 at k112. Earlier neighboring uncertain poses can cross first. The short arm still needs feature unions; it is not one smooth branch for the entire throw.

Because the trace has only one correction per solver pass, recomputing victim geometry at the next pass agrees with the fresh-geometry premise along this nominal path. A region proof must establish that no additional contact becomes active. Multiple contacts evaluated from geometry cached earlier in a pass need the actual cached-state program, not this simplified single-contact map.

## 5. Concrete next work

Astra: derive or verify uniform B,m,G on the reachable guarded domains, including the chord transition, and check the resulting tube inclusions.

Opus/Sonnet: implement a proposal-only full-map enclosure mode behind an experimental switch. Keep the original checker for comparison. Use mass-scaled matrices, apply Pc to the uncertainty set, add b(r), and retain distinct contact/no-contact/feature branches. Log every bound's domain, provenance and guard. If a guard, derivative bound or correction-segment containment is unavailable, return UNRESOLVED, not CERTIFIED.

Start with the small Brief 6 box (xy half-width 0.0002u, rotation half-width 0.002 DEGREES), arm (2,-1). Compare singleton behavior and per-step width with the existing enclosure. Numerical Hessians may propose domains but may not certify B. Do not silently reuse floored heuristic Hessian denominators as verified geometric lower bounds.

After every internal correction, prove inclusion and other-contact exclusions, follow the real finite solver's stopping program, bound numerical error, and check winning versus losing terminals. Only then attempt all-reply coverage and expansion in both pieces' poses.

This work does not replace the L13/L17 task request. Those experiments can proceed independently. No new matches, full local throw certificate, all-reply certificate, or dead-region proof were completed in this update.
