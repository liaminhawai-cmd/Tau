# Overnight Investigation Plan: Tau Dead Positions, Coverage, and Finisher Strength

**Prepared:** 12 October 2026  
**Repository:** liaminhawai-cmd/Tau  
**Research starting point:** branch claude/serene-pasteur-psjoi2 and the other current Target 1 proof branches; this plan itself is on research/overnight-dead-position-investigation.  
**Primary question:** What can we rigorously classify as dead or live, how much of a clearly defined position sample is actually certified, and does feeding reliable tactical knowledge to the neural network or search improve finishing strength?

This is an investigation plan, not a claim that the current proof corpus is sound. First reconcile the source, code, branch, and artifact provenance. Then use the findings to decide which mathematical and ML branches deserve the remaining compute. Prefer one carefully justified theorem and one controlled experiment over a huge pile of certificates whose premises have not been checked.

## 0. Rules of engagement

- [ ] Start by reading this plan, **CLAUDE-HANDOFF.md**, **docs/geometry-reviews/README.md**, and **docs/geometry-reviews/taylor-model/README.md** on the actual reference branch. Read the original problem JSON before running any generator.
- [ ] Fetch and compare current main, claude/serene-pasteur-psjoi2, claude/target1-param-taylor-cert, claude/target1-gap-cert, and any newer proof branches or PRs. Do not assume an old PR head is current.
- [ ] Use an isolated work branch and isolated temporary results directory. Never reset, force-push, overwrite, or prune another research branch. Do not merge into main as part of this overnight task.
- [ ] Do not stop or restart the user's continuous trainer, edit its live checkpoint/pool, or mutate live ladder files. Use existing GitHub Actions workflows or a bounded local job when safe. Record resource use and avoid running duplicate multi-hour covers/audits concurrently.
- [ ] Never turn an unresolved angle, timed-out cell, sample-only test, failed certificate, or absent witness into a dead/live label.
- [ ] Do not count certificate cells, angle samples, engine comparisons, repeated retries, or symmetric copies as distinct proved positions.
- [ ] Preserve any discovered counterexample before fixing code. Add a regression test, then re-run old positive controls as well as the failing case.
- [ ] Keep three levels visibly separate in every report: (1) sampled / heuristic evidence, (2) reproducible program evidence, and (3) proof-grade claims with explicit assumptions and independently reviewed soundness.
- [ ] Do not silently change the game's contact/crossing rules, engine, move schedule, or board constants to make a certificate pass.

## 1. Starting facts to verify, not blindly trust

The following were visible in the repository during preparation. Re-check all refs and commit ancestry before relying on them.

