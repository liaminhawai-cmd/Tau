# Target1 arm (1,+): validated post-fix slice [12°, 12.02°]

Date: 11 October 2026  
Blue move: pivot 1, direction +, stop angle in [12°, 12.02°]  
Red reply: pivot 2, direction +, 107 substeps of 0.375°  
Arithmetic source: post-square-root-bound-fix `tm.js` (blob `8f9f9b0cf69bc92687a77fcef7360c1cab32513a`)

**Status: this slice is now regenerated, replay-audited, tiled, and passed cellwise containment and Red-legality checks.** It is a narrow, post-fix interval result; it does not establish the rest of the old coverage corpus or close the full gap.

## Reproducible run

- [GitHub Actions run](https://github.com/liaminhawai-cmd/Tau/actions/runs/38118866133)
- [Run artifact](https://github.com/liaminhawai-cmd/Tau/actions/runs/38118866133/artifacts/11694543580)
- [Temporary draft PR used to trigger the run](https://github.com/liaminhawai-cmd/Tau/pull/51)
- Committed cell data: [`cover_12_12.02_d4.json`](../target1-b1p/arm_1_p/cover_12_12.02_d4.json)

The job checked out the current Taylor-model source after the square-root Lagrange-remainder correction. Its cover step ran `cover2.js` with degree 4, `SYMREM=1`, `VTX=1`, `MAXPASSES=8000`, `MAXOPS=3500000`, `MERGE_MAXW=0.0005`, and `MAXOPS_MERGE=1500000`.

## Results

| Check | Result |
| --- | ---: |
| Tested interval | [12°, 12.02°] |
| Accepted Taylor-model cells | 6 |
| Failed leaves | 0 |
| Cover attempts | 11 |
| Minimum certified throw margin | 2.9747806958807383 board units |
| Minimum hub-motion lower bound | 18.053467425995223 board units |
| Cell widths (min / median / max) | 0.000625° / 0.0025° / 0.01° |
| Cover modes | 5 plain, 1 straddle |
| Exact binary64 tiling | passed; 6 cells, no gaps or overlaps |
| Independent margin replay | 6/6 reproduced, 0 mismatches |
| Cellwise sampled engine containment | 5,844 comparisons, 0 outside, worst observed excess 0 |
| Red-line legality | 0 failing cells |
| Stopped validation cells | 0 |

The four contact patterns summarized by the cover retry log that initially failed were resolved by subdivision; one near-parallel-segment case was also split. The accepted cells all have positive margin. Red's moving foot 1 remains on line r1 over one continuous contact episode: substeps 35–43 in four cells and 35–44 in two cells.

The containment check is a finite sampled replay, not a proof of binary64 equivalence for every possible execution. The interval argument remains conditional on the Taylor-model and trigonometric enclosure implementation and the idealised collision/rule model being sound.

## What this closes—and what it does not

This post-fix run establishes the six-cell interval [12°, 12.02°] under the certificate's stated assumptions. Since the old covers on [2°, 12°] and [16.5°, 20.71908458837398°] were generated before the arithmetic correction, they remain **historical pending post-fix rebuild and re-audit**. Thus the new verified slice does not yet join a current post-fix cover from 2° upward, and the still-open portion of the original central gap is [12.02°, 16.5°] (4.48° wide).

The original in-memory exploratory attempt on this slice is superseded: it did not save leaves or run these checks, and its numbers must not be used as current evidence.

## Reproduction

From `docs/geometry-reviews/taylor-model`:

```sh
PROBLEM=target1-b1p SYMREM=1 VTX=1 MAXPASSES=8000 MAXOPS=3500000 MERGE_MAXW=0.0005 MAXOPS_MERGE=1500000 node cover2.js 1 1 12 12.02 4 1e-5
PROBLEM=target1-b1p node tiling.js 1 1 12 12.02
PROBLEM=target1-b1p SYMREM=1 VTX=1 node audit2.js 1 1 12 12.02 4
PROBLEM=target1-b1p SYMREM=1 VTX=1 node validate-cover2.js 1 1 12 12.02 3 4
```

The cover cells are already committed at `results/target1-b1p/arm_1_p/cover_12_12.02_d4.json`; future runs should reproduce the reported margins exactly.
