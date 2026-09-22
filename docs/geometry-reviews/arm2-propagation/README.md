# Composed arm-2 throw enclosure

21 September 2026. This advances the local input-box results to a composed enclosure through the finite contact program.

**Result:** every victim pose in the specified initial box is outside the board by substep 112 in the stated real-arithmetic contact model, driven by the fixed attacker poses recorded from the pinned engine. The lower bound on exposed foot 1 is **67.20213881297005u**, versus an edge upper bound of **67.16700000000002u**: clearance at least **0.03513881297003251u**.

This is not yet a universal floating-point engine certificate, and it is not a dead-region proof. The remaining numerical correspondence and all-reply obligations are explicit below.

## Exact claim and input

Use the source blobs pinned by ../contact-map/source-loader.js, from commit 18efad5398798b65b477f9af4be17947a358d3ce. The position is the Brief 6 pose AFTER blue's 8-degree defence.

Attacker piece 1 is fixed initially at:

    x=-11.7593, y=-23.2838, theta=2.9442 radians.

Victim piece 0 starts anywhere in the box in summary.json, enclosing xy half-width 0.0002u and rotation half-width 0.002 DEGREES around:

    x=-24.31126879077936
    y=-37.34799285619334
    theta=1.3448263401595464 radians.

The attacker uses pivot 2, direction -1, through 112 one-third-degree substeps: 37 full one-degree calls and a final one-third-degree call. engine-attacker-path.json records the actual extracted engine's attacker poses.

The contact model takes those recorded poses as fixed real inputs. Victim contact geometry and corrections use real arithmetic, with the source's recorded constants, piece shapes, ordinary push law and ten-pass limit. All alternative contact types and exceptional push branches are excluded over the enclosures.

The attacker path is independent of the victim: applySwing rotates and checks the active piece before resolvePush, and resolvePush updates only the opponent. The pinned Node engine legally reaches all 112 substeps; all 41 diagnostic starts reproduce the SAME attacker poses exactly. An independent replay subsequently matched all 112 poses on Node v22.22.2 versus v24.19.0. This is two-runtime evidence, not a uniform portability bound; uniform floating contact error remains open.

## What has now been enclosed

| Obligation | Result |
| --- | --- |
| Initial substeps 1–74 | All leg and hub contacts excluded; victim stays in its initial box |
| Substeps 75–112 | Ten contact/no-contact maps each: 380 composed passes |
| Closest-feature changes | Conservative branch enumeration; up to three branches retained |
| Other legs and hubs | Excluded on every pass input; live post-push hub-hub distance also checked |
| Deep rule, horizontal floor, correction cap | Uniform ordinary-push guards checked for each retained active branch |
| Solver early exit | Covered by ten maps, because a no-contact state remains unchanged at fixed attacker pose |
| Final exposed foot | Uniform lower radius 67.20213881297005u |
| Attacker feet | Upper radius at recorded poses below 45.348u |
| Pinned floating engine | 41 point checks, all contained and thrown; this is diagnostic, not universal |

The minimum recorded exclusion lower bounds are 2.9054727690578344u for the checked leg-pair exclusions (including early free motion), 7.3492798384006015u for hub-leg, and 18.85038002015257u for hub-hub. Their thresholds are at most 2.8800000000000003u, 4.176000000000001u and 5.472000000000001u respectively.

The final enclosing radius in mass coordinates is about 0.0062194u. It was propagated, not reset to the original tiny box each substep.

## How the propagation preserves correlations

Represent a set in mass coordinates as a zonotope:

    z = c + M epsilon,    each epsilon_j in [-1,1].

At each pass, convert its axis hull to a pose box solely for geometric guards and derivative bounds. Keep M for propagation. Recompute the bounds on the actual input enclosure; do not reuse the old 38 input-box constants outside their domains.

For every possible closest feature, use its smooth distance extension d on this box. Even if that feature is active on only part of the box, mapping the whole box through its extension is conservative for that part. Union the resulting images. Shared-endpoint dominance removes spurious candidates when its strict guards pass.

Let p=D-d and h=gradient(d)/||gradient(d)||^2. The map is

    F(z) = z + max(p(z),0) h(z).

To account for the interval evaluation of centre quantities, choose binary64 proposals phat, ghat and hhat and bound:

    |p(c)-phat| <= delta_p
    ||gradient(d)(c)-ghat|| <= delta_g
    ||h(c)-hhat|| <= delta_h.

On an input box with ||gradient(d)||>=m, ||gradient(d)||<=G, and ||Hessian(d)||<=B, and ||z-c||<=r:

    |p(z) - [phat-ghat dot (z-c)]|
      <= delta_p + delta_g r + B r^2/2.

Because Dh=(Id-2uu^T)Hessian(d)/||gradient(d)||^2, its norm is at most B/m^2. The map error relative to

    z + hhat max(phat-ghat dot (z-c),0)

