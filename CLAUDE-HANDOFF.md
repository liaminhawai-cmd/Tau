# Tau project handoff

Prepared 2026-09-19 at the user's request, so work can continue in a Claude
account without the old project conversation. This records context available
in this review thread, supplied briefs/logs, and retrieved earlier Tau
conversations. It is not a complete export of the old Claude account.

## Start here

Repository: **`liaminhawai-cmd/Tau`**. Public game: **https://tau-game.com/**.
Depth explainer: **https://tau-game.com/depth**. The game, self-play/training
system, public explanation and mathematical research are connected parts of
this project, with different standards of evidence.

Read these in order:

1. This handoff for the user's intent and the state of the work.
2. [Review index](docs/geometry-reviews/README.md) for all findings and source pins.
3. [Brief 4 review](docs/geometry-reviews/brief4/tau-box-size-review.md) for the
   latest throw-checker audit and remaining mathematical obligations.
4. [Supplied context and briefs](docs/project-context/README.md), especially
   Brief 4, the original theorem, and Claude's response to Brief 2.
5. [Earlier trainer/league decisions](docs/project-context/training-history.md)
   before changing those systems. Those decisions evolved; read their dates.

## The user's purpose for `/depth`

The central question is **“How deep is this game?”** The audience is someone
smart and technical who probably has never played Tau. The user liked many
individual sections but thought the overall purpose and structure had drifted.
The requested direction was:

- Teach enough of the game to understand the evidence. Use concrete positions,
  examples and demonstrations rather than assuming experience playing Tau.
- Organise the explanation into clear sections with an index. Make each major
  section contribute to the same depth question.
- Use the **live self-play league as data**. The user explicitly challenged its
  omission. Keep older tournaments distinguishable from newer live evidence.
- Keep the **jiu-jitsu/belt and chess strength-range analogy**. Earlier context
  also records the rough “about five chess-classes” intuition. Present these as
  explanatory analogies, not calibrated conversions between rating systems.
- Explain both the observed skill ladder and the still-unmeasured ceiling.
  Do not replace interesting evidence with only methodological qualifications.

The initial supplied ladder snapshot had **19,562 rated games, 9,781 two-game
matches, 73 live model faces and 52 model files**, plus the immortal ladder
anchors. It is historical, not a current counter. The
[snapshot note](docs/project-context/live-ladder-snapshot.md) preserves the
readout and its interpretation limits.

The archived [depth proposal](docs/geometry-reviews/depth/README.md) predates
subsequent merged editions. Main's later depth changes include PRs #10, #13 and
#15; corresponding Pages changes include #11, #12 and #14. Inspect current
`depth.html` and the actual deployment branch before editing or publishing.
Do not overwrite later work with the historical proposal.

## What Tau's geometry means in this research

Two tripod pieces move on a disc. A player chooses a foot as pivot, a rotation
direction and a stopping angle. The other piece can be pushed; a foot beyond
the off-board radius is a throw. The mover's own board/line rules determine
its legal swing limit. A legal-reply envelope and a proof that a reply is
punished are different calculations.

Constants in the reviewed model: board radius 66.667u; off-board threshold
67.167u; leg radius R = 23.095u; tube radius 1.44u; leg-to-leg contact distance
2.88u; inertia I = 0.7R². Each quarter-circle leg is represented by 12 chords.
Pose coordinates are `(x,y,θ)`; uncertainty grids often use `(x,y,Rθ)`.

The **certified target is the finite game program**, not an assumed smooth
continuous contact law. The engine subdivides a swing call into equal steps
of at most 0.4°. Search's one-degree calls therefore use **⅓° substeps**.
Changing the calling schedule changes the finite map. Degrees, radians and
Rθ must always be labelled explicitly.

## Why the dead-position and lemma work exists

The user wanted a short data-gathering phase to develop intuition, then an
analytical approach that proves larger dead regions. In the supplied project
conversation they explicitly asked to **“make it a proof”** and **“mathsify”**
the throw argument, then approved building the checker.

A “dead” position informally means every legal reply can be punished, possibly
through a deeper continuation. The search's labels describe its configured
procedure; they are not interchangeable with mathematical quantifiers. In
particular, **“escape” can mean no certified child was found within a sampled,
screened or budgeted search**, while unresolved and timeout are also distinct.
Read the search implementation before calling a negative result a theorem.

