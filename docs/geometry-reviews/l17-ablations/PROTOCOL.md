# Controlled component tests for internal L17 — frozen protocol

21 September 2026. Written for the execution lane. The audit these rows come from is
`docs/geometry-reviews/l13-l17-stop-audit/` on `claude/l13-l17-stop-audit`; this branch adds the
switches and the runners that make the rows measurable.

Every row is the **same rung** with options overridden for that call — never a re-implementation —
so a difference between two rows is a difference in the switched component and nothing else.

## Before anything else: two arena facts that decide the design

**1. Ladder rungs ignore every clock flag.** `nn/arena.js`'s `makeBrain` matches `L<n>` first and
returns `fn: idx => eng.ladderPlanFor(lvl-1, idx, cfg)`; `timeMs` is read only by the `le:`, `dual:`
and `nn:` branches. So `--timeMs`, `--timeMsA/B` and `--timeMsLo/Hi` are silently inert here, and
the brain name carries no `T` tag, so runs at different clocks would pool as one row. **Do not claim
equal time. Label every comparison "fixed search plus measured runtime"** and report the runtimes.

**2. Without a shared opening list, "96 games" is two games.** `opening.js`'s own header says it:
deterministic brains replay one game per starting colour. `--openingPlies` defaults to **0**, so that
guard is off unless asked for, and the arena pins the corner-opening coin to `false` for a bare
`L<n>` spec — so nothing varies at all. Measured on this build:

    node nn/arena.js --a L4 --b L5 --games 6
    → game 0,2,4: aIsBlue=true,  B wins, 30 plies      (the same game three times)
      game 1,3,5: aIsBlue=false, A wins, 120 plies     (the same game three times)
      printed: "3-3 (50% of decided, +0 +/- 284 Elo)" — an interval computed from n=6 on n=2

This branch adds `--openingSeed`, `--openings` and `--openingsOut`. With a list in play, games `2i`
and `2i+1` are the same opening with the seats swapped, which is the resampling unit the request
asks for. The same six-game match with `--openingPlies 2 --openingSeed 7` gives six genuinely
distinct games (30, 89, 38, 45, 76, 83 plies), and re-running from the saved file reproduces the
outcomes, plies and seats exactly.

## Stage 1 — fixtures (no games). `ablation-matrix.js`

    node ablation-matrix.js --n 60 --split dev --json results/matrix-dev-60.json

Per-position decisions, component counters and cost. **Its first row is a self-test, not a
measurement**: with all three components off, `ladderPlanDead` must reduce to `ladderPlan3` and play
L11's move on every position. If that fails the run aborts and no other row means anything.

Reading from a 10-position smoke run (`--n 10 --split dev`), self-test passed:

| row | switches | moves ≠ L11 | ×L11 cost | counters |
| --- | --- | --- | --- | --- |
| `L11` | baseline | 0 | 1.00 | |
| `L17-all-off` | all three off | **0** (self-test) | 1.02 | |
| `L13` | — | 1 | **2.84** | |
| `L17` | shipped | 2 | 1.17 | `certCalls=216` `guards=8` `guardHits=8` `declined=8` |
| `L17-dense` | dense only | **0** | 1.02 | dense never fired |
| `L17-guard` | guard only | **2** | 1.13 | `guards=8 guardHits=8 declined=8` |
| `L17-dense+guard` | table off | 2 | 1.14 | same as guard alone |
| `L17-table` | table only | **0** | 1.04 | `certCalls=216`, no hits |
| `L11-eps` | marks restored | 6 | 1.02 | |
| `L17-eps` | marks restored | 7 | 1.17 | |

Ten positions is a smoke run, but the structure is already clear and matches the audit: **the guard
is the only component of L17 that changes a move here**, the dense test never fires on ordinary
mined positions because it only runs on a child L11 has already scored as a forced win, and the
certificate table is consulted 216 times for nothing. Run at `--n 60` before drawing conclusions.

