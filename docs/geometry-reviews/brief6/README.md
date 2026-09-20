# Brief 6: reproducing the throw-certificate numbers

Read [the response](response.md). The recorded numbers reproduce on committed
code when the seed is advanced through **blue's (0,+1) reply to 8 degrees**.
The successful rotation half-width is **0.002 degrees**, not radians. The
two enclosure defects identified in Brief 4 remain in the unchanged checker.

## Reproduce

Requires Python 3 and Node.js. From this directory:

```sh
python fetch-sources.py --checkout /path/to/Tau
# Or, using an authenticated GitHub CLI:
# python fetch-sources.py
python fetch-sources.py --verify
node reproduce.js
node audit.js
```

`source-manifest.json` pins seven files at
`431f13129d57fb41dd17e0844b3bd55624e2c3b4` on
`claude/board-game-video-adaptation-cf8a93`. The fetch script restores them
under `repo/`, without changing another checkout. No game rule is patched.

`results.json` saves the engine replay of blue's reply, six direct CLI runs,
and the two 200-pose random validation passes. Random validation minima may
vary between runs; the deterministic checker values are the reproduction
target. One radian-box run crashes and one refuses, as documented.

`audit.js` uses `probe.js`, the Brief 4 diagnostic adapter. It exposes existing
functions and adds observation callbacks in memory; it changes no algorithm.
`audit.json` records the chord mismatch and carried-frame discrepancy on the
current dependencies. `pieces.json` is the historical full-precision post-reply
pose used to reproduce the published numerical results. The independent
engine replay differs by at most 3.56e-14 in a coordinate.

These are reproduced program outputs and proof-defect diagnostics. A returned
`CERTIFIED` label is not an endorsement of the enclosure argument.
