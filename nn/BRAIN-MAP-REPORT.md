# Does Tau have fractal depth? — what the danger maps actually say

A danger map is what you get when you freeze one piece, walk the other piece's hub over
every point on the board, and ask a value net "how good is this for me?" at each point.
Small nets draw something smooth and ring-shaped. Big nets draw something visibly rougher.
The question was whether that roughness is real positional nuance or just noise.

Short answer: **it is not noise, but it is also not the game's fractal depth. Most of the
roughness comes from the way positions are encoded before the net ever sees them.**

---

## What was measured

Ten nets spanning a 108x capacity range, from `scratch-010` (19k weights) up to `best`,
`gold` and `silver` (2.06M each), plus the engine's own hand-written L11 evaluator as a
reference, plus two untrained nets as a control. Every one swept over the same board from
the same position (one swing in from the opening), at 1024x1024, so the maps are directly
comparable. Then 1-D scan lines at much finer spacing to see what happens at small scales.

Three things were measured: how rough each map is and at what size, whether separately
trained nets agree on the fine detail, and whether that detail changes how the net plays.

---

## Finding 1 — none of the maps contain noise

If a map were noisy, neighbouring cells would disagree at random, and that shows up as a
"floor" in the roughness statistic that survives no matter how close together you look.

Every single map had a floor of exactly zero. There is no random jitter anywhere in the
ladder. Whatever the big nets are drawing, they are drawing it deliberately and would draw
the same thing again.

---

## Finding 2 — the roughness doesn't come from the nets

This is the surprising one.

Roughness has a standard exponent: 2 means a smooth surface, 1 means a surface full of
sudden steps, 0 means pure hash. Measured down to 0.0015 board units — about 540x finer
than the distance at which the game's own rules stop distinguishing two positions:

```
                        0.0015u  0.004u   0.01u   0.03u   0.08u    0.2u
  engine L11 (no net)      0.96    0.96    0.90    0.97    0.95    1.10
  scratch-010 (19k)        0.85    0.85    0.60    0.81    0.91    1.03
  UNTRAINED net            1.01    1.01    1.03    1.08    1.00    0.92
  ultra-m4-343 (280k)      1.02    1.02    1.05    1.13    1.28    1.22
  best (2.06M)             0.98    0.98    0.97    1.03    1.05    1.29
  gold (2.06M)             0.86    0.86    0.62    0.87    1.03    1.41
```

A net that has never been trained is exactly as rough as a 2-million-weight champion, and
so is the hand-written evaluator that contains no net at all. That cannot be something the
nets learned.

Measuring the raw feature vector — the 94 numbers `features.js` hands the net — explains it:

```
                        0.0015u  0.004u   0.01u   0.03u   0.08u    0.2u
  the whole vector         1.00    1.00    1.01    1.02    1.05    1.10
    block A (geometry)     1.00    1.00    1.00    1.01    1.04    1.10
    block B (line dists)   2.00    2.00    2.00    1.99    1.96    1.91
    block C (swing caps)   1.00    1.00    1.01    1.02    0.98    0.83
    block D (L11 terms)    1.00    1.00    1.01    1.03    1.08    1.19
```

Block B is the only smooth one, and it is the only block built purely from `min()` over
continuous distances. Every other block contains something that jumps: the mirror flip in
block A, the pivot-swap in block C, the park counter in block D. Each of those is a place
where the encoding changes its mind abruptly as the piece slides.

**So the fractal texture is inherited from the input encoding. Every net gets it for free,
trained or not. It is a property of how we describe a position, not of the game.**

Related: roughness clusters near the printed lines (correlation -0.51 with distance to the
nearest line). That is where the rules genuinely have their discontinuities, so it is not
arbitrary — but it is the *rules'* discontinuities showing through the encoding, not a net
discovering hidden structure.

---

## Finding 3 — but the detail itself is real

Roughness is inherited. The *content* is not.

Band-pass two maps to a chosen size and correlate them. Two nets trained separately cannot
invent matching detail, so agreement at a scale means the structure at that scale is a fact
about the game rather than a quirk of one net.

```
  pair                       16u     4u    1.6u   0.81u    0.4u
  best vs gold             0.992  0.935   0.892   0.878   0.883
  best vs silver           0.995  0.941   0.901   0.892   0.899
  gold vs silver           0.998  0.978   0.959   0.957   0.961
  TWO UNTRAINED NETS      -0.516 -0.140  -0.014   0.043   0.047
```

The floor is 0.04. The three big nets sit at 0.88–0.96 all the way down through the
engine's epsilon. They are seeing the same thing, and it is really there.

