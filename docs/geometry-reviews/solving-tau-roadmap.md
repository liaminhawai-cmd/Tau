# Solving Tau: the roadmap and where the leaf stands

**Date:** 2026-10-06
**Branch:** `claude/board-game-video-adaptation-cf8a93`
**Goal:** solve Tau the way checkers was solved -- a stored, independently checkable proof,
not a strong player.

## The ladder (checkers/Chinook analogue)

| Rung | What it is | Status |
|---|---|---|
| Leaf atom | rigorous throw proof over a continuous pose set (a reply-stop interval), no sampling inside | **done** -- validated patch certificates, `nn/response-cover.js` |
| Dead position | all six reply families covered by patches -> "every legal move loses" | machinery done (`--dead`); first family measured: 46 patches prove the limit-end 37% (below) |
| Retrograde | WIN/LOST recursion over the game graph consuming proven leaves | exists (forced-win.js) but leaves are sampled; wiring point identified (below) |
| Solution | proof tree from the initial position + formal FP rigor + independent verifier | not started |

Strategy: make the leaf provable, then let the existing recursion inherit soundness bottom-up.

## What the 2026-10-06 session changed

1. **Soundness fix in `certifiedClearance`.** The angular soundness margin was
   `hypot(R, 0.5R)*|sin(hi)|*1.1`, but the farthest leg point from the pivot foot is the hub end of
   the arc at `hypot(R, H)`, and `H = hubHeight = footR` in the engine CFG (not `R/2`); rotating the
   leg by a half-width `hi` displaces points by `2*|p-foot|*sin(hi/2)`, not `|p-foot|*sin(hi)`. The
   old margin was ~15% below the true bound for every `hi` -- unsound. Corrected to
   `2*hypot(R,H)*sin(min(hi,pi)/2)*1.02 + 1e-9`. Both committed CERT targets still clear MIND
   (5.6245 and 3.8360 vs 2.88) and still validate 3/3 against engine replays.

2. **Tangent-frame seeding (`opts.seed` in `throw-cert.js`, `tangentSeed` in response-cover.js).**
   The reply over [a,b] is an exact rigid rotation; its tangent enters the enclosure basis and only
   the quadratic remainder `R*tau^2/2` widens the box. Architecture in and validated (margins equal
   or a hair better: 67.227 vs 67.226 at the probe width). **Honest negative:** it does NOT widen
   patches for the parked-geometry witness. Measured by `--width`: both the axis box and the seed
   certify at the same first-halving width (~0.112 deg at the limit end). Reason: the AABB entering
   the first contact is the arc's own hull either way; the binding refusal is the two-pairs-touchable
   guard *mid-contact* (enclosure smearing through ~60 push substeps), which no initial frame can
   shrink. The next lever for patch width is the missing frame term `lambda*(a_c - m3)` in the
   contact-phase enclosure (the Brief-4 ablation), not the seed.

3. **Sub-interval contact-freeness (`staticOn`).** A contact elsewhere in the reply family no
   longer refuses a contact-free patch: staticness is now proven on [a,b] alone, from the family
   record's per-step poses (steps <= 0.4 deg; a push is visible in the next entry and never reverts).