Note also that `L13` is **2.84× the cost of L11**, against its own header's claim that it "costs
little more than L11". Re-measure on a quiet machine; it was contended here.

## Stage 2 — smoke match (legality and runtime, not strength)

    node nn/arena.js --a L11 --b L17 --games 16 --openingPlies 2 --openingSeed 20260921 \
      --openingsOut openings-dev.jsonl --resultsJsonl smoke.jsonl --deadStats

16 games, 8 opening pairs. This exists to expose legality, runner and runtime failures. **It is not
an Elo verdict** and must not be reported as one.

## Stage 3 — the matrix, on fixtures first

Run stage 1 at `--n 60 --split dev` for every row. Select the small set of rows that are actually
distinguishable **before** paying for matches. A row whose `moves ≠ L11` is 0 cannot differ from L11
in a game either, and buying it 200 games proves nothing.

## Stage 4 — matches, only on the surviving rows

Freeze before the first game and record in the run log:

- **openings**: `openings-dev.jsonl`, generated once with `--openingSeed 20260921 --openingPlies 2`,
  and given to **every** configuration with `--openings`. Record its sha256.
- **seats**: swapped within each pair; the arena already alternates on `g % 2`.
- **source**: `index.html` and `nn/arena.js` blob hashes, and the branch head.
- **corner opening**: pinned off for a bare `L<n>` spec. If you want it on, use `L<n>+corner` for
  both sides and say so — it is a different brain.
- **clock**: none. Fixed search. Record `--n`-style per-move timings from stage 1 alongside.
- **hardware and concurrency**: one match at a time per core, and say what else was running. The
  stage-1 numbers here were contended and are marked so.
- **sample size**: chosen from stage-1 runtimes and Liam's available compute, fixed in advance.
  **Do not stop when significance appears.**

Then:

    node paired-elo.js smoke.jsonl --boots 4000

which resamples **opening pairs**, not games, includes draws and adjudicated games (cap-decided ones
weighted 0.75/0.25, the arena's own komi weight), states the match definition in its output, and
prints what the arena would have printed per-game for contrast. The arena's own `+/- Elo` ignores the
pairing and is roughly √2 too tight; do not quote it.

## Rows, and what each one answers

| Row | Spec for `--a`/`--b` | Question |
| --- | --- | --- |
| `L11` | `L11` | baseline |
| `L17-all-off` | `L17+cfg:deadDense=0,deadGuard=0,deadTable=0` | self-test: must equal L11 |
| `L13` | `L13` | do richer opponent replies catch the missed stops? |
| `L17` | `L17` | the shipped combined mechanism |
| `L17-dense` | `L17+cfg:deadTable=0,deadGuard=0` | challenging apparent forced wins, alone |
| `L17-guard` | `L17+cfg:deadTable=0,deadDense=0` | avoiding impending dead states, alone |
| `L17-dense+guard` | `L17+cfg:deadTable=0` | their interaction |
| `L17-table` | `L17+cfg:deadDense=0,deadGuard=0` | lookup cost and hits, alone |
| `L11-eps` | `L11+cfg:markEps=1e-9` | L11 with the dropped stop marks restored |
| `L17-eps` | `L17+cfg:markEps=1e-9` | shipped L17, marks restored |

`+cfg:` overrides options **per call**; `AI_LADDER` is never mutated, so the two sides of a match
cannot contaminate each other even though they share one engine. The cfg string rides in the brain
name so two option sets can never pool as one row.

## What is deliberately not here

- **No selective interior-stop challenger.** The request says to implement it only after the
  existing searches are audited. The audit is done; the challenger is the next patch, and it should
  be designed against the escape-band structure the audit measured, not against the 2° fixture —
  both L13 and L17 already refute that one.
- **No change to the shipped ladder.** `markEps` defaults to 0, every `dead*` switch defaults on, and
  a bare `L<n>` spec is the rung exactly as it ships.
