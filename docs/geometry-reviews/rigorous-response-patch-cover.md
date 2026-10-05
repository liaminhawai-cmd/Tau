# Rigorous response-patch cover

**Date:** 2026-10-04  
**Status:** research design; no theorem claimed yet.

## Why this is the next step

The existing reply-gap cover is useful as a topology detector but is not a proof.

On the current geometry branch, `gap-cover.js` sampled 25 stops in each of 136 unresolved gaps and found 135 apparently covered gaps. The subsequent engine falsification file `docs/dead-regions/gap-cover-falsified.jsonl` contradicted 25 of those 135 apparent covers over 40 random legal moves per seed. One unresolved gap remained uncovered at all sampled stops. Therefore a theorem must not infer interval coverage from sampled winning stops.

The correct object is a **finite validated patch cover**.

## Target statement

Fix one position P and one legal reply family of the side to move, parameterised by stop angle

\[
s\in[a,b].
\]

Let L(s) be the exact post-reply state, including any push prescribed by the engine's continuous collision law.

A response patch is a triple

\[
([a,b],\ W,\ T)
\]

where:

* `[a,b]` is a reply-stop interval;
* W is one fixed attacker move family (pivot foot, direction, and a stopping rule);
* T is a validated enclosure of the entire response trajectory for every s in [a,b].

The patch is accepted only when interval evaluation proves, uniformly for every s in [a,b]:

1. the reply L(s) is legal and its stopping event is fixed on the patch;
2. W is legal from L(s);
3. W does not accidentally cross an unaccounted contact/limit event;
4. the resulting attacker foot radius is strictly larger than the board's off-board threshold;
5. the proof margin is positive after all enclosure/remainder terms.

For a complete dead-position certificate, finitely many response patches must satisfy

\[
[a,b] \subseteq \bigcup_k [a_k,b_k]
\]

for every legal reply family, including the endpoints and every stopping-event boundary.

This converts the quantifier

\[
\forall s\;\exists W(s):\text{throw}
\]

into a finite, checkable cover in which W is constant on each patch.

## Do not use the old sampled cover as evidence of theoremhood

The current empirical counts are retained only as search guidance:

* 136 unresolved single-arc gaps;
* 135 sampled covers;
* 25/135 later contradicted by engine probing;
* 1 gap had no winning arm at the sampled stops;
* among the apparent covers, the winning-arm frequencies were heavily concentrated in arms (0,+1) and (0,-1).

The useful conclusion is therefore **topological**: an arm switch is often the reason the old single-arc certificate refused. The invalid conclusion would be that dense sampling proves the whole gap is covered.

## Mathematical representation

The response field should be treated as a piecewise-smooth map, not as an arbitrary black-box surface.

Between event walls:

\[
s \mapsto L(s)
\]

is smooth because the mover is a rigid rotation and each active collision branch is smooth. The attacker response map is also smooth while its closest-feature branch and stopping event stay fixed.

For each patch, use a local coordinate \tau=s-s_0 and enclose:

\[
L(s)=L(s_0)+J_L\tau+R_L(\tau),
\]

with a validated bound on \|R_L\|. The first-order term should be carried in a **moving basis**, rather than converted immediately into an axis-aligned box. This is the same principle that the current `nn/throw-cert.js` uses in its parallelotope/contact-frame propagation.

The geometry branch structure is:

* interior/interior closest-point pair;
* attacker-vertex or victim-vertex park;
* event transition at a chord vertex;
* self-off / cross-line stopping boundary.

An event boundary is not swept through blindly. It becomes an endpoint of one patch and the start of another, with both sides checked.

## The key reduction

For the first implementation, do **not** try to prove a full two-dimensional \((s_B,s_R)\) winning region.

Instead, discover candidate responses numerically, then certify a one-dimensional patch with a **fixed response witness**.

For sampled reply stops \(s_B\):

1. find the strongest throwing response W;
2. cluster adjacent stops with the same W and same event signature;
3. propose an interval around the cluster;
4. construct a validated tube for L(s) over that interval;
5. run the exact throw enclosure against that tube;
6. if it fails, bisect the reply interval;
7. if it changes witness/event, split at the detected boundary;
8. continue until the complete legal interval is covered.

