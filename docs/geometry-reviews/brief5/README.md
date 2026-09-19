# Brief 5: from points to regions

Read [the review](tau-dead-region-classes-review.md), or download its
[standalone illustrated HTML](tau-dead-region-classes-review.html).

This package audits the new 261-point / 63-ball corpus and the L17 measurement,
then gives a sufficient condition for a region using a finite cover of legal
replies. It includes a quantitative two-response bridge, the correct
finite-horizon winning-set induction, and an explicit engine diagnostic.
It does **not** establish a new nonempty region of proved Tau deadness.

## Source scope

The research snapshot is `c1ac39e771f8115797a4b8672587860fb676ad1b` on
`claude/board-game-video-adaptation-cf8a93`. The match report was published at
`b9907b05e40103dc459d3013b7a873ac12941f78`; its index, loader and arena blobs
match that snapshot. The corpus instead records a frozen rule index from
`5252f2d839b739f52ce69158dcddfcedbd62bbb7`.

`source-manifest.json` pins every restored blob. The three dataset JSONL files and the original Brief 5 write-up are copied under `data/` for inspection. The engine sources stay
outside this package in a generated `repo/` directory. `load.js` adds an export
of the already-extracted `crossingSubstep` in memory to the frozen loader;
it changes no rule function. The current index and loader are restored
separately for the L17 inventory audit.

## Reproduce

Requires Python 3 and Node.js; no npm dependencies for the checks.

```sh
python fetch-sources.py --checkout /path/to/Tau
# Alternatively, with authenticated GitHub CLI:
# python fetch-sources.py
python fetch-sources.py --verify
node audit.js
node gap-probe.js
```

The checkout must contain the pinned blobs (fetch the research branch if
necessary). `audit.json` records dataset accounting, metric calculations and
the embedded table inventory. The copied data is provenance material; the audit still loads the exact pinned engine sources after `fetch-sources.py`. `gap-probe.json` records nine finite diagnostic
stops, including all six attacker responses; it is not an interval proof.
The 10,440 and 1,575 falsification counts are read from the supplied records,
not re-run in this review.

Optional report generation uses Matplotlib, NumPy and the Node package `marked`:

```sh
python figures.py
node build_report.mjs
```

`response-coverage.svg` illustrates exact synthetic margins from the theorem.
It is not a plot of measured Tau margins. Original Brief 5 and the forwarded
Claude update are preserved in `../../project-context/inputs/`.
