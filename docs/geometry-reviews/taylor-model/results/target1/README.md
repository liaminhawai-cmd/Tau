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
range crosses zero (a squared-sum enclosure dips below 0 under interval over-approximation);
the centre proves the terminal throw with margin ≈ 5.9u. No proof code was changed to force a
pass; the centre proof is the current certified slice.
