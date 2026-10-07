# Tau research checkpoint

## Scope and claim level
The supplied snapshot was inspected and the local research probes were rerun. These are mathematical derivations and numerical counterexamples, not a complete throw proof, a solved game, or a formally validated floating-point certificate. No shipped game rules were changed by this investigation.

## 1. The first mixed-contact refusal is overly conservative
For target 1, reply family (2,+1), exact reply stops in [2.4,2.6] degrees and witness (0,-1), the checker refuses at substep 23. A finite subdivision of its entire incoming axis-aligned hull into seven boxes gives a positive leg-clearance lower bound of 0.026097384520983202 units.

For each subbox with center q and half-widths hx,hy,hr, the real-arithmetic lower bound is

    min_leg_gap(q) - hypot(hx,hy) - 2 R sin(min(hr,pi)/2).

Every leg point has planar lever at most R about its own hub. Rigid rotation displaces it by at most the last term; set distance is 1-Lipschitz under Hausdorff displacement. Therefore positive bounds exclude leg penetration uniformly, not merely at sampled poses. The evaluated center distances and arithmetic still need outward-rounded verification. This does not validate the incoming enclosure's earlier propagation, which has the defect below.

## 2. The hubV shell pin has a concrete tangential defect
A pure hubV push is parallel to each pose's own horizontal residual w_xy, not to the center's fixed normal. In a fixed tangential frame,

    b_post = (1 + lambda / |w_xy|) b_pre.

The current pin retains b_pre unchanged. At an exact 2.5-degree reply and witness substep 4, a translation box of half-width 1e-5 units produces 16 escapes among 1,004 tested poses. The old bound is 1.0788869982429866e-5; the factor-aware bound is 1.1525278340771688e-5, with zero sampled escapes. The largest old escape is 7.363913377423097e-7 units. This is a counterexample to the local pin, not merely failure to find a certificate.

The factor-aware formula is a local algebraic repair for one pure vertex hubV push. Interior-contact projection drift, multiple iterations, feature ownership, and outward rounding require separate treatment. It must not be advertised as a complete repaired certificate.

## 3. Mixed engine hubV is not necessarily pure translation
At exact reply stop 5 degrees, witness (0,-1), substep 29, the iteration first applies a leg push and then a hubV push using the hub saved at iteration start. The application routine computes the lever relative to the already-updated hub. The hubV lever is -0.03750777904907724, not zero. Consequently the mixed update can rotate the victim. A composition that assumes every hubV push has rn=0 does not match this engine.

## 4. Least-motion active sets and ordered engine pushes are distinct targets
For frozen normals a1=(1,0,0), a2=(1/2,sqrt(3)/2,0), constraints a_i v >= 1, the least-motion solution is v=(1,1/sqrt(3),0), objective 2/3. Ordered nonnegative projection corrections produce (1.25,sqrt(3)/4,0) or (1,sqrt(3)/2,0), objective 7/8. Both are feasible, so subsequent penetration-only passes do not undo their excess motion. Scaling the right-hand sides toward zero preserves these distinct normalized velocities. Thus smaller steps alone do not establish equivalence to the least-motion QP.

This is a frozen-contact algebraic counterexample to a general equivalence claim. It is not a claim that these exact normals occur at every Tau mixed event.

## Recommended next direction
For proving the shipped game, prioritize the ordered snapshot-based engine map: repair the hubV pin, verify all intermediate pushes and feature branches, and tighten false mixed-contact guards. Keep the least-motion active-set model as a separately specified idealization. If the intended research target is instead that idealization, derive its complementarity system without calling it an engine proof.

## Reproduction
From the snapshot root:

    node nn/research/deep-probe.js
    node nn/research/soundness-probe.js
    node nn/research/exclusion-probe.js

The accompanying bundle includes these probes and result records. They require the supplied snapshot's nn modules and index.html. No remote repository was pushed.


## Independent checks and local history
The research active-set solver was independently checked against SciPy SLSQP on 100 seeded, feasible synthetic constraint systems in mass coordinates. There were zero failed comparisons; the maximum objective difference was 1.4033219031261979e-13. These are solver unit tests, not synthetic game evidence.

A separate uniform 4-by-4-by-4 partition of the incoming refusal box gives a minimum real-arithmetic leg-gap lower bound of 0.05498659789635005 units. An 8-by-8-by-8 partition gives 0.12392314795559836 units. Neither substitutes for directed rounding or for repairing the preceding propagation.

The archive supplied no Git history. A new local baseline and two research commits were created:
- 62e251c: supplied snapshot baseline
- da37934: exact-stop timeline and independent active-set probe
- 2431b69: soundness counterexample, exclusion and solver checks

The complete checkpoint archive contains the original snapshot, research additions, this report, and a Git history bundle. The shipped index.html, contact-law.js, throw-cert.js and response-cover.js are unchanged. No remote push was performed.

## Next mathematical priority
Repair and validate the isolated hubV enclosure first. Keep the engine-exact sequential snapshot law separate from the ideal least-motion complementarity law. The cyclic-projection counterexample rules out identifying them solely by taking smaller steps. A mixed-contact theorem requires a stated choice of law, event isolation, active-set inequalities, and an enclosure or convergence argument appropriate to that law.
