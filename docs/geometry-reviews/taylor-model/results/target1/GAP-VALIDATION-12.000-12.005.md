<!-- Historical diagnostic only: this run predates the current sqrt-remainder source revision. The stored margins differ by a few ulps from the current-source cover for the same endpoints. It is not a current-source proof artifact and must not be counted by tiling/audit; the overlapping cover JSON was removed from arm_1_p. -->

# Target1 arm (1,+): validated gap slice [12°, 12.005°]

This slice extends the accepted cover immediately above the prior lower interval. It uses the fixed Red response from `problems/target1-b1p.json`: pivot 2, direction +, 107 substeps (0.375° each).

## Result

| Check | Outcome |
|---|---:|
| Accepted degree-4 Taylor cells | 4 |
| Failed cover leaves | 0 |
| Exact tiling | Passed; no gaps or overlaps |
| Independent replay | 4/4 margins reproduced bit-for-bit; 0 mismatches |
| Engine trajectory containment | 3 sample angles per cell; 3,900 pose checks; 0 outside |
| Red swing legality | 4/4 cells passed; 0 failures or stopped checks |
| Minimum certified throw margin | 2.974780695878 board units |
| Minimum Red-legality clearance | 4.631465868341 board units |

Every checked cell records the same Red line-crossing episode: foot 1 at ring r1, substeps 35–43. The first cell required two phase-A regimes and retained two Red branches; the other three were plain single-regime cells.

## Cell table

| Angle interval | Mode | Certified throw margin | Containment checks | Red legality |
|---|---|---:|---:|---|
| [12°, 12.000625°] | straddle | 2.974780695878u | 984; 0 outside | pass; clearance 4.631466u |
| [12.000625°, 12.00125°] | plain | 2.974989415719u | 972; 0 outside | pass; clearance 4.631703u |
| [12.00125°, 12.002500000000001°] | plain | 2.975025469576u | 972; 0 outside | pass; clearance 4.631879u |
| [12.002500000000001°, 12.005°] | plain | 2.975097429667u | 972; 0 outside | pass; clearance 4.632231u |

The machine-readable cell records are in `arm_1_p/cover_12_12.005_d4.json`; replay and validation totals are in the adjacent JSON report.

**Scope:** this is a validated subinterval only. It does not close the entire former gap [12°, 16.5°]. The remaining interval is [12.005°, 16.5°], a width of 4.495°.
