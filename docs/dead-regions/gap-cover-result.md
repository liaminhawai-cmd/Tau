# The 136 unresolved gaps, covered

`nn/forced-win.js` refused 136 of 1,306 screened seeds for one reason: *"no single
arc certifies the gap ... the throw changes arm here."* Brief 5's region criterion
says that is the wrong demand — cover the victim's replies with finitely many
patches, each carrying its own verified winning response, and let overlap happen.

Run at 25 fixed stops per gap, 1-degree calls plus a final remainder:

| outcome | count |
| --- | --- |
| **covered** | **135 / 136** |
| of which one arm covers the whole gap | **135** |
| patches needed | **1**, in every covered case |
| gap genuinely uncovered | 1 |
| victim's reply throws the attacker | 0 |

**The refusal was the method's, not the positions'.** In 135 of 136 cases a single
attacker arm throws at every sampled stop across the whole gap. No case needed two
patches; none was an escape by the victim's own reply.

The covering arm is position-dependent, not universal — `(0,+1)` 54, `(0,−1)` 42,
`(1,+1)` 24, `(1,−1)` 7, `(2,+1)` 6, `(2,−1)` 2 — which is what a real cover should
look like. Gap widths: 130 at 0.4°, 4 degenerate at 0.0°, 1 at 0.3°.

## The one genuine hole

```
game  vu7lnb1mw-0     mover 1 (red to move)
pose  [-18.076, -18.5681, -2.6427, -30.9263, -23.3577, -2.6736]
reply (0,+1), gap 2.8-3.2 deg
```

It fails at the **first** sampled stop, 2.8°, not somewhere in the middle: no
attacker arm throws there at all. This is the one position in the set where the
single-arc refusal may have been right, and it is the most interesting seed here —
either a real escape, or the place where the sampling is too coarse to see the win.
It deserves a dense probe before anything else.

## What this does and does not establish

It **does** settle that 135 of the 136 refusals were hiding an arm change rather
than an escape, and it identifies exactly one that is not.

It **does not** make those 135 positions proved dead. This is 25 samples over a
0.4° interval — about one per 0.017°, fine against the engine's 0.4° substep, but
still sampling. Proof needs the endpoint margins and enclosure bounds of Brief 5
section 5, and those 135 also each need their other five arms' full legal ranges
carried the same way before the position itself is certified.

## Why the cover rule's bar is flat, not a Lipschitz allowance

The single-arc rule that refused these 136 uses a *Lipschitz allowance*: the margin
has to clear `max(1, 3 × |Δm| / d) × d / 2`, a requirement that scales with the
sample spacing `d`, so a finer grid earns a smaller bar. The obvious next move was
to apply the same allowance inside the cover, at the cover's own ~13× finer spacing.

**That would have been false rigour, and it is not what the rule does.** Every gap
that reaches the cover has already been halved by the subdivision loop until it is
at most 1.5 engine substeps wide, and measured across all 136 it is one substep or
less — 131 at exactly 0.4°, one at 0.3°, four degenerate at 0.0°, none wider. The
cover's 13 samples therefore sit about 0.03° apart, **twelve times finer than the
integrator's own step**. Scaling an allowance to that spacing divides the
requirement by twelve on a separation the physics cannot resolve: a smaller number
that means less, not more.

So `COVER_BAR` is `PROBE_BAR`, flat, and the cover sits in the same tier as the
sliver and the engine probe — the two rules already in `forced-win.js` that are
explicitly *relative to the engine's resolution* and say so. A cover asserts "one
arm throws robustly at every sub-substep sample we can ask for", not a theorem
about the interval, and `covers` is counted separately from `slivers` and
`probedSlivers` so a certificate always says how it was obtained.

Reproduce: `node nn/gap-cover.js docs/dead-regions/screened-not-dead.jsonl out.jsonl 25`
