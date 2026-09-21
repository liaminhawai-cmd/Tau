# Opus task A: what L11, internal L13 and internal L17 actually examine

21 September 2026. This is the audit the [Claude task request](../l11-stop-audit/CLAUDE-TASKS.md)
asks for before anything is redesigned. It reports what the three searches do; it does not propose a
new rung, and it runs no arena matches.

## Revisions

| What | Revision |
| --- | --- |
| Audit pin used by the L11 stop audit | `ce0e61d1e7482e3d1252aadadf97bd4269f71e29` |
| Current `main` at this audit | `8b31eec8babb7aa1b0a2198e803088c3ec11e7ed` (PR #33 merged) |
| Only revision that carries internal L17 | `claude/board-game-video-adaptation-cf8a93` @ `ecda5780704d0950057d5fe42e91f36258ac123f` |
| `index.html` blob, pin and `main` | `2fbb3e401ecf8736810f0867080b90c83558e6fe` |
| `index.html` blob, L17 branch | `c79872b8f3a8cad175075c2639320fa7cf915c29` |
| `nn/engine.js` blob, pin and `main` | `e3fa3d44847575379b95bd8a4f5183c4d7741335` |
| `nn/engine.js` blob, L17 branch | `e7d333a50ea8eb983dbd8308e5748606dbb0ec04` |
| `nn/arena.js` blob, `main` / L17 branch | `8a82474e0d81be414ac8717d6fec2a8f8264969e` / `278de70a708bf84a370106511b74a7713a73bd41` |

## Step 1 — reproduce.js, pinned and current

`docs/geometry-reviews/l11-stop-audit/reproduce.js` reproduces `result.json` byte for byte against
both the pinned checkout and current `main`: score `1000015.513212251`, stop `2` degrees, all six
attacker responses legal with the defender on board.

That agreement is **not** independent confirmation. `nn/engine.js` is byte-identical at the pin and
at `main` (`e3fa3d44…` both), and so is `index.html`, so the current-source run re-executes the same
bytes. What it does establish is that nothing merged since the pin, PR #33 included, touched the
engine or the search.

Two provenance gaps a reader following the audit on `main` will hit:

- The audit names `docs/dead-regions/screened-not-dead.jsonl` as its source fixture. **That file is
  not on `main` and not at the pin.** The whole `docs/dead-regions/` corpus and
  `nn/dead-positions.jsonl` live only on `claude/board-game-video-adaptation-cf8a93`.
- The audit's `result.json` records `source: ce0e61d1e…`, which is correct for the engine but
  cannot be used to recover the fixture.

## Step 2 — ladder mapping, checked against the live table

Internal `L<n>` is `AI_LADDER[n-1]`, one-based. Read off the extracted engine rather than from a
document:

| Revision | `AI_LADDER.length` | internal L11 | internal L13 | internal L15 / L16 | internal L17 |
| --- | --- | --- | --- | --- | --- |
| `main` `8b31eec8b` | 16 | `[10]` `p3` | `[12]` `opp2` "Retired L13" | Committee / Champion | **absent** |
| L17 branch `ecda57807` | 18 | `[10]` `p3` | `[12]` `opp2` "Retired L13" | L12a `p4` / L12b `opp` | `[16]` `dead` "L11+dead" (and `[17]` `p5` L12c) |

Three consequences, all load-bearing for task B:

1. **Internal L17 cannot be ablated on `main`.** `kind:'dead'`, `ladderPlanDead`, `ladderDeadEscape`,
   `ladderDeadGuard`, `DEAD_CERTS` and `DEAD_FAMILIES` exist only on the L17 branch. Any run of the
   task's ablation matrix has to name that branch explicitly.
2. **"L15" and "L16" mean different brains on the two branches.** On `main` they are the Committee
   and the Champion net; on the L17 branch they are the `d4-deeper` and `opp-model` experiments.
   An arena log naming `L15` is ambiguous without its revision. More awkwardly, the Committee and
   Champion rungs do **not** exist on the L17 branch at all, so **no single revision carries both
   internal L17 and the current top of the player ladder**. A "best challenger against the strongest
   rung we have" comparison cannot be run until one does.
3. **Public difficulty 13 is not internal L13.** `RUNG_TO_AI_LADDER = [0,0,1,2,3,4,5,6,7,8,9,15,14]`
   with `LADDER_N = 13`, so the thirteenth public rung is `AI_LADDER[14]` — the Committee. The page
   says so itself: "Yellow at rung 1 through Colossus at rung 12 (L1-L11's own difficulties,
   unmoved…), plus the Committee at rung 13. L12/L13 in AI_LADDER's own numbering are retained
   internally only so old arena logs remain reproducible". Internal L13 is `AI_LADDER[12]`,
   `experimental:'retired-search'`, and is not on the public ladder at all.

