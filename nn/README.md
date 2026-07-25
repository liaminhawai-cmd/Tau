# Tau neural-net AI — zero-install training kit

Trains a small value network for Tau **on your own machine** with nothing but Node (no Python,
no PyTorch, no GPU needed — the net is tiny and the expensive part is playing games, which is
plain CPU). The rules engine and the whole AI ladder are **extracted live from `../index.html`**
every run (`engine.js` pulls the exact shipped functions by dependency closure), so training can
never drift from the real game's rules.

## The one command

```
node nn/run.js
```

Leave it running overnight (Ctrl-C any time — every stage saves). Selfplay automatically spreads
games across your CPU cores (up to 8 worker processes — a desktop chews through games several
times faster than one core; `--workers 1` forces serial). Training is CPU-only by design: the
net is tiny and the real cost is *playing games*, so a GPU would sit idle — don't expect the
graphics card to light up, expect one busy node process per worker. Each iteration:

1. **selfplay** — 200 games. Iteration 1 is pure ladder sparring (dense, decisive teaching
   games); from then on the net's own share ramps up ~10% per iteration toward 85% self-play —
   bootstrap on the ladder, then let the curriculum come from its own games. Every decided game's positions land in `nn/data/*.jsonl`,
   labeled with the outcome from the mover's perspective.
2. **train** — the value MLP (16 symmetry-canonicalized features → 64 → 64 → 1, tanh) resumes
   from the current best and trains on ALL accumulated data.
3. **benchmark** — 24-game head-to-head vs L8 (`--vs L11` to aim at the top rung).

Progress appends to `nn/log.txt`. The current model is `nn/models/best.json` — a plain JSON
weight file, small enough to ship in the game (the browser-side forward pass is ~20 lines).

## Pieces, individually

```
node nn/selfplay.js --games 200 --out nn/data/run1.jsonl     # generate data
node nn/train.js --epochs 8                                  # fit the net
node nn/arena.js --a nn --b L8 --games 24                    # head-to-head anything vs anything
node nn/arena.js --a L7 --b L8 --games 24                    # ladder sanity checks too
```

## How the net plays (`nnai.js`)

Candidates are real engine simulations: every (pivot × direction × stop-fraction) swing is run
through the actual `applySwing` (crossing budget, direction lock, rim block all enforced), the
resulting position is scored by the net from the opponent's perspective, and outright throws are
recognized exactly. Plans come out in the same `{ pivotIdx, dir, targetRad }` shape as every
ladder brain, so the arena — and eventually the game — can swap it in anywhere.

**The difficulty dial is built in**: `nn:0.3` in the arena (or `{ temperature: 0.3 }` in code)
softens the argmax into a softmax over move values. Temperature 0 = full strength; higher =
softer, *monotonically* — one continuous knob, no hundred hand-tuned levels. Calibrate a few
points against the ladder with `arena.js` and interpolate.

## Checkpoints — play them, watch them

`run.js` snapshots every iteration to `nn/models/ckpt-001.json`, `ckpt-002.json`, … so nothing
is ever lost and any generation can be fought against any other:

```
node nn/arena.js --a nn:0:nn/models/ckpt-009.json --b nn:0:nn/models/ckpt-003.json --games 24
```

To WATCH a checkpoint (or play it yourself) on the premium boards: serve the repo locally
(`python -m http.server` or `npx http-server` in the repo root) and open

```
http://localhost:8000/steam.html?nn=nn/models/best.json
```

Red always plays the net; blue plays it too until you grab a blue foot — then it's you vs the
checkpoint, guides and all. Swap the path for any `ckpt-*.json` to time-travel.

## The easy start (gaming PC)

Double-click **`nn/START.bat`** (Windows). A black window opens and training runs — leave it
open; closing it stops training with everything saved. `nn/start.sh` is the same for Mac/Linux.

## Expectations, honestly

- Iteration 1's net only knows ladder games — expect it to land somewhere around L4-L6.
- The interesting part starts when it trains on its own games (iteration 2+).
- Beating L8 is a realistic overnight goal; L11 is the boss fight and may need feature or
  search upgrades (2-ply lookahead in `nnai.js` is the obvious next lever).
- Speed scales with your CPU: this kit's numbers were smoke-tested on a slow container;
  a desktop should chew through several times more games per hour. Deep-brain games (L7/L8)
  are minutes each — that's why they're the garnish, not the bulk.
