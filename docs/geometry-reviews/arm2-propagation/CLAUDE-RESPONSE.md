# Response to the independent replay and 150-position audit

22 September 2026. Follow-up to Claude's [task-A commit](https://github.com/liaminhawai-cmd/Tau/commit/3c2c9f47040c88d761402ab6fa5cba8a24a5b42b). This note updates the earlier L13/L17 task request.

## What the replication establishes

Claude reports every numeric output reproduced: 380 corrections, no failure, final exposed-foot lower bound 67.20213881297005u against edge upper 67.16700000000002u, clearance 0.03513881297003251u; 454 contact exclusions; 41 engine cases and 4,592 containment checks without failure. Its report is independent execution, not an independent proof review of the zonotope argument.

All 112 attacker poses also match between Node v24.19.0 and v22.22.2 on different machines. This is useful two-runtime evidence. It does not bound arbitrary runtime arithmetic or discharge uniform floating contact correspondence. Recorded poses, rather than nominal multiples of degrees, remain the inputs to the enclosure.

The pinned geometry source belongs to `claude/board-game-video-adaptation-cf8a93`, the research revision containing internal L17; it is not main. Keep experimental, proof-source and deployed revisions distinct.

[The replay verifier](REPLAY.md) now separates cross-run numeric identity from within-run byte-hash consistency. The existing `summarize.py` still validates a complete chain. Its hashes fail when old derived files are mixed with newly timed inputs; that does not mean an intact committed chain cannot be verified.

## What the 150-position result actually says

| Measure | Shipped marking | Tolerant marking |
| --- | ---: | ---: |
| Positions with a witness on the reference grid | 142 | 142 |
| Witnesses found | 137 | 140 |
| Reference-grid witnesses missed | 5 | 2 |
| Miss fraction, denominator 142 | 3.52% | 1.41% |
| Marks examined | 1,318 | 1,636 |
| Budget exhaustion | 0 | 0 |

The net reduction is three misses, but the changed verdicts are **four recovered witnesses and one lost witness**. This is not a monotonic extension of the old sampled set. In `arenamujedgps-1`, k=0, the shipped grid finds pivot 1, direction -1 at 15.000000000000005 degrees; tolerant marking finds none. Keep this case as a regression fixture alongside the recovered cases.

The residual 1.41% is the measured comparator for dense-check ablations under this development corpus and protocol, not a universal floor or ordinary-play error rate. The quarter-degree reference grid supplies witnesses, not continuous negative proofs. The budget was never binding here; that says nothing about every future position.

## Are the escape bands properties of the position or the punishment test?

They depend on both. Fix the engine revision, legal rules, history and command protocol. Let M_V(q) be all legal defender moves, E_A(s) the tested endpoint attacker responses, and M_A(s) all legal attacker moves. Define:

- D_E(q): every v in M_V(q) admits an immediate winning response in E_A(v(q)).
- D_1(q): every v in M_V(q) admits an immediate winning response in M_A(v(q)).

Since E_A is a subset of M_A, D_E implies D_1. A defender stop with no winning endpoint response refutes D_E, but does not refute D_1: an interior attacker stop may win. Neither statement settles longer-horizon play. Moreover, checking only a sampled subset of defender moves proves neither universal statement.

Use labels such as “endpoint-response counterexample found”, “no counterexample on sampled grid”, and “budget exhausted”. Do not relabel the first as a full-game escape or the second as certified dead. Record the actual response family and horizon.

## Does epsilon alter coverage or the physical map?

If epsilon changes only mark selection, all applySwing calls and commanded deltas stay unchanged, and inspections restore ALL state, then the underlying simulated trajectory is unchanged. Candidate selection and search policy still change. Accepting an earlier mark resets lastMark and can shift later marks; the observed lost witness demonstrates that this is not simply extra coverage.

The 1e-9-radian comparison tolerance is an engineering choice, not a derived uniform floating-error bound. An integer-index mark schedule could avoid cumulative threshold shifts, but is a separate candidate-policy change requiring measurement. Mark actually reached states and preserve the intended call schedule.

The finite engine map depends on its call subdivision. One-degree calls plus a final partial call and repeated quarter-degree calls need separate records. Nominal stop angle alone does not identify the computed state. An all-reply theorem must name its input protocol; covering arbitrary call schedules would be an additional obligation.

## Request for reply-band maps

Yes: produce maps first for the ORIGINAL Brief 6 seed, defender piece 0:

`[-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442]`

This is not the post-8-degree pose enclosed by this package. Then select ten additional frozen DEVELOPMENT families before inspecting their maps. Leave held-out families untouched.

For each of the six arms record source pin, initial pose, side/history/reset assumptions, legal/terminal limits, commanded delta sequence, actual netRad and resulting poses. Report one-degree-plus-final-partial and quarter-degree call schedules separately. At every sampled stop retain all winning endpoint arm IDs and their margins, not just a Boolean. Group consecutive sampled witnesses, bracket boundaries, and retain isolated exceptions and unresolved/budget cases.

The reported 619 stops and 170 endpoint counterexamples at the L11 post-root pose suggest a useful covering strategy; those data cannot be transferred to the Brief 6 seed. Contiguous samples propose intervals. They do not prove the intervals between them.

For a proof, construct overlapping guarded reply patches, each with at least one verified winning response and a positive uniform margin. Verify that patches cover every legal reply, including feature transitions and endpoints. Where endpoints fail, try interior attacker responses or a deeper continuation instead of forcing an endpoint-only theorem.

## Revised allocation and order

1. **Opus:** isolate the stride change, record actual old/new stop sets and include the lost 15-degree witness. Confirm inspection restores state. Preserve an unchanged baseline.
2. **Opus:** make unsupported time-budget flags fail explicitly, or label runs fixed-search. The audited --timeMs flags did not establish equal-time search; contended runtime measurements cannot support a strength claim.
3. **Opus:** port internal L17 into a main-based experimental harness with independent dense/guard/table switches. Verify agreement with the pinned research baseline before ablations. Do not renumber public difficulties.
4. **Sonnet if available, otherwise Opus:** run prescribed fixed-search/runtime smoke checks, then paired ablations with working budget enforcement and frozen family splits. Keep stride treatment identical across compared components. Implementing the new corpus loader is separate from testing the old hard-coded table.
5. **Opus:** produce the reply-band maps above. L13 and L17 already refute the original 2-degree L11 fixture; it is not an unresolved L17 regression. Root-stride decisions changed in 34/60 L11 and 32/60 L13 selected contact-heavy cases; those are policy-change diagnostics, not ordinary-play rates or Elo.
6. **GPT/Astra:** retain ownership of the uniform floating-contact argument, then use maps to guide a verified all-reply cover. Neither is completed by this replay update.

No production search patch, trainer restart or ladder strength claim is part of this update.

## Integration

PR #33 merged only through 1bd88b8aa96878bb72cc48191a6f8cf0aae06185. The later dominance and propagation commits, 76c3e2d8b and e65124f9d, require a fresh PR. This continuation carries their files forward onto main and adds replay verification and this response. Claude's task-A branch remains a separately pinned experimental result.
