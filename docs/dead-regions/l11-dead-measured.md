# Does knowing the dead spots make L11 stronger?

> ## CORRECTION (2026-09-19, after Brief 5 review)
>
> **This measurement did not test the 261-point / 63-ball corpus.** Astra's Brief 5
> review checked the shipped code and found that the L17 rung carries a
> hand-embedded table of ~4 `dead` entries and 4 `win2` entries at lookup radii
> `DEAD_CERT_EPS = 1.0` / `DEAD_BALL_EPS = 1.5`, and that neither
> `dead-points-mined.jsonl` nor `dead-balls.jsonl` is referenced anywhere in
> `index.html` or `nn/engine.js`. Verified independently: both greps return zero.
>
> So "23,804 consultations, 0 hits" is a true statement about the **old
> 4-point baseline table**, and says nothing about the new corpus. The
> conclusion drawn below — that the certified set is too sparse to ever fire —
> **does not follow from this experiment.**
>
> Two further corrections from the same review:
>
> * **The zero-volume argument is wrong.** It is true of a slice with the
>   attacker held fixed, but `certifyStar` perturbs all six pose coordinates.
>   In the implemented metric a radius-eps ball has ambient volume
>   `Vol6 = (pi^2/45) * eps^6 > 0`; over the 63 radii that sums to
>   0.00184559 u^6 in scaled coordinates. The balls are full-dimensional.
>   The corpus README stated this correctly; the brief contradicted it.
> * **`nearestVictim` 2.85u is not comparable to the 0.35u ball radius.** It
>   measures one piece's distance to eligible *embedded point entries*, not the
>   minimum joint-pose distance to the new balls. Comparing them mixes two
>   different tables and two different measurements.
>
> What still stands: the 56-40 score itself, and that the interval is
> inconclusive. But "a big margin is ruled out" also over-claims -- the 95%
> interval runs -11 to +133 Elo and therefore includes +100. Ruling out a big
> margin needs a stated threshold. The dense-test and guard counters likewise
> show those mechanisms *ran*; isolating their effect needs an ablation and an
> equal-time baseline, neither of which was done here.


`AI_LADDER`'s `L11+dead` (arena spec **L17**, `kind:'dead'`, marked
`experimental:'dead-set'`) is L11's evaluator, roots and pessimistic minimax
plus knowledge of the certified dead set. This is the measurement.

## Result: no, not by a big margin, and not provably at all

96 games against plain L11, `--openingPlies 2`, six lanes of 16.

| | |
| --- | --- |
| record | **L17 56 — 40 L11** |
| win rate | 58.3% (SE 5.0pp) |
| 95% CI | 48.5% .. 68.2% |
| Elo | **+58, 95% CI −11 .. +133** |
| significant at 95%? | **No — the interval straddles even** |

At this sample the honest statement is "possibly a little stronger, not
established". It is nowhere near a big margin, and 96 games cannot separate
+58 Elo from zero.

## The certificates themselves fired exactly zero times

This is the finding that matters, and it is unambiguous:

```
table consulted 23,804x  ->  0 point hits, 0 arc hits
nearest approach by the victim to any certificate: 2.85u
largest certified ball radius:                     0.35u
```

Across 96 games the rung consulted its certified table 23,804 times and never
once matched. The closest live play ever came to a certified region was **2.85u
in the L1 pose metric, against a largest ball radius of 0.35u** — roughly eight
times too far away, and that is the *nearest* approach over the whole run.

This is the geometry, not bad luck. Holding the attacker fixed and varying the
victim sweeps a 3-D set inside a 6-D joint pose space: it has zero 6-dimensional
volume. 261 points and 63 balls of radius ~0.1u do not change that. A lookup
table of certified positions is not a playing strength mechanism and should not
be expected to become one by adding more certificates at this rate.

## What did the work instead

The rung carries two other mechanisms, and neither consults the table:

```
dense test  1,005x  ->  265 confirmed dead, 740 refuted
guard         285x  ->  232 moves declined
```

The **dense test** re-derives deadness on the fly for a position the search
already suspects is a forced win. The **guard** spends 6 candidates x 12 replies
looking for a forced loss and declines the move when it finds one. Whatever
part of the +58 Elo is real comes from these, i.e. from the *machinery* built to
verify certificates being used as an online tactical check — not from the
certified knowledge it was built to verify.

That reframes the result usefully. "Teach L11 the dead spots" does nothing.
"Give L11 an online forced-loss check" may do something, and is worth measuring
on its own, without the table, at a sample large enough to resolve it.

