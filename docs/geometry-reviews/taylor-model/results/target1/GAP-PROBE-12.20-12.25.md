# Target1 arm (1,+): narrow gap probe [12.20°, 12.25°]

The broader [12.20°, 12.30°] adaptive cover call timed out without a result. Splitting at 12.225° gave a complete cover of [12.20°, 12.25°] in three cells, with no failed leaves. All three margins reproduced exactly on replay; all three Red-legality checks passed without a borderline pivot.

| Cell | Margin lower bound | Replay | Red legality |
|---|---:|---|---|
| [12.2000°, 12.2250°] | 2.9257567302761625u | exact | pass |
| [12.2250°, 12.2375°] | 2.92627237647477u | exact | pass |
| [12.2375°, 12.2500°] | 2.9270984367581145u | exact | pass |

The report [GAP-PROBE-12.20-12.25.json](GAP-PROBE-12.20-12.25.json) preserves the cell data and exact metadata. This is still exploratory: engine-containment validation has not been run, and the interval [12.25°, 12.30°] remains open.
