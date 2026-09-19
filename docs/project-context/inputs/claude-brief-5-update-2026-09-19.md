Session limit reached

committee.js+39-3

I hit my usage limit while you were working, but it has reset now. Please continue from where you left off.

Both agents were killed by the session limit mid-flight. Let me see exactly what survived before deciding what to redo.

Rana command

Good — a lot survived on disk. The `lane*.log` files look like the L17-vs-L11 arena output. Let me check whether the measurement result is recoverable.

Rana command

Lane logs are truncated at 5–9 games each — those agents died before finishing. But arena writes its own logs; let me check if more survived there.

Ranls…

Arena logs are headers only — the measurement didn't survive. The games were also slower than expected (160 games didn't finish in \~20 min), which itself matters. Let me check what instrumentation exists and time it properly.

Rangrep…

`--deadStats` instrumentation exists, and I can see why it was slow: L17 is L11's exact search plus `guardCands:6, guardReplies:12` — 72 extra reply evaluations per move, plus a 160-stop dead scan. Let me re-run the measurement properly, in the background with durable output.

Rana command

\~45s per game even with 6 lanes — that's the cost of those 72 extra reply evaluations. It'll take \~12 min. Meanwhile, let me recover what the dead-zone agent had in flight when it died mid-sentence on "excellent example found."

Rana command

Recovered it — the star pass found **67 dead balls**, not the 5 in the committed write-up, including one at `eps 0.35u` (vs 0.038 in what got committed). That's the "excellent example." Let me quantify properly.

Rana command

This is real, verified, and exists nowhere but the scratchpad — and `dead-balls.jsonl` is the file the committed README already references but which was never written. Let me complete that.

Ran 2 commands

63 distinct poses with certified balls written. Now updating the README section that references it, then committing.

Edited README.md, ran a command+12-0

The README is richer than I'd seen — the agent also found that **dead does not require contact** (10 of 261 have the pieces up to 17.1u apart, overturning the earlier "all four dead positions are in contact" note). Committing the recovered ball data.

Ran 2 commands

\~11 games in 9 minutes — L17 is far more expensive than L11, which matters independently of strength. Let me check what the instrumentation will tell us and confirm the dead-set actually fires at all.

Ransed…

The instrumentation is well designed — it separates the two mechanisms. `certHits`/`famHits` count the actual *certificate table* firing; `guardHits`/`declined` count a generic forced-loss guard that doesn't use the certificates at all. That distinction decides whether any strength gain is really "knowing the dead spots" or just a tactical safety net. Let me wait for it properly.

Rana command

Measurement is running in the background — I'll be notified when all six lanes finish.

Recap of where things stand after the rate-limit interruption:

**Recovered and pushed** (`945168ade`) — the star pass results that died with the agent. It had finished computing but never wrote them: **63 certified dead balls** (radii `eps` 0.009u–0.350u, median 0.095u, widest carrying W = 1.014u), all 63 passing engine falsification at 25/25. Baseline was **one**. That also fills `dead-balls.jsonl`, which the committed README already referenced but which never existed.

**The honest headline in that data is the refusal rate**: 132 attempts, 67 accepted, 65 refused. A refusal means a reach envelope changes stopping event inside the box — so those points sit on an event wall, which is precisely where a *moving tube* rather than a fixed box will be needed. That lines up exactly with Brief 4's open obligation.

**Also worth flagging from the agent's write-up**: with 261 points instead of 4, the earlier catalogue note that "the four real dead positions are all in contact" no longer holds — 10 of the 261 have the pieces strictly apart, up to **17.1u** of clearance. The operative condition is the victim being cornered against the rim, not contact.

**Still open — the L11+dead strength question.** The original 160 games died with the agent (arena logs were headers only), so I restarted it: 6 lanes × 16 games with `--deadStats`. It's slow — \~45s/game, because L17 adds 6 candidates × 12 replies per move on top of L11's search. That cost is a real finding on its own: even a stronger rung that's several times slower per move may lose at equal *time*, which is how you'd actually play it.

Readblbc4dz34.output

Full result in. Let me aggregate it precisely and get a cost baseline, since "stronger" and "stronger per unit time" are different questions here.

Rannode…

Definitive answer, and it's not the one hoped for. Let me record it durably before reporting.

Rana command

Push raced with a concurrent push (trainers may be back up). Retrying.

Rana command

Pushed. All three things you asked for are done and in git. The third one has a clear answer, and it's not the one you were hoping for — but it's a genuinely useful one.

### Does L11-that-knows-the-dead-spots get stronger by a big margin?

**No. And the dead spots contributed literally nothing.**

96 games vs plain L11: **L17 56–40**, 58.3%, **+58 Elo with a 95% CI of −11 to +133**. The interval straddles even, so "stronger" isn't established and "by a big margin" is ruled out at this sample.

The decisive number isn't the score, it's the instrumentation:

```
certified table consulted   23,804x  ->  0 point hits, 0 arc hits
```

`nearest approach to any certificate:     2.85u`

`largest certified ball radius:           0.35u`

Across 96 games the rung checked its table nearly 24,000 times and **never matched once**. The closest live play ever came to a certified region was \~8× the radius of the biggest ball we have — and that's the *nearest* approach in the whole run.

