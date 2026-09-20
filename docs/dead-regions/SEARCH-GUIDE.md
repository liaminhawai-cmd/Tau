# How the dead-certificate search works

A guide to `nn/forced-win.js` and `nn/contact-law.js` for someone new to the code: what a
certificate claims, what the depth and screening options do, how a batch run is seeded and
resumed, and what the four outcomes mean.

**Where the code lives.** Neither file is on `main`. Both are on
`claude/board-game-video-adaptation-cf8a93`, which is where the 261-point corpus in this
directory was produced. They were originally written on `claude/nn-arena-matches-tm1hi9`
(PR #8) and the two versions have since converged -- `contact-law.js` is byte-identical
and `forced-win.js` differs only by the cover rule described below.

Line references, on this branch: the certificate is `deadCertificate` (line 518), the
deeper search is `deadDeep` (839), one batch seed is `batchSeed` (1054) and the batch
command is `--dead-batch` (2068).

## The problem in one paragraph

Tau is a two-piece pushing game on a round board. Each piece is a tripod. A move pins one
foot and rotates the piece about it, and the rotating piece can shove the other one. A
player loses when one of their feet is pushed past the rim. The search asks a single
question about a position: **is the side to move already lost, whatever they do?** A
position where the answer is yes is called **dead**. Because moves are continuous (any
pivot foot, either direction, any stopping angle) you cannot enumerate replies. The code
instead certifies whole *ranges* of stops at once using a continuity argument, and then
asks the real game engine to try to break the claim.

## The contact law

`contact-law.js` is a stand-alone reimplementation of what happens during a swing. The
mover rotates rigidly about its pinned foot. The pushed piece moves the least it can, at
every instant, to keep every leg-tube gap at least two leg radii apart. That is a
closed-form rule per contact, integrated in small angular steps.

Two parameter sets exist. `IDEAL` integrates the law finely with none of the engine's
shortcuts. `REPLICA` uses the engine's own knobs -- 0.4-degree substeps, 12-segment legs,
10 solver iterations, a 0.8u correction cap. Measured over 200 contact events, REPLICA
reproduces the engine to 0.000u, so the search always uses REPLICA: the law *is* the
engine, only callable as a function. (`nn/throw-cert.js --engine` still shows the two
agreeing to six decimals on a full 110-degree sweep.)

The search uses three things from this file:

- **`swing()`** sweeps one move to a given angle and returns where the pushed piece ends
  up. With `record` on it also keeps the pushed piece's pose after every step, so one
  sweep yields the outcome of *every* stopping angle along that arm. The code calls this
  the **reply family**.
- **Throw margin.** How far the furthest victim foot gets beyond the rim during a sweep,
  in board units (u). Positive means thrown, negative means not.
- **`minGapOf()`**, the closest approach of the two tripods as one number, used by the
  family-graph part of the file (arcs and tubes), which this guide leaves aside.

## What a certificate claims

Fix the victim (the side to move) and the attacker. The victim has six **arms**: three
pivot feet times two directions. Along each arm the victim can stop anywhere from the
minimum legal move up to that arm's limit, where the engine stops the swing (an own foot
at the rim, or the one-crossing rule).

### Depth 1: thrown at once

A position is dead at depth 1 when for every arm and every stop, the attacker then has
some swing that throws the victim. The certificate samples stops every 2 degrees along
each arm (the last sample at the limit), and at each sample takes the attacker's six throw
margins. Then it certifies each **gap** between neighbouring samples with a sampled-slope
rule:

- Some single attacker arc must be positive at **both** ends of the gap, by more than the
  gap's half-length times a Lipschitz allowance. The allowance is three times the steepest
  slope the two ends show, never below 1u per u.
- That arc must have the same **contact signature** at both ends: the same leg pairs
  touched, first touch within 5 degrees. Otherwise a grazing surface could hide a change
  of outcome inside the gap.
- A gap that fails with positive ends is bisected and each half tried again, down to the
  engine's own 0.4-degree substep.

At the substep three rescues remain, and all three are **relative to the engine's
resolution** -- every gap that reaches them is at most 1.5 substeps wide, and measured
over the 136 unresolved seeds in this directory, 131 are exactly one substep and none are
wider.

- **Sliver.** Both ends clear 5u on some arc. For the throw to vanish inside the gap the
  margin would have to fall from over 5u to zero and back within one substep, which the
  engine itself cannot resolve.
- **Engine-probed sliver.** Both ends clear 1.5u on a *common* arc. Twelve random stops
  inside the gap are reached by a human-style drag and the attacker's arms swept; if every
  one throws, the gap is accepted.