They also agree with each other far more than with L11's hand-written eval (only 0.24–0.38
at the finest band). So the shared content is not just a restatement of the ladder's rules
of thumb — the nets have learned something L11 does not encode.

---

## Finding 4 — the fine detail doesn't change how they play

Real, reproducible, and apparently not load-bearing.

**Test one:** blur a net's own evaluator over a disc the size of the rules' epsilon — which
deletes everything finer than the rules can distinguish — and re-run its search. Does it
pick a different move? 200 matched position pairs, half where the net's map is rough, half
where it is smooth, matched on distance to centre, to the opponent and to the nearest line:

```
  model          params      rough    smooth   p(move)  p(angle)
  scratch-010     19037     35/200    28/200    0.349     0.021
  deep-360        35473     34/200    35/200    1.000     0.553
  ultra-m4-343   279505     37/200    23/200    0.065     0.114
  best          2058361     21/200    13/200    0.215     0.265
  gold          2058361     35/200    32/200    0.775     0.063
```

Blurring changes the move 8–17% of the time, but no more where the map is rough than where
it is smooth. Across ten tests the best p-value is 0.021, which corrects to 0.21. Nothing.

**Test two:** actual games. `deep-360` has the highest measured roughness of any net here —
higher than `best` — and `scratch-010` the lowest. 600 games from rough regions of
deep-360's own map, 600 from smooth regions, colours balanced, temperature 0:

```
  ROUGH  positions:  311-289  = 51.8%   (+13 +/- 28 Elo)
  SMOOTH positions:  338-262  = 56.3%   (+44 +/- 29 Elo)
```

The rough net does *worse* where its own map is rough. Not significantly (p 0.12–0.27), so
this is not a real reversal — but it is certainly not the predicted win. The likely reason
is mundane: rough spots are near lines, near-line positions are tactically sharp, and sharp
positions compress whatever skill gap exists.

---

## What this says about the game

1. **Tau's evaluation landscape is genuinely step-like, not smooth.** Slide a piece a
   hair's breadth and the value can jump. That is real and it comes from the rules — feet
   cross lines, pivots swap, parks engage. The fractal look in the visualiser is a faithful
   picture of that.

2. **But the step-like-ness is not depth.** It is the same at every capacity and it is
   there before any learning happens. A bigger net does not find a finer layer of structure;
   it finds a *bigger-amplitude* version of the same structure. Untrained nets have output
   ranges of 0.09–0.14; trained ones 0.59–0.72. Capacity buys loudness, not resolution.

3. **What the big nets actually have is agreement.** Three independently trained 2M nets
   converge on the same fine structure, and that structure is not in L11's rulebook. That is
   the real finding — there is learnable positional content beyond the hand-written eval.

4. **Almost none of it is below the rules' resolution.** Only 1.0–2.1% of any map's
   variance lives at scales finer than crossEps. The search is riding on coarse structure,
   which is why blurring the fine detail away barely changes anything.

---

## The big limitation

**Everything here is the leaf evaluator, not the player.** These maps show what a net thinks
of a position with no search at all. The nets were trained on games played at depth 1–3, and
they were measured here at depth 0.

That matters because search is where new structure would be created. A minimax tree takes
the max over many leaf values, and the surface where "which move is best" changes is itself
a new discontinuity — one that belongs to the game, not the encoding. Every extra ply adds
another layer of those switching surfaces. If Tau has genuine fractal depth, that is where
it would live, and this study did not look.

Other limits worth stating: one starting position (one swing in from the opening); the
game-level test used `deep-360` vs `scratch-010` because `best` costs ~340s per game and
600 games would be 28 hours, so it says nothing specific about the 2M nets; and the rough
regions were defined from one net's own map, so it tests that net's claim about itself.

---

## Proposed next step

Take L11 — the hand-written ladder brain, which needs no training data and so has none of
the depth-1–3 limitation — and map its *searched* evaluation at depth 1, 2, 3, 4, 5, 6 from
the same position. Same transects, same statistics.

The prediction worth testing: the depth-0 slope is ~1.0 and inherited from the encoding. If
deeper search adds real game structure, the slope should move — and the scale at which it
moves tells you how fine the game's own decision boundaries get. If it stays flat at 1.0 no
matter how deep you look, then the step-like-ness really is all encoding and Tau's value
landscape is rough but shallow.

That is the experiment that would actually answer "does this game have fractal depth",
because it removes both confounds at once: no training distribution, and search structure
instead of encoding structure.
