# Stride-fix match: L11 vs L11 with the stop marks restored

26 September 2026. Pre-registered in [PREREG.txt](PREREG.txt) before any counted game.

## Question

`ladderRoots3` and `ladderSampledPlanGen` drop stop marks because `|netRad|` lands a few ULPs short
of each multiple of `sampleDeg`; a 9° rung actually samples on an irregular, sparser grid. The
tolerance patch (`markEps = 1e-9`, `docs/geometry-reviews/l13-l17-stop-audit/patches/`) restores
the configured grid and changes 57% of L11's moves on the frozen dev positions. Does it make L11
stronger?

## Match

| | |
| --- | --- |
| A | `L11`, as shipped |
| B | `L11+cfg:markEps=1e-9` |
| openings | 150, seed 20260926, 2 random plies ([openings-150.jsonl](openings-150.jsonl), sha256 `593e31d1…`) |
| games | 300: each opening twice, seats swapped; 4 shards ([shard-0k.jsonl](shard-00.jsonl)), one per core |
| corner opening | pinned off on both sides (`--noCorner`) |
| clock | none; fixed search, as the rung ships |
| source | `claude/l17-on-main` `7e15f4fc0`; ladder code identical to `main` `8717380f6` (only UI and tutorial code differs) |

## Result

| | |
| --- | --- |
| games | A 146, B 154; no draws, no games decided at the move cap |
| opening pairs | A won both: 18 · split 1-1: 110 · B won both: 22 |
| paired Elo, B over A | **+9**, 95% interval **−16 to +35** (4000 resamples of opening pairs) |
| first mover | won 200 of 300 (67%) |

Per [paired-elo.json](paired-elo.json). Raw games: `res-00.jsonl` … `res-03.jsonl`.

**Verdict under the pre-registered rule: no measurable difference. The patch is not shipped.**

## Reading it

- The restored grid changes most of L11's individual moves and leaves its strength where it was,
  to within about ±25 Elo. The dropped marks cost nothing measurable at this depth.
- The first-move advantage decides most games: 110 of 150 openings split 1-1 by seat. Only 40
  openings separated the two versions (22 to 18). A future comparison between two close L11
  variants needs several times this many openings to resolve a 15–20 Elo effect.
- This removes the handoff's "measure the stride fix before any L17 ablation" blocker. Ablations
  run on the shipped grid are measuring the rung as it plays.
- It says nothing about `ladderDeadEscape`'s dense test, where a dropped mark decides whether an
  escape is found. That is a different use of the same grid; see the stop audit's README.
