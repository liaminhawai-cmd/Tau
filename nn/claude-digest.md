# Tau -- local digest for Claude

_Generated 2026-08-04T12:23:14.460Z on DESKTOP-2B7IQHN._

Read-only snapshot: no games played, nothing retrained. Regenerate any time with menu.bat option 18.

---

## Raw pairwise ratings (elo-results.json)

461 pairs on record, 1,233 games total.

### Every pair on record touching L11 (ground truth, not a fit)

| opponent | record | n | win% |
|---|---|---|---|
| mut-105@D1 | 2-2 | 4 | 50% |
| scratch-105@D1 | 2-2 | 4 | 50% |
| scratch-105@D2 | 0-4 | 4 | 0% |
| deep-105@D1 | 2-2 | 4 | 50% |
| deep-105@D2 | 1-3 | 4 | 25% |
| mut-105@D2 | 1-3 | 4 | 25% |
| ckpt-098@D1 | 1-2 | 3 | 33% |
| ckpt-098@D2 | 1-2 | 3 | 33% |
| ckpt-100@D1 | 1-2 | 3 | 33% |
| ckpt-100@D2 | 1-2 | 3 | 33% |
| ckpt-100@D3 | 2-1 | 3 | 67% |
| ckpt-102@D1 | 1-2 | 3 | 33% |
| ckpt-102@D2 | 0-3 | 3 | 0% |
| ckpt-103@D1 | 2-1 | 3 | 67% |
| ckpt-103@D2 | 1-2 | 3 | 33% |
| ckpt-105@D1 | 0-3 | 3 | 0% |
| ckpt-105@D2 | 1-2 | 3 | 33% |
| ckpt-105@D3 | 2-1 | 3 | 67% |
| L10 | 2-0 | 2 | 100% |
| wide@D1 | 1-1 | 2 | 50% |
| best@D2 | 2-0 | 2 | 100% |
| wide@D2 | 2-0 | 2 | 100% |
| ultra@D1 | 1-1 | 2 | 50% |
| best@D1 | 1-1 | 2 | 50% |
| ultra@D2 | 0-2 | 2 | 0% |
| wide@D3 | 1-1 | 2 | 50% |
| best@D3 | 0-2 | 2 | 0% |
| deep@D1 | 2-0 | 2 | 100% |
| deep@D2 | 2-0 | 2 | 100% |
| l15_value@D2 | 1-1 | 2 | 50% |
| scratch@D1 | 1-1 | 2 | 50% |
| ckpt-001@D1 | 2-0 | 2 | 100% |
| l15_value@D1 | 2-0 | 2 | 100% |
| ultra@D3 | 2-0 | 2 | 100% |
| scratch@D3 | 2-0 | 2 | 100% |
| scratch@D2 | 2-0 | 2 | 100% |
| ckpt-031@D1 | 0-2 | 2 | 0% |
| ckpt-016@D2 | 2-0 | 2 | 100% |
| deep@D3 | 2-0 | 2 | 100% |
| ckpt-001@D2 | 2-0 | 2 | 100% |
| ckpt-016@D1 | 2-0 | 2 | 100% |
| l15_value@D3 | 2-0 | 2 | 100% |
| ckpt-031@D2 | 2-0 | 2 | 100% |
| ckpt-016@D3 | 2-0 | 2 | 100% |
| ckpt-046@D1 | 2-0 | 2 | 100% |
| ckpt-046@D2 | 2-0 | 2 | 100% |
| ckpt-031@D3 | 2-0 | 2 | 100% |

---

## Local training-data composition

323 files, 413.4 MB, 554,885 rows.

### Rows per ladder-brain mover (how much L-vs-net play is actually in the corpus)

| level | rows |
|---|---|
| L1 | 55 |
| L2 | 6,680 |
| L3 | 1,529 |
| L4 | 3,037 |
| L5 | 13,402 |
| L6 | 24,181 |
| L7 | 30,867 |
| L8 | 30,530 |
| L9 | 23,440 |
| L10 | 9,769 |
| L11 | 6,572 |

### Rows per net lineage (excluding ladder movers)

| lineage | rows |
|---|---|
| best | 73,519 |
| nn | 43,456 |
| ckpt | 12,802 |
| pool | 10,061 |
| scratch | 2,945 |
| mut | 2,615 |
| l | 2,609 |
| deep | 2,346 |
| wide | 2,227 |
| ultra | 1,834 |

_304,476 of 554,885 rows carry a mover id (older rows predate the field and are untagged)._

---

## Fresh mine of local arena-logs/ (vs L11 only, by day, all nets pooled)

66 game-log entries touch L11.

| date | record | n | win% |
|---|---|---|---|
| 2026-07-30 | 6-11 | 17 | 35% |
| 2026-07-31 | 84-144 | 228 | 37% |
| 2026-08-01 | 16-51 | 67 | 24% |
| 2026-08-02 | 9-8 | 17 | 53% |
| 2026-08-03 | 11-4 | 15 | 73% |
| 2026-08-04 | 22-16 | 38 | 58% |

---

## Live run.js status (status.md)

