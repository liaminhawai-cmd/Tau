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

Leave it running overnight (Ctrl-C any time — every stage saves). Each iteration:

1. **selfplay** — 200 games (ladder-vs-ladder from the fast levels L2-L6, every 12th game from
   the deep L7/L8 brains; once a model exists, half the games involve the net itself, with a
   little exploration temperature). Every decided game's positions land in `nn/data/*.jsonl`,
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

## Expectations, honestly

- Iteration 1's net only knows ladder games — expect it to land somewhere around L4-L6.
- The interesting part starts when it trains on its own games (iteration 2+).
- Beating L8 is a realistic overnight goal; L11 is the boss fight and may need feature or
  search upgrades (2-ply lookahead in `nnai.js` is the obvious next lever).
- Speed scales with your CPU: this kit's numbers were smoke-tested on a slow container;
  a desktop should chew through several times more games per hour. Deep-brain games (L7/L8)
  are minutes each — that's why they're the garnish, not the bulk.