## Cost

L17 ran at ~81s per game against L11 under six-way CPU contention, driven by the
guard's 72 extra reply evaluations per move. Any future verdict should be at
equal *time*, not equal games: a rung several times slower per move can be
stronger per game and still weaker in a real clock-bounded match.

## Reproducing

```
node nn/arena.js --a L17 --b L11 --games 16 --openingPlies 2 --deadStats
```

`--deadStats` prints the counters above; they are the reason this question could
be answered rather than guessed at.

---

# Settling it properly: the corpus itself, measured (2026-09-19)

The correction above withdrew the sparsity conclusion because the experiment had
tested the wrong table. The question can be answered without any game at all, and
without the shipped table, by measuring the corpus in the metric its own
certificates are issued in. That measurement is below, and it reaches the same
verdict on evidence that actually supports it.

## The certified dead set is 261 isolated needles

Merging `dead-points-mined.jsonl` and `dead-balls.jsonl` (each ball was grown from
one of the points, so they are the same position and are counted once) gives **261
distinct certified dead positions, 63 of which carry a certified radius**. Nearest
same-mover neighbour, joint L1 distance over both pieces with rotation as arc
length (`R = 23.095u`) — the metric `forced-win.js` certifies in:

| min | p05 | median | p95 | max |
| --- | --- | --- | --- | --- |
| **5.57u** | 10.83u | 30.07u | 58.05u | 87.93u |

Against that, the certified radii: **min 0.009u, median 0.095u, max 0.350u.**

- Entries whose nearest same-mover neighbour lies within 1.0u: **0 of 261.**
- Entries within 5.0u of another: **0 of 261.**
- Pairs of certified balls that overlap, or even come within twice the sum of
  their radii: **0.**

The closest any two certified dead positions come to each other is **sixteen times
the largest ball radius in the corpus**, and about sixty times the median one. The
set is not a region with gaps in it. It is 261 needles.

## So the table cannot fire, and that is geometry, not sample size

A crude box for the reachable joint pose space — each hub over a disc of radius
66.667u, each rotation over its full 2*pi*R = 145.1u of arc — is about
`4.1e12 u^6`. The 63 balls' ambient volume, by Astra's own
`Vol6 = (pi^2/45) * eps^6`, totals `0.00184559 u^6`. That is a coverage ratio of
order **1e-16**. The box is crude and mixes a Euclidean disc with an L1 ball, so
treat it as an order of magnitude only; the 5.57u-vs-0.35u separation above needs
no modelling and says the same thing exactly.

As a check against real play, the 1,045 positions in `screened-not-dead.jsonl` —
genuine self-play positions taken one loser-move before a throw, i.e. the most
throw-adjacent sample the project has — were measured against the corpus:

```
nearest joint distance to any same-mover certified entry
  min 5.22u   p05 18.09u   median 42.75u   p95 75.82u
inside a certified ball (eps 0.009-0.35u):        0 / 1045
inside even the shipped over-claimed eps = 1.0u:  0 / 1045
```

(Those 1,045 were screened and found *not* dead, so finding none of them dead is
expected and is not the point; the distances are. Nothing in real play comes
within an order of magnitude of a certified region.)

## What this does and does not now establish

It **does** establish that a lookup table over this corpus cannot be a playing
strength mechanism, for a reason that does not depend on which table the L17 rung
happens to carry, on 96 games, or on any counter. The certified regions are too
small and too far apart for play to land in one. Shipping all 261 points and 63
balls into `DEAD_CERTS` would change the L17 result by nothing, and shipping them
at the current `DEAD_CERT_EPS = 1.0` would additionally claim a radius **three
times larger than the largest one ever certified**, on 198 points that carry no
certified radius at all (`"ball": null`). That is not a code change worth making.

It **does not** say the corpus is worthless, or that dead knowledge cannot help.
It says enumeration is the wrong shape. 261 points at 30u spacing is a **training
set for finding the rule**, not the rule — which is exactly what Brief 5's region
criterion asks for, and exactly what "find classes and regions that are dead, not
just points" means. The corpus earns its keep as the input to that, and as the
falsification set any candidate rule must survive.

It also leaves the reframing above untouched and still worth doing: the dense test
(1,005 calls, 265 confirmed) and the guard (285 calls, 232 declines) are the parts
of L17 that actually ran, they do not consult the table, and whether they are worth
their ~81s/game belongs in its own equal-time measurement.

## Reproducing

```
node nn/dead-corpus-geometry.js
```
