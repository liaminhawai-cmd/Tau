# Target 1 — Taylor-model counter-response cover

Target 1 is the mined seed from record line 176, with blue first to move. The blue move family currently addressed is pivot 2, direction +. The fixed seed and original witness setup are in `problems/target1.json`.

## Initial diagnostic

A single broad interval `[2.4°,2.6°]` refused because a Taylor-model square-root enclosure crossed zero. That was an over-wide enclosure, not evidence that the physical move itself was illegal. Adaptive interval subdivision then produced the covers below.

## Response cover

The current per-cell result is summarized in [REPLY-COVER-MAP.md](REPLY-COVER-MAP.md):

- [2°, 9.6828°]: red response (pivot 0, direction −), 120 substeps; 427 accepted cells.
- [9.6828°, 9.73°]: same red response; 2 accepted cells.
- [9.73°, 14.33°]: red response (pivot 2, direction +), 36 substeps; 51 accepted cells.

Across these intervals there are 480 accepted cells with positive recorded Taylor-model throw margins. The smallest is 0.097729u in the upper interval. The intervals join at both shared boundaries, so the current cover has no angular gap within [2°,14.33°] for this blue move family.

## Saved certificate files

- Lower interval: `arm_2_p/cover_2_9.6828_d4.json` (being regenerated as part of the full certificate-bundle job); the recorded cover has 427 accepted cells and no failed leaves.
- Middle gap: [arm_2_p/cover_9.6828_9.73_d4.json](arm_2_p/cover_9.6828_9.73_d4.json), with [audit summary](angle-gap-audit.json) and [closure record](angle-gap-closure.json).
- Upper interval: [target1-red2plus per-cell cover](../target1-red2plus/arm_2_p/cover_9.73_14.33_d4.json), with the saved audit and closure summaries.
- The full interval-by-interval picture is [REPLY-COVER-MAP.md](REPLY-COVER-MAP.md).

## Claim boundary

This is a counter-response cover for one blue arm, not a proof that the starting position is dead against every legal Blue move. The accepted cells are intended as interval proof objects under the soundness of the Taylor-model remainder and arithmetic operations. Cell-wise comparison with the shipped engine samples several angles per cell; that is useful consistency evidence, not proof of all floating-point executions. The other blue arms and the formal soundness argument remain necessary for the full theorem.
