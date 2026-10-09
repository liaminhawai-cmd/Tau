# Target 1 angle-gap certificate

**Run:** [GitHub Actions](https://github.com/liaminhawai-cmd/Tau/actions/runs/37890116267)  
**Branch:** `claude/target1-gap-cert`  
**Problem fixture:** `problems/target1.json`  
**Proof source:** `cover2.js`, degree 4; `SYMREM=1`, `VTX=1`.

## Middle-gap result

The fixed red witness arm `(0,-)`, `kRed=120` substeps, certifies the whole closed blue stop-angle interval
`[9.6828°, 9.73°]` using two accepted Taylor-model cells on blue arm `(2,+)`.

| Cell | Mode | Certified throw margin | Hub-motion lower bound |
|---|---|---:|---:|
| [9.6828°, 9.7064°] | straddle | 6.8163873595u | 17.6410209429u |
| [9.7064°, 9.73°] | plain | 6.8299661417u | 17.6362913791u |

No cell failed. Independent replay reproduced the two recorded margins exactly (2/2, zero mismatches).

## Engine correspondence checks

The cellwise checker reported 0 containment failures, 0 red-legality failures and 0 stopped cells under its 1e-9 point-in-enclosure tolerance. Across three sample angles per cell it made 2,178 comparisons; the largest reported excess was 1.7763568394002505e-14. The red crossing episode was foot 2 on ring r0 at substeps 23–39 overlapping foot 1 on ring r1 at substeps 38–82.

These are sampled engine/model correspondence diagnostics, not a universal proof about every floating-point trajectory. The conditional interval result relies on the Taylor-model enclosure and the correctness of its arithmetic/remainder rules.

## The upper neighbour is now covered too

The adjacent interval `[9.73°,14.33°]` was subsequently covered using a different fixed red witness: pivot 2, direction +, 36 substeps. Its degree-4 cover has 51 accepted cells, zero failed leaves, exact replay audit 51/51 with zero mismatches, and zero containment/legality/stopped-cell failures. Its minimum recorded throw margin is 0.09772912589987467u. See [REPLY-COVER-MAP.md](REPLY-COVER-MAP.md) and [the upper cell corpus](../target1-red2plus/arm_2_p/cover_9.73_14.33_d4.json).

## Scope warning

Together with the recorded lower interval `[2°,9.6828°]`, these certificates leave no angular gap in `[2°,14.33°]` for blue arm `(2,+)`. This is not a proof that the starting position is dead against every legal blue move: the other blue arms still need coverage. In addition, the Taylor-model arithmetic/remainder and idealised collision-rule encoding need a complete soundness argument before claiming a fully formal theorem.
