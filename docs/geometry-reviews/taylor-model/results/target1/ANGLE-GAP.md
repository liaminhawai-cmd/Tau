# Target 1 angle-gap certificate

**Run:** [GitHub Actions #1](https://github.com/liaminhawai-cmd/Tau/actions/runs/37890116267)  
**Branch:** `claude/target1-gap-cert`  
**Problem fixture:** `problems/target1.json`  
**Proof source:** `cover2.js`, degree 4; `SYMREM=1`, `VTX=1`.

## Result

The fixed red witness arm `(0,-)`, `kRed=120` substeps, certifies the whole closed blue stop-angle interval
`[9.6828°, 9.73°]` using two accepted Taylor-model cells on blue arm `(2,+)`.

| Cell | Mode | Certified throw margin | Hub-motion lower bound |
|---|---|---:|---:|
| [9.6828°, 9.7064°] | straddle | 6.8163873595u | 17.6410209429u |
| [9.7064°, 9.73°] | plain | 6.8299661417u | 17.6362913791u |

No cell failed. Independent replay reproduced the two recorded margins exactly (2/2, zero mismatches).

## Engine correspondence checks

The cellwise checker reported:
- 0 containment failures and 0 red-legality failures;
- 0 stopped cells;
- 2,178 sampled containment comparisons across three sample points per cell, with 0 sample points outside the Taylor enclosure;
- crossing episode remains the same across both cells: foot 2 on ring r0 at substeps 23–39 overlaps foot 1 on ring r1 at substeps 38–82.

The containment figures are **sampled engine/model correspondence evidence**, not a universal proof about every floating-point trajectory. The mathematical result comes from the accepted Taylor cells, assuming the Taylor-model interval/remainder operations and legality encoding are sound.

## Scope warning

This closes the small interval `[9.6828°, 9.73°]` for this Target 1 fixture and this fixed red response. It does **not** by itself close the full `[2°, 14.33°]` interval. The current Target 1 branch contains a recorded cover for `[2°, 9.6828°]` and this new gap certificate, but no corresponding committed per-cell certificate for `[9.73°, 14.33°]`.

The separate response-cover research notes explicitly distinguish sampled response-band discovery from a proof: sampled apparent covers were contradicted by later probes, and a formal response-patch cover remained unimplemented. Therefore the upper interval must not be counted as proved until a matching certificate for this exact seed is produced and audited.

## Reproduction

From `docs/geometry-reviews/taylor-model`:

```sh
PROBLEM=target1 SYMREM=1 VTX=1 node cover2.js 2 1 9.6828 9.73 4 1e-5
PROBLEM=target1 SYMREM=1 VTX=1 node audit2.js 2 1 9.6828 9.73 4
PROBLEM=target1 SYMREM=1 VTX=1 node validate-cover2.js 2 1 9.6828 9.73 3 4
```

Committed records:
- `arm_2_p/cover_9.6828_9.73_d4.json`: accepted leaves and their proof bounds.
- `angle-gap-cover-summary.json`: cover statistics.
- `angle-gap-audit.json`: replay/audit summary.
- `angle-gap-closure.json`: containment and legality check summary.
