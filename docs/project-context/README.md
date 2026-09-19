# Supplied Tau project context

Start with [the project handoff](../../CLAUDE-HANDOFF.md). This directory keeps
user-supplied source material alongside the reviews so a new Claude account can
recover the project's questions and decisions without the old chat.

**Original briefs are historical inputs, not endorsed conclusions.** Some say
“proved” or “sound” where later reviews identify missing hypotheses or defects.
Read the latest [Brief 4 review](../geometry-reviews/brief4/tau-box-size-review.md)
and the review index before adopting a claim.

## Original materials

| File | Purpose |
| --- | --- |
| [Initial contact questions](inputs/astra-brief.md) | Contact regularity, margin bounds and swept walls |
| [Dead-region visual brief](inputs/dead-region-brief-for-visual-model.md) | Wall diagrams, coordinates and seeds |
| [Original throw theorem](inputs/throw-theorem.md) | Proposed H1–H4 barrier, reviewed and corrected later |
| [Contact-lemma write-up](inputs/throw-contact-lemmas.md) | Historical proposed contact bounds |
| [Brief 2](inputs/astra-brief-2-throw-lemmas-and-oriented-split.md) | Contact lemmas and oriented cells |
| [Claude's Brief-2 check](inputs/astra-brief2-check.md) | Confirmed phase counterexamples, sampled guard, historical rule issue |
| [Brief 3](inputs/astra-brief-3-the-vertex-dwell.md) | Vertex dwell and enclosure closure |
| [Brief 4](inputs/astra-brief-4-the-box-size-gap.md) | Box-size gap, barrier hypotheses and second arm |
| [Forwarded project conversation](inputs/claude-project-conversation-2026-09-18.md) | User questions/approvals and successive Claude updates; retain later corrections |

The markdown inputs are byte-for-byte copies; the forwarded conversation has a
filesystem-safe filename. `INPUT-SHA256SUMS` records all original input hashes.

## Data and decisions

- [Live ladder snapshot](live-ladder-snapshot.md): the user's pasted counts and
  why that evidence belongs in the depth explanation.
- [Trainer and league history](training-history.md): dated prior decisions,
  including changes to the laptop role and retromine allocation.
- [Original level-1 logs](search-logs/dead1.jsonl),
  [deeper logs](search-logs/deep2.jsonl),
  [seed list](search-logs/seeds-k4-childdead.jsonl), and
  [supplied tally](search-logs/tally.txt).
- [Reviewed log summary](search-logs/reviewed-summary.json): deduplicated counts,
  input hashes and the positive witness record. Status labels retain the
  original search semantics; no failed search is promoted to an escape proof.

Latest operational update from the user, 2026-09-19: **both trainers have been
stopped to make the handoff easier**. This is user-reported state, not a remote
process inspection. No trainer restart was performed as part of this handoff.
Inspect the current checkout, saved state and processes before resuming work.