4. **Family and dead-point cover machinery.** `coverFamily` (greedy right-to-left, halving gallop
   with width locality, one doubling attempt, shared endpoints between adjacent patches = the
   boundary protocol; no sliver exceptions), `witnessPrescreen` (ranks the six witness arms by the
   REPLICA's own throw margin at sampled stops and picks the exposed foot), `coverDeadPoint` (six
   families; an illegal arm is covered trivially; an engine-exact escape -- a reply that pushes the
   opponent off -- is reported, not papered over), `rigorousCellSample` (the leaf in
   `cellSample`'s verdict shape). CLI: `--family <pv> <dir>`, `--dead`, `--retro [--write]`,
   `--try <a> <b> [--all] [--noseed]` (diagnose a width with all six witnesses), `--width` (A/B
   axis box vs seed with bisection refinement), `--fp`.

5. **Formal-FP layer (`nn/rigorous-fp.js`).** Outward-rounded interval arithmetic: IEEE ops widened
   by 4 ulp per endpoint (one for the op's rounding, one for the rounding of the widening itself),
   transcendental-tainted values by 8 ulp under an explicit, tested 4-ulp libm axiom.
   Self-test (double-double reference, ~106 bits): 200k cases, **0 containment failures**;
   Math.sin/cos measured at worst **1.00 ulp** vs the reference. The `--fp` report re-derives the
   leaf's analytic enclosures with it: the exact reply box differs from the fast endpoint+extremum
   box by ~1.6e-12 u, and the exact-circle clearance's rigorous lower bound (5.6245 u) still clears
   MIND -- the leaf's analytic layer is FP-robust. The self-test also caught and killed an inverted
   zero-check in `divI` on its first run.

6. **A latent crash in `throw-cert.js`** (null `post` in the per-substep row bookkeeping when every
   state is individually free while their hull is not) -- unreachable on the thin committed patches,
   first hit by wide/seeded boxes; now records a free row and carries on with the per-state
   propagation (the sound path).

## The hub-leg clearance fix (2026-10-07) and what it revealed

The 2026-10-07 act session replaced `analyse()`'s hub guards (previously `centre distance − full
pose pad`) with three tight bounds over the whole box:

* **hub-hub**: both hubs sit at height H, so the distance is planar and the minimum over the box is
  EXACTLY the point-to-rectangle distance (no interval loss);
* **victim hub vs attacker legs**: the interval point `{box.x, box.y, H}` against the attacker's
  exact arc segments (the hub does not rotate with the piece, so the old pad charged rotation for
  a point that never turns);
* **attacker hub vs victim legs**: a fixed point against `vertexBoxOf` endpoint-box segments,
  via an interval evaluation of the point-to-segment distance (clamped projection parameter,
  interval affine foot, sqrt of the lower end of |P−foot|² over a superset — sound lower bound).

Falsified by `nn/throw-audit/hub-guard-falsify.js`: 4500 random near-graze/pass geometries × 150
sampled poses, **0 containment violations (LB never exceeds the sampled true minimum), 0 false
passes**; both the passing side (2921) and the refusing side (1426+3000) exercised; median LB
slack 0.86u under the true minimum. Both committed CERT targets revalidate unchanged (3/3 each).

**What it revealed (the honest new census of family (2,1) of CERT target 1, `--try` at 2.5/5/9.5 deg):**
the deep range [2, ~9.7] deg is *genuinely* hub-contact territory, not a clearance artifact:

* at 2.5 deg the best witness now passes the clearance guard and refuses one substep later because
  *the centre's own replay uses a hub contact* (throw-cert.js:868 refuses on `flags.hub` in the
  replica sweep) — the push itself engages the attacker's hub;
* mid-contact, the post-push box contains the contact (tight LB 0.000) — the interval legitimately
  spans a hub push the propagation cannot model;
* the near-graze LBs hover at 4.165–4.173 through the whole deep range: the opponent is parked at
  hub-grazing distance from the witness's swing (which is why the position is dead at all).

So the next mathematical target is now named with unusual precision: a **hub-leg push regime**
for the interval propagation. Structural note for whoever derives it: a hubA contact (attacker's
fixed hub vs the victim's moving leg polyline) mirrors the existing vertex-contact machinery
(fixed point vs moving polyline; the replica's push is closed-form per Gauss-Seidel iteration,
`push3d(aHub, c.pt, dist, HUBLEGD − dist)` in both contact-law.js and throw-cert.js's replica
sweep), so the localisation/normal-cone/lever-arm pattern of the chord regime carries over with
the hub as the "vertex". A hubV contact (victim's moving hub vs the attacker's fixed leg) is the
`footOnFixedSeg` shape exactly.

**The hub-regime census (`nn/throw-audit/hub-regime-census.js`, 2026-10-07) settles which to build:**
replaying the three best witnesses from stops 2.5/5/7.5/9.5 deg of family (2,1):

* every hub contact in the deep range is **hubV** (the victim's hub riding the attacker's leg
  mid-throw) — zero hubA, zero hubhub across all twelve replays;
* witness (0,-1) (the strongest): hubV at 4–45 substeps, its count shrinking with stop depth
  (45 pushes at 2.5 deg, 4 at 9.5 deg);
* witness (2,1) throws at EVERY deep stop with **pure leg-leg contact** — its refusals are the
  cone-width smearing (the Brief-4 frame term), not hub;
* witness (1,1) does not throw from the deep stops (prescreen margins negative there).

So the deep range has two independent unlock paths, and hubV is the easier derivation: the
victim's hub does not rotate, so the interval point is exactly `{box.x, box.y, H}` against the
attacker's FIXED polyline — a 1D localisation parameter along the polyline whose drift is the
translation pad alone, the normal cone from the contact-point box vs the hub box, hf and the
lever arm rn closed-form (`push3d(c.pt, oHub, dist, HUBLEGD − dist)`), and the push magnitude
pinned by the same [HUBLEGD, HUBLEGD + eta] contact constraint as the leg regime.



## The first family-cover measurement (2026-10-06, family (2,1) of CERT target 1)

`node nn/response-cover.js --family 2 1` covered the limit end of the family -- [9.73 deg, lim =
14.33 deg] -- with **46 validated patches** (shared endpoints throughout, the boundary protocol;
half-widths 0.025-0.096 deg; clearances >= 4.905 u over MIND 2.88; worst throw margin +0.0021 u
over the rim). The legal domain is [MIN_MOVE = 2 deg, lim], so ~37% of this family is now *proven*;
the record is saved at `docs/dead-regions/response-cover-family-2-1-target1.json`. The remaining [2, 9.73] deg
is not covered, and a six-witness `--try` census at three depths says exactly why:

* **hub-leg grazing** (gap 3): the two best witnesses refuse almost immediately -- substep 2 for
  (0,-1) at 2.5 deg -- because the opponent's foot lies ~0.03 u outside the hub-ball grazing
  threshold 4.18 u on the witness's own path; the current lemmas cover leg-leg contact only;
* **deep-park smearing** (gap 1): other witnesses smear their enclosures through 60-100+ push
  substeps until `vertex cone too wide` or `contact point not localised` (slack up to 7.2 u, one
  pad reaching 120 u);
* **real geometry**: two arms genuinely do not throw from there (prescreen margins -2 to -6 u) --
  correctly refused, not an enclosure issue.

So milestone 2's remaining distance is precisely gaps 1 and 3 -- the same two levers the honest
negative on tangent seeding points at. The full six-family `--dead` run was launched the same day
and reports each family the same way.

## The 2026-10-08 session: cone class eliminated, libm axiom eliminated, witness diversity

Three landings, each measured:

1. **Brief-3 residual bound in the vertex dwell** (`bf0bc17f7`). The blanket cone's angular
   half-width at a victim-vertex dwell used `2*pad` — the triangle-inequality sum of the vertex
   displacement and its projection's displacement. But `w = pV - pA` there is the *residual* of
   the victim vertex's projection onto the FIXED attacker chord, and the residual map of a
   firmly-nonexpansive projection is nonexpansive (`|Δres|² ≤ |Δp|²` by the projection inequality),
   so one displacement suffices. Effect: witness (2,1) at [2.4,2.6] deg passes its former
   'vertex cone too wide (21.3 deg)' refusal and advances a substep; (1,-1) and (2,-1) move past
   their cone refusals entirely; the family cover certified 47 patches before reaching the deep
   range vs 46 in the entire previous run. Both committed CERT targets revalidate 3/3.
   The 'vertex cone too wide' blocker CLASS is removed; the deep range now refuses only on the
   two known gaps (hubV push regime, mid-contact smearing).
2. **Axiom-free trig** (`763a12814`). `rigorous-fp.js`'s cosI/sinI now evaluate endpoints through
   dd-pi argument reduction + an alternating Taylor enclosure — ONLY +,-,*,/ in the enclosure
   path, truncation bounded by the first omitted term. The 4-ulp libm axiom is gone; the self-test
   (200k cases, sinI containment added) reports 0 containment failures; the `--fp` report shows
   box widening 2.25e-12 u and the clearance lower bound still clearing MIND. The leaf's analytic
   layer now rests on IEEE 754 arithmetic alone; the remaining named FP gap is the REPLICA sweep.
3. **Witness diversity in `certifyBest`** (this commit). If the top-ranked witnesses all refuse,
   every remaining witness with a positive prescreen margin is tried — a refused witness is not
   evidence about the rest, and the census showed different arms certify different sub-intervals
   ((1,1) certified 2x wider than (0,-1) at the limit end). Negative-margin arms stay skipped:
   they do not throw at all.

The family (2,1) cover with all three fixes finished at session end: **47 patches** covering
[9.68 deg, lim] (the previous run: 46 patches down to 9.73 deg), worst throw margin +0.0021 u over
the rim; the record superseded the committed artifact at
`docs/dead-regions/response-cover-family-2-1-target1.json`. The deep range [2, 9.68] deg remains
blocked by exactly the two named gaps -- the hubV push regime and the Brief-4 frame term -- with
the third blocker class now closed.



## The wiring point (rung 3)

`forced-win.js:1611 cellSample -> deadCertificate` is the sampled leaf the retrograde currently
consumes. `response-cover.rigorousCellSample(pieces, victim, opts)` returns the same
`{status: dead|escape|unresolved, worstMargin, why, samples}` shape with the stop axis proven
inside every patch, so `cellSample` can delegate to it per point; the sampled Lipschitz gap rule
then only has to carry the pose axis. `--retro` emits the graph-compatible point-node record
(`{kind:'point', plies:2, side, pose, eps:0, proof:{method:'response-patch-cover', families}}`);
`lookup` consumes it once `certifyStar` grows an eps>0 ball around the point with the rigorous leaf
swapped in. `--retro --write` appends to `nn/data/rigorous-dead-points.jsonl`.

## The honest claim ladder

What a "validated patch" means today: mathematically derived enclosures in a real-arithmetic
model, whose analytic layer (boxes, clearance margins) has now been re-derived under outward
rounding with a tested libm axiom, falsified against the engine at random stops. What it is NOT
yet: a machine-verified theorem. The remaining FP distance is (a) the cos/sin axiom -- replace with
a correctly-rounded implementation or a proved per-function error budget, and (b) the REPLICA
sweep itself, which stays falsification-tested rather than enclosed. See
`response-cover-proof-status.md` for the standing statement.

## Open gaps, in dependency order

1. **Patch width** (the parked-witness bottleneck): the contact-phase enclosure needs the Brief-4
   frame term `lambda*(a_c - m3)`; alternative scalar route per the design doc: a positive
   lower bound on radial gain per contact substep, summed.
2. **Varying-attacker bridge**: replies that push the opponent (staticness fails on part of the
   family) need the witness phase with both pieces varying.
3. **Hub-contact lemmas**: witnesses whose contact is hub-leg; current lemmas cover leg-leg.
4. **Region growth**: certifyStar with the rigorous leaf (eps-ball around a proven point).
5. **Full-graph retrograde + proof storage + independent verifier** -- the actual "solved" gates.

## Reversibility (asked 2026-10-06: "do we have a reversible collision formula?")

Yes for kinematics, no closed form for collisions. The rigid swing is exactly invertible
(`hubFromFoot` in forced-win.js round-trips to 1e-14); the collision response (Gauss-Seidel pushes)
is forward-only, and its inverse is the sampled, Lipschitz-bounded `fibre` scan -- which is exactly
where the sampled-leaf soundness debt lives. Making the leaf rigorous (`response-cover.js`) is what
makes the backward walk (`unwindArcs -> fibre -> arcPose`) inherit soundness.
