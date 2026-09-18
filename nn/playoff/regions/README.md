# Per-region reliability of committee members

Asks the finer-grained version of the question `nn/playoff/` answers at game level: not just
inner vs outer, but is there a *specific* part of the board where one member's judgement is
better than another's?

It scores each member the way `committee.js` actually consumes them. `pool()` sums `log(p)`, so
the quantity that decides how much a member should be trusted somewhere is its **log-loss**
there -- literally the term being added up. For every recorded position with a decided outcome,
each member gives a win probability for the side to move, that is scored against what actually
happened, and binned by distance from centre, distance from the nearest line, and advantage
state.

## Running it

```
node reliability.js <worker> <nWorkers> [out.json]     # one slice, writes rel-w<worker>.json
node merge.js                                          # merges rel-w*.json, prints the tables
```

`TARGET=20000` positions per worker by default; `TAU_REPO` overrides the repo root.
`results-2026-09-18.txt` is the merged output of a 48k-position run.

## Read the output carefully -- two of the three tables are traps

**The log-loss-by-region table is confounded and must not be used to set weights.** Positions near
the rim are far more *decided* than mid-board ones: the accuracy table underneath shows every
member calling ~94% of the far-out positions correctly against ~71% mid-board. A loss gradient
across those bins measures how settled the positions are at least as much as who judges them
better, and it points the opposite way to the balanced game-level playoff. The playoff samples
evenly across cells by construction, so it, not this, sets the weights in `committee.js`.

**best.json's absolute loss is in-sample** -- it was trained on this corpus -- so do not read its
level against the ladder rungs as a strength estimate.

**The error-correlation table is the honest one**, and the reason this script is kept. It is
unaffected by both problems above, and it answers whether an extra committee seat buys anything:

```
L10 ~ L11    1.000      any two ladder rungs are one opinion
L9  ~ L10    0.993
deep ~ wide  0.985      any two nets are one opinion
ultra ~ wide 0.985
L11 ~ best   0.744      ladder vs net is the ONLY real split
L9  ~ best   0.680
```

A committee of three whose members make the same mistakes is a committee of one with three times
the compute. Picking a second net for a *different hidden shape*, which is what `pickAuto` does,
buys almost no independence -- 0.98+ correlated errors. This is what the `d2pair` league variant
(chair + top net, third seat removed) exists to test.
