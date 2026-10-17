# Target 1 — first cert2.js run (reply family (2,+), witness (0,-))

Problem: `problems/target1.json` (seed `[12.2195,37.7663,11.0497,2.8121,28.9609,-13.703]`,
first mover blue, witness red (0,-1), kRed = 120 substeps = 45.0° red crossing limit).

Command: `SYMREM=1 VTX=1 PROBLEM=target1 node cert2.js 2 1 <a0> <a1> 4`

| run | interval | result |
| --- | --- | --- |
| whole cell | [2.4, 2.6] | **refused**: phase B substep 19: sqrt range not positive [-19.158, 93.535] |
| centre point | [2.4999, 2.5001] | **proved**: margin [5.9147, 5.9149]u, foot 1, hubMoveLo 19.651u, firstContact substep 3 |
| half | [2.4, 2.5] | **refused**: phase B substep 46: sqrt range not positive [-2.651, 31.062] |
| half | [2.5, 2.6] | **refused**: phase B substep 45: sqrt range not positive [-0.601, 5.226] |

The whole cell and both halves refuse in phase B with a Taylor-model `sqrt` whose operand
range crosses zero (a squared-sum enclosure dips below 0 under interval over-approximation).
The 0.2° refusal is therefore a cell-splitting limitation, not a newly identified physical refusal;
Brief 6 already handles such cases by subdividing the parameter interval. The centre proves the
terminal throw with margin ≈ 5.9u. No proof code was changed to force a pass; the centre proof is
the current certified slice. The next cover target is the remaining [2°, 9.6828°] portion of
Target 1, since [9.73°, 14.33°] is already covered by the response-cover work.
## Full Target1 cover result

The adaptive Taylor cover was run on the remaining Target1 interval [2°, 9.6828°] with SYMREM=1, VTX=1, DEG=4. It produced 427 accepted cells and 0 failed leaves in 853 cover attempts. Cell widths ranged from 0.000234460449° to 0.12004375°, with median 0.007502734375°. The smallest certified terminal margin was 5.409085263853455u and the smallest hub-motion lower bound was 17.64584513837921u.

An independent audit reproduced 427/427 cells with 0 mismatches. The accepted cover used 330 plain cells, 8 branch cells, 15 branch+merge cells, 59 straddle cells, and 15 straddle+merge cells.

The first red-legality diagnostic exposed an over-conservative checker, not an engine refusal: in the first Target1 cell, foot 2 is guaranteed on r0 for substeps 23..39 while foot 1 is guaranteed on r1 for 38..82, with guaranteed overlap at 38..39. Because the shipped rule's crossing budget is whole-tripod, those two different-foot contacts form one continuous crossing episode. The legality checker has been corrected accordingly; a concrete checkCell run now returns ok=true with that two-contact episode.

Containment must be checked cell-by-cell: running the entire [2°, 9.6828°] interval as one hull is intentionally too wide and stops on a deep-crossing enclosure. The reusable validate-cover2.js runner performs containment using each leaf's actual mode and symbol settings, rather than treating the complete target as one interval.