- **Cover.** No single arc spans the gap, but a succession of arms does: the gap is
  sampled at 13 points and each must have some arm throwing above 1.5u. This was added
  because 136 of 1,306 screened seeds were refused for exactly one reason -- *"no single
  arc certifies the gap ... the throw changes arm here"* -- and sweeping all 136 directly
  found one arm throwing at every stop in 135 of them. The refusal was the demand's, not
  the position's. See `gap-cover-result.md`, including why this bar is flat rather than a
  Lipschitz allowance.

All three are counted separately in the verdict (`slivers`, `probedSlivers`, `covers`), so
a certificate always says how it was obtained.

### Depth d: thrown or witnessed

`deadDeep` extends this to more moves. Dead at *d* moves (2d−1 plies) means: for every
victim reply, either the attacker throws now, or the attacker has a recorded **witness**
swing after which the position is dead at d−1 moves. Each sampled stop resolves one of two
ways:

- **thrown**: its best depth-1 margin clears the escape tolerance (0.75u).
- **witness**: the attacker's candidate swings (every 3 degrees on each arm) are screened
  cheaply, and the survivors get the full certificate at d−1 in screen order, at most four
  full children per sample.

Gaps are then certified as before, with one extra rule: a witness–witness gap whose two
witnesses lie on the same attacker arm with stops within 6 degrees is certified by the
children's margins in place of the throw margins. A gap whose ends differ in kind (one
thrown, one witnessed) is subdivided to the substep; there the thrown end is also searched
for a witness on the other end's arm, which bridges the boundary where the depth-1 margin
dips below 0.75u.

### What it is not

**None of this is a proof.** The Lipschitz allowance is read off the samples themselves,
so a certificate is a strong *sampled* claim. That is why every certified verdict is
followed by engine playouts: random legal victim moves played by random-size drags in the
shipped engine, the certificate's gap for that stop consulted, and the attacker's answer
played out. The header comment is blunt about it: **a claim the engine contradicts is a
bug in this file, never a rounding.**

## The depth and screening options

The single-position command is `--dead-deep`; the batch command is `--dead-batch`.

| Option | Default | What it does |
| --- | --- | --- |
| `--depth d` | 1 (batch), 2 (single) | Dead at *d* moves, 2d−1 plies. Depth 1 is the plain certificate with no witnesses. |
| `--step` | 2° | Spacing of the victim's sampled stops along each arm. Single-position only; the batch uses the default. |
| `--attStep` | 3° | Spacing of the attacker's candidate witness stops. Single-position only. |
| `--tries` | 4 | Full child certificates paid for per sample before giving up on that sample. Single-position only. |
| `--engine N` | 20 | Random engine playouts of a certified verdict. Single-position only; the batch always plays 20. |
| `--maxSeconds` | none | Batch budget. Passed down as a deadline so a seed stops cleanly. |
| `--threads N` | 1 | Batch seeds run in worker threads, one seed per worker. |

### Screening

A full certificate is expensive, so a **screen** is a cheap first look: the same per-arm
sampling but with stops every 8 degrees (or 16 for the coarsest pass) and no gap loop at
all. It returns only the smallest best margin seen, called `minBest`. Screens are used in
two places:

- **Ranking witness candidates.** Every candidate child gets the 16-degree screen; the
  best three get the 8-degree screen; then the full certificate is tried in that order.
  Screens and full results are memoised by pose, so a child reached twice costs once.
- **At the start of each batch seed.** At depth 1 a screen that finds a stop with best
  margin at or below −0.75u settles the seed as an escape without paying for the
  certificate. At depth 2 or more the screen is recorded but never rejects, because a
  position that escapes a throw in one may still be dead in two.

### Continuation and the played line

Two shortcuts keep the witness search from starting cold at every sample.
**Continuation:** along one arm the stops are resolved in increasing order, and the
previous stop's witness arm is tried first, candidate stops nearest its stop first, with
two full tries -- neighbouring victim stops are usually answered by neighbouring attacker
swings wherever the witness rule can certify the gap at all. **The hint:** when the batch
is given the seed's own game (`--games`), the attacker's reply actually played in that
game is tried before any other arm.

## How a batch run is seeded and resumed

```
node nn/forced-win.js --dead-batch seeds.jsonl --depth 2 --out results.jsonl \
  --maxSeconds 3600 --threads 4 [--only k] [--games dir...] [--memo f] [--childDead f]
```

1. **Read seeds.** One JSON row per line: `p` (six numbers, blue x y rot then red x y
   rot), `mover`, `k`, `g` the game id, `file` the game file.
2. **Filter.** `--only k` keeps one `k` value. `--childDead f` keeps only seeds whose game
   already has a certified-dead `k=2` row in that file.
3. **Skip done rows.** Rows in `--out` with the same pose, mover and depth are skipped,
   unless their status was `timeout`. Those are retried.
