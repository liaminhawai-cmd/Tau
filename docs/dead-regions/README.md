# Growing the dead regions

A **dead** position is one where the side to move loses whatever it plays. This
directory records a run whose only purpose was to make the certified dead set
bigger, and to record the misses as carefully as the hits.

Read [CLAUDE-HANDOFF.md](https://github.com/liaminhawai-cmd/Tau/blob/codex/tau-project-context-and-findings/CLAUDE-HANDOFF.md)
on `codex/tau-project-context-and-findings` first, and the
[geometry review index](https://github.com/liaminhawai-cmd/Tau/blob/codex/tau-project-context-and-findings/docs/geometry-reviews/README.md)
beside it. `depth.html`'s certificate section names "growing the dead regions
(currently thin)" as the open work; this is one pass at it.

## What class of claim this is

**Everything here is certified by SAMPLING. Nothing here is proved.** The
certificate `nn/forced-win.js` issues is a check, in its own words, not a
theorem:

- the throw margin is evaluated on a **grid** of poses, and each sample must
  clear the cell diagonal times an allowance;
- the allowance is **three times the steepest finite difference the grid
  itself shows**, floored at 1. That is empirical evidence about the sampled
  function, not a uniform Lipschitz bound, and no enclosure proof stands
  behind it;
- every sample in a region must share one **contact signature**, so that no
  grazing surface hides between samples — again, between samples;
- every certificate is then put to the **engine** on random poses and random
  moves. Engine agreement is falsification that did not fire. It does not
  repair a missing enclosure argument.

The negatives are weaker still. **`escape` here means "no certificate was found
by this procedure within this budget", not "an escape exists"** — and 865 of
the 909 escapes below were rejected by the cheap screen alone, which never
attempted a full certificate. `unresolved` means a gap at the engine's substep
that no single arc could close. Neither is a proof about the game.

Degrees, radians and Rθ: poses in the data files carry **radians** in
`brot`/`rrot`; every angle in this text is labelled where it appears; the
Lipschitz metric is L1 over both pieces with rotation weighted by R = 23.095u,
so a ball radius `eps` is in **units of foot travel (u)**.

## Guides in this directory

- [`SEARCH-GUIDE.md`](SEARCH-GUIDE.md) — how `forced-win.js` and `contact-law.js` work:
  what a certificate claims, the depth and screening options, how a batch run is seeded
  and resumed, and what the four outcomes mean. Start here if the code is new to you.
- [`astra-brief-6-throw-certificate-reproduction.md`](astra-brief-6-throw-certificate-reproduction.md)
  — an open question sent for outside review: `nn/THROW-CONTACT-LEMMAS.md` section 8
  claims an enclosure *proof* that closes, and its recorded numbers do not reproduce on
  the code committed with it. Do not cite section 8's figures until that resolves.

## Provenance and pinning

`nn/forced-win.js` and `nn/contact-law.js` were copied verbatim onto this
branch from `origin/claude/project-thread-mtkkjf` (tip `2c229a265`); the blobs
are unchanged, so these results are comparable with PR #23's. `nn/engine.js`
re-exports `crossingSubstep`, which that branch exports and this one had
dropped. No rule and no `index.html` behaviour was changed.

The whole run executed against a **frozen copy** of `index.html` at blob
`729a394959968e5fbdb5af10d3067005712b890f` (this branch's HEAD `5252f2d83`),
outside the working tree, because a concurrent session was editing `index.html`
in it. `nn/engine.js` extracts the rules live from `index.html`, so an edit
mid-run would have moved the rules underneath the certificates.

## The run

Seeds: `nn/dead-seeds.js` samples decided games out of `nn/data/*.jsonl` and
takes the position **one loser-move before the throw** (`k=0`), the way
`--mine` does. A pilot at `k=0,1,2` showed dead verdicts are concentrated at
`k=0` (12 of 13), so the main run used `k=0` only.

| Stage | Tool | Result |
| --- | --- | --- |
| Screen + certificate | `forced-win.js --dead-batch --depth 1 --threads 3` | 1306 distinct positions: **261 dead**, 909 escape, 136 unresolved |
| Falsification | `nn/verify-dead.js`, 40 random legal moves each | **261/261 agreed, 10440 playouts, 0 contradictions** |
| Point → region | `nn/star-drive.js` → `forced-win.js --star` | see below |

### Certified dead points — `dead-points-mined.jsonl`

**261 certified dead positions, against a baseline of 4** in
`nn/dead-positions.jsonl` (`6dgqa1fd8-0`, `ndpxhts24-0`, `l5807vazg-0`,
`0r8c3cohc-0`). 123 have blue to move, 138 red.

Worst throw margin over all replies, per position (u past the off-board
threshold, so bigger is safer):

| min | p25 | median | p75 | max |
| --- | --- | --- | --- | --- |
| 0.025 | 0.461 | 0.846 | 1.480 | 5.821 |

16 of the 261 have a worst margin under 0.2u and 69 under 0.5u. Those are the
ones to distrust first: the certificate's own allowance is derived from
measured slopes, and a 0.025u margin is thinner than the engine/law
disagreement of ~0.6u that `ESC_TOL` exists to absorb. **104 of the 261 rely on
at least one sliver-rule acceptance** at the engine's substep rather than on a
single common arc spanning the gap; the `slivers` field records how many.

### Certified dead balls — `dead-balls.jsonl`

`--star` turns a dead point into a dead **ball**: an L1 ball of radius `eps`
in the joint 6-D pose space of both pieces, inside which the side to move is
certified dead everywhere, via six reach envelopes over the mover's box and 13
dead certificates swept to those envelopes. This is the artifact with actual
6-D volume, and the baseline had **one**.

A refusal at half-box `h` is not a claim that the point is not dead. It means a
reach envelope changes **stopping event** inside the box: the swing limit is
continuous only between events, so the box straddles a wall and must be shrunk
or split. The driver walks h = 0.3, 0.12, 0.05u and keeps the first that is
accepted.

**Result: 132 star attempts — 67 accepted, covering 63 distinct poses; 65 refused.**
Radii run from `eps` 0.009u to **0.350u**, median 0.095u; the widest carries
W = 1.014u with the engine agreeing on 25 of 25 random poses. Every one of the
63 passed its engine falsification pass. Nearly half of all attempts were
refused, which is the expected shape: the envelope-wall test is the binding
constraint, not the margin.

The refusals are as informative as the balls. A point that refuses at every `h`
on the ladder is sitting on or beside an event wall, and those are exactly the
places where a moving tube -- not a fixed box -- is the construction that will
be needed. See the closing section.

### How big is all of this, really? — `nn/dead-corpus-geometry.js`

Merged on pose (each ball was grown from one of the points), the corpus is **261
distinct certified dead positions, 63 of them carrying a certified radius** of
0.009-0.350u. Measured in the metric the certificates are issued in, the closest
any two same-mover certified positions come to each other is **5.57u** (median
30.07u); **none** is within 1u of another and **no two balls overlap**. The
certified 6-volume, on `Vol6 = (pi^2/45) * eps^6`, is `1.845593e-3 u^6` — which
independently reproduces Astra's `0.00184559`. Run `node nn/dead-corpus-geometry.js`.

The consequence is recorded in [`l11-dead-measured.md`](l11-dead-measured.md): the
set is 261 isolated needles, so a lookup table over it cannot be a playing-strength
mechanism, and the corpus's value is as the input to a *rule* — Brief 5's classes
and regions — not as an enumeration to ship.

### Recorded misses — `screened-not-dead.jsonl`

All 1045 non-dead seeds, with the reason. 909 escape (865 of them from the
screen alone, 44 from a full certificate attempt) and 136 unresolved — every
one of the 136 for the same reason, *"no single arc certifies the gap"* at some
reply's substep boundary. That is a concentrated, addressable weakness in the
checker, not 136 different problems.

## A finding worth keeping: dead does not require contact

The earlier catalog note in `nn/dead-positions.jsonl` records that *"the four
real dead positions are all in contact"* and that non-touching rim positions
were never dead in that sample. With 261 points that no longer holds: **10 of
them have the two pieces strictly apart**, up to a clearance of **17.1u**
between the nearest legs.

The clearest is `u6nehpcuw-1`, red to move, pose
`-3.9934,2.8817,-0.0691,33.4128,-29.5851,4.706` (radians):

```
blue hub (-4.0,2.9)   feet r = 19.1, 27.5, 23.5
red  hub (33.4,-29.6) feet r = 62.3, 56.5, 22.4      (rim 66.667u, off-board 67.167u)
red to move: DEAD -- every move certified lost, worst margin 0.68u; engine 40/40
  arm (0,1) legal to 22.3deg, dead 2.4-22.3      arm (1,-1) legal to 32deg,   dead 2-32
  arm (0,-1) legal to 16deg,  dead 2-16          arm (2,1)  legal to 32.3deg, dead 2.4-32.3
  arm (1,1) legal to 8deg,    dead 2-8           arm (2,-1) legal to 55deg,   dead 2.4-55
```

Blue is 17u clear in the middle of the board. Red is pinned against the rim,
and every stopping angle on all six of its arms leaves blue a throw. So the
operative condition is **the victim being cornered against the rim**, not the
two pieces touching. Contact is still overwhelmingly typical — 251 of 261 dead
points are in contact — but it is not necessary. (It is nowhere near
sufficient either: 925 of the 1045 *non*-dead seeds are also in contact.)

## Reproducing

```sh
node nn/dead-seeds.js nn/data seeds.jsonl 1400 20 0 424242
node nn/forced-win.js --dead-batch seeds.jsonl --depth 1 --out out.jsonl --threads 3 --maxSeconds 7200
node nn/verify-dead.js out.jsonl verified.jsonl 40 0 1
STAR_HS=0.3,0.12,0.05 node nn/star-drive.js verified.jsonl graph.jsonl starlog.jsonl 0 1 2000
```

Run it against a checkout whose `index.html` is not being edited, or the rules
will move under the certificates. `--dead-batch` is resumable: rows already in
`--out` for the same `(pose, mover, depth)` are skipped.

## What would turn any of this into a theorem

Nothing here closes the obligations Brief 4 left open, and none of it should be
described as having done so. The missing pieces are still an enclosure argument
for the margin over a cell (not a grid of samples times an observed slope), a
phase-indexed moving tube rather than a fixed invariant box, and exact branch
maps for a fixed victim vertex and a fixed attacker vertex separately. The 136
unresolved gaps above are the most concrete lead in this run: they are all the
same failure, at a substep boundary where the throwing arm changes.