The uploaded historical logs contain 334 distinct level-1 positions: 84 dead,
52 unresolved, 14 escape and 184 screenEscape. The combined deeper run has
100 distinct targeted seeds after deduplicating retries: 1 dead, 8 unresolved,
90 escape and 1 timeout. The positive deeper result has recorded worst margin
0.105u and 20/20 random engine checks. These are reports from that procedure,
not a measured fraction of the full state space.

Holding the attacker fixed while varying the victim produces a 3D region in
6D joint pose space; it has zero six-dimensional volume. The user asked about
global coverage and then supported using data to guide a broader analytical
argument. No useful global percentage has been established.

## Branches and source versions

This is a snapshot, not a promise about current branch state. Resolve current
heads when continuing, and keep reports attached to their stated revisions.

| Thread | Branch / PR | What matters |
| --- | --- | --- |
| Game and shipped assets | `main` | Publication base inspected: `e7d3f13c518eeab1cfae6256952a7af615eb3bf0`; later commits may exist |
| Original arena / dead-search explainer | `claude/nn-arena-matches-tm1hi9`, PR #8 | User's Claude update said `nn/forced-win.js` and `nn/contact-law.js` were here, not on main, at that time |
| Faster limits / push physics research | `claude/project-thread-yoneu9`, PR #17 | Predecessor of the original PR #18 research branch |
| Dead cells and throw-certificate lemmas | `claude/project-thread-kyx87p`, PR #18 | Main source of Briefs 2–4; not interchangeable with main or PR #8 |
| Unions of dead cells / rim clipping / pose-gap work | `claude/project-thread-mtkkjf`, PR #23 | Related domain/envelope work; see supplied response to Brief 2 |
| New ladder search work | `claude/ladder-d5`, PR #28 | Open when checked; historical compute limits should not be mistaken for a veto of this later experiment |

Claude's user-forwarded [Dead Certificate Search explainer](https://claude.ai/artifact/PJKtydKncWLCdz9wBzpzyP)
described certificate claims, depth/screening, seeding/resume, statuses and a
glossary at its branch head. The message said its author changed no repository
files. Treat that description as a dated branch explainer, not current main.

The Brief 4 audit pins `1cf90f63fb597c039d99ff554242a12ff4b91f1a`. Its checker
blob, `b8fb4c6f3bc69beedd8b8973e96994d65dc2c96a`, was unchanged at PR #18 head
`1ba97f2a9b7bf169c40972fa9476b10c77c3ee13` when checked, although the write-up
had advanced. Exact input hashes and restoration scripts are in the packages.

## Findings the new Claude must not lose

**The latest small-box throw claim is not yet a completed proof.** Brief 4
reproduces the claimed output at ±0.0002u and ±0.002 **degrees**, not radians.
It also finds (1) the park Jacobian selecting the wrong attacker chord because
the degenerate segment is passed in the wrong argument position, and (2) a
carried basis being treated as if its third column still equals the current
push direction. The missing term is explicit in the report. These are proof
defects, not exhibited escape poses.

**A fixed small invariant box is impossible in the stated location.** The
nominal trajectory leaves both the ±0.1u and ±0.125u initial boxes at k15 (5°),
well before throwing. This does not rule out a narrow **moving tube**. The
current review derives the complete contact-map Jacobian, finite radial-gain
bound and a slab-telescoping progress inequality, with their hypotheses.

**There are positive results at the target scale.** Outward-rounded local
geometry gives positive attacker closing and radial-gain bounds on three park
slabs over ±0.125u/±0.01-radian pose boxes. Their reachability and whole-trajectory
invariance are unproved. The second arm approaches an **attacker** vertex;
fixing only the first arm's victim-vertex dwell does not cover it.

**Keep the earlier corrections.**

- Nominal first-arm throw: k84 = 28°. Pre-push park: k74–98. Post-push park:
  k79–104. Do not treat those as the same interval.
- Zero lever arm does not itself make the chosen basis ill-conditioned. That
  earlier suspicion was checked and rejected. It is not the new frame-identity bug.
- Ordinary isolated grazing is not automatically a jump. A fixed contact
  signature does not imply a differentiable maximum-foot-radius margin.
- Three times an observed finite-difference slope is empirical evidence, not a
  uniform Lipschitz theorem. Random engine agreement does not repair a missing
  enclosure proof. Floored denominators do not establish geometric lower bounds.
