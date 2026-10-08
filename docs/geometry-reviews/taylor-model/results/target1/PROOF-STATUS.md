# Target 1 — proof status

Target 1 is the mined dead-family witness using blue reply arm (2,+), red witness arm (0,-),
with seed from dead-regions/mined record line 176 and kRed = 120 substeps.

## Claim ladder

| Layer | Current state | Evidence |
| --- | --- | --- |
| Witness fixture | verified | problems/target1.json reproduces the mined seed, first mover, witness and kRed |
| Taylor arithmetic | verified by randomized containment tests | test-tm.js: 300 models per operation; 60,000 samples each, with 0 sampled violations |
| Finite angle cover | verified for the recorded run | [2°, 9.6828°] accepted by 427 cells, 0 failed leaves, 853 cover attempts |
| Independent cell audit | verified for the recorded run | 427/427 cells reproduce exactly, 0 mismatches |
| Red line legality | checker corrected and concrete Target1 cell verified | foot 2/r0 and foot 1/r1 overlap at substeps 38–39, forming one whole-tripod crossing episode |
| Engine/model containment | not yet globally closed | whole-range containment is too wide; validate-cover2.js checks cell-by-cell with the leaf's actual mode |
| Floating-point refinement | not yet closed | requires the separate FP enclosure layer / libm axioms |
| Global theorem | not yet closed | remaining work is to finish the cell-by-cell validation record and reconcile it with the FP layer |

## Recorded cover statistics

Minimum certified terminal margin: 5.409085263853455u.
Minimum hub-motion lower bound: 17.64584513837921u.

Cell widths:
- minimum 0.000234460449°
- median 0.007502734375°
- maximum 0.12004375°

Modes:
- 330 plain
- 8 branch
- 15 branch+merge
- 59 straddle
- 15 straddle+merge

## Important correction

The earlier red-legality test rejected any cell containing more than one possible (foot,line) pair.
That was too strong because the shipped rule budgets one crossing episode for the whole tripod.
Different feet may therefore occupy different lines simultaneously while the tripod remains continuously
in contact. The first Target1 cell demonstrates the pattern explicitly:

- foot 2 / inner ring r0: substeps 23..39
- foot 1 / outer ring r1: substeps 38..82
- guaranteed overlap: substeps 38..39

The corrected checker requires each candidate pair to have a monotone contact window and requires a
guaranteed line contact throughout the combined episode. It remains conservative for the harder case
of one foot touching two distinct lines away from a printed corner.

## What remains

The strongest immediate target is not new geometry. It is to finish the cell-by-cell containment and
legality record for the 427 accepted cells and then connect that result to the separate outward-rounded
floating-point layer without promoting sampled validation into a theorem.
