# Tau Brief 2 — derivations and reproducible checks

Read `tau-brief-2-response.html` for the self-contained report. It works offline and embeds all three SVG figures. `tau-brief-2-response.md` is the editable text. The report distinguishes mathematical lemmas, conditional numerical predictions, and floating-point engine reproductions.

The accompanying scripts do not implement a completed interval throw certificate. They reproduce the specific counterexamples and numbers used to determine what such a certificate must prove.

## Source revision

Tau repository: https://github.com/liaminhawai-cmd/Tau

Pinned revision: `e32f09d5be9600212c3d5294b70a3835f0517427` (PR 18).

Repository source files are retrieved by the companion `dead-geometry/fetch_sources.py`. The analysis scripts expect this directory structure:

```text
dead-geometry/
  fetch_sources.py
  index.html             # fetched
  source/                # fetched nn modules
brief2/
  README.md
  tau-brief-2-response.html
  tau-brief-2-response.md
  find-tie.js
  walls.js
  phase-check.js
  checks.js
  numbers_and_figures.py
  build_report.mjs
  figures/
  ... JSON outputs
```

## Reproduce the engine results

Requires Python 3 for fetching source, Node.js, and an internet connection to GitHub. Tested with Node 24.19.0. From the archive's root, run these commands in order:

```sh
python dead-geometry/fetch_sources.py
node brief2/find-tie.js
node brief2/walls.js
node brief2/phase-check.js
node brief2/checks.js
```

`find-tie.js` reconstructs the supplied ndpxhts24 reply and throw, then searches translations near its contact-feature changes. It finds two competing interior chord contacts below distance 2.88 and saves them in `contact-tie.json` together with the sweep trace.

`walls.js` checks the circle equations and traces line-contact state changes. It also recreates the small scan that finds longer programs without any corner-disc intersection.

`phase-check.js` keeps a pivot fixed while rotating the tripod around it through one limit-sampling period. It records the program and limit changes.

`checks.js` reproduces the contact updates, then exposes the actual game's `resolvePush` in memory and compares its output. It also checks representative phase cases with `limitLadder`, which runs the full engine, including push physics. No repository file is changed. `checks.json` reports zero pose discrepancy for the two push counterexamples.

## Recompute bounds and figures

With NumPy and Matplotlib installed:

```sh
python brief2/numbers_and_figures.py
```

This writes `numeric-bounds.json` and the SVG/PNG figures. The formulas are analytical sufficient bounds, evaluated in ordinary floating point for illustration; this is not an outward-rounded interval implementation.

To rebuild the HTML report, `build_report.mjs` uses the `marked` npm package. It first checks `CODEX_PRIMARY_RUNTIME_NODE_MODULES` when available and otherwise uses local Node module resolution. Install `marked` in the usual way if necessary, then run:

```sh
node brief2/build_report.mjs
```

The generated report needs no JavaScript package or network connection to read. Its small embedded script only enlarges the figures.

## Files of interest

- `contact-tie.json`: exact decimal input poses, the two minima, closest points, normals, and the 46° reference sweep.
- `checks.json`: full-engine comparisons and the fixed-pivot limit cases quoted in the report.
- `walls-data.json`: seed circle gradients/distances and line-contact traces.
- `phase-check.json`: complete fixed-pivot phase scans.
- `e-candidates.json`: longer a1/r1 programs that the K8 tangency fails to characterize.
- `numeric-bounds.json`: A/B/C predictions, the explicit Hessian constants, and the scalar gap ratio.

Figures are reproducible scientific plots of the equations and engine outputs. The report does not infer volume-wide proof from the samples, and does not claim all boundary pairs in the unprovided 21³ maps have been classified.