- Pivot-plane geometry alone does not determine the engine's stopping program:
  absolute substep phase can change the limit. The supplied Claude response
  confirmed the counterexamples and described a **sampled** PR #23 guard, not
  a full proof of the guard over a cell.
- An event-order swap need not make the limit jump when both events truly stop
  the move; their minimum/envelope union can remain the right construction.
- The “no legal reply” class proposed in one older discussion was withdrawn:
  the investigated examples already had a foot off-board.
- The supplied Brief-2 response identifies a historical `newPending` /
  `pendingMerge` rule issue. It explicitly treats a fix as a gameplay change
  requiring the user's decision, not a silent certificate cleanup. Recheck
  whether it still exists before making any current claim.

## Current operational state

The user reported on 2026-09-19 that **both trainers are stopped** to make this
handoff easier. This was not independently checked on their machines. No
trainer restart was performed during the review/push. Inspect saved state and
current processes before resuming; do not assume a loop is still running.

## What to do next

The current user request is to preserve and push **all findings and relevant
context**, which this handoff accompanies. It is not an instruction to merge
experimental branches, deploy a page or silently change game rules.

For continued proof work, start from the latest checker source and reproduce
the two defects before altering it. Then verify complete piecewise contact
updates and a phase-indexed tube, including first contact, every reachable
feature transition, other-contact exclusions, finite-pass residuals and
floating-point correspondence. A fixed victim vertex and a fixed attacker
vertex need different exact branch maps.

For continued `/depth` work, review the current page first, fetch fresh league
evidence, and keep the user's examples-first audience and depth question in
view. Date snapshots and distinguish games, colour-swapped matches, model
trunks, search-depth faces and rating uncertainty.

The user repeatedly asked the work to continue and asked that findings be
made durable in GitHub. Finish authorised, reviewable work and state concrete
results. Preserve uncertainty honestly and avoid resetting already-settled
questions when context changes accounts.


## Brief 5 update — dead points to regions (2026-09-19)

The new Claude update and the mathematical audit are preserved in
[the Brief 5 review](docs/geometry-reviews/brief5/tau-dead-region-classes-review.md),
with a standalone HTML version and reproducible scripts. The forwarded update is
[archived with the project inputs](docs/project-context/inputs/claude-brief-5-update-2026-09-19.md).

The audit pins research snapshot `c1ac39e771f8115797a4b8672587860fb676ad1b`,
frozen corpus rules at `5252f2d839b739f52ce69158dcddfcedbd62bbb7`, and the
published L17 measurement at `b9907b05e40103dc459d3013b7a873ac12941f78`.
The decisive correction is that the published L17 index contains eight old
hard-coded entries and twelve old arcs. It does not load the new 261-point or
63-ball files. Its zero-hit run therefore audits the old table, not the new
corpus. The new balls vary all six pose coordinates and have positive ambient
six-dimensional volume; they remain sampled certificates, not proofs.

The constructive research target is a finite reply cover: for every legal
victim stop in a region, at least one verified attacker response wins, with
response policies allowed to change across guarded patches. The review gives a
margin bridge for two responses, a phase-indexed moving-tube formulation, and
the bounded-horizon forced-win induction. It does not claim a new proved
nonempty Tau dead region. A nine-stop diagnostic of one unresolved control is
saved beside the report; the same attacker arm wins at all nine tested stops,
but the finite samples do not close the interval.

The saved audit confirms 261 points, 63 balls, 1,045 controls, 10,440/10,440
point falsification agreement and 1,575 recorded ball trials. Controls remain
screen-biased and sampled labels are not universal negatives. The user reported
that both trainers were stopped; no trainer was restarted for this update.


## Brief 6 resolution — 2026-09-20

[Brief 6 review](docs/geometry-reviews/brief6/response.md) resolves the recorded
throw-certificate discrepancy: the numerical claims start **after blue's
(0,+1) reply to 8 degrees**, not at the original `ndpxhts24` seed. The current
committed stack returns k85 / 67.192689u and k112 / 67.204663u using the exact
post-reply pose and a **0.002-degree** rotation half-width. The document's
0.002-radian box is a unit error. These outputs reproduce without recovering
uncommitted code, but the wrong-chord Jacobian and missing carried-frame term
from Brief 4 remain in the unchanged checker and were rechecked here. Do not
cite `CERTIFIED` or random containment agreement as a completed enclosure proof.
The [package](docs/geometry-reviews/brief6/README.md) includes exact source pins,
commands, an engine replay of the missing reply and all diagnostic outputs.
