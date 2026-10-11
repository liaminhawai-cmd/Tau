# Target1 arm (1,+): gap probe [12.10°, 12.20°]

Date: 11 October 2026. Branch: `claude/serene-pasteur-psjoi2`.

## Results

The adaptive degree-4 cover accepted five cells over [12.10°, 12.20°], with zero failed leaves in nine attempts. The smallest recorded throw margin was **2.9217728798662246u**; the smallest hub-motion lower bound was **18.04748251618376u**. Three cells were accepted in plain mode and two with straddle branching.

Every one of the five cells was replayed against the fetched certificate source and its margin reproduced exactly (bit-for-bit; zero delta). The Red-legality checker passed every cell, with no borderline pivot. Its reported contact episode is foot 1 on ring r1 over substeps 35–44.

| Interval (°) | Margin lower bound (u) | Replay | Red legality |
|---|---:|---|---|
| [12.1000, 12.1250] | 2.9548953635150066 | exact | pass |
| [12.1250, 12.1375] | 2.9558651146262345 | exact | pass |
| [12.1375, 12.1500] | 2.95625137583103 | exact | pass |
| [12.1500, 12.1750] | 2.9217728798662246 | exact | pass |
| [12.1750, 12.2000] | 2.923732054073269 | exact | pass |

The machine-readable saved-cell record is [GAP-PROBE-12.10-12.20.json](GAP-PROBE-12.10-12.20.json).

## Status limitation

The shipped-engine trajectory containment checker was **not** run for this slice. These results establish accepted Taylor-model cells, exact replay of their recorded bounds, and the encoded Red line-contact legality check; they are not yet a fully validated certificate slice and are not included in the formal whole-arm coverage claim. The dedicated CI workflow must pass containment before this slice is promoted.