This is much stronger than `coverGap`: every accepted patch carries its own enclosure and positive margin.

## What has to be genuinely rigorous

The existing code contains several mechanisms that are promising but must not be silently upgraded:

* `nn/throw-cert.js::certify` uses contact-regime branching and a carried parallelotope. Its current implementation is far stronger than the old sampled checker, but the mathematical soundness of every remainder term still needs an audit.
* `nn/throw-cert.js::parkJacobian` now includes the formerly omitted \lambda(a_c-m_3) frame term. The code comment itself records that this term can reach about 0.39 in the project's foot-displacement metric, so the old omission cannot be waved away.
* `nn/throw-audit/slab-shape.js` shows why axis-aligned boxes are intrinsically wasteful in pushed regions: the reachable set is thin in the contact-normal direction.
* `nn/throw-audit/gain-bound.js` provides a useful alternative scalar route: prove a positive lower bound on exposed-foot radial gain per contact substep and sum it. This can become a fallback certificate for park-heavy patches if the moving tube is still too expensive.
* The existing empirical “3 × observed finite difference” rules in `forced-win.js` are not sufficient for a theorem. A proof needs analytic/interval derivative bounds or a validated enclosure theorem on each branch.

## First proof target

The best first target is **not** the fragile 0.4-degree gaps that previously triggered the sampled-cover machinery.

Use a large-margin dead seed and the least complicated response arm, so the proof can validate the architecture before attacking the difficult arm-switch cases.

A good anchor from `docs/dead-regions/dead-points-mined.jsonl` is:

```
game: retro-ratchet-20260806100429-77s-w1-j1-0-32
mover: 1
pose:
[0.4981, 35.798, 0.5752,
 2.4001, 49.5323, 4.7]
worstMargin: 5.821u
engine: 40/40
```

The margin is large enough that a conservative first patch has a realistic chance of closing without heroic subdivision.

The second anchor should be the historical `ndpxhts24` post-reply throw, especially arm (2,-1), because its non-park enclosure is materially cleaner than the failed park arm. The exact post-reply pose used by the audited throw certificate is recorded in `docs/dead-regions/astra-brief-6-throw-certificate-reproduction.md`.

## Boundary protocol

A patch boundary is allowed for any of:

* a change in legal stop-limit signature;
* a closest-feature pair switch;
* a chord-vertex park entry/exit;
* a contact onset/offset;
* a board-edge crossing;
* a sign change in the fixed witness's proof margin.

At every boundary, certify the closed endpoint on at least one adjacent patch. No gap may be dismissed merely because it is smaller than an engine substep.

That last rule is important: the old sliver rule was explicitly resolution-relative. A theorem cannot inherit that escape hatch.

## Deliverable for the eventual code

The first production-quality implementation should emit JSON records of the form:

```json
{
  "replyArm": [0, 1],
  "replyInterval": [a, b],
  "witness": {"pv": 2, "dir": -1, "stopRule": "..."},
  "eventSignature": "...",
  "enclosure": {
    "metric": "L1-foot",
    "radius": 0.0,
    "remainder": 0.0
  },
  "throwMargin": 0.0,
  "proof": {
    "status": "validated",
    "method": "interval-parallelotope",
    "noEventCrossing": true
  }
}
```

Zero or null values must never mean “sampled successfully”; an accepted record must contain a positive explicit margin and a machine-checkable reason why the patch is complete.

## Success criterion

The first milestone is deliberately small:

> Prove one nontrivial reply interval with one fixed winning response, with no empirical finite-difference safety factor and no engine-probe/sliver exception.

Then cover one complete reply family.

Then cover all six families of one dead point.

Only after that should the construction be lifted to recursive WIN(3)/LOST(4) family graphs.

## Consequence for the old “reply map”

The earlier idea of plotting a two-dimensional field \((s_B,s_R)\) is still useful, but it is a **discovery visualisation**.

The mathematical proof object is the finite collection of one-dimensional guarded patches extracted from that field. This keeps the world-class strategy intact:

**sample to discover topology; interval analysis to prove the topology's cells.**
