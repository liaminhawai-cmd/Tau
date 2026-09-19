# Tau: dead-region geometry and proof audit

Open `tau-dead-region-analysis.html` in a browser. It is self-contained, includes an index and enlargeable vector figures, and needs no network.

The report addresses the supplied dead-region brief, the four subsequent search-log attachments, and `throw-theorem.md`. It does not change the game or merge a PR.

## Included

- Five ndpxhts24 wall slices, individually labeled versions, three pivot planes, an all-arm phase atlas, rim slices, and the swing figure, in SVG and PNG.
- `swing-events.csv`: every event in the requested clockwise swing.
- `geometry-data.json`, `rim-data.json`, `wall-catalog.json`, and other JSON files: numerical results and exact event tags.
- `validation.json`: 72 reproducible random engine comparisons, supplementing the 24 seed-arm comparisons in `geometry-data.json`.
- `search-results-summary.json` and `deep2-latest.csv`: deduplicated uploaded-log analysis and input hashes. The original uploads are not duplicated here.
- `throw-audit-values.json`: algebraic checks of the proposed throw theorem.
- All analysis, plotting, and report-building scripts.

## Reproduce

Requirements: Python 3 with NumPy, SciPy, Matplotlib, and contourpy; Node.js. Versions used were NumPy 2.3.5, SciPy 1.17.0, Matplotlib 3.10.8. The source retrieval step requires internet access; plots can be regenerated offline from the included data.

Run these separately from this directory:

```
python fetch_sources.py
node compute.js
node compute-other.js
node validate.js
python geometry.py
python plot_geometry.py
python audit_throw.py
python analyze_results.py /path/to/the/four/uploaded/log/files
python build_report.py
```

The source revision is `e32f09d5be9600212c3d5294b70a3835f0517427` in `liaminhawai-cmd/Tau`, PR #18. Repository source files are retrieved by `fetch_sources.py`, rather than duplicated in this bundle.

## Scope

The event equations are analytic, while rendered contours and active-event selection use finite grids. The report explicitly states the grid resolution and the absence of a complete interval decomposition of the intervening volume. No new continuous dead-region proof or throw-margin survey was performed. Recorded certificates and random engine checks are empirical evidence. The proposed replacement throw theorem is a sufficient statement conditional on validated reachable-state enclosures; those enclosures have not been implemented.
