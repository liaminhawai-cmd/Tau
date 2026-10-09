# Target 1 — proof status

Target 1 is the mined dead-family witness using blue reply arm (2,+), red witness arm (0,-),
with seed from dead-regions/mined record line 176 and kRed = 120 substeps.

## Claim ladder

| Layer | Current state | Evidence |
| --- | --- | --- |
| Witness fixture | verified | problems/target1.json reproduces the mined seed, first mover, witness and kRed |
| Taylor arithmetic | tested, not yet a fully audited theorem | test-tm.js randomized sampled-containment tests; no sampled violations recorded |
| Lower finite angle cover | recorded and independently replayed | [2°, 9.6828°], 427 accepted cells, 0 failed leaves, 853 attempts; 427/427 replayed |
| Gap finite angle cover | certified at Taylor-model level | [9.6828°, 9.73°], 2 accepted cells, 0 failures |
| Gap independent cell audit | verified for recorded run | 2/2 cells reproduced, 0 mismatches |
| Gap line legality | verified by cell-wise checker | crossing contacts overlap at substeps 38–39, forming one whole-tripod crossing episode |
| Lower cover engine/model correspondence | re-run in progress | [Target1 cell closure workflow](https://github.com/liaminhawai-cmd/Tau/actions/runs/37889490556) rebuilds and checks all lower cells |
| Upper angle interval | not yet closed | fixed-witness degree-4 cover is running; a 0.1° response scan is only candidate-discovery evidence |
| Floating-point refinement | not yet closed | requires the separate numerical soundness/error argument if claims concern the binary64 implementation |
| Global dead-position theorem | not yet closed | other legal blue reply families and all required proof obligations remain |

## Gap cover statistics

For [9.6828°, 9.73°], the two accepted cells have minimum certified terminal margin
6.816387359537115u and minimum hub-motion lower bound 17.636291379074123u.
The cell-wise checker reports 0 containment failures, 0 legality failures, and 0 stopped cells.
It uses three sample angles per cell: 2,178 comparisons, zero failures under a 1e-9 tolerance,
and maximum reported excess 1.7763568394002505e-14.

## Crossing-legality correction

The earlier red-legality test rejected any cell containing more than one possible (foot,line) pair.
That was too strong because the rule budgets one crossing episode for the whole tripod. Different
feet may therefore occupy different lines simultaneously while the tripod remains continuously in
contact. The first Target 1 cell has foot 2 on r0 during substeps 23..39 and foot 1 on r1 during
38..82, with guaranteed overlap at 38..39. The checker requires each candidate pair to have a
monotone contact window and guaranteed line contact throughout the combined episode. It remains
conservative for a single foot touching two distinct lines away from a printed corner.

## Important boundaries on the claim

A successful cell cover is a proof about all angle values in its interval only insofar as the
Taylor-model enclosure operations, remainders and rule encoding are mathematically sound. The
contain2.js engine comparison samples only three points per cell; it is a useful correspondence
test, not a universal proof about binary64 execution.

The old README assertion that [9.73°, 14.33°] was already covered by response-cover work is not
supported by a matching committed cell corpus for this Target 1 fixture. The current upper cover
attempt is running; the separate 0.1° sweep found a winning witness at all 47 sampled angles, but
that is empirical discovery, not interval coverage.

## What remains

1. Finish and audit the [2°, 9.6828°] cell-wise closure run.
2. Close [9.73°, 14.33°] with a matching Taylor cover, replay audit, and cell-by-cell legality / correspondence diagnostics.
3. Check that the interval/remainder arithmetic used by the Taylor model is justified for the idealised real-valued rule.
4. Extend the result beyond blue arm (2,+), so every legal reply family required for a dead-position theorem is covered.

No global dead-position theorem is claimed yet.
