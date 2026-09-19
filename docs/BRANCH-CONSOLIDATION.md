# Branch consolidation, 2026-09-19

Two long-lived branches from here: **`main`** (the game, the site, the Steam builds) and
**`claude/board-game-video-adaptation-cf8a93`** (the trainer and the nn research). Everything
else was a working branch.

Every branch below is recorded with the SHA it pointed at when it was deleted, so any of them
can be restored exactly: `git push origin <sha>:refs/heads/<name>`. Deletion was only ever
applied to branches whose every commit was already reachable from `main` or the nn branch, so
no content was lost even before that safety net.

## Deleted (fully contained)

| branch | sha | contained in |
| --- | --- | --- |
| `claude/android-apple-steam-builds-yr0wkj` | `4d1c246cba3b4bfb2bde2399a0e10f3d42675ad3` | main |
| `claude/board-space-2d-3d-toggle-diqycg` | `6c432cb28f331a7ffd44b80e39d3f020cdb23d65` | main |
| `claude/ladder-d5` | `28e2b7245cc2cdf2b151da6c2bae8125220ec244` | nn branch |
| `claude/project-thread-xm91c3-main` | `1fad61fa54b10b62fe5b10e450df88d6e50db55a` | main |
| `claude/push-physics-main` | `885bdb9041939332483b919a17a2e77f4374d623` | main |
| `claude/push-physics-trainer` | `7c8bd59fb71d2d084f15fb898d9c367dbf922450` | nn branch |
| `codex/tau-project-context-and-findings` | `84b8cb9fdfcee73091febb4ecaa34aa3c1fb205f` | main |
| `depth-ed4-main` | `99038af3a890de86f402c8f5f914399c19184458` | main |
| `depth-ed4-pages` | `9f7914516abf1aef41099b31dcec371255a2ffb5` | nn branch |
| `depth-ed4b-main` | `ff169574c22d165ef6805dbf52cb287140cdf40b` | main |
| `depth-ed4b-pages` | `ccc99fc1c87f5d65a24dae4b678c02025eeaa211` | nn branch |
| `depth-report-live` | `6ab7a2e0e311e573009300c7613e5f7a96b0772a` | main |
| `depth-report-pages` | `a39780c3c364794ae9a763df8b98d5082cbf0044` | nn branch |
| `depth-report-third-edition` | `9dfe0509d59c574de2765490e875611568159136` | main |
| `feature/retromine-ratchet-loop` | `8e71c2d629d40f7beef57a37d15eb4e4ddef9688` | main |
| `feature/steam-curves-replays` | `d22c2793e7cb57ab131f3b9bb76489615f2a9a14` | main |
| `feature/steam-premium-match` | `25b7107c17b7e5f71309d7447b483a22f10db22f` | main |
| `feature/steam-shader-validation` | `047a36575cfafaf0ef15b34e73301a2b1691a2b4` | main |
| `retromine-champion-gate` | `1b9d00c36a0281df089e60b2abb7d97894d8039b` | nn branch |

## Kept for now (carry unique work)

These are NOT contained in either keeper. Each needs its content folded into `main` (if it is
game code) or the nn branch (if it is research) before it can go. Several are open PRs.

| branch | ahead of main | ahead of nn | what it holds |
| --- | --- | --- | --- |
| `claude/nn-arena-matches-tm1hi9` | 208 | 123 | PR #8. nn/playoff, the original home of forced-win.js / contact-law.js |
| `claude/project-thread-0v87tm` | 165 | 80 | Depth-2 dead-certificate batch, seeds and scripts |
| `claude/project-thread-7jul5e` | 1 | 128 | Build 275 camera unification |
| `claude/project-thread-f2xh8p` | 7 | 134 | Main merge + build 275 |
| `claude/project-thread-kyx87p` | 200 | 115 | PR #18. Source of geometry Briefs 2-4, the throw-certificate lemmas |
| `claude/project-thread-mtkkjf` | 174 | 89 | PR #23. Dead-cell unions, rim clipping; forced-win.js/contact-law.js already copied to the nn branch |
| `claude/project-thread-nr4eb2` | 20 | 142 | Brief 4 tangential-growth correction |
| `claude/project-thread-rzej7w` | 7 | 132 | Controls build, take 274 |
| `claude/project-thread-rzej7w-ci` | 3 | 128 | CI variant of rzej7w |
| `claude/project-thread-xm91c3` | 165 | 80 | Temperature-0 net play and the depth-2 dial |
| `claude/project-thread-yoneu9` | 203 | 118 | PR #17. nn/physics-check.js, the faster-limits push-physics research |
| `feature/nn-model-observatory` | 2 | 2 | Two commits, unique to both sides |
