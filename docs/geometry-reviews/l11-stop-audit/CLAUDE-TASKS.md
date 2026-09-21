# Request for Claude: L13/L17 tests and division of work

Requested by Liam, 21 September 2026. No Fable is available. This is a work order, not a report of completed new matches.

## Start here
Read this file, [the L11 stop audit](README.md), and its result.json. Read only the additional files needed for your assigned task. The audit pins main at ce0e61d1e7482e3d1252aadadf97bd4269f71e29; inspect current source before editing.

For mathematics, the newest review is [Brief 7, PR #32](https://github.com/liaminhawai-cmd/Tau/pull/32). It supersedes older handoff statements that its two repaired checker defects are still present. Brief 5 explains the corpus-loading and measurement corrections.

Internal arena L13 means the retired opp2 search experiment; internal L17 means the dead-set experiment. Verify the mapping in makeBrain/AI_LADDER. Do not substitute the current public difficulty numbered 13 or renumber the public ladder.

## Ownership and token budget

| Owner | Work | Deliverable |
| --- | --- | --- |
| Astra / Codex | Abstract contact-map bounds, local throw certificate, full reply coverage, region expansion and proof review | Explicit lemmas, assumptions, verifier requirements, and proof/counterexample verdicts |
| Claude Opus | Inspect current L13/L17, define the smallest sound experiments, implement the selective search change and review results | Small code patch, frozen experiment specification, interpretation and recommendation |
| Claude Sonnet, if available | Follow the specification: instrument counters, fixtures, deterministic runner, execute/resume batches, aggregate results | Reproducible scripts, raw logs, concise table and failure list |
| Local Node/Python processes | Play games and compute statistics | Machine-generated results, no model call per move or per game |

Use one Opus planning/review pass and one Sonnet implementation/run pass initially. Do not send the full project history to every worker. If Sonnet is unavailable, Opus uses the same bounded scripts; no Fable dependency. Escalate only specific failing fixtures or contradictory outputs. No need for a team of speculative agents.

## Opus task A: establish what the existing searches miss
1. Reproduce reproduce.js against the pinned source, then current source. Keep historical and current results separate.
2. Inspect L11, L13 and L17 at the SAME post-root position. Record the actual defender stops each considers and whether the known foot-0, +1, 2-degree defence is included, rejected or pruned. A whole-game win does not answer this question.
3. Audit L17's dense-check stride, budget and early exits. A 6-degree grid does not automatically catch a 2-degree witness. Distinguish budget exhaustion, counterexample found and no counterexample found.
4. Audit its certificate table and loader. The historical 96-game run did not load the new 261 points / 63 balls. Do not repeat its zero-hit result as a test of that corpus.
5. Freeze a development set and a held-out set grouped by source game/trajectory, not random rows. Nearby variants of the same position belong to one group. The known 2-degree example belongs to development.

Do not treat screen-only escape rows as proven safe positions, nor sampled-dead rows as mathematical ground truth.

## Opus task B / Sonnet execution: explicit L13 and L17 requests

First collect tactical correctness, stop coverage and cost for these configurations. Use named experimental switches rather than adding new public ladder levels.

| Configuration | Purpose |
| --- | --- |
| Unchanged L11 | Baseline |
| Unchanged internal L13 | Does its richer opponent candidate generator catch the known and held-out missed stops? |
| Unchanged internal L17 | Reproduce the existing combined mechanism and identify which component fires |
| L17 dense check only; guard/table off | Isolate challenges to apparent forced wins |
| L17 guard only; dense check/table off | Isolate avoidance of impending dead states |
| L17 dense + guard; table off | Measure their interaction |
| Same combined search, table on | Isolate lookup cost/hits; record exact table hash and claim class |
| Selective interior-stop challenger | Compare a targeted new proposal against L13 and L17 |

Implement the last row only after the existing searches are audited. Start with a bounded selection of intermediate stops around contact/line changes and uncertain winning margins; preserve the evaluator and first-move candidates initially. Do not hard-code the 2-degree fixture as the solution.

Report: whether the fixture changes verdict, held-out counterexamples captured, candidate decisions changed, stops evaluated, dense/guard/table calls, budget exhaustion, lookup hits, total move time and p50/p95 move time. Record downstream decisions, not just counters.

Stage the arena work:
- Use a small fixed smoke run (e.g. 16 paired openings, swapped seats) to expose legality, runner and runtime failures. It is not an Elo verdict.
- Run the full ablation matrix on tactical fixtures first. Select the small set of useful challengers BEFORE the final held-out match evaluation.
- Compare unchanged L13 and L17, the best isolated component, and any selective challenger with L11. Include the best challenger against L13/L17 if it advances.
- Freeze opening seeds/positions, seat swaps, rule/source hashes, clock, hardware/concurrency and sample size before that evaluation. Use a saved common opening list across configurations.
- Use paired-opening confidence intervals with the opening pair as the resampling unit, include draws and adjudications, and report the match definition. The historical 56–40 result alone establishes no improvement.
- Choose a precision target and sample count after measuring runtime, within Liam's available compute. Do not stop the final run merely when significance appears.

**Equal-time gate:** verify that the arena's time flags actually constrain ladder brains, not just neural brains. If they do not, implement and test a safe budgeted search with a legal completed fallback, or label the first comparison as fixed-search plus measured runtime. Do not claim clock fairness from passing --timeMs alone. Report overruns and keep parallel contention controlled.

Keep new results separate from the production live league until the variants and rating protocol are verified. Do not restart the trainers as part of this request.

## Mathematical work reserved for Astra
- Bound the complete finite contact update, retaining correlations; account for feature guards, contact ordering, residuals and numerical semantics.
- Start with the shorter arm-(2,-1) continuation from the exact Brief 6 post-8-degree-reply pose.
- Then cover EVERY legal defender reply interval with verified winning responses, allowing response changes between overlapping patches.
- Expand to neighborhoods varying both pieces, then construct finite-horizon predecessors of proved losing regions.

Opus/Sonnet can provide deterministic traces, branch/feature events, minimal failing boxes and independent numerical replays. Sampling supplies counterexamples and candidate policies; it does not close a universal proof. A checker returning CERTIFIED is not accepted without its enclosure obligations being established.

## Return packet
Commit the runner and patches, source/fixture hashes, frozen protocol, resumable raw logs and one summary table. Add a short handoff listing completed tasks, failed checks and exact questions for Astra. Keep raw per-move logs in files; send the models summaries and minimal counterexamples. Mark unrun experiments clearly. Preserve existing game rules and public ladder until an evidence-backed change is reviewed.