## Step 2 — the stops each search actually examines

`stop-coverage.js` runs at the audited post-root position
(`[-40.2848, 3.7263, 1.8209, -30.2905, 12.3529, 1.5755]`, defender is piece 0, to move) and records
each reply on the line where that search commits to it. Ground truth is every stop the defender can
reach on its six arms, sampled at 0.25°, classified by the same punishment test `ladderDeadEscape`
uses: can the attacker throw it with one of its six swing-to-the-jam answers.

**The escape set is not a needle.** 170 of 619 sampled stops escape — a contiguous band from 2° to
20.5° on arm (foot 0, +1), 2° to 18° on arm (foot 2, +1), 10° to 14.75° on (foot 1, +1) and 2° to 5°
on (foot 1, −1). The published 2° witness is the **bottom end of an 18.5°-wide band**, not a
knife-edge. Arms (foot 0, −1) and (foot 2, −1) have no escape at all.

| Search | reply generator | stops at this node | in an escape band | node verdict |
| --- | --- | --- | --- | --- |
| L11 | `ladderScore3`, `simMoveToLimit` endpoints | 6 (26.25°, 15.375°, 22.125°, 21.375°, 33.75°, 46.875°) | **0 of 6** | `1000015.513…` — claims a forced win |
| internal L13 | `ladderOppReplies` (endpoint + ≤2 park stops + shove stops), `oppKeep:18` | 15 | **4 of 15** (0+@3°, 0+@18°, 1−@3°, 2+@3°) | `58.48` — **refutes the win** |
| internal L17 | `ladderDeadEscape`, `deadDeg:6`, `deadStops:160` | 4 before its first-escape exit | **2 of 4** (0+@9°, 0+@15°) | escape found at 0+@9° — **refuses to certify** |

So, answering the step-2 question directly: the foot-0/+1/2° defence is **not included by any of the
three**. L11 has no interior stops at all — its only stop on that arm is the 26.25° jam, which is
past the band. L13's sweep quantises to 3°, so 2° is below its first expressible interior stop.
L17's dense grid does not mark before 9° here. It is not pruned, ranked out or rejected on merit by
any of them; it is simply not in their vocabulary.

**But the fixture is an L11-only blind spot.** Both L13 and L17 already overturn the claim at this
position, by different stops in the same band. Any experiment that uses this fixture as a test of
L13 or L17 will pass trivially. That is the main reason the held-out families in step 5 matter.

A methodological note worth keeping: the published witness pose was built with 1°-per-call swings,
while both searches replay a chosen stop with 3°-per-call swings, and the engine subdivides each
call into equal substeps of at most 0.4°. Those are different finite maps. Over the 619 sampled
stops the two schedules disagree on exactly one (170 escapes under 3° calls, 169 under 1°: the
(foot 1, +1) stop at 10° escapes under one and not the other). Small, but not zero, and it is the
reason every stop here is reported with the schedule that produced it.

## Step 3 — L17's dense check: stride, budget, early exits

`ladderDeadEscape(victim, stepDeg, maxStops)` sweeps each arm in `AI_STEP_RAD` = 3° calls and marks
a stop when `a - lastMark >= step`, plus the arm's own endpoint; it returns the first stop that is
not punished, and returns the stop it stopped at when `maxStops` runs out.

- **Early exit:** first unpunished stop, immediately. At the audited position it examines four stops
  on one arm and returns; the other five arms are never swept. This is correct for the verdict but
  means per-position stop counts are not a measure of the grid's coverage.
- **Budget:** `deadStops:160` across six arms. Not reached at the audited position, and not reached
  in the corpus sample below.
- **Stride: the configured 6° is not the stride it gets.** `|netRad|` is accumulated through
  `applySwing`'s substep loop and lands a few ULPs *below* the nominal multiple of the 3° call, so
  the exact `>=` fails and the mark is skipped to the next call. At the audited position the marks
  on arm (foot 0, +1) fall at **9°, 15°, 24°** — strides of 9, 6 and 9 — with 6° and 21° silently
  dropped. Over 200 corpus positions × 6 arms, the shipped rule takes 4021 marks where an exact 6°
  stride would take 5070: **20.7% of the dense grid is lost.** The same comparison at the root
  sampler's `sampleDeg:9` (`ladderRoots3`, used by L11, L13 and L17 alike) loses **10.9%**.

  This can only ever cost the test escapes it should have found — a sparser grid cannot invent an
  escape — so the file's claim that the test "can only ever refuse a claim, never invent one" still
  holds, and so does its claim to contain L11's six endpoints, which are always pushed. What it
  cannot support is the claim to be a 6° test.

  The fix is one comparison, not a redesign: `a - lastMark >= step - 1e-9`.

