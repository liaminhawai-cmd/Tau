# Deep best experiments

Pull this update and restart the running trainer once before the first run: the new
packet routes need the updated evaluator in every worker. Then double-click
`nn\DEEP-BEST.bat`. It runs four jobs sequentially, so only one experimental model
trains on the GPU at a time. The normal trainer can run alongside it, with some slowdown.

Defaults for a 400-wide, 10-layer dense-memory parent (memory width 40):

| Style | Hidden shape | Parameters | New bypass routes |
| --- | --- | ---: | --- |
| Plain | 400 x 26 | 4,048,401 | None; full network first learns to imitate the parent |
| Residual | 400 x 22 | 3,983,161 | Identity trunk across each added layer |
| Bridges | 400 x 22 | 3,995,161 | Residual trunk plus a 10-channel packet across five layers, every five layers |
| Wispy | 400 x 22 | 4,011,961 | Residual trunk plus 2-channel packets across 2, 5 and 9 layers |

Residual variants retain the parent's first ten layers, packet routes and value head.
The added branches start at zero, so their predictions match the parent at birth.
The styles describe the **added segment**: inherited bypasses are retained to preserve
what the parent knows. Plain is a true tanh-only model. Added plain tanh layers cannot
be exact identity layers, so it instead distils parent predictions on the training files
for one complete pass before learning game outcomes. This costs extra time and makes
it a practical experiment, rather than a perfectly controlled architecture benchmark.

All jobs use one copied parent with its original modification time and one fixed list
of stable corpus files. Files changed in the last two minutes are excluded to avoid
reading the league's active append file. The suite stops if a listed file changes
between jobs. New games arriving during the run are left for normal future training.
Validation selection follows GROW-BEST: files created after the parent was written,
with an explicit warning and newest-file fallback when there are too few. Each job
keeps that selection identical because it uses the same parent and corpus list.

Training reads all training files in RAM-sized shards, evaluates held-out MSE after
each shard, rolls back and halves the rate on stalls, and stops after four rate drops
plus another stall (hard cap: 30 passes). Deep variants retain the inherited or
distilled starting checkpoint as a rollback candidate. CPU-side shard tensors with
GPU minibatch transfers limit VRAM use; the default batch size is 1024.

Output names are `nn/models/deep-STYLE-w400-lDEPTH-NNN.json`. Best checkpoints remain
`.partial.json` until the Python/JavaScript verifier passes, then enter the ordinary
league. MSE does not grant promotion, immunity or a retirement exemption.
Logs, the parent snapshot and corpus manifest live in `nn/grow-cache/deep-suite-*`.
Keep that directory until the experiment is finished; after that it can be removed.

Example options:

```bat
nn\DEEP-BEST.bat --styles residual,wispy --rounds 3
nn\DEEP-BEST.bat --shardMB 512 --batch 512
```

Use `--depth` for the residual styles and `--plainDepth` for plain. A wider/deeper
future parent needs explicit dimensions that cover it; invalid growth stops before
training. Existing GROW-BEST usage and old dense-memory exports keep their semantics.

Verification performed on CPU: legacy and routed Python/JavaScript parity, exact
residual inheritance from plain and residual parents, gradients through packet routes,
a complete four-job synthetic shard run, normal trainer continuation of a wispy export,
and rollback/rate-drop handling. These verify plumbing, not playing strength or GTX
1080 runtime. Run `python nn/test-deep-experiments.py` for the architecture regressions.
