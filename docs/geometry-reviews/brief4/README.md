# Tau Brief 4 — the box-size gap

Read [the review](tau-box-size-review.md), or open `tau-box-size-review.html`
for the standalone illustrated version. This package documents two checker
defects, a unit mismatch, a fixed-box counterexample, local interval bounds,
and a proposed complete-contact-map/moving-tube argument. It does **not**
claim a completed whole-cell throw certificate.

## Source and arithmetic scope

`source-manifest.json` pins the reviewed Tau revision and seven Git blob hashes.
The checker blob was also checked unchanged at PR #18 head
`1ba97f2a9b7bf169c40972fa9476b10c77c3ee13`.

The JavaScript diagnostics use ordinary floating point. `slab-bounds.py` uses
outward-rounded intervals and Taylor enclosures for trigonometry to bound
local real polyline geometry. It does not enclose the floating-point engine's
full execution or prove that trajectories enter the selected local boxes.

Original source files are not duplicated here. Restore from a checkout that
contains the pinned commit, without changing that checkout:

```sh
python fetch-sources.py --checkout /path/to/Tau
```

Alternatively, with authenticated GitHub CLI access, run `python fetch-sources.py`.
Verify restored inputs with `python fetch-sources.py --verify`.

## Reproduce

Node.js and Python 3 suffice for the core checks. Run from this directory:

```sh
node probe.js
node map-checks.js
node second-arm.js
node reference-poses.js
python slab-bounds.py --step 20 --n 4
python slab-bounds.py --step 50 --n 4
python slab-bounds.py --step 74 --n 4
python slab-bounds.py --step 80 --n 4
python slab-bounds.py --step 84 --n 4
node slab-sample-checks.js
```

Expected principal results:

- The unchanged checker reports success at k85/k112 for ±0.0002u/±0.002 **degrees**.
- The actual ±0.002-radian input instead raises a null-reporting exception on
  foot 0 and refuses at k78 on foot 2.
- The park Jacobian selects attacker chord 2 instead of chord 1.
- The complete-map Jacobian's finite-difference discrepancies are below 3e-10
  at the four tested park poses.
- The diagnostic chord-and-frame correction refuses the small foot-0 box at k83.
- The centre leaves both fixed small boxes at k15 while still on the board.
- The three park slab enclosures have positive lower bounds on g and closing
  speed at the stated ±0.125u/±0.01-radian scale.
- The finite grids, 1,029 poses per slab, have zero interval-bound violations.

`reference-poses.json` includes geometry after the nominal throw for diagnosis;
this does not imply the actual game continues after its terminal event.
`probe.js` instruments the pinned checker in memory. `map-checks.js` also
applies two in-memory ablations; neither is a replacement formal checker.
The baseline exception's stack trace can contain the local source path.

## Figures and HTML

With NumPy and Matplotlib installed:

```sh
python figures.py
```

With the Node `marked` package installed:

```sh
node build_report.mjs
```

The generated HTML includes its SVG figure and works offline. Saved JSON
outputs are included so the reasoning and figure can be inspected without
re-running the source extraction. The interval results' `seconds` field is
timing metadata, not a mathematical output.