```
# Tau NN training status
_Last updated: 2026-08-04T11:29:49.479Z_

**Self-play batch:** 15
**Stage:** self-play batch 15 running, next check in 5 min
**mix:** nnnn:0.4,nnladder:0.3,ladder:0.3

**Last gate result:** resume-train promoted at 2026-08-04T08:58:14.917Z

**Last checkpoint:** ckpt-107.json at 2026-08-04T09:00:43.854Z

**Last ladder sweep:** frontier 1ply:L7 2ply:L7 3ply:L8 | regressed D1:L6 D3:L2 — D1 L7 2-1 L8 1-2 L9 1-2 | L11 3-0 | D2 L7 3-0 L8 2-1 L9 1-2 | L11 2-1 | D3 L8 3-0 L9 1-2 L10 2-1 | L11 1-2

```

---

## Ladder-placement / bake-off history (archtest-result.txt, tail)

```
Tau architecture bake-off
2026-07-28T08:03:32.084Z

settings: 30 epochs, seed 1, 40 games/pair, search depth 1, 8 workers
data:     C:\tau\Tau\nn\data\*.jsonl

head-to-head:
  arch-96x96 vs arch-96x96x96: 20-20
  arch-96x96 vs arch-64x64x64x64: 24-15
  arch-96x96 vs arch-48x48x48x48x48: 20-20
  arch-96x96 vs incumbent(best.json): 31-9
  arch-96x96x96 vs arch-64x64x64x64: 26-14
  arch-96x96x96 vs arch-48x48x48x48x48: 21-19
  arch-96x96x96 vs incumbent(best.json): 28-11
  arch-64x64x64x64 vs arch-48x48x48x48x48: 30-10
  arch-64x64x64x64 vs incumbent(best.json): 24-16
  arch-48x48x48x48x48 vs incumbent(best.json): 32-7

ranking:
  1. arch-96x96: 95/159 decided (60%)
  2. arch-96x96x96: 95/159 decided (60%)
  3. arch-64x64x64x64: 83/159 decided (52%)
  4. arch-48x48x48x48x48: 81/159 decided (51%)
  5. incumbent(best.json): 43/158 decided (27%)

strongest: arch-96x96

------------------------------------------------------------

Tau architecture bake-off
2026-07-28T10:16:42.249Z

settings: 120 epochs, seed 1, 40 games/pair, search depth 1, 8 workers
data:     C:\tau\Tau\nn\data\*.jsonl

head-to-head:
  arch-96x96 vs arch-96x64x48: 14-25
  arch-96x96 vs arch-82x64x48x32: 13-26
  arch-96x96 vs arch-64x64x64x64: 19-20
  arch-96x96 vs incumbent(best.json): 14-25
  arch-96x64x48 vs arch-82x64x48x32: 21-18
  arch-96x64x48 vs arch-64x64x64x64: 22-16
  arch-96x64x48 vs incumbent(best.json): 16-21
  arch-82x64x48x32 vs arch-64x64x64x64: 27-10
  arch-82x64x48x32 vs incumbent(best.json): 19-20
  arch-64x64x64x64 vs incumbent(best.json): 19-20

ranking:
  1. arch-82x64x48x32: 90/154 decided (58%)
  2. incumbent(best.json): 86/154 decided (56%)
  3. arch-96x64x48: 84/153 decided (55%)
  4. arch-64x64x64x64: 65/153 decided (42%)
  5. arch-96x96: 60/156 decided (38%)

strongest: arch-82x64x48x32

------------------------------------------------------------

Tau architecture bake-off
2026-07-28T11:52:32.920Z

settings: 120 epochs, seed 1, 30 games/pair, search depth 2, 8 workers
data:     C:\tau\Tau\nn\data\*.jsonl

head-to-head:
  arch-96x96 vs arch-96x64x48: 12-16
  arch-96x96 vs arch-82x64x48x32: 9-20
  arch-96x96 vs arch-64x64x64x64: 13-16
  arch-96x96 vs incumbent(best.json): 11-19
  arch-96x64x48 vs arch-82x64x48x32: 20-9
  arch-96x64x48 vs arch-64x64x64x64: 19-10
  arch-96x64x48 vs incumbent(best.json): 17-12
  arch-82x64x48x32 vs arch-64x64x64x64: 16-13
  arch-82x64x48x32 vs incumbent(best.json): 11-18
  arch-64x64x64x64 vs incumbent(best.json): 12-17

ranking:
  1. arch-96x64x48: 72/115 decided (63%)
  2. incumbent(best.json): 66/117 decided (56%)
  3. arch-82x64x48x32: 56/116 decided (48%)
  4. arch-64x64x64x64: 51/116 decided (44%)
  5. arch-96x96: 45/116 decided (39%)

strongest: arch-96x64x48

------------------------------------------------------------

Tau ladder placement
2026-07-28T13:22:55.112Z

model: C:\tau\Tau\nn\models\arch-96x64x48.json
settings: 6 games/cell, openingPlies 2, 8 workers

              L9       L10       L11
  D1       0-6       0-6       0-6
  D2       1-5       0-6       2-4
  D3       1-4       1-4       2-4

------------------------------------------------------------

Tau ladder placement
2026-07-28T15:00:24.088Z

model: models\arch-96x64x48.json
settings: 6 games/cell, openingPlies 2, 8 workers

             L11
  D4       2-3

------------------------------------------------------------


```
