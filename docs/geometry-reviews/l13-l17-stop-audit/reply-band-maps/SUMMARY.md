# Reply-band maps: results summary

Per Astra's request. Full data in `results/`; this is the digest.

## Positions mapped

1. **Brief 6 original seed** (defender piece 0, before the 8° reply): `results/brief6-seed.json`
2. **10 frozen development families** (one representative position each, `mover` as the defender):
   `results/dev10-*.json`
3. **3 certified-dead positions** as a check (`docs/dead-regions/dead-points-mined.jsonl`, `mover`
   is the certified-dead side, tested directly at the certified pose): `results/positive-control/`

All 14 positions swept under BOTH call schedules (one-degree-plus-final-partial, and quarter-degree)
across all six defender arms, testing all six attacker endpoint responses at every reachable stop.

## Result: zero D_E bands found anywhere, across all 14 positions

Not one of the 14 positions — the Brief 6 seed, the 10 dev families, or the 3 directly-certified-dead
positions — has a single reachable defender stop where ALL SIX attacker endpoint responses throw the
defender. Individual throwing responses are common (e.g. 1,426 of 4,518 legal responses tested at the
Brief 6 seed alone), but never all six at once, on any sampled stop, at either resolution.

This means: **the D_E (endpoint-response) test is the wrong tool for finding all-reply-covered dead
positions on this domain, full stop** — not just on the escape-labeled corpus (expected, since those
positions are selected specifically because the mover escapes), but even on positions independently
CERTIFIED dead by nn/forced-win.js's much deeper analysis. A certified-dead mover's actual winning
attacker replies are apparently interior stops (D_1, not D_E) far more often than they are one of the
six swing-to-jam endpoints — the same asymmetry the original L11 audit found in the other direction
(defenders escape via interior stops the six-endpoint model can't see).

**Caveat on the 3 certified-dead positions**: this is a small, quick check (n=3), and it tests a
different question than dense-ablation.js's 442/827 refutation rate on the same corpus -- that number
comes from testing the WINNER's post-candidate-move positions (a narrower, pre-filtered, ladderScore3-
gated slice), not a direct sweep of the raw certified pose's own arms. The two are not directly
comparable; both are reported as measured, not reconciled.

**Consequence for the all-reply-coverage task**: covering the Brief 6 seed (or these dev families)
by finding contiguous D_E bands per arm, the way the L11-audit fixture worked, will not work here.
Astra's own formalization anticipated this ("a defender stop with no winning endpoint response
refutes D_E but does not refute D_1: an interior attacker stop may win") -- this is that prediction
confirmed empirically at the actual positions in question, not just as an abstract possibility.
