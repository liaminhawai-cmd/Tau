# Reply-band maps: results summary

26 September 2026. **This replaces the 22 September summary, whose conclusion was wrong.** Full
data in `results/`; inputs in [positions.tsv](positions.tsv); `./regenerate.sh` rebuilds every file
byte for byte from those inputs and a pinned engine.

## Retraction

The first version of `map-position.js` had two bugs, both found by Astra/GPT and both reproduced
here before being fixed:

1. **Wrong quantifier.** A stop was labelled an endpoint counterexample when *all six* endpoint
   replies threw the defender. A counterexample to D_E is a nonterminal defender stop where *no*
   legal endpoint reply throws it: `!responses.some(r => r.legal && r.throwsDefender)`. "No stop
   where all six win" says nothing about D_E.
2. **The reply simulation moved the defender's sweep.** Replies were tested in the middle of the
   sweep and G restored by hand. `pinFoot` sets `G.pivot` (the pinned foot's coordinates), which the
   restore missed, so from the second stop on every arm rotated about the attacker's last pivot foot.
   Reproduced on Brief 6, arm (0,+): the second stop is off by **0.393 units**, the same figure
   Astra reports; across the six arms the drift reaches 15 units and the old arms end at the wrong
   angles (29.7° where the real arm ends at 14.7°).

So the 22 September conclusion, that the endpoint test is the wrong tool and that the winning
replies are mostly interior stops, was an artefact and is withdrawn. So is the "29 stops for a 44°
arm looks sane" check, which verified nothing.

## What the mapper does now

- The defender's arm is swept uninterrupted first and every landed stop snapshotted. Replies are
  tested only afterwards, each from a fresh restore of that stop, which is how `ladderDeadEscape`
  itself works. A second, reply-free sweep must match every stop bit for bit, or the run aborts.
- Nonterminal stop: **punished** if at least one legal endpoint reply throws the defender, otherwise
  an **endpoint counterexample**.
- A stop where the defender's move throws the attacker is a **terminal escape**. A stop where the
  defender throws itself is excluded. Both as `ladderDeadEscape` does.
- No stop budget. Both call schedules, one degree plus the final partial and quarter degree.
- Every map records its source: pinned revision `ce0e61d1e` (the L11 audit pin, whose `applySwing`,
  `pinFoot` and `simMoveToLimit` match current `main`), plus sha256 of `index.html` and `nn/engine.js`.
  The first dev-set maps ran on `claude/l17-ablations` and recorded no source.

## Results

Counts are defender stops. Verdicts are relative to the six endpoint replies and to each grid.

| position | source | 1°: stops / counterexamples | ¼°: stops / counterexamples |
| --- | --- | --- | --- |
| Brief 6 seed | Brief 6 | 156 / **0** | 603 / **0** |
| 06l76agzc | certified dead | 142 / 0 | 549 / 0 |
| arenaf9soeap4 | certified dead | 158 / 0 | 608 / 0 |
| nfng6zslk | certified dead | 114 / 0 | 430 / 0 |
| certdead-0 | certified dead | 161 / 0 | 616 / 0 |
| certdead-1 | certified dead | 156 / 0 | 596 / 0 |
| certdead-2 | certified dead | 173 / 0 | 665 / 0 |
| retro-ratchet-…8uw-w1 | not certified: unresolved | 138 / 0 | 523 / 0 |
| tnj56agko | not certified: unresolved | 167 / 0 | 643 / 0 |
| 6j41r1r00 | not certified: screen escape | 119 / 77 | 677 / 333 |
| arena3b37de4o | not certified: screen escape | 199 / 25 | 772 / 98 |
| arenaprqx8ixk | not certified: screen escape | 146 / 65 | 552 / 241 |
| e0c37qmjk | not certified: screen escape | 286 / 275 | 1117 / 1078 |
| ifcrtdvdw | not certified: screen escape | 147 / 11 | 562 / 43 |
| **L11 audit node** (control) | known escape bands | 164 / 44 | 626 / 169 |

No terminal escapes anywhere.

**The endpoint test agrees with every label it can be checked against.** All six certified-dead
positions have no endpoint counterexample on either grid. All five positions the screen marked as
escapes have counterexamples on both. The two "unresolved" positions have none on the grid, which is
what unresolved means there: every sampled stop is covered, and the proof failed only on the gap
between stops. The control reproduces the audit's independently computed bands (2°–20.5° on arm
(0,+), 2°–18° on (2,+), about 10°–14.75° on (1,+), 2°–5° on (1,−), none on the other two arms), so
the detector fires when it should. Not bit for bit: this sweep lands 626 stops against the audit's
619 (the two scripts do not land on identical states; not yet traced), and three
isolated stops inside the audit's bands come out punished here (19.75° on (0,+), 14.25° on (1,+),
4.75° on (1,−)); 169 counterexample stops against 170.

## Brief 6 seed: one reply covers every sampled stop

[`cover.js`](cover.js) lists, per arm, the stretches over which a single endpoint reply throws the
defender at every stop. At the Brief 6 seed one reply, **(0,−)**, pin foot 0 and swing negative to
the jam, throws the defender at all 156 stops on the 1° grid and all 603 on the ¼° grid, on all six
arms ([results/brief6-seed.cover.json](results/brief6-seed.cover.json)).

At the weakest sampled stop (arm (0,−), 8.5°) the defender's outermost foot ends at 69.371u after
that reply, against a throw threshold of 67.167u (`edgeU` 66.667 + `edgeEps` 0.5): about **2.2u of
slack**. For scale, the arm-2 propagation's final clearance was 0.03u.

What this is not: a certificate. It says nothing about defender states between sampled stops, nor
about the floating-point correspondence between the continuous argument and engine arithmetic. It is
a strong lead for a proof shape: one attacker reply, one continuity argument per arm, with about 2u
to spend.

## The two open questions, answered by Astra

1. **"Escape" is relative to the tested response set.** D_E: every legal defender move has some
   winning endpoint reply. D_1: some winning reply among all legal attacker moves. D_E implies D_1,
   and an endpoint counterexample refutes D_E only; an interior reply or a later continuation may
   still win. In-game results should distinguish "endpoint counterexample found", "none found on this
   grid" and "budget exhausted"; none of them alone certifies full-game survival. (`ladderDeadEscape`
   currently returns a budget-exhausted search the same way as an escape, and counts it in
   `DEAD_STATS.budgetOut`. The budget never bound in the audit corpus.)
2. **The mark tolerance changes search policy**, even though it leaves the trajectory alone:
   accepting an earlier mark resets `lastMark` and shifts every later sample. `1e-9` is an
   engineering choice, not a proved error bound or a guaranteed coverage gain. The 300-game match on
   `claude/l17-on-main` found no strength difference either (interval includes zero).