- [ ] The current main head observed was dab4f01e (“build 355”, 11 October 2026 UTC). It is not automatically the newest mathematical working tree.
- [ ] The Target 1 working branch claude/serene-pasteur-psjoi2 contains a Taylor-model package under **docs/geometry-reviews/taylor-model** and Target 1 workflows. PR #51 was a temporary smoke-test trigger and was closed without merge; its comment reports a successful six-cell gap-slice run and links workflow run [38118866133](https://github.com/liaminhawai-cmd/Tau/actions/runs/38118866133).
- [ ] Commit 80aa61e0c259cd3d3742571ed1b75315020e8b13 changes **close-holes.js** and **audit-parallel.js** to use **armResultsDir(fromEnv(), ...)**. Verify that every other generator, auditor, report, and workflow uses the correct per-problem corpus as well. A wrong-directory read can mix Brief 6 and Target 1 data while looking superficially successful.
- [ ] The Taylor-model README records a critical square-root Lagrange-remainder correction in commit [344e35c](https://github.com/liaminhawai-cmd/Tau/commit/344e35c05d554af0930c62245dca613ed6cb922c), followed by a regression in [d8b9d13](https://github.com/liaminhawai-cmd/Tau/commit/d8b9d13f2a32026667fde2f52c54dd376ddd7871). The README explicitly says the historical six-arm Brief 6 tables/figures/covers are stale until regenerated with corrected arithmetic and replayed.
- [ ] Therefore, do not quote the historical “5,710 cells over all six Brief 6 arms” table as current certified coverage until the exact artifacts are rebuilt/replayed under the corrected code. Determine which individual saved artifacts were generated before versus after the fix.
- [ ] The current **target1-lower-cover-summary.json** claims arm [2,+], interval [2, 9.6828], 427 cells, and minimum margin 5.409085...; the associated summary claims 427/427 exact replays and the closure record reports 465,180 containment comparisons with zero outside. Re-establish artifact provenance and soundness before upgrading those records into a theorem.
- [ ] The Target 1 (1,+) directory currently lists covers for [2,7], [7,12], [12,12.02], and [16.5,20.719084588...]. At face value, [12.02,16.5] is an uncovered interval; confirm exact endpoint conventions and whether newer validated output closes it. Do not report this family as fully covered unless a gap check proves it is tiled.
- [ ] The (1,+) problem description names a Red witness using pivot 2, positive direction, and 107 substeps; the separate **target1.json** has different reply/witness fields. Confirm which file defines the intended theorem for each result. Avoid merging similarly named Target 1 summaries without checking their input JSON and commit.
- [ ] The Taylor-model README states that the model is a real-arithmetic model of a finite engine program, not a full enclosure of JavaScript binary64 execution, and that the package has not had a complete independent review. Report claims at that level unless the remaining gaps are closed.

## 2. Write down the quantifiers before running code

The phrase “proved dead at 1 ply” is ambiguous. The current interval work often concerns a Blue move followed by a Red reply that throws Blue off the board: that is a two-half-move tactical argument, even if a particular search code calls it a one-ply target. Record both conventions in the report.

- [ ] Define the exact state: both pieces' positions and rotations, side to move, legal-rule state / move-cap or ko state, engine version, and any other state used by the rule engine.
- [ ] Define the legal action set for a state, including pivot foot, swing direction, exact stop-angle domain, partial-call schedule, crossing constraints, and maximum executed target. The continuous domain and the engine's executable angle domain must not be conflated.
- [ ] Define a **certified forced-dead-at-horizon state** using quantifiers. For example, for a two-ply tactical label: for every legal move by the side to move, there exists a legal opponent reply that produces a certified loss within that reply. Make clear whether the losing event is “a foot passes the rim” or a deeper forced result.
- [ ] Define a **certified live/surviving state** constructively: provide at least one legal move and a proof that every relevant opponent response fails to force the claimed loss over the stated horizon. “We found no losing reply” is not a live proof.
- [ ] Define **unknown / partial** as a first-class status. A cell failure, interval gap, timeout, model exception, or lack of search budget means unknown unless a separate theorem applies.
- [ ] Define “distinct position” and deduplication. Use exact source state and safe symmetry transforms; do not deduplicate by a loose floating-point tolerance unless the geometry error induced by that tolerance is bounded and shown irrelevant to the result.
- [ ] Define the denominator for any percentage. A continuous state space has no meaningful “percent of the whole board” without a measure and domain. Produce (a) theorem coverage statements for continuous angle/pose domains and (b) separately, percentages on a named, reproducible, stratified finite sample. Never present the latter as the former.

## 3. Workstream A — repository, branch, and artifact provenance

- [ ] Record current SHA, branch head SHAs, merge bases, and open/closed PR state for every math-related branch.
- [ ] Inspect all commits after the square-root correction, especially all certificate-generation and persistence commits. Check whether the relevant workflow used corrected **tm.js**, corrected tests, and the intended problem JSON.
- [ ] Fetch and inspect the actual source of the “Persist Target1 lower-interval certificate” commit mentioned in the conversation; establish its full SHA, parent, exact changed paths, and whether it is merged into any branch used by the current corpus.
- [ ] Inspect the full run and artifact list for workflow run 38118866133 and any newer Target 1 runs. Save run ID, source SHA, workflow SHA, conclusion, artifact ID, and artifact checksum in the report.
- [ ] Compute a provenance manifest for every accepted cover, audit output, legality report, containment report, and summary. Each row should include problem JSON SHA, engine/source commit, Taylor-model source SHA, generation run/SHA, auditor source SHA, report SHA, interval, cell count, and status.
- [ ] Confirm there are no accidental path collisions between **results/arm_\***, **results/target1/arm_\***, and **results/target1-b1p/arm_\***. Add a test that intentionally sets **PROBLEM=target1** and fails if a tool reads/writes Brief 6 output.
- [ ] Check every script and workflow, not just the two fixed in 80aa61e0: cover generation, gap closure, auditing, parallel auditing, containment, Red legality, reports/status, and certificate bundling.
- [ ] Check JSON parsing and endpoint semantics: adjacent cells should meet exactly under the chosen representation; no silent float rounding may create a gap, overlap, or duplicate boundary.
- [ ] Make an index of stale, current-but-not-audited, audited, independently replayed, blocked, and superseded files. Keep old files for research history; do not quietly overwrite them.
- [ ] Produce a brief machine-readable corpus status file alongside a human-readable explanation. The status generator must derive its result from artifacts, not hand-maintained claims in a Markdown table.

**Branch A1 — provenance mismatch found:** stop coverage expansion. Trace the first contamination/incorrect reference, correct the path or source pin, add a regression, regenerate affected outputs and audit them. Recompute every number that consumed the affected result.

**Branch A2 — provenance matches:** proceed to arithmetic/model soundness. This is not yet a proof of mathematical validity; it only establishes that the right program and data were run.

## 4. Workstream B — arithmetic and interval-model soundness

- [ ] Run the complete Taylor-model regression suite on the corrected branch, including the analytic square-root remainder regression, interval arithmetic tests, trigonometric bounds, inverse, multiplication, composition, fold/re-basis, **remToSym**, and segment-distance screens.
- [ ] Add tests for the former square-root underbound over xmin < 1, xmin = 1, and xmin > 1, across small/large widths, polynomial orders, and near-zero admissible domains. Verify enclosure direction, not just that the output is finite.
- [ ] Review all Lagrange-remainder formulae independently: derivatives, binomial coefficients, remainder order, worst-case point in the interval, powers/units, and outward-rounding direction. Look for the same exponent/sign/scale error in sqrt, sin, cos, and reciprocal/inverse.
- [ ] Review interval primitives for NaN, overflow, underflow, signed zero, infinities, cancellation, and denominator intervals that approach or contain zero. A thrown exception should block acceptance, not be converted into a large but plausible-looking result.
- [ ] Independently derive the Taylor-model operations from their definitions and document the proof obligation for each primitive and composition. Do not treat random input sampling as a soundness proof.
- [ ] Build a small, independent verifier for the certificate record format that does not simply call the same **tm.js** arithmetic through another wrapper. Prefer a distinct implementation/language or a carefully justified exact / directed-rounded numeric layer. If independence is incomplete, state exactly which code is shared.
- [ ] For a representative set, independently recompute cell endpoints, coefficients/remainders, push sequence, margins, and Red legality from the saved inputs. Include widest/weakest cells, cells near contact transitions, cells using branch merge/straddle/relaxation, and cells using **remToSym** or **vertexDedup**.
- [ ] Verify every contact branch that can occur on a cell is either ruled out by a strict bound or represented in the enclosure. Audit closest-segment clamp cases, vertex ties, near-parallel segments, floor/cap activation, hub–hub contact, deep-crossing shove, near-vertical contact, and contact on/off within a cell.
- [ ] Audit dependency handling. Specifically check that remainders are not spuriously copied into independent x/y/rotation boxes and amplified through the engine's Gauss–Seidel contact passes. Confirm **remToSym** preserves the correlation it claims to preserve.
- [ ] Independently audit **vertexDedup**: demonstrate that the two segment candidates really represent one geometric vertex contact and that dropping one cannot omit a distinct feasible push branch under the engine's tie-breaking rule.
- [ ] Inspect every “stopped cell” policy. Ensure stopped/timeout/nonpositive-domain/too-many-branches conditions never enter the accepted cover and always surface as an explicit gap.
- [ ] Add adversarial fixtures around every observed event boundary: one representable value before/at/after the boundary, tiny intervals spanning the boundary, and cases where two constraints switch nearly simultaneously.

**Branch B1 — any arithmetic regression or independent replay fails:** do not promote any dependent certificate. Reduce to a minimal failure, determine whether it is an arithmetic bug, an unsound enclosure, an engine/model mismatch, or a bad saved artifact. Add the smallest failing case as a permanent test; then rebuild all data produced by the affected primitive.

**Branch B2 — arithmetic passes but model branches are missing/ambiguous:** treat the relevant regions as uncertified. Add branch splitting/guard conditions or tighter enclosures and rerun the cover. Do not “fix” the result by widening only the claimed margin.

**Branch B3 — audit passes:** record the precise scope of the audit. Passing shared-code replay is reproducibility; the independent reviewer must still assess completeness and the proof argument.

## 5. Workstream C — close the current Target 1 intervals

- [ ] Re-run the generated status/summary tool under each named PROBLEM and compare it with a direct independent parser of the JSON artifacts.
- [ ] For Target 1 arm (2,+), verify whether the saved interval [2, 9.6828] belongs to the intended problem and whether its 427 cells were generated after the square-root fix. Re-run the exact saved-cover audit and containment plus Red-legality checks on the exact commit.
- [ ] For Target 1 arm (1,+), reconstruct the exact union of current intervals from the raw JSON leaves, not filename labels. Check the endpoints of [2,7], [7,12], [12,12.02], and [16.5,20.719084588...].
- [ ] Run the current gap finder with explicit problem and arm, then independently calculate the complement of the union inside the legal domain. Expect a gap around [12.02,16.5] unless newer validated output closes it. Include a minimal boundary table with open/closed endpoint conventions.
- [ ] Verify that each existing Target 1 cell carries enough provenance to identify the corrected arithmetic source and all model options used to prove it.
- [ ] For the narrow [12,12.02] smoke run, inspect the saved workflow JSON and log: exact tiling, exact replay, containment failures, Red-legality failures, stopped cells, cell count, and min margin. Persist an immutable run summary and checksums if any are missing.
- [ ] Audit the 16.5°–20.719° segment with the same gates as the lower segment. Do not infer validation from the presence of a cover JSON alone.
- [ ] Once the interval inventory is sound, define a task queue for every uncovered interval. Order jobs by expected proof value per CPU-minute, not by visual neatness or existing file names.
- [ ] Start with a cheap response scan across each gap to map contact-event transitions and margin minima. The scan is discovery-only; it cannot close a gap.
- [ ] Use adaptive subdivisions, starting from intervals bounded by event changes. For each candidate Red witness, search for a positive uniform margin and legal swing before spending time on a full Taylor-model cover.
- [ ] Try already-implemented proof modes in documented order: plain/hulled branches, separate branches, controlled merges, then subdivision. Record the first failed obligation and operation/solver budget for every rejected cell.
- [ ] If a gap only fails because the model becomes too wide, determine whether the cause is genuine geometry, a contact branch transition, dependency blow-up, or a numerical remainder issue. Use a targeted diagnostic rather than blindly splitting to machine precision.
- [ ] If no fixed Red reply works across the gap, scan for where the best witness changes. Partition the Blue domain by witness regime; each partition still needs a complete, legal, uniform certificate.
- [ ] If no legal reply can be found at some angle, do not declare Blue live from a failed Red search. Try multiple Red pivots/directions/stop lengths, or record that the current witness family is insufficient.
- [ ] Run audits and containment only after each regenerated interval is tiled. Then recompute the full family union and its minimum certified margin.
- [ ] Add one command that fails nonzero on any missing interval, duplicate/inconsistent endpoint, stale source SHA, rejected cell in an accepted cover, or absent legality/containment report.

**Branch C1 — the gaps close with the existing witness:** freeze the input and source manifest; generate an independently replayable certificate bundle and move to full state quantifiers.

**Branch C2 — the best witness changes by interval:** implement a piecewise witness schedule and prove each scheduled response is legal, continuous where required, and covers the complete interval. Do not assume the switch point can be rounded.

**Branch C3 — no witness found:** expand witness search systematically and record counterexamples. If Blue appears to survive, attempt an explicit survival certificate; otherwise keep the interval unresolved.

## 6. Workstream D — from one arm to a truly dead seed

One Blue arm with a losing Red reply does **not** prove the seed dead if Blue has other legal first moves. To certify the seed dead at the stated tactical horizon, every legal Blue first-move family must be covered, with legal Red punishment over its full domain.

- [ ] Read **six-arms/blue-limits.js** and independently reproduce each arm's maximum fully executed target under the current engine and the actual search move-application schedule.
- [ ] Confirm the exact six legal Blue move families: pivot feet 0/1/2, each direction, minimum stop, all intermediate stops, and the endpoint where the engine begins to truncate/refuse a substep. Add explicit endpoint tests for targets just below, at, and just above each limit.
- [ ] Pin the engine commit, finite substep schedule, board radius, off-board tolerance, 12-segment leg discretisation, contact passes, crossing rule, constants, and side-to-move / ko / move-cap state as part of the theorem statement.
- [ ] Regenerate all six arms from the corrected arithmetic. Do not use historical pre-fix Brief 6 covers as current proof cells.
- [ ] For each arm, first run a numeric scouting scan of margins, contact transitions, witness legality, and minimum margin. Save it separately from theorem artifacts.
- [ ] Find the strongest candidate Red reply for each arm or subinterval. Optimise for a **uniform lower bound** on loss margin subject to reply legality, not just the largest sampled margin.
- [ ] Generate adaptive covers for each full executable domain. Make each arm status one of full-certificate, partial-certificate, failed, or not attempted.
- [ ] Re-run independent arithmetic and model checks on all accepted cells; rerun containment of the actual engine pose after every reply substep for representative hard cells; rerun Red-legality checks over every branch/cell.
- [ ] Check the theorem's universal quantifiers explicitly: all six arms, every admissible stop angle, any truncated end-move behaviour, and every response branch of the finite contact solver. A grid of angles is not a substitute for interval coverage.
- [ ] Check the “real arithmetic versus binary64 engine” gap. Determine whether the positive margin plus strict branch guards gives a robust transfer to the actual engine, or whether exact float-branch semantics / a stronger numerical error bound is required.
- [ ] Where floating-point rounding may alter contact on/off, pivot location, tie-breaking, or crossing legality, classify the affected cells as conditional/unresolved until analysed.
- [ ] Have a reviewer who did not author the generator inspect the theorem statement, primitive soundness, branch completeness, boundary handling, and one end-to-end certificate. Record objections and resolutions.
- [ ] Only after all these checks pass, mark the **exact seed** dead at the stated horizon. Count it as one distinct proved state, regardless of how many cells were needed to cover its move intervals.

**Branch D1 — one or more arms remain uncovered:** the seed is not proved dead. Report covered angular measure per arm as a diagnostic only; continue the cheapest unresolved arm or publish an explicit blocker.

**Branch D2 — all six arms are certified in the real-arithmetic model, but floating execution is not enclosed:** publish “certified in the stated real-arithmetic finite-program model” and do not label it a full implementation-level game theorem.

**Branch D3 — all six arms and the engine-transfer argument pass:** freeze a reproducible dead-seed certificate and test whether it generalises to a nonzero region of nearby positions.

## 7. Workstream E — seek a region, not just one point

- [ ] Inspect prior work on dead geometry, Brief 5, and the 261-point / 63-ball corpus. Confirm the meaning and limits of each old result; the earlier sampled-label corpus is not a collection of fully proved dead balls.
- [ ] Identify which of the existing mined dead points have exact replayable source positions and whether their recorded “dead” classifications came from a proof, a sampled search, a screen, a timeout, or a heuristic.
- [ ] Build a stratified candidate list of distinct states: varied board locations, rotations, side to move, move-cap / ko states, and relevant geometric/contact regimes. Preserve source game and line for every mined state.
- [ ] Start with the exact certified seed. Perturb one coordinate at a time (x, y, blue rotation, red x, red y, red rotation), then test selected coupled directions. Numerical scans identify candidate radii only; they do not certify any neighbourhood.
- [ ] Search for an invariant/robust region where the same reply schedule remains legal and the throw margin stays strictly positive while every Blue move family remains covered.
- [ ] If the optimal reply changes across state space, partition into certified subregions with different response schedules rather than forcing a single brittle witness.
- [ ] Use interval boxes / Taylor models in all six state coordinates only if the six-dimensional dependency and event guards are handled soundly. Otherwise start with lower-dimensional slices and prove exactly what those slices mean.
- [ ] Inspect every contact/event boundary before claiming an open ball. A certificate valid at a point or along one coordinate slice does not certify the surrounding six-dimensional volume.
- [ ] If one local box fails, use bisection and event-guided partitions. Record whether failure is due to real counterexample geometry, weak enclosure, ambiguous branch, or compute exhaustion.
- [ ] Measure the certified volume only after a disjoint/overlapping region union is correctly represented. Report total certified measure only if the coordinate domain and measure are explicitly defined; otherwise give box count, dimensions, bounds, and a map/slice visual.
- [ ] For symmetry transforms, prove that the engine rules, board geometry, side labels, and move-state variables preserve the game before multiplying region counts.

**Branch E1 — no nonzero region certifies:** retain the exact-state result, improve event partitioning or witness selection, and do not describe it as a dead area.

**Branch E2 — small robust region succeeds:** compute a conservative certified box / ball, plot it in state slices, independently audit the region boundaries, and use it as a proof-label source.

**Branch E3 — the same pattern repeats across several unrelated seeds:** investigate a general lemma or response-family theorem, but state its hypotheses exactly and test counterexamples outside them.

## 8. Workstream F — honest live/dead/unknown coverage ledger

- [ ] Define a reproducible benchmark sample from the mined logs and fresh engine-generated legal states. Stratify by board region, orientations, contact regime, side to move, depth, and source game rather than using a single biased random sample.
- [ ] Freeze the sample and publish a seed, generation code, exact sampling rules, engine SHA, deduplication rule, and checksum. Keep any training sample separate from the final evaluation sample.
- [ ] Create one row per distinct state with source state, legal rule-state, exact SHA / canonical hash, proof horizon, status, certificate reference, assumptions, margins, replay/audit status, and unresolved reason.
- [ ] Allowed statuses: **PROVED DEAD at horizon H**, **PROVED SURVIVING/LIVE at horizon H**, **HEURISTIC LIKELY DEAD**, **SEARCH FOUND ESCAPE**, **PARTIAL**, **UNRESOLVED**, and **INVALIDATED**. Never map “search found no escape” to proved dead or “no death certificate found” to proved live.
- [ ] Specify the quantifier for every status and the precise horizon: full turn, half-move, search ply, and game engine substep are different units. Use the same convention in the report, dataset, and UI.
- [ ] Audit the search's exact label source. Read the implementation of escape, screenEscape, dead, unresolved, and timeout rather than relying on status names. Keep prior log counts labelled as historical procedure outputs unless reprocessed.
- [ ] Deduplicate retries and safe symmetry copies; do not merge distinct states just because rounded coordinates match. Maintain a parent/source-game ID to prevent train/test leakage across near-identical states.
- [ ] Track two separate numerators: number of distinct fully certified positions, and number of interval cells / containment checks behind those certificates.
- [ ] Report percentage only on the frozen sample: proved-dead / N, proved-live / N, partial / N, unresolved / N. Include denominator, confidence/sampling limitations, and category definitions.
- [ ] Separately report continuous theorem scope: state points, state boxes, move families, angular intervals and witness schedules certified. Do not label this “percent of the board” without a justified measure.
- [ ] Build a coverage visual with each seed's six action families and each family's domain coloured by proved / gap / invalid / not attempted. Keep proof status visually separate from heuristic discovery.
- [ ] Make the status table and visual reproducible from data, not edited by hand. Add a test that deliberately inserts a gap and a stale SHA and confirms the summary fails loudly.

**Branch F1 — few or no distinct fully proved positions:** report that clearly. Continue proof work and prepare the training/evaluation plumbing, but do not claim there is enough diversity to improve the network.

**Branch F2 — many cells but few distinct seeds:** prioritise new geometries and different contact regimes over subdividing the same family more finely.

**Branch F3 — many distinct, diverse, independently verified states:** proceed to controlled NN/search experiments, with a completely held-out set of seed families.

## 9. Workstream G — will dead-position knowledge improve Tau's finishers?

The proof project and the playing-strength project must be measured separately. A theorem can be valuable without changing Elo; a rating increase does not validate the theorem.

- [ ] First inspect the current value, policy, self-play, search, training data schema, held-out evaluation, and arena/ladder scripts. Reuse existing training conventions where possible; do not create a parallel trainer that silently changes sampling or opponent selection.
- [ ] Check whether the NN data already records terminal loss, final outcome, search depth, root state, candidate move, and reason for a throw. Quantify overlap between prospective labels and existing examples before adding data.
- [ ] Create an offline proof-label importer that accepts only immutable, passing certificate manifests. Reject stale source SHAs, failed audits, missing legality checks, gaps, unknown statuses, and uncertain model/float assumptions by default.
- [ ] Keep proof labels distinct from heuristic labels in the schema. Give every row a certificate ID, exact state hash, horizon, theorem assumptions, and provenance.
- [ ] If there are only a handful of exact certified states, do not train a general classifier and infer generalisation from memorisation. Build unit tests and a tactical-search prototype first; continue proof diversification.
- [ ] If there are enough diverse proved states, prepare a fixed, family-held-out dataset. Keep near-identical trajectories and transformed copies in the same split to prevent leakage.
- [ ] Establish four matched experimental arms if supported by the code: (A) unmodified control; (B) training with verified outcome/value supervision; (C) auxiliary deadness/tactical-risk head with matched evaluation budget; (D) proof-guided search or move-pruning enabled only for verified states/regions. Keep exploration of labels separate from testing them.
- [ ] If policy labels are considered, derive them only from certified moves and state what they teach. A dead-state label alone does not identify the best move out of a live state. Do not invent preferred moves when the certificate only says the position loses.
- [ ] If adding an auxiliary head changes parameter count, compare with a parameter-matched control or otherwise disclose the capacity confound.
- [ ] Keep architecture, initial weights, optimizer, data volume where feasible, augmentation, training steps / GPU budget, search budget, temperature, and opponent pool fixed between arms.
- [ ] Measure held-out classification precision/recall and calibration separately from game outcomes. Optimise for false-positive control: a wrong “proved dead” training label can poison both play and search.
- [ ] Measure finishing-specific outcomes: conversion rate from a known winning/advantageous position, moves to finish, opponent escape rate, frequency of entering a certified dead region, missed escape moves, forced-throw success, and win rate / rating.
- [ ] Test against a fixed opponent pool containing current ladder anchors, the current strongest overall model, recent ladder candidates, and a diversity set. Freeze the pool before the evaluation.
- [ ] Use paired games, side swaps, common openings / starting states where valid, equal compute, and fixed seeds. Report sample size, win/draw/loss, paired score, rating difference, and confidence intervals.
- [ ] Start with a small sequential pilot. If an effect is clearly harmful, stop that arm; if inconclusive, increase the paired sample size rather than picking the best-looking checkpoint; if positive, rerun on a separate held-out pool before calling it an improvement.
- [ ] For an initial operational gate, do not interpret a broad strength result from fewer than about 20 distinct certified states spanning several genuinely different geometries. This is a pragmatic stop/go rule, not a theorem or universal statistical threshold. With fewer labels, only claim the local tactical test or pipeline validation.
- [ ] Save control and candidate checkpoints plus full configs outside live production folders. Never replace the top ladder model on the basis of a single small match batch.

**Branch G1 — insufficient labels/diversity:** do not spend the night on a full network run. Verify the importer, create a small synthetic/unit fixture only for pipeline testing, quantify existing training-data overlap, and prioritise mathematical coverage.

**Branch G2 — labels are sound but overlap existing terminal data:** compare for genuinely new information (earlier tactical warning, counterfactual move guidance, or states unavailable to self-play). If there is no incremental information, skip redundant augmentation and test only the policy/search hypothesis.

**Branch G3 — data are diverse and provenance is strong:** run the matched experiment and reserve evaluation families untouched. Do not change the public ladder or production trainer.

**Branch G4 — strength rises but verified tactics do not:** investigate confounds/leakage and rerun the benchmark; do not claim the proof method caused the gain.

**Branch G5 — tactical metrics improve but Elo does not:** report the local skill gain, identify whether search budget or state frequency makes it strategically irrelevant, and design one targeted experiment rather than generalising.

## 10. Workstream H — search integration without unsafe pruning

- [ ] Prototype proof data as an **offline annotation** first: when a replay reaches an exact known state, show the certified outcome and its horizon without changing move choice.
- [ ] For a state-region oracle, require a rigorous membership test for all state coordinates and legal-rule variables. Rounded-coordinate lookup and nearest-neighbour matching are not proof-preserving.
- [ ] Start with exact certified states only. Prove that serialization, rotations, symmetry transforms, and state hashing cannot accidentally map an unproved state onto a certified one.
- [ ] If using proof certificates to prune search, make pruning opt-in and fail closed: missing data, version mismatch, hash mismatch, unknown status, or failed checksum must fall back to the original search.
- [ ] Keep “certified forced loss”, “heuristically likely loss”, and “search failed to find an escape” in separate buckets. Only the first may enable sound theorem-based pruning.
- [ ] Add paired ablation tests for original search versus annotation-only versus oracle-guided search. Equalise node/time budgets and log prunes, avoided losses, false positive attempts, timeout changes, and move-choice differences.
- [ ] Test negative controls: corrupted certificate, wrong engine SHA, neighbouring-but-unproved state, changed crossing rule, wrong side to move, and boundary point outside the certified domain. Every control must disable the oracle.
- [ ] Compare actual finish rate and compute per move before considering broader deployment. A correct oracle about one rare seed can be useless for general ladder strength.

**Branch H1 — exact-state lookup is too rare to affect play:** keep it as a verifier/debug tool and prioritise certified regions or improved generalisable NN features.

**Branch H2 — lookup materially improves tactic choices:** expand only through proof-preserving state transforms and rerun robustness tests; do not fuzz the certificate domain.

**Branch H3 — any false-positive oracle hit:** disable pruning, minimise the counterexample, fix hashing/domain membership, and rerun every negative control before any strength test.

## 11. Workstream I — independent review and research-quality report

- [ ] Ask for an independent review of the theorem statement, interval operations, branch completeness, finite-call schedule, endpoint logic, model-engine equivalence, and proof-label semantics. The reviewer should not use the generator's own summary as evidence.
- [ ] Include a short dependency graph: problem JSON → engine revision → cover generator/model → raw cell JSON → independent audit → containment/legality → accepted certificate → ledger entry → training/search ingestion.
- [ ] Write a compact report with: the exact question answered; formal quantifiers; source and environment; input/state; interval domains; cell counts; minimum robust margin; every failed/uncovered interval; independent checks and their limits; floating-point limitation; current conclusion; next blocker.
- [ ] Include an executive summary with separate answers for: how many distinct states are fully certified dead; how many are certified live/surviving; what proportion of the fixed finite sample falls into each category; which continuous move ranges are certified; and whether a controlled finisher experiment improved play.
- [ ] Produce a machine-readable JSON ledger and a rendered table/coverage figure from the same data.
- [ ] Report CPU/GPU time, wall time, peak memory if available, run IDs, exact source SHA, and deterministic reproduction commands.
- [ ] Keep counterexamples, failed-cell logs, old/stale artifacts, and falsified assumptions in the package. The history of what failed is useful, not clutter.
- [ ] Do not write “proved” in a result title or public claim if only a smoke test, random check, sampled engine comparison, or shared-code replay was performed.
- [ ] End with one of four explicit conclusions: **proof-grade result; reproducible but not independently established; useful heuristic finding; unresolved / blocked**.

## 12. Suggested overnight order and deliverables

1. **First pass — inventory and gates.** Check refs, current source, proof inputs, corrected arithmetic ancestry, run artifacts and interval gaps. Deliver provenance/status JSON before starting long jobs.
2. **Second pass — cheap decisive checks.** Re-run analytic arithmetic regressions, path-isolation tests, raw gap computation, legal-reply checks and the lightest audits. Fix any reproducible tooling bug with a regression.
3. **Third pass — highest-value proof task.** If the current Target 1 gap is genuinely open and corrected-source coverage can be run safely, cover that gap or identify the first mathematical blocker. If the corpus is stale, rebuild the weakest/smallest representative cell before queueing large runs.
4. **Parallel, bounded task — independent verification.** Review a representative certificate and independently check a hard boundary cell. Do not count work as independent when it imports the same faulty primitive.
5. **Fourth pass — coverage ledger.** Build an exact table of distinct proved states, per-arm continuous coverage, sample statuses, and unresolved regions. This deliverable is useful even if no new theorem lands.
6. **Fifth pass — expand breadth if feasible.** Try another Blue move family or another seed/contact regime once the first pipeline is known sound. Breadth is more valuable than making one existing interval excessively fine.
7. **Sixth pass — training decision.** If there are not enough diverse verified examples, stop at an importer/unit test and write the next-data requirement. If there are enough, run only a bounded isolated pilot and reserve a clean evaluation split.
8. **Final pass — preserve and report.** Freeze outputs by checksum, commit source/docs/data to the working branch, summarize all commands and failures, and open a PR for review. Do not merge it automatically.

Required handoff artifacts:
- [ ] A provenance manifest with branch/SHA/run/artifact/checksum for every claim.
- [ ] A test report showing corrected arithmetic, path isolation, tiling, independent replay, containment, Red legality, and explicit failures.
- [ ] A gap map for each investigated move family.
- [ ] A definition-ledger with distinct states versus certificate cells, plus live/dead/unknown sample counts.
- [ ] If justified, an isolated controlled training/arena pilot with full configs and confidence intervals.
- [ ] A concise PR description that says what is actually proved, what remains unproved, and how to reproduce it.

## 13. Definition of done for this overnight run

The task is a success if it leaves a reproducible, evidence-calibrated next step — not necessarily if it proves the whole seed dead tonight. At minimum:

- [ ] No new claim relies on stale pre-correction artifacts without an explicit warning.
- [ ] Every accepted result identifies its problem, branch/commit, model, assumptions, interval/state domain, and replay status.
- [ ] Every gap, timeout, failed cell, and failed soundness obligation is visible.
- [ ] The distinct-position count is not confused with interval cells or sampled comparisons.
- [ ] No unproved state is used as a hard NN truth label or a sound search-pruning rule.
- [ ] The report makes the next branching decision obvious from the results.
- [ ] All code/results remain on an isolated research branch, with a reviewable PR and no production ladder/trainer mutation.

If progress stalls, prioritise finding and minimising the earliest failed obligation. A small counterexample to the proof pipeline is more valuable than another large certificate run that repeats the same unsound assumption.
