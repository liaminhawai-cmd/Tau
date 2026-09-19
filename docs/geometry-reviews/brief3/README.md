# Tau vertex-dwell review — reproduction

Read `tau-vertex-dwell-review.html` for the standalone illustrated report. The
Markdown version and SVG figures are included for reuse.

This is a mathematical review and numerical diagnostic package. It does not
claim to certify the full throw from a nonzero initial pose box. The inequalities
in the report have derivations; the JavaScript formula implementations use
ordinary floating point, not outward-rounded intervals.

## Source

Repository: `liaminhawai-cmd/Tau`.

PR #18, branch `claude/project-thread-kyx87p`, commit
`2d39d4d53855a9a1aeb86e2674a35ec0aef0e8da`.

`source-manifest.json` records the eleven source paths and Git blob hashes.
Original repository files are obtained from that commit and are not duplicated
in this archive. The diagnostic instrumentation adds exports/callbacks in memory.

Restore from a local git repository containing the commit, without switching or
modifying its checkout:

```sh
python fetch-sources.py --checkout /path/to/Tau
```

Or use an authenticated GitHub CLI account with repository access:

```sh
python fetch-sources.py
```

Verify existing files:

```sh
python fetch-sources.py --verify
```

## Reproduce

The principal checks require Node.js and no external Node packages:

```sh
node diagnose.js
node checks.js
```

`pieces.json` contains the victim's pose after its 8-degree reply and the fixed
attacker seed. `diagnose.js` runs the checker and records exact before/after
poses, closest chord pairs, vertex KKT signs, singleton analyses and the failed
closure attempts. `checks.js` compares all 138 individual pushes with the
game's extracted `resolvePush`, checks the new bounds on three grids, and records
the numerical guard and overshoot calculations.

Expected principal results:

- The ±0.001u, ±0.004-degree initial box fails at substep 73.
- A singleton pre-step-74 analysis reports a 6.447579-degree bearing interval;
  the unique geometric normal has bearing −108.51136558 degrees.
- The before-push vertex run is 74–98; the after-push run is 79–104.
- Nominal first throw is substep 84, sweep angle 28 degrees.
- Maximum difference from the engine in `(x,y,R theta)` is below 1e-12u.
- Zero cone-bound violations on 2,187 finite grid poses.

The extended trace after the first throw is a geometry diagnostic; the real game
would already have ended. Additional vertex reentries appear later in that trace.

Optional smooth-arc comparison and figures require Python with NumPy, SciPy and
Matplotlib:

```sh
python smooth-arc.py
python figures.py
```

The smooth comparison holds the polyline trajectory's poses fixed and solves
only the two leg-0 closest-point parameters from 49 starting pairs. It is neither
a globally certified optimizer nor a smooth-engine trajectory simulation.

Generated data are already included: `diagnosis.json`, `checks.json`,
`smooth-arc.json`, and three original checker baseline outputs. To regenerate
the standalone HTML, install the Node `marked` package and run
`node build_report.mjs`.

The separate Claude explainer update names `claude/nn-arena-matches-tm1hi9`.
It was checked at `5217e4b89272c93ec55226d1ea1ee3f553cecba0`; this package uses
PR #18 for the newer lemma checker and does not mix the two versions.