4. **Run to the budget.** Each remaining seed runs the screen, then the search under the
   deadline. One row is appended per seed. The tally prints after each.

**What a seed is.** Seeds are positions taken from real games, mined from arena or
retromine logs (`nn/dead-seeds.js`). The `k` field is an integer the seed list carries and
the batch only filters on; in the runs so far it reads as how far before the game's end
the position sits, counted in the losing side's moves, so `k=2` seeds are the ones the
depth-2 batch was built for. That reading is inferred from the `--childDead` filter, which
pairs a seed with "its game's `k=2` row", not from a definition in this file.

**Resume in detail.** The key is the six pose numbers to six decimals, the mover and the
depth. So one results file can hold depth-1 and depth-2 rows for the same position, and
rerunning with the same `--out` is idempotent apart from timeouts.

**Stopping.** With one thread the loop ends when the clock passes the budget or when a
seed returns `timeout`. With several threads, no new worker is launched after the
deadline, and the workers still running each hit the same deadline inside their own search
and return a timeout row. Either way the closing line says how many seeds are left.

**Preloaded memo.** `--memo f` reads depth-1 verdict rows and seeds each worker's child
memo with them, so a depth-2 search that lands on a child already judged at depth 1 gets
that verdict free. Rows are matched by pose and mover.

**Worker threads.** Each worker loads the module afresh and runs exactly one seed. Nothing
is shared between workers: memoisation is per seed, and the parent only appends rows and
prints. The row gains a `thread` field.

## What the outcomes mean

The batch tally counts four statuses. The printed word and the `status` field differ for
the first one: the row says `dead`, the tally says `certified`.

| Outcome | Meaning | What to do with it |
| --- | --- | --- |
| **certified** | Every arm, every stop, is thrown or witnessed, and every gap is certified, a sliver, an engine-probed sliver or a cover. The row carries `worstMargin`, the sliver/cover counts, the witnesses per segment and, at depth 2+, the engine's playout score out of 20. | Trust it to the extent of its worst margin and its playouts. A playout failure is a bug to chase, not noise. |
| **escape** | A concrete victim move the search cannot answer. Three forms: a reply that throws the attacker outright; a sampled stop whose best depth-1 margin is at or below −0.75u; or, at depth 2+, a stop with no witness within the tries. | A real, checkable position: play the named stop. At depth 2 an escape may vanish at depth 3 or with more tries, so it is a candidate for the next run, not a refutation forever. |
| **unresolved** | Margins positive everywhere sampled, but some gap could not be certified even at the substep: typically the certifying arm changes inside it, or the ends are of different kinds and no witness bridged them. `why` names the arm and the degree range. | Usually a boundary effect. The probe and cover rules were added for exactly this case and converted most earlier refusals; what remains needs a finer step, a different bar, or a hand look. |
| **timeout** | The deadline passed inside this seed. Whatever was certified so far is discarded. | Nothing was learned. The next batch with the same output file retries it automatically. |

A fifth status, `screen`, appears only inside the code: it is the return of a screening
pass and never reaches a batch row.

## Reading a certified row's segments

```
arm (1,-1): to 63.2deg  2.0-18.0 thrown by (0,1)(2,-1) | 18.0-40.0 witness (2,1) stop 9.0..21.0deg | 40.0-63.2 sliver
```

On pivot foot 1 swung clockwise: stops from 2 to 18 degrees are thrown by either of two
attacker arcs; stops from 18 to 40 are answered by the attacker's arm (2,1) with a witness
stop that slides from 9 to 21 degrees as the victim's stop advances; stops from 40 to the
limit are a sliver. Arms are written (pivot, direction) with direction 1 or −1.

## Glossary

- **u** — board units. Margins and gaps are in u; the rotational part of a distance is
  scaled by the foot radius (R = 23.095u) so it is in u too.
- **arm** — one pivot foot and one direction. Six per piece.
- **family** — the recorded outcome of every stop along one arm, from one sweep.
- **throw margin** — how far the furthest victim foot passes the rim during an attacker
  sweep. Positive is thrown.
- **gap** — the interval between two neighbouring sampled stops on an arm.
- **sliver** — a substep gap accepted because both ends clear 5u; an *engine-probed*
  sliver is one accepted because twelve engine drags inside it were all thrown; a *cover*
  is one accepted because some arm throws above 1.5u at all 13 sampled points.
- **witness** — the attacker's recorded answer to a victim stop, after which the position
  is dead one move shallower.
- **screen** — a coarse, gap-free pass returning only the smallest best margin seen.
- **ESC_TOL** — 0.75u. A margin must be below minus this to count as an escape, because
  law and engine differ by up to about 0.6u on a push.
- **worst margin** — the smallest certified margin anywhere in a verdict. The
  certificate's headline strength.