That's geometry, not bad luck. The certified set is a 3-D sweep inside a 6-D joint pose space — zero 6-dimensional volume. Going from 4 points to 261 points and 63 balls doesn't change that. **A certified-position lookup table is not a playing-strength mechanism**, and won't become one by adding certificates at this rate.

### But something in there did work

```
dense test  1,005x  ->  265 confirmed dead, 740 refuted
```

`guard         285x  ->  232 moves declined`

Whatever part of that +58 Elo is real comes from the *machinery* built to verify certificates, used online — the dense dead-test and the 6×12 forced-loss guard — neither of which consults the table. So the question actually worth chasing is "give L11 an online forced-loss check," with no table at all, measured **at equal time rather than equal games** (L17 costs \~81s/game because of 72 extra reply evaluations per move). I've got an L11-vs-L11 baseline timing running to quantify that.

### The other two

- **Committee weighting** — `d2w` now always fields regardless of that stale `TAU_COMMITTEE_VARIANTS` env var, and tops up beside live siblings rather than waiting for a full sweep. Needs a `git pull` on the desktop before restart.
- **More dead zones** — 4 → **261 certified dead points** (all 261 passing engine falsification, 10,440 playouts, zero contradictions) and 1 → **63 dead balls** (radii up to 0.35u). Plus a real finding: dead does *not* require contact — 10 of the 261 have the pieces up to 17.1u apart, so the operative condition is the victim cornered against the rim.

All of it certified by sampling, not proved — the write-ups say so plainly in their own opening sections.

README.md+12-0

did you push results to repo or you wanna gimme handover to astra for it to see if it can generalise between the 261 and find classes and regions that are dead not just  points

Pushed — everything's in. Let me confirm, then do the actual work for the Astra brief: a good brief needs the structure we've *already* found in the 261, not just a pointer to the file.

Rana command

All pushed. Now the analysis that makes a brief worth sending — the key asset is that we have a **control group**: 1,045 screened-not-dead positions alongside the 261 dead. Let me find what discriminates them.

Rana command

That hit the bundled THREE.js. Let me query the engine directly instead.

Rana command

Geometry confirmed (`footR 23.095`, rim `66.667`). Now the discriminating analysis — dead vs the 1,045 not-dead controls.

Rannode…

Real structure emerging — and it's in the *attacker's* placement, not just the victim's. Let me quantify separation properly rather than eyeball percentiles.

Rana command

Strong signal. Let me test whether a simple conjunctive rule captures a real subclass — that's what turns "points" into "regions" for Astra.

Rannode…

Important negative result: static geometry **doesn't** characterize deadness — best rule is 44% precision at 39% recall, only \~2.2× lift over base rate. That's exactly what Astra needs to know so it doesn't re-tread it. Writing the brief.

Ran 2 commands

Both: results were already pushed, and the Astra brief is now written and pushed too.

**docs/dead-regions/astra-brief-5-from-points-to-classes.md** — follows your existing brief-N convention, ready to hand over.

The reason I spent the time analysing rather than just pointing Astra at the files: most of the brief's value is in **ruling out the easy answers**, so it doesn't burn effort re-deriving what we can already measure.

What it tells Astra we've eliminated:

- **The lookup table is worthless in play** — 23,804 consultations, 0 hits, nearest approach 2.85u against a 0.35u largest ball. The certified set has zero 6-dimensional volume, so enumerating more points can never help. *Generalisation is the only thing that makes the 261 worth having* — that's the framing for why it's being asked.
- **Dead does not require contact** — 10 of 261 have the pieces apart, up to 17.1u.
- **Static pose geometry does not characterise deadness.** I computed hub radii, foot radii, clearance, hub separation and angular separation across all 261 dead + 1,045 controls. Full AUC table in the brief; best conjunctive rules plateau at **\~45% precision / 2.2× lift** against a 20% base rate. And the intuitive story is wrong — "victim jammed against the rim" points the *wrong way* (AUC 0.374).
- **The 65 star refusals are all one thing**: an envelope changing stopping event inside the box.
- **All 136 unresolved seeds are one failure**: no single arc certifies the gap at a substep boundary — the same substep-phase phenomenon Brief 2 established.

The ask is then sharp: a sufficient condition over a **region**, phrased on the victim's six arm-limits and the attacker's reach envelope rather than hub coordinates, plus the phase-indexed **moving tube** that Brief 4's k15 box-escape result implies is necessary. It also asks whether "dead" is even the right primitive, or whether "forced win in n" is the closed object.

It restates the claim class verbatim — sampled not proved, allowance is 3× an observed slope, `escape` means "not found within budget" — and explicitly warns that the control set is screen-biased, since 865 of 909 escapes came from the cheap screen.

And it closes with what we'll do with the answer: implement it in `forced-win.js`, run it over the 1,306 screened seeds, report precision/recall against the 261/1,045 split, and engine-falsify anything it newly claims.

Three PRs blocked on conflicts. Let me look at the actual conflicts before touching anything — especially since two of these target `main`, which is the live site.

Rangit fetch origin…

`main` is 132 commits ahead; my branch is 4,263 ahead (mostly trainer noise), diverged 9 days ago. Let me examine PR [#28](https://github.com/liaminhawai-cmd/Tau/pull/28)'s conflict first — it's one commit and targets my branch, so it's the in-scope one.

Runninga commandrunning