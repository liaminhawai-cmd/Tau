# Earlier Tau trainer and league decisions

These are relevant user decisions recovered from earlier Tau conversations.
They have **not** been re-audited against today's code. Dates matter: the
laptop's role and retromine policy changed during August. Preserve the history
instead of turning all entries into simultaneous requirements.

| Date | User direction / preference | How to use this context |
| --- | --- | --- |
| 2026-08-08 | One connected league: four models across three depths, with L7–L11 anchors; allow cross-depth play; completed games feed training; continuously checkpoint standings and 90% confidence intervals | Ratings should come from a connected competition, with durable results |
| 2026-08-08 | Asked whether locally accumulated league results had been pushed to GitHub | Do not assume desktop-only results are available to another account or checkout |
| 2026-08-09 | Full trainer: continuous self-play, evolving Elo pool, CPU value/GPU dual training, shared pool, strength/CI-biased selection, four standing dual networks as bare/+policy faces, replace one at a time; no retromine in that setup | Historical full-trainer specification; later retromine decisions differ |
| 2026-08-09 | Arena logs should write incrementally to `nn/arena-logs/`; loops continue until their window closes | Avoid losing a long run's evidence at shutdown |
| 2026-08-09 | Laptop should run option 22 Self-Play Factory only, without training/rating or competing with desktop compute | Historical role assignment; later directions below evolved |
| 2026-08-12 | Cut routine D5; possibly reserve D4 for the best three models, because of compute cost | A dated affordability constraint, not a ban on every later deep-search experiment |
| 2026-08-12 | Try 5–10 substantially different experimental models, train long enough to detect degradation, test epoch variants, then admit winners into the normal continuous 20-minute trainer | The user wanted meaningful diversity and evaluation, not endless short tweaks |
| 2026-08-12 | Laptop trainer should use gold/silver/bronze with limited retromine after games | Later change to the earlier laptop/no-retromine direction |
| 2026-08-15 | Policy should represent Tau's three-leg geometry; accepted a 96-way setup for normal, large and behemoth models | Geometry should inform the action/policy design |
| 2026-08-16 | Gold/Silver/Bronze should be the global top three **model trunks**, regardless of depth; laptop mixed-depth games should prioritise quality over quantity | Do not equate three strongest faces with three distinct trunks |
| 2026-08-16 | `policy-joint-behemoth-10x400-pair4` should be a real pool entrant, not stranded desktop-only | Check admission and lineage rather than assuming model files imply participation |
| 2026-08-18 | Accepted shifting most compute toward official ranking/training games, with a minority for randomised/seeded exploration and retromine | Later allocation direction supersedes a blanket “no retromine everywhere” reading |

An earlier assistant described the intended official-rating contract as
temperature 0, a canonical/fair start, paired colour reversal and one W/D/L
result per two-game match. Randomised, seeded and retromine games supply training
evidence separately. This is a **previously reported implementation contract**;
confirm it against the current rating code before asserting compliance.

Earlier diagnostics also reported that option 22 could omit the primary model
and record alias names such as `gold-d1@D1` instead of original faces. Preserve
weight identity/lineage when relating saved games to a ladder; the old report is
not evidence the issue persists today. Concurrent local workers previously
encountered non-fast-forward pushes and `.git/index.lock` failures, so inspect
the actual checkout and ongoing processes before changing shared Git state.

This note records Tau project context only. It does not include account details
or assert access to files still confined to the old Claude account or desktop.
