# Position playoff

432 positions sampled from the recorded games between strong brains, 48 per cell of
advantage (losing / even / winning, by L11's static eval) x centre distance (inner / mid / outer).
Each is played out to the end with L11, L8, best.json at depth 1 and best.json at depth 2 as the
mover, always against L8, so the only thing that differs between the four games of a position is
the mover. Brains are deterministic, so one game per (position, mover) is the whole sample.

Every ply of every decided game is also saved as a training row in the same schema as
`nn/data/*.jsonl` (`f`/`z`/`p`/`m`/`g`/`mv`, discount 0.995, komi-scaled and `adj`-marked the same
way arena.js does it), so the run doubles as data generation -- these positions were sampled from
the losing/even/winning x inner/mid/outer cells, which is a more even spread than plain self-play.

## To run

1. Make sure this branch (`claude/nn-arena-matches-tm1hi9`) is checked out, so this folder sits at
   `Tau\nn\playoff` and `..\..\index.html` / `..\models\best.json` are two levels up.
2. Double-click **`run-playoff.bat`**. One worker per core opens in a minimized window; each
   appends to `out-w<i>.jsonl` (results) and `out-w<i>.data.jsonl` (training rows) after every
   game, and skips games already in its results file, so closing and rerunning loses nothing.
   Rough cost in the cloud container was several minutes per position per core across the four
   movers -- a desktop with more/faster cores should be quicker.
3. When every worker window has closed on its own (all positions done), double-click
   **`analyze-results.bat`**. It prints the paired win-rate tables by position type and the
   root-move agreement, and saves them to `results.txt`.
4. Send back `results.txt` (or the `out-w*.jsonl` files if the run gets interrupted partway). The
   `out-w*.data.jsonl` files can just be copied or moved into `nn/data/` -- same schema, so
   train.js picks them up with no conversion.

To change the opponent or movers, edit `OPP` / `MOVERS` in `run-playoff.bat` (and `MOVERS` in
`analyze-results.bat` to match) -- brain specs are `L<n>`, `best@D1`, `best@D2`. Result rows:
`{id, mover, opp, res, adj, plies, first, ms, cell, adv, dm, ply, srcfam}`. Data rows:
`{f, z, p, m, g, mv, [adj]}`, byte-compatible with the rest of `nn/data/`.
