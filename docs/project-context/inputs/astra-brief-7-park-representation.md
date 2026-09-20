# Brief 7: the park representation fails at zero width — is the moving tube the fix?

**Status of the previous round.** Brief 6 was wrong and has been corrected: sections 8
and 9 of `nn/THROW-CONTACT-LEMMAS.md` reproduce exactly, from the pose after blue's
(0,+1) reply to 8 degrees. Brief 4's two enclosure defects are now **repaired in
`nn/throw-cert.js`** (commit `1ab1c8222` on `claude/board-game-video-adaptation-cf8a93`),
and both of Brief 4's ablation predictions reproduced exactly on the way:

| Brief 4 predicted | measured here |
| --- | --- |
| chord fix alone still certifies, at k84 | `CERTIFIED` at substep 84 (was 85) |
| adding the frame term refuses at k83, two leg pairs | `REFUSED` at 83, "two leg pairs can touch: (0,0) 3.15, (1,2) 3.56" |

Brief 4 section 9 said the repairs had to land before the valid checker's limiting size
could be measured. That measurement is below, and it is the reason for this brief.

## 1. The measurement: it is not a box-size problem

Pose (the post-reply one):

```
POSE=-24.31126879077936,-37.34799285619334,1.3448263401595464,-11.7593,-23.2838,2.9442
node nn/throw-cert.js 1 <pv> -1 1 <hx> <hy> <hRotDeg>
```

With both defects repaired, sweeping the box down to and including a **zero-width
singleton**:

| box (position, rotation) | arm (0,-1) — section 8's | arm (2,-1) — section 9's |
| --- | --- | --- |
| +-0.0002u, +-0.002 deg | REFUSED k83 | **CERTIFIED** k112 |
| +-5e-5u, +-0.0005 deg | REFUSED k84 | — |
| +-1e-5u, +-0.0001 deg | REFUSED k84 | **CERTIFIED** k112 |
| +-1e-6u, +-1e-5 deg | REFUSED k84 | — |
| +-1e-7u, +-1e-6 deg | REFUSED k84 | **CERTIFIED** k112 |
| **0, 0 (singleton)** | **REFUSED k84** | **CERTIFIED** k112 |

The centre is thrown at k84, so section 8's arm dies exactly where it must survive.

**A singleton has no width to inflate.** Everything the enclosure carries at k84 is its
own slack, generated along the correction path from a point. So the refusal on arm
(0,-1) is not a statement about how big the initial box is; it is a property of the
representation through the chord-vertex park. Brief 4 section 9 anticipated this
("nonzero growth from a zero-width input already shows a source of intrinsic enclosure
slack"); this is that prediction at its limit.

For contrast, the unrepaired checker certifies both arms at a singleton — so the whole
of arm (0,-1)'s certificate, at every box size, was resting on the two defects.

## 2. What survives

Arm (2,-1) still certifies at the stated box **and** at a singleton, with the repairs in.
Brief 4 section 7 already observed that the second arm has a different contact
transition; it does not lean on the park, so the defective bookkeeping was not
load-bearing for it.

That matters for the game-level claim. The certificate says *this arm throws every pose
in the box*. Red needs only one such arm. So the repaired checker does **not** overturn
the throw at this pose — it relocates it to the second arm and removes the first arm's
certificate entirely.

We are not claiming arm (2,-1) is a proof. Brief 4 section 10's obligations are
untouched: direction derivatives along all internal corrections, all feasible contact
transitions, and the finite solver's residual for every pose.

## 3. What we are asking

1. **Is the moving tube of Brief 4 section 8 the right construction for the park, and can
   it close there?** The phase-indexed form given — sets `S_k = qbar_k + P_k E` chosen in
   advance, `T_k(S_{k-1} ∩ onboard) ⊂ S_k ∪ {thrown}` — replaces recursive inflation with
   verified inclusion, which is exactly what a zero-width failure says is needed. Does the
   exposed-foot polar formulation `(r, psi, theta)` with `dG/dr = h_f n·u` and the implicit
   contact shell `r = r(alpha, psi, theta, sigma)` actually admit a verified positive lower
   bound on `dG/dr` through the whole park on this arm?
2. **Or is a different object required through a chord-vertex park?** Section 8 lists
   ellipsoid, zonotope and contact-coordinate tubes. If the park's dwell is what breaks a
   parallelotope at zero width, is there a reason to expect any of those to do better, or
   does the dwell need its own patch with a guarded union at each feature change?
3. **Does the surviving arm change the target?** If a proof is wanted for *this pose*
   rather than for *every arm*, arm (2,-1) is the cheaper object — it has no park. Which
   of Brief 4 section 10's remaining obligations bind for an arm that never parks, and is
   there a shorter route to a real proof through it?
4. **Is the repair itself right?** The frame-independent identity used is Brief 4's:
   `lambda a_c = lambda N m3 + lambda (a_c - m3 - Lam_c B m3)`, carrying the previously
   dropped `lambda (a_c - m3)`. The alternative Brief 4 offers — carry a_c's actual
   coordinates in the new frame, or differentiate the complete correction as in section 5
   — was not taken. Is the identity version sound as written, or does it hide the same
   assumption somewhere else?

## 4. Reproducing

Both repairs are one hunk each in `nn/throw-cert.js`, commit `1ab1c8222`. To see the
ablations separately, revert defect 2's hunk (the `dm3` term in `Rv`) and re-run — that is
the k84 `CERTIFIED` row. Revert both and it is k85, the document's number.