**This is not an L17 problem.** The same exact-`>=` mark rule appears three times on production
`main` (`grep -n 'a-lastMark' index.html` → 4260, 4305, 4708) and four times on the L17 branch:

  | Site | Used by | `sampleDeg` |
  | --- | --- | --- |
  | `ladderSampledPlanGen` | L3, L4, L5, L6 | 26 / 18 / 18 / 24 |
  | `ladderRoots3` | L8, L9, L10, **L11**, L12, L13, L14 — and L17's roots | 18 / 9 / 9 / 9 / 9 / 9 / 9 |
  | corner-book third move | every rung wearing the corner opening | 9 (default 6) |
  | `ladderDeadEscape` | internal L17 only | `deadDeg` 6 |

  So the shipped game's own ladder loses roughly **10.9%** of the root stop candidates it is
  configured to generate, on every rung from L3 up.

  **It changes the move.** `root-stride.js`, 60 frozen dev positions, each rung called through
  `ladderPlanRung` so the corner-opening coin is never tossed and nothing is random:

  | Rung | `sampleDeg` | moves changed by a 1e-9 mark tolerance |
  | --- | --- | --- |
  | **L11** (`p3`, on the public ladder as rung 12) | 9 | **34 of 60 — 56.7%** |
  | internal L13 (`opp2`) | 9 | **32 of 60 — 53.3%** |

  Most changes are a neighbouring stop on the same arm (`2+@51°` → `2+@54°`, `0+@42°` → `0+@36°`),
  which is what inserting grid points into a `keepStops`-truncated candidate list should do. Some are
  a different arm entirely (`1+@3°` → `0+@27°`). **Whether the restored grid plays better is not
  measured here and is not claimed** — task A runs no matches. What is established is that this is
  not a cosmetic defect: on these positions it decides over half the rung's moves.

  Caveat on the population: these are mined mid/late-game contact-heavy poses from
  `screened-not-dead.jsonl`, chosen because they are where stop coverage matters. They are not a
  sample of ordinary play, and the rate on opening positions will differ.

`dense-stride.js` measures what that costs in verdicts, on the frozen development set only:

**Preliminary, 12 positions, whole corpus (not the frozen split).** A 150-position run on the
frozen development set is in flight; this is the smoke run that sized it, and 12 positions is far
too few to put a rate on.

| | shipped | 1e-9 tolerance |
| --- | --- | --- |
| positions sampled | 12 | 12 |
| positions that have an escape at 0.25° | 11 | 11 |
| escape found | 9 | 10 |
| escape missed (certified dead when it is not) | **2** | **1** |
| dense-grid marks taken | 104 | 118 |
| budget exhausted | 0 | 0 |

One verdict in twelve flipped on the tolerance alone. Read that as "the defect reaches verdicts,
not only counters"; do not read a rate off it.

## Step 4 — the certificate table and its loader

**There is no loader.** `DEAD_CERTS` is a literal array of **8 poses** (4 `dead`, 4 `win2`) plus
`DEAD_FAMILIES`, 12 entry arcs. `index.html` mentions `nn/dead-positions.jsonl` only in comments;
nothing in the shipped page reads any `.jsonl` file.

| Corpus | rows | read by |
| --- | --- | --- |
| `nn/dead-positions.jsonl` | 23 | `nn/forced-win.js` (the offline certifier) |
| `docs/dead-regions/dead-points-mined.jsonl` | **261** | `nn/dead-corpus-geometry.js` (analysis only) |
| `docs/dead-regions/dead-balls.jsonl` | **63** | `nn/dead-corpus-geometry.js` (analysis only) |
| `docs/dead-regions/screened-not-dead.jsonl` | 1045 | nothing in the game |

So the historical 96-game L17 run's "23,804 table consultations, no hits" is a result about **8
hard-coded poses**, and it could not have tested the 261-point / 63-ball corpus under any flag,
because no code path loads it. Re-running that measurement against the advertised corpus is not a
re-run: it requires a loader that does not exist. Until one does, the table's hit rate and the dense
check's contribution should be reported as two separate things, which `DEAD_STATS` already
separates (`certCalls`/`certHits`/`famHits` against `dense`/`confirmed`/`refuted`).

## Step 5 — frozen development and held-out sets

`freeze-sets.js` writes `frozen-sets.json`. A corpus row's `g` is a position id, not a game id
(`<game>-j<job>-<a>-<b>`, or `<game>-<ply>` for the older short ids), and rows from one game are the
same trajectory a few plies apart. The split is therefore by **game family**, assigned by a salted
SHA-256 of the family name so it is deterministic and no family can straddle the boundary.

- sources: `screened-not-dead.jsonl` (1045 rows, sha256 `72ddda0d…`) and `dead-points-mined.jsonl`
  (261 rows, sha256 `d0af93a8…`)
