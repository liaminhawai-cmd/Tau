# Does knowing the dead spots make L11 stronger?

`AI_LADDER`'s `L11+dead` (arena spec **L17**, `kind:'dead'`, marked
`experimental:'dead-set'`) is L11's evaluator, roots and pessimistic minimax
plus knowledge of the certified dead set. This is the measurement.

## Result: no, not by a big margin, and not provably at all

96 games against plain L11, `--openingPlies 2`, six lanes of 16.

| | |
| --- | --- |
| record | **L17 56 — 40 L11** |
| win rate | 58.3% (SE 5.0pp) |
| 95% CI | 48.5% .. 68.2% |
| Elo | **+58, 95% CI −11 .. +133** |
| significant at 95%? | **No — the interval straddles even** |

At this sample the honest statement is "possibly a little stronger, not
established". It is nowhere near a big margin, and 96 games cannot separate
+58 Elo from zero.

## The certificates themselves fired exactly zero times

This is the finding that matters, and it is unambiguous:

```
table consulted 23,804x  ->  0 point hits, 0 arc hits
nearest approach by the victim to any certificate: 2.85u
largest certified ball radius:                     0.35u
```

Across 96 games the rung consulted its certified table 23,804 times and never
once matched. The closest live play ever came to a certified region was **2.85u
in the L1 pose metric, against a largest ball radius of 0.35u** — roughly eight
times too far away, and that is the *nearest* approach over the whole run.

This is the geometry, not bad luck. Holding the attacker fixed and varying the
victim sweeps a 3-D set inside a 6-D joint pose space: it has zero 6-dimensional
volume. 261 points and 63 balls of radius ~0.1u do not change that. A lookup
table of certified positions is not a playing strength mechanism and should not
be expected to become one by adding more certificates at this rate.

## What did the work instead

The rung carries two other mechanisms, and neither consults the table:

```
dense test  1,005x  ->  265 confirmed dead, 740 refuted
guard         285x  ->  232 moves declined
```

The **dense test** re-derives deadness on the fly for a position the search
already suspects is a forced win. The **guard** spends 6 candidates x 12 replies
looking for a forced loss and declines the move when it finds one. Whatever
part of the +58 Elo is real comes from these, i.e. from the *machinery* built to
verify certificates being used as an online tactical check — not from the
certified knowledge it was built to verify.

That reframes the result usefully. "Teach L11 the dead spots" does nothing.
"Give L11 an online forced-loss check" may do something, and is worth measuring
on its own, without the table, at a sample large enough to resolve it.

## Cost

L17 ran at ~81s per game against L11 under six-way CPU contention, driven by the
guard's 72 extra reply evaluations per move. Any future verdict should be at
equal *time*, not equal games: a rung several times slower per move can be
stronger per game and still weaker in a real clock-bounded match.

## Reproducing

```
node nn/arena.js --a L17 --b L11 --games 16 --openingPlies 2 --deadStats
```

`--deadStats` prints the counters above; they are the reason this question could
be answered rather than guessed at.
