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
The centre proves the terminal throw with margin ≈ 5.9u. No proof code was changed to force a pass.

## Recorded lower-interval cover

The adaptive Taylor cover for Target 1 on [2°, 9.6828°], with SYMREM=1, VTX=1 and degree 4,
has a recorded result of 427 accepted cells and 0 failed leaves in 853 attempts. The independent
audit record reports 427/427 cells reproduced and 0 mismatches. Its recorded minimum margin was
5.409085263853455u and minimum hub-motion lower bound was 17.64584513837921u.

The cell-by-cell engine containment and legality closure is being re-run by
[Target1 cell closure](https://github.com/liaminhawai-cmd/Tau/actions/runs/37889490556);
until that workflow completes, the recorded cover and audit should not be described as a fresh
end-to-end closure run.

## Newly certified gap

The interval [9.6828°, 9.73°] is covered by two degree-4 Taylor-model cells:
[9.6828°, 9.7064°] and [9.7064°, 9.73°]. Both were accepted, independently reproduced (2/2,
zero mismatches), and passed the cell-wise legality check. The minimum certified throw margin
is 6.816387359537115u and the minimum hub-motion lower bound is 17.636291379074123u.

See [ANGLE-GAP.md](ANGLE-GAP.md), the [cover cells](arm_2_p/cover_9.6828_9.73_d4.json),
and the saved [audit](angle-gap-audit.json) / [closure diagnostics](angle-gap-closure.json).
The engine/model containment diagnostic sampled three points per cell, for 2,178 comparisons:
zero failures under the checker's 1e-9 tolerance; the largest reported excess was 1.78e-14.

## Upper interval status

The earlier sentence claiming [9.73°, 14.33°] was "already covered by response-cover work" was
too strong for this Target 1 seed: that response-cover material is not a committed, matching
per-cell certificate for this fixture. A fixed-witness degree-4 cover is now being attempted in
[Target1 upper response witness test](https://github.com/liaminhawai-cmd/Tau/actions/runs/37891119459).
A separate discovery-only engine scan found a winning red response at all 47 grid points spaced
0.1° apart; red arms (0,-) and (2,+) each won at all 47 sampled points. Those samples suggest
good candidate witnesses but do not prove the angles between them. The upper interval must remain
unclaimed until the Taylor cover, audit, and cell-wise checks close.

## Scope and remaining work

This is one blue reply arm (2,+) against a fixed red witness. Even if all the angular intervals close,
that is not by itself a proof that the original position is dead against every legal blue move. The
full theorem still needs all relevant reply families and explicit justification of the Taylor-model
remainder and interval arithmetic assumptions. Sampled engine containment is a correspondence check,
not a universal proof for every floating-point trajectory.