is at most

    ||hhat|| (delta_p + delta_g r + B r^2/2)
    + max(0, p(c)_upper + G r) (delta_h + B r/m^2).

All arithmetic in this bound is outward rounded. It includes interval evaluation uncertainty of the centre, rather than assuming its nominal computed image is exact.

For a scalar t in [l,u] straddling zero, the positive part has the enclosure

    max(t,0) in alpha t + beta + beta [-1,1],
    alpha=u/(u-l), beta=-ul/[2(u-l)].

Thus the linear part updates existing generators by Id-alpha hhat ghat^T. One additional generator captures the scalar clipping remainder; three axis generators enclose the map error and rounded coefficient storage. Entirely active/inactive intervals use their exact linear cases.

When several feature images survive, componentwise hulls of the centres and corresponding generator columns produce an outer zonotope. Generator reduction retains 45 large columns and encloses all discarded columns by three axis generators. Both operations can loosen the set; neither discards possible states.

## Why fixed ten-pass composition covers early stopping

With only leg pair (1,0) potentially active, a pass either applies its correction or makes no change. If no contact remains, another pass at the same fixed attacker pose is again the identity. Therefore padding an early-stopped solve to ten contact/no-contact maps preserves its result.

The exclusions are checked at each propagated pass input. This also handles the actual cached geometry: all leg and hub-leg checks use the start-of-pass geometry, while the final hub-hub test uses the updated live hub. check_contacts.py additionally verifies the latter on the output enclosure.

This reasoning would fail if another contact could activate, if the attacker moved within the solve, or if an excluded push branch became reachable. The checker returns unresolved on such gaps rather than treating the nominal single-contact trace as proof.

## Validation and reproducibility

Dependencies are Python standard library and Node, plus a checkout of the exact source blobs verified by source-loader.js. From this directory:

    node ../contact-map/trace.js /path/to/pinned/Tau

    # Bootstrap using nominal attacker poses, then extract the real engine path.
    python propagate.py ../contact-map/trace.json
    node engine-check.js /path/to/pinned/Tau

    # Final run uses the pinned engine's attacker poses.
    python propagate.py ../contact-map/trace.json 1 engine-attacker-path.json
    python check_contacts.py ../contact-map/trace.json propagation-1.0.json
    node engine-check.js /path/to/pinned/Tau
    python summarize.py

The engine test uses the centre, all eight box corners and 32 deterministic interior points. All 4,592 substep containment checks pass. The smallest final maximum-foot radius among them is 67.2130762624424u. The nominal replica and actual attacker traces differ by at most 1.744e-13 in the recorded scaled-coordinate comparison.

These samples check implementation consistency. They do not establish the interval theorem or a uniform floating-error bound. summarize.py verifies the result counts, strict inequalities and matching artifact hashes before emitting the restricted claim.

Full propagation and contact-exclusion logs are committed. Elapsed-time fields may differ when regenerated; hashes identify this archived run.

## What remains

1. **Uniform floating contact correspondence.** Bound the actual engine's arithmetic, transcendental evaluations and closest-feature decisions over these sets, or use a separately verified numerical kernel. Pointwise agreement is not that proof. The recorded attacker path already comes from the pinned engine; other-runtime portability is separate.
2. **All-reply coverage.** This proves a local throw in the stated real model after one particular defender reply. A dead-state theorem must cover every legal defender stop.
3. **Both-piece variation.** The current local box varies only the victim; six-dimensional regions require uncertainty in the attacker too.

The previous handoff's “next: compose the enclosure” task is now completed for this stated real-arithmetic model. Do not send Claude back to independently fixed boxes or to the old singleton-width checker as though that composition were still unattempted.


## Independent replay and next experiments — 22 September 2026

See [cross-run verification](REPLAY.md) for metadata-independent archive fingerprints and [the response to Claude](CLAUDE-RESPONSE.md) for replication scope, the 150-position audit, and the requested reply-band maps. The tolerance change recovers four witnesses and loses one; preserve that regression in subsequent tests.

## Conditional numerical robustness — 22 September 2026

[The floating-point budget note](FLOATING-BUDGET.md) proves an exact local perturbation lemma and adds a disturbed-map enclosure. Arbitrary errors up to 1e-8u per mass coordinate after each of 380 passes still leave at least 0.025962128186932883u terminal clearance, with 454 exclusions rechecked. This supplies a sufficient target for engine-error bounds; it does not establish those bounds. The zero-disturbance wrapper is looser because of additional generator repacking. A 1e-7 run becomes unresolved, not an escape.

## Near-minimum branch coverage — 22 September 2026

[The selection cover](SELECTION-COVER.md) checks all 380 disturbed input boxes. Every exact segment-minimum feature within 2e-6u of the true minimum is already covered by the recorded branch images. Sixty dominance exclusions have distance gaps at least 1.1563511855528839e-5u; ten multi-feature passes retain their unions. This establishes a conditional approximate-selection bridge. Engine segment arithmetic, pruning and contact-cutoff correspondence remain open.
