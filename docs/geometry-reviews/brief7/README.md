# Brief 7 review and local contact-chart bound

Read [response.md](response.md). The repaired checker reproduces the singleton
failure, but ∂G/∂r is uniformly positive on explicitly specified candidate
domains spanning the park. This is a real-geometry chart bound, not a proof of
reachable-set containment or of the full finite engine.

## Reproduce

Requires Python 3 and Node.js. From this directory:

```sh
python fetch-sources.py --checkout /path/to/Tau
# Alternatively, use an authenticated GitHub CLI:
# python fetch-sources.py
python fetch-sources.py --verify
node diagnostic.js
node reference-poses.js
python park_bounds.py
```

The exact sources are restored into `repo/` at
`18efad5398798b65b477f9af4be17947a358d3ce`. `probe.js` exposes existing
functions and adds observation hooks in memory, without changing the checker
algorithm. `reference-poses.js` regenerates the larger nominal trace; it is
not committed here. `pieces.json` contains the full-precision post-reply input.

`diagnostic.json` records all six widths on both arms and observations of the
nonlinear fallback. `park-bounds.json` records all 31 domains, each divided
into 16 subboxes, and the radial derivative lower/upper bounds.

The interval kernel is adapted from Brief 4: binary64 endpoints are rounded
outward using `nextafter` after each arithmetic operation; trigonometric bounds
use Taylor remainders. It bounds the real geometry and does not enclose each
rounding operation of the actual game's contact solver. The new quantity is
`radialDerivative = (h_f) n·u` for all retained closest-feature candidates.

Optional figure regeneration requires Matplotlib:

```sh
python figures.py
```
