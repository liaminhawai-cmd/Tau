# Astra's dead-region answer, checked against our own geometry

Thread "Astra's dead-region answer" (2026-09-18). liam sent back GPT Astra's reply to `dead-region-brief-for-visual-model.md` (an analysis page and a reproduction bundle). This note says what Astra found, which parts were re-derived here against PR 18's code (commit e32f09d, the same one Astra pinned), which were not, and what to do with it. Everything below the "checked" headings was recomputed with the scripts listed at the end; Astra's own scripts only call our `limitAt`, `limitLadder` and `limitEvents` on that commit and were read before anything was run.

## 0. Short answer

Astra's geometry is right and every number of its that could be re-derived here was re-derived to the printed digit. Its most useful contributions are two corrections to what we believed, not a new region shape:

1. **The wall at ndpxhts24 is not a wall of the dead set and not even a discontinuity of the limit.** It is an event-order curve (Astra's E01) where arm (0,-) stops on foot 2 reaching a0's band on one side and on foot 1 reaching r1's band on the other. Both events stop the arm, so the limit is the minimum of two continuous functions and is continuous across the curve (the 21^3 map below shows jumps of at most 0.67 degrees across it, the substep floor). No coordinate change and no split is needed there: enclose both events over the whole box and take the minimum. Tried in a scratch copy of PR 18: the whole +-1u box became ONE cell (no split, all six envelopes formed, arm (0,-) enclosed as the minimum of its two events, 58.3 to 67.3 degrees); all 476 grid and midpoint poses certified dead, 92,344 (pose pair, arm, stop) gaps accepted with 292 slivers, and 11 gaps refused, all on arm (2,-) at its last stop (19.7 degrees) in one corner of the box (victim y and rotation both at -0.75 to -1.0u), each with best margins of 3.3 to 3.5u at both ends and refused only because the throwing arm's contact signature differs between the two poses 0.06u apart: a certification wall of kind C, not an escape. 6.5 minutes on 4 threads against PR 18's 28 minutes for 59%. The same box minus that corner, as two cells: the same refusal moved with the cut (cell A, y >= -0.75: 446 poses dead, 11 gaps left at y = -0.75, rot = -1.0; cell B, the strip y in [-1, -0.75] with rot >= -0.75: 346 poses dead, 18 gaps left at rot = -0.75). So the residual is a surface, not a corner: arm (2,-)'s last two stops (18.2 to 19.7 degrees) change their throwing contact signature across a sheet through victim y = -0.75 to -1.0u, rotation -0.75 to -1.0u, with margins 2.8 to 3.5u on both sides everywhere. Under the current gap rule the whole box stays unresolved; PR 18's 59% came from sub-boxes that happened to avoid that sheet. Closing it needs either a probe rule between pose neighbours (the engine at random poses inside the pair at that stop, as probeGap already does along the stop axis when both ends clear 1.5u) or splitting on unresolved gaps as well as on envelope refusals; either would leave the union envelope's single cell, or two, where PR 18 had 37 leaves.
2. **The two "no legal reply" points at l5807vazg were off the board at the start** (foot 1 at 67.517u and 67.392u against the 67.167u threshold). They are not limit walls; the brief and dead-curves-and-regions.md section 2 were wrong on this (the "Dead curves" thread had independently withdrawn the claim the same day). A fifth of the 1u box at that point is not a position at all, and the cell code should clip the box to "all feet on the board" instead of refusing it.

Astra's proposed primitive, a cell in an implicit chart (u, v, t) fitted to one arm's event-order curve with the other arms' walls pulled back into it as constraints, is the right tool where the limit genuinely jumps across a wall. That is the case at the other three points (jumps of 13 to 60 degrees, see section 3), not at ndpxhts24.

Astra also audited throw-theorem.md and found three real errors in it (section 2.3). It did not perform any new certification or throw survey, and says so.

## 1. What Astra says, in one paragraph per section

1. At ndpxhts24 the dominant wall is E01 on arm (0,-): foot 2 reaching a0's outer band edge (63.6927 deg) against foot 1 reaching r1's outer edge (68.7636 deg); gap H = 5.0709 deg, linearised H = 5.0709 - 3.9884 dx + 1.6929 dy + 4.3300 t (deg, t = R dtheta in u), nearest point of the curve 1.1606u from the pivot foot. Three more event-order candidates on arm (2,-) (E02 to E04) appear in the +1.5u slices. A wall like E01 is a boundary of the limit program, not of the dead set.
2. Certify one local chart per cell: pivot 0 for this seed, coordinates u (tangential), v = H/lambda (signed distance to E01), t = R(theta - theta*); recover the hub from the pivot foot. The other pivots' walls are constraints on the same cell, not separate cells to union. An oriented box along grad H is the cheap prototype. A separate chart (azimuth, radius, relative attacker pose) for the long direction.
3. Rotation independence of A1 and A2 walls in the pivot plane is exact (the theta term cancels even between two different moving feet once each foot's fixed offset is included); A3 (legality), A6 (substep bins: floor(s/Delta) depends on the absolute phase) and the maps between the three foot planes keep their theta dependence. Same-foot A1 equalities are arcs of radius-rho circles about the intersection of the two level circles.
4. The scans support "patches extended along azimuth", not yet "one continuous tube"; keep A (program changes), B (margin walls) and C (certification limits) apart.
5. l5807vazg needs the starting-rim domain clipped first; the two "no legal reply" perturbations are off board at the start. Margin walls at 6dgqa1fd8 and 0r8c3cohc should be bracketed between an accepted pose and an escaping pose inside one program cell.
6. The clockwise swing checks out: 40 events, all level events (no ray or rim event on this arm), the arccos and arcsin formulas confirmed; rho = 40.0017u with the engine's R = 23.095 (exactly 40 would need R = 40/sqrt 3).
7. The depth-2 logs: 111 records are 100 positions (11 retries), 1 dead, 8 unresolved, 90 escape, 1 timeout (not 12); the one certified depth-2 position and its witness ranges; `deadDeep`'s "escape" includes "no certified child found".
8. throw-theorem.md: Lemma 1's deficit is not one-sided; Lemma 3's "below 1e-4u" is false; "s = a" is first order, not exact; H1 to H3 only bind touching poses while the theorem sums gain over every substep; a corrected sufficient theorem over validated state enclosures, counting every solver pass.
9. A practical order: event identities instead of display labels; split on relevant boundaries only; prove or enclose the event program; handle phase clusters as unions; keep the throw certificate empirical; continue along azimuth.
10. What it checked: 24 seed arms and 72 random arms against the ladder, event phase invariance, all 40 events against their level equations; a list of places where the brief's description differed from the code.

## 2. Checked here, item by item

### 2.1 Geometry (scripts verify1.js, algebra.js; PR 18 at e32f09d)

| Astra's claim | Recomputed here | Verdict |
|---|---|---|
| 24 closed-form limits and signatures match the ladder | worst difference 2.7e-15 rad, 0 signature mismatches | confirmed |
| ndpxhts24 arm limits 44.33 / 63.67 / 14.67 / 16.67 / 4.67 / 15.67 deg with the stated stopping events | identical | confirmed |
| 40 events on arm (0,-), all level events | 40, all `level`, none on a span ray or the rim | confirmed (the brief's "about 44" was an estimate) |
| E01 events at 63.692660 and 68.763598 deg, H = 5.070938 deg | identical to six decimals | confirmed |
| grad H = (-3.988378, +1.692944, +4.330027) deg per u in (dx, dy, t) | central differences: -3.988378, 1.692944, 4.330027 | confirmed |
| H depends on the pivot foot only, not on theta | pivot fixed, rot varied +-3u: H changes by 6e-14 deg | confirmed |
| nearest point of E01 to the seed pivot at 1.16062u | 1.16062u (offset 1.091, -0.397) | confirmed |
| rho = 40.0017134u | 40.00171340u | confirmed |

### 2.2 The code (read at e32f09d)

| Astra's reading | In the code | Verdict |
|---|---|---|
| `throwMargin` uses the maximum victim foot radius over the sweep | `out.maxFootR - EDGE` | confirmed |
| `dist6` is hypot(dx, dy) + R|drot| per piece, not the brief's L1 | as stated | confirmed; the brief was loose |
| `deadDeep`'s escape includes "no attacker reply leads to a certified dead position" | forced-win.js line 856 | confirmed |
| Leaving a start line is free only on the start side; crossing to the other side is billed | `crossingSubstep`: `lineSideOf(after) !== startSide` bills it | confirmed; the brief said "may leave it for free" |
| The episode charge is piece-level, not one per foot entry | `st.episodeCharged` is a single flag on the state | confirmed |
| The signature's line label is descriptive only | `describeStop` takes the nearest line within STOP_BAND; at ndpxhts24 arm (2,-) it flips between a0 and r1 on 0.1% of the 1u box for the same stopping event | confirmed, and it produces a spurious wall |
| Depth-2 logs: 100 positions, 11 retries, 1 timeout | dedup of deep2.jsonl: 111 rows, 100 positions, latest statuses 90/8/1/1 | confirmed (tally.txt already reported it that way) |

### 2.3 The throw note (algebra.js)

| Astra's claim | Recomputed | Verdict |
|---|---|---|
| Lemma 1's deficit eta can be negative: -0.00338u at r = (-R/sqrt2, R/sqrt2), n = (1,0), s = 0.8 | -0.0033787u; over 5e5 random updates eta ranges over [-0.0035, +0.0035] | confirmed. The bound |eta| <= 0.005u stands, the sign claim does not |
| Lemma 3's error is not below 1e-4u: 5.07e-4u at s = 0.32, lever sqrt(I), foot at 64u | exact gain 0.159493 against linear 0.160000 | confirmed; our O(e^2 R) term is 7.9e-4u, the "below 1e-4" sentence was wrong |
| A substep moves an attacker leg-axis point by at most 2 sqrt3 R sin(0.2 deg) = 0.2793u | 0.27926u (ours was the looser 2R delta = 0.3225u) | confirmed, tighter |
| "s = a" is first order; H1 to H3 bind only touching poses | agreed on reading: our section 3 assumes the pair stays at distance exactly D and the normal fixed; the theorem's sum must run over contact substeps only | accepted, not numerically checked |

### 2.4 Not checked

Astra's five rendered slices, the E02 to E04 catalogue in the +-1.5u range, the rim slices at l5807vazg, the 72 random validation poses (same functions as the 24 that were checked) and its figures were not re-rendered. Its corrected throw theorem was read, not proved.

## 3. The map of the 1u boxes (script verify2.js, verify3.js: 21^3 poses per point, all six arms, stopping event by tag)

| point | arm | programs in the box (share) | limit jump across the wall | kind |
|---|---|---|---|---|
| ndpxhts24 | (0,-) | f2 at a0 88.6%, f1 at r1 9.0%, both in one substep 1.6% | <= 0.67 deg (same as within a program) | order swap, both stop: continuous |
| ndpxhts24 | (2,-) | one event; label flips a0/r1 on 0.1% | 0.33 deg | spurious (display label) |
| ndpxhts24 | other four | one program each | - | - |
| 6dgqa1fd8 | (0,+) | 90.7% / 6.2% / 3.1% (the last crosses a0 and r1) | 35.0 deg | program change |
| 0r8c3cohc | (0,+) | 71.0% / 28.7% (+0.4%) | 17.7 deg | program change |
| 0r8c3cohc | (1,-) | 97.6% / 2.4% | 13.0 deg | program change |
| 0r8c3cohc | (2,+) | 97.3% and seven small ones | 59.7 deg | program change |
| 0r8c3cohc | (2,-) | 75.7% / 18.7% / 2.4% / ... | 29.7 deg | program change |
| l5807vazg | start pose | 20.2% of the box has a victim foot off the board | - | not positions |
| l5807vazg | (0,-) | illegal (< 2 deg) on 57.1% of the box | 0.33 deg | legality wall (A3), continuous |
| l5807vazg | (1,+) | illegal on 36.2% | 0.33 deg | legality wall |
| l5807vazg | (0,+), (1,-) | 46.9/21.6/8.0/3.3% and 58.2/21.6% | 19.7 deg | program change |

So the four points are two different problems. At ndpxhts24 the refused 41% is entirely axis-aligned slabs hugging a curve across which nothing discontinuous happens. At the other three the walls are genuine program changes (a different line gets crossed, so the limit jumps by tens of degrees), and both sides need their own envelope; that is where Astra's chart, or at least an oriented split along grad H, earns its cost. At l5807vazg the first problem is the domain: clip to the board and accept arms that are illegal throughout a sub-box.

## 4. Where I differ from Astra

- Astra proposes splitting at v = 0 (on E01) at ndpxhts24. The map says do not split there at all: the union envelope is exact and cheaper. Astra half-says this itself ("a positive throw margin can survive that change").
- Astra's chart inverts H numerically per cell and needs a proof of unique inversion over the cell. For the program-changing walls the cheaper first step is its own "inexpensive prototype": an oriented box with one axis along grad H, which cuts the slab waste by the ratio of the slab thickness to the box width without any new coordinate machinery. The chart is the second step if the oriented boxes still leave thick slabs.
- Astra rightly says the constancy of the event program over a cell is sampled, not proved, in PR 18. That remains true after the union envelope: the enclosure is exact once the set of stopping events is known, and that set is read off the grid.

## 5. Proposal (each is a small change to nn/forced-win.js on PR 18; nothing pushed)

1. Compare stopping events by tag (kind, foot, circle, level or ray, root), not by describeStop's line label. Removes the spurious (2,-) wall.
2. Union envelope: when the grid stops on more than one event of the same program (same reason, same lines crossed), enclose every event seen over the whole box and take the minimum of the enclosures. The scratch patch (union-envelope.patch) does this in `reachEnvelope` and gives `limitEnclosure` an explicit event to follow. Result on the +-1u box at ndpxhts24: one cell, 476 poses dead, 11 of 92,344 gaps unresolved in one corner (kind C, margins 3.3u+), 6.5 min; minus that corner the same 11 to 18 gaps reappear on the cut faces: the kind-C sheet of arm (2,-) runs through the box and needs a pose-gap probe rule or a split on unresolved gaps (section 0).
3. Domain clip: certify box intersected with "all victim feet on the board" instead of refusing at the rim, and accept an arm whose limit is below 2 degrees everywhere in a sub-box as having no stops. This is what l5807vazg needs.
4. Program-changing walls: split along grad H of the two events' angle difference (an oriented box), and only if that still wastes volume, Astra's implicit chart. 6dgqa1fd8 and 0r8c3cohc are the test cases.
5. Throw theorem: rewrite the note with Astra's corrections (two-sided |eta| bound, the exact norm increment for the foot, the sum over contact substeps and solver passes only, "s = a" as a bounded approximation) before any interval checker is built on it.

## Files

- `verify1.js`: the 24 arms, the 40 events, E01's gradient and nearest point.
- `verify2.js`, `verify3.js`: the 21^3 maps of the 1u boxes (signature by tag, limit jumps, off-board and illegal fractions).
- `algebra.js`: the three throw-note checks and the l5807vazg foot radii.
- `union-envelope.patch`: the scratch change to forced-win.js at e32f09d; `union-run-ndpxhts24.log` and `union-cells-ndpxhts24.jsonl`: its run on the whole box; `two-cells.js`, `two-cells-ndpxhts24.log/.json`: the box minus the corner.
- Astra's bundle (analysis page and reproduction code) is in the project's uploads; not copied here (22 MB).
