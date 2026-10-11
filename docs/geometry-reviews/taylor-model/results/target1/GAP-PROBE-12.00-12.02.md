> **Historical only — superseded after the arithmetic review on 11 October 2026.** This six-cell adaptive result was generated with the old square-root remainder expression and must not be used as current proof evidence. The post-fix narrow cell is recorded separately: [corrected cell JSON](probes/arm_1_p/cover_12_12.0001_d4.json) and [replay/Red-legality record](probes/arm_1_p/validation_12_12.0001.json). The corrected cell does not certify the whole [12°, 12.02°] interval.

# Target1 arm (1,+): provisional gap probe [12°, 12.02°]

Date: 11 October 2026  
Branch: `claude/serene-pasteur-psjoi2`  
Purpose: test whether the existing Red witness (pivot 2, direction +, 107 substeps) can be certified immediately inside the still-open interval [12°, 16.5°].

## Run result

The adaptive `cover2.js` routine accepted this slice with:

| Measure | Result |
| --- | ---: |
| Blue arm | (1,+) |
| Tested interval | [12°, 12.02°] |
| Degree | 4 |
| Accepted cells | 6 |
| Failed leaves | 0 |
| Cover attempts | 11 |
| Minimum recorded throw margin | 2.974780695877939 board units |
| Cell widths (min / median / max) | 0.000625° / 0.0025° / 0.01° |
| Modes | 5 plain, 1 straddle |

The cover needed retries: four attempts stopped at an unresolved vertical-contact branch, and one at a near-parallel-segment denominator. Subdivision/branch handling then accepted the six cells. A direct non-adaptive attempt on [12°, 12.01°] stopped at phase A substep 33 because the horizontal-fraction enclosure straddled an unresolved vertical-contact condition; this is a limitation of that enclosure attempt, not a counterexample to the candidate Red reply.

## Important status

This was an in-memory cover-stage run. The six leaf records were not saved by the runner in this session, and I did **not** run the independent replay audit, cellwise engine-containment check, or Red-line-legality check on this slice. Treat this as a positive exploratory result, **not yet a promoted certificate**. The persisted result must be regenerated and audited before the slice is added to the formal coverage map.

## Reproduction

From `docs/geometry-reviews/taylor-model`, using the Target1 (1,+) fixture:

```sh
PROBLEM=target1-b1p SYMREM=1 VTX=1 MAXPASSES=8000 MAXOPS=3500000 MERGE_MAXW=0.0005 MAXOPS_MERGE=1500000 node cover2.js 1 1 12 12.02 4 1e-5
node audit2.js 1 1 12 12.02 4
node validate-cover2.js 1 1 12 12.02 3 4
```

On a POSIX shell, the first command writes its cell JSON under `results/target1-b1p/arm_1_p/`. The audit and validation commands should be run only after that leaf file has been regenerated. Promote this slice only if the replay reproduces every saved margin and validation reports zero containment failures, zero legality failures and zero stopped cells.
