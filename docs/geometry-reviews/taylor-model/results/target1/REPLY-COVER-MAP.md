# Target 1 — response-cover map for blue arm (2,+)

**Seed:** the fixed Target 1 seed in `problems/target1.json`.  
**Question addressed:** for every stop angle in the tested range of blue's legal swing family (pivot 2, direction +), is there a legal red response that throws Blue?  
**Scope:** this covers one blue move family, not all six blue arms, so it is not yet a theorem that the starting position is globally dead.

## Closed angle cover

| Blue stop-angle interval | Red response witness | Cells | Replay audit | Cellwise check | Minimum Taylor-model throw margin |
|---|---|---:|---|---|---:|
| [2°, 9.6828°] | pivot 0, direction −; 120 substeps | 427 | 427/427, 0 mismatches recorded | 0 contain / 0 legal / 0 stopped; 465,180 point comparisons | 5.409085u |
| [9.6828°, 9.73°] | pivot 0, direction −; 120 substeps | 2 | 2/2, 0 mismatches | 0 contain / 0 legal / 0 stopped; 2,178 point comparisons | 6.816388u |
| [9.73°, 14.33°] | pivot 2, direction +; 36 substeps | 51 | 51/51, 0 mismatches | 0 contain / 0 legal / 0 stopped; 17,085 point comparisons | 0.097729u |

The three intervals meet at their endpoints, so there is no uncovered angular sliver inside [2°, 14.33°]. A witness switch at 9.73° is allowed: Blue only needs to have a losing red reply, not the same reply for every stop angle.

The union contains 480 accepted Taylor-model cells. The smallest recorded terminal margin in the union is positive (about 0.0977 board units), attained on the upper interval. The smallest recorded hub-motion lower bound is 2.3882u on that same upper cover.

## What the checks establish

- Each upper and gap cell was accepted by the degree-4 Taylor-model cover runner.
- Replay audits reproduce all 53 gap+upper margins exactly with zero mismatches.
- Cellwise engine correspondence and red-legality checks reported no failures: 484,443 sampled containment comparisons in total, all inside the model within the checker's 1e-9 tolerance.
- The lower interval's latest CI rebuild and closure run succeeded with 427 cells and zero failed containment, legality, or stopped cells.

Those checks support a conditional interval result under the soundness of the Taylor-model operations, their remainder bounds, and the encoded idealised move/collision rules. The engine comparisons are finite samples and do not alone prove universal binary64 equivalence. See the per-cell JSON records for the accepted enclosures and the separate CI logs/artifacts for replay and closure summaries.

## Reproduction

From `docs/geometry-reviews/taylor-model`:

```sh
PROBLEM=target1 SYMREM=1 VTX=1 node cover2.js 2 1 2 9.6828 4 1e-5
PROBLEM=target1 SYMREM=1 VTX=1 node audit2.js 2 1 2 9.6828 4
PROBLEM=target1 SYMREM=1 VTX=1 node validate-cover2.js 2 1 2 9.6828 3 4

PROBLEM=target1 SYMREM=1 VTX=1 node cover2.js 2 1 9.6828 9.73 4 1e-5
PROBLEM=target1 SYMREM=1 VTX=1 node audit2.js 2 1 9.6828 9.73 4
PROBLEM=target1 SYMREM=1 VTX=1 node validate-cover2.js 2 1 9.6828 9.73 3 4

PROBLEM=target1-red2plus SYMREM=1 VTX=1 node cover2.js 2 1 9.73 14.33 4 1e-5
PROBLEM=target1-red2plus SYMREM=1 VTX=1 node audit2.js 2 1 9.73 14.33 4
PROBLEM=target1-red2plus SYMREM=1 VTX=1 node validate-cover2.js 2 1 9.73 14.33 3 4
```

## Next theorem obligation

The remaining move-class work is to cover the other legal blue swing families (pivots 0/1 and the opposite directions where legal), including exact endpoint/event handling. After that, the analytic and numerical soundness conditions for the Taylor-model enclosures need to be stated and justified before elevating this to a full mathematical theorem about the idealised game.