- 928 families → **291 dev families / 384 rows**, **637 held-out families / 922 rows**
- the published witness's family, `retro-ratchet-20260918073412-de8-w1`, hashes into held-out and is
  **forced into dev**, as the task requires. `witnessForcedIntoDev: true` records that it was forced
  rather than landing there by chance.

## The equal-time gate

The task asks for this to be settled before any comparison is run. It is settled, and the answer is
no.

`nn/arena.js`'s `makeBrain` matches `L<n>` first and returns
`{ name: 'L' + lvl, fn: idx => eng.ladderPlanFor(lvl - 1, idx) }`. **`timeMs` is never read on that
path.** It is consumed only by the `le:`, `dual:` and `nn:` branches, which route to
`nnPlanForTimed`. This holds on both `main` (`8a82474e…`) and the L17 branch (`278de70a…`, which
adds `+corner` and `+veto` to the same clockless branch).

So `--timeMs`, `--timeMsA`, `--timeMsB` and `--timeMsLo`/`--timeMsHi` are **silently inert against a
ladder rung**: it plays its fixed-depth search for as long as that takes. Worse for bookkeeping, the
rung's arena name carries no `T` tag, so two runs at different clocks pool as the same brain in a
tournament table — the exact hazard the file guards against elsewhere ("two memberships can never
pool as one brain"). The `le:` branch's own comment already says a ladder rung has no clock; what is
new here is that passing the flag anyway produces no error and no trace.

Per the task's instruction, the first comparison must therefore be labelled **fixed search plus
measured runtime**, not equal time. Measured cost, `move-cost.js`, on the frozen dev set:

**Deterministic part first**, since it does not depend on the machine. Over 10 dev positions,
called through `ladderPlanRung` so the corner-opening coin is never tossed:

| Rung | moves differing from L11 | `DEAD_STATS` |
| --- | --- | --- |
| internal L13 (`opp2`) | 1 of 10 | — |
| internal L17 (`dead`) | 2 of 10 | `dense: 0`, `certCalls: 216`, `certHits: 0`, `famHits: 0`, `guards: 8`, `guardHits: 8`, `declined: 8` |

Two things stand out. The **dense test never fired** in ten positions: it only runs on a child that
`ladderScore3` has already scored as a forced win, and none occurred. So on ordinary mined
positions L17's advertised half is dormant and what actually differs from L11 is the guard. And the
guard **declined every candidate it examined** (`guardHits == guards == declined == 8`); the moves
that changed did so because a later candidate passed the rim/hub gate without the guard ever
running on it, not because the guard found a safe move.

**Timings from that run are not reportable.** It shared the machine with a long background job, and
the absolute numbers (L11 ≈ 1.98 s a move, L13 ≈ 2.8× L11, L17 ≈ 1.13× L11) are inflated by an
unknown amount. The L13 ratio is worth re-measuring on a quiet machine specifically, because the
rung's own header claims it "costs little more than L11" and 2.8× would contradict that. Marked as
not yet established.

## What this changes about the plan

1. The task's ablation matrix rows for L17 (`dense only`, `guard only`, `dense+guard`, `table on`)
   need switches that do not exist yet, on a branch that is not `main`. That is the first patch, and
   it is small: `deadDeg`/`deadStops`/`guardCands`/`guardReplies` are already per-rung options, so
   the ablations are option values plus a flag to bypass `deadCertVerdict`.
2. The stride defect should be fixed **before** the ablations, or the "dense check" row measures a
   grid 20.7% sparser than the one being reported.
3. The 2° fixture cannot serve as the L13/L17 regression example — both already pass it. It stays as
   the L11 regression example, and the held-out families supply the L13/L17 cases.
4. No arena match in this packet, and no trainer was restarted.

## Files

| File | What it does |
| --- | --- |
| `stop-coverage.js` | Steps 2–3 at the audited position: each search's real reply set, its node verdict, and the 0.25° ground-truth escape set under both call schedules. |
| `dense-stride.js` | Step 3: `ladderDeadEscape` as shipped vs with a 1e-9 rad mark tolerance, against ground truth, over the frozen dev set. |
| `freeze-sets.js` / `frozen-sets.json` | Step 5: the family-grouped, salted, deterministic split. |
| `root-stride.js` | The same defect at the site that is on production `main`: does a 1e-9 mark tolerance change the move a rung plays? |
| `move-cost.js` | The equal-time gate finding, plus measured per-move cost and move-change rate against L11. |
| `patches/` | The stride fix, for `main` and for the L17 branch. Supplied, not applied — see `patches/README.md`. |
| `results/` | Raw JSON from each run. |

All four take a checkout path. `stop-coverage.js` and `move-cost.js` report an absent L17 rather
than failing; `dense-stride.js` requires a checkout that has one.
