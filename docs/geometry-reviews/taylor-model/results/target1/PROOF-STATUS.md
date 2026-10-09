# Target 1 — proof status

Target 1 is the mined seed from record line 176. This certificate effort asks whether every stop angle for blue arm (pivot 2, direction +) has a legal red response that throws Blue.

## Current claim ladder

| Layer | Current state | Evidence |
| --- | --- | --- |
| Input fixture | recorded | `problems/target1.json`; same seed throughout the original-witness intervals |
| Lower angle cover | accepted and rechecked | [2°, 9.6828°], 427 accepted degree-4 cells, zero failed leaves |
| Lower replay audit | recorded; exact per-cell corpus refresh pending | prior audit 427/427, 0 mismatches; fresh run output is being retained via the certificate bundle |
| Lower cellwise checker | passed latest CI run | 0 containment failures, 0 legality failures, 0 stopped cells; 465,180 sampled point comparisons |
| Gap angle cover | accepted and saved | [9.6828°, 9.73°], 2 cells; audit 2/2, no mismatch |
| Upper angle cover | accepted and saved | [9.73°, 14.33°], 51 cells with alternate red witness (pivot 2, direction +), 36 substeps |
| Upper replay audit | passed | 51/51 cells reproduced, 0 mismatches |
| Upper cellwise checker | passed | 0 containment failures, 0 legality failures, 0 stopped cells; 17,085 sampled point comparisons |
| Full response-arm coverage | joined | three closed intervals cover [2°,14.33°] for blue arm (2,+), with a legal red counter-response on each |
| Other blue swing arms | not yet covered | still needed before claiming the start position is globally dead |
| Taylor-model / idealised-rule soundness proof | not fully formalised | arithmetic/trigonometric enclosures, remainders and collision/legality encoding still need independent justification |
| Global dead-position theorem | not yet established | one of the blue move families is covered; other legal move families remain |

## Key numeric result

Across 480 accepted cells, the smallest recorded terminal throw margin is 0.09772912589987467u (upper interval). The smallest hub-motion lower bound is 2.388222849258422u.

The cellwise engine comparison totals 484,443 sampled comparisons across all three ranges, with no detected failures and maximum observed excess below 2.5e-14. These finite samples support model/engine correspondence; they do not prove every binary64 execution or replace the analytic enclosure obligations.

See [REPLY-COVER-MAP.md](REPLY-COVER-MAP.md) for the interval partition, witnesses and commands.
