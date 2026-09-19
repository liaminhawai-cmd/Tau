# Brief 5 — from 261 dead points to dead classes

**For:** the outside mathematical model (Astra).
**From:** the Tau project, 2026-09-19.
**Question in one line:** we have 261 certified dead positions and 63 small
certified dead balls. Is there a *characterisation* — a class, a region, an
invariant — rather than a list?

## Why this is the question now

A `L11+dead` ladder rung was built that carries the certified set as a lookup
table and consults it in search. It was measured over 96 games against plain
L11 (`docs/dead-regions/l11-dead-measured.md`):

```
certified table consulted   23,804x  ->  0 point hits, 0 arc hits
nearest approach by the victim to any certificate:  2.85u
largest certified ball radius:                      0.35u
```

Never once. The certified set is a 3-D sweep inside a 6-D joint pose space and
has **zero 6-dimensional volume**; 261 points and 63 balls of median radius
0.095u do not change that. Enumerating more certificates at this rate cannot
produce either playing strength or a theorem. **Generalisation is the only path
that makes this work worth anything**, which is why you are being asked.

## What you are being given

All on branch `claude/board-game-video-adaptation-cf8a93`, under
`docs/dead-regions/`:

| file | contents |
| --- | --- |
| `dead-points-mined.jsonl` | **261** certified dead positions. `p` = `[x,y,rot]` for blue then red (**radians**), `mover` = the side to move, which is the side that loses. `worstMargin` = worst throw margin over all its replies (u). `engine` = falsification result. |
| `dead-balls.jsonl` | **63** certified L1 balls, `eps` 0.009–0.350u (median 0.095u), metric L1 over both pieces with rotation weighted by R = 23.095u, so `eps` is in units of foot travel. |
| `screened-not-dead.jsonl` | **1,045 controls** — near-terminal positions that were *not* certified dead, with the reason. This is the comparison set. |
| `README.md` | the run, the claim class, and the honest limits. |

Geometry: board radius 66.667u, off-board 67.167u, leg radius R = 23.095u,
tube radius 1.44u, leg-to-leg contact 2.88u, rings at 40 and 53.3u. A tripod's
three feet sit at radius R from the hub at `rot`, `rot+120°`, `rot+240°`.
Engine substep is at most 0.4°; search's 1° calls use ⅓° substeps, and absolute
substep phase can change the stopping program.

**Claim class, unchanged and important:** every certificate here is certified by
**sampling**, not proved. The allowance is three times the steepest finite
difference the grid itself shows, floored at 1 — empirical evidence about a
sampled function, not a uniform Lipschitz bound. Engine agreement is
falsification that did not fire. `escape` in the control file means "no
certificate was found within this budget", **not** "an escape exists"; 865 of
909 escapes came from a cheap screen that never attempted a full certificate.
Please do not upgrade any of this language, and treat the control set as biased
by that screen.

## What we already checked, so you don't repeat it

**1. Dead does not require contact.** The earlier catalogue note that "the four
real dead positions are all in contact" is now false. 10 of the 261 have the
pieces strictly apart, up to **17.1u** of clearance between nearest legs. The
operative condition involves the victim's reachable set, not touching.

**2. Static pose geometry does not characterise deadness.** We computed hub
radii, foot radii, leg clearance, hub separation and angular separation for all
261 dead and all 1,045 controls. Single-feature separation (AUC):

```
attacker hub radius   0.761      leg clearance        0.359
victim mid-foot r     0.739      angular separation   0.364
victim hub radius     0.716      victim feet near rim 0.374
attacker max foot r   0.712      hub separation       0.378
```

The picture is "both pieces well out from centre **and** close to each other",
but it does not sharpen. Best conjunctive rules, against a 20.0% base rate:

```
tHub>=28 & clear<=10 & dAng<=30   57% recall, 39% precision (1.94x lift)
tHub>=30 & hubSep<=16 & vHub>=40  39% recall, 44% precision (2.20x lift)
tHub>=32 & clear<=8  & vMid>=42   11% recall, 45% precision (2.24x lift)
```

Precision ceilings around 45%. **Crude hub-coordinate geometry is not the
class.** Notably `victim feet near rim` points the *wrong* way (AUC 0.374), so
the intuitive "victim jammed against the rim" story is not what is happening
either. If a characterisation exists we think it has to be stated in terms of
the victim's **reachable set and its envelope structure** — which arms are
legal, how far, and where their stopping events fall — not in hub coordinates.

**3. The refusals are structured.** `--star` tries to inflate a dead point into
a ball and walks half-box h = 0.3, 0.12, 0.05u. 65 of 132 attempts were refused,
and the refusal is always the same thing: a reach envelope changes **stopping
event** inside the box, so the swing limit — continuous only between events —
straddles a wall. Points that refuse at every h are sitting on an event wall.

**4. The unresolved cases are one failure, not many.** All **136** unresolved
seeds failed for the same reason: *"no single arc certifies the gap"* at some
reply's substep boundary. That is one concentrated weakness, and it is the same
substep-phase phenomenon Brief 2's counterexamples established.

## What we are asking for

In rough priority:

1. **A sufficient condition for deadness stated over a region**, not a point —
   ideally in terms of the victim's six arm-limits and the attacker's reach
   envelope, such that membership can be tested without re-certifying every
   pose. Even a conservative condition covering a modest fraction of the 261
   would be worth far more than the list.

2. **A moving tube rather than a fixed box.** Brief 4 established that the
   nominal trajectory leaves both the ±0.1u and ±0.125u boxes at k15 (5°), well
   before the throw, so a fixed invariant box at that location is impossible.
   The refusal structure in (3) above says the same thing from the certificate
   side. A phase-indexed tube that tracks the event walls is the construction we
   think is needed; we have not built it.

3. **Is "dead" the right primitive?** Every position here is dead *one* loser-move
   before a throw (k=0); a pilot at k=0,1,2 found dead verdicts concentrated at
   k=0 (12 of 13). If the natural closed object is instead "the set from which
   the attacker has a forced win in n", say so and give the right induction.

4. **A falsifiable prediction.** Anything you derive, we would like to test
   against the engine the way everything else here was tested — so a condition
   we can evaluate on a pose, with an explicit expected verdict, is much more
   useful than an existence result.

## What we will do with it

Implement the condition in `nn/forced-win.js`, run it over the existing 1,306
screened seeds, and report precision and recall against the 261/1,045 split
above — plus an engine falsification pass on anything it newly claims. If it
generalises, it also becomes a real playing mechanism, which the lookup table
demonstrably is not.
