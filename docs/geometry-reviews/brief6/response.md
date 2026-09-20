# Brief 6 response: the missing 8° reply

**20 September 2026.** The recorded small-box results reproduce on the committed
code. The missing input is **blue's reply before red's throw**. Brief 6 starts
the throw at the original dead seed; the historical example starts after blue
has moved about foot 0 in direction +1 by 8°.

The successful rotation half-width is **±0.002 degrees**, approximately
±0.0000349066 radians. The document's ±0.002-radian claim is a unit error.
Reproducing the output does not establish the proof: two concrete enclosure
defects from Brief 4 are still present and reproduce on this stack.

## Index

1. [Exact invocation](#exact-invocation)
2. [What reproduces](#what-reproduces)
3. [Why the proof is still incomplete](#why-the-proof-is-still-incomplete)
4. [Answers and documentation correction](#answers-and-documentation-correction)
5. [Sources and reproducibility](#sources-and-reproducibility)

## Exact invocation

The original seed in Brief 6 is correct:

```text
blue = (−27.3934, −36.4088, 1.2052)
red  = (−11.7593, −23.2838, 2.9442)
```

But the original throw theorem's worked example explicitly says: blue replies
with arm (0,+1) to 8°, then red throws with arm (0,−1). This sequence was also
preserved in the Brief 3 and Brief 4 reviews. Section 8's shorthand reference
to the seed omits the intermediate pose, making the current reproduction
instructions misleading.

The historical full-precision **post-reply** pose is:

```text
blue = (−24.31126879077936, −37.34799285619334, 1.3448263401595464)
red  = (−11.7593, −23.2838, 2.9442)
```

All pose angles above are radians. Starting from the seed and making eight
one-degree `applySwing` calls with blue pinned at foot 0 recovers this pose
to a maximum coordinate difference of 3.56×10⁻¹⁴. The red piece has not moved.
The full replay and its coordinates are in [results.json](results.json).

From the pinned repository root, these invocations recover the output:

```sh
export POSE=-24.31126879077936,-37.34799285619334,1.3448263401595464,-11.7593,-23.2838,2.9442

# Section 8: red about foot 0, clockwise; test blue foot 1.
node nn/throw-cert.js 1 0 -1 1 0.0002 0.0002 0.002 --engine --validate 200

# Section 9: red about foot 2, clockwise; test blue foot 1.
node nn/throw-cert.js 1 2 -1 1 0.0002 0.0002 0.002 --engine --validate 200
```

The final positional argument is `hRotDeg`. It describes uncertainty around
the post-reply victim pose; it is not the victim's reply angle. Red's initial
pose is fixed in these tests. This is a throw test from one particular reply,
not a proof covering every legal reply from the original seed.

## What reproduces

All runs below use the unmodified checker on research snapshot
`431f13129d57fb41dd17e0844b3bd55624e2c3b4`.

| Starting pose | Rotation half-width | Red arm | Centre first thrown | Checker result |
| --- | --- | --- | ---: | --- |
| Original seed | 0.002° | (0,−1) | k98 | Refuses at k47 |
| Original seed | 0.002° | (2,−1) | k118 | `CERTIFIED`, k118, bound 67.1975u |
| **After blue's 8° reply** | **0.002°** | **(0,−1)** | **k84** | **`CERTIFIED`, k85, bound 67.192689u** |
| **After blue's 8° reply** | **0.002°** | **(2,−1)** | **k112** | **`CERTIFIED`, k112, bound 67.204663u** |
| After blue's 8° reply | 0.002 rad | (0,−1) | k84 | Exception at k11: `post` is null |
| After blue's 8° reply | 0.002 rad | (2,−1) | k112 | Refuses at k78: contact point not localised |

The first two rows reproduce Brief 6's observations. The next two recover
sections 8–9's rounded values, **67.193u and 67.205u**. Substeps are exactly
⅓°, so k85 is 28.333…° and k112 is 37.333…°. Both poses happen to give the
same attacker arm limits, 46° and 110⅓°; matching those limits did not verify
that the victim's starting pose was the same.

For the radian rows, the CLI argument was `0.002*180/Math.PI`, approximately
0.114591559 degrees. The rotational width ratio is 180/π ≈ 57.296. Only that
axis changes; the translation half-widths stay at 0.0002u. The exception is a
checker/reporting failure, not evidence that a victim escaped.

For both post-reply degree-box runs, `--engine` agrees with the replica's
continued final pose to six decimals. Each `--validate 200` run accepted 200
sampled poses, found all 200 thrown, and reported zero containment violations.
These are finite diagnostics, not universal bounds. In particular, the
validator checks recorded axis-aligned enclosures and the final parallelotope;
it is not an independent proof of each intermediate correlated enclosure.
The full-sweep comparison continues geometry beyond the first throw and should
not be described as additional legal gameplay.

## Why the proof is still incomplete

The current `throw-cert.js` blob is
`b8fb4c6f3bc69beedd8b8973e96994d65dc2c96a`: **identical to the checker audited
in Brief 4**. The contact-law dependency has changed since that audit, so I
repeated the relevant diagnostics on the current stack rather than assuming
their numerical results carried over.

### The park Jacobian selects the wrong chord

`parkJacobian()` chooses an attacker segment with:

```js
segClosest3(A[a], A[a + 1], p, p)
```

In this implementation the degenerate second segment makes the selector use
the first segment's start instead of the perpendicular projection. At the
reproduced post-reply trajectory, the selector chooses chord 2, while the
correct point-to-segment projection is on chord 1. This holds at all six
checked steps: 74, 79, 80, 84, 85 and 95. The point-first diagnostic call is:

```js
segClosest3(p, p, A[a], A[a + 1])
```

A Jacobian for the wrong chord is not a justified derivative enclosure for
the actual contact map. Lohner-style coordinate changes can reduce enclosure
growth, but they require valid derivative and remainder bounds.

### The carried-frame identity omits a term

Let a꜀ be the current centre push direction, m₃ the third column of the carried
basis, B the direction Jacobian, Λ꜀ the centre push magnitude, and
N = Id + Λ꜀B. With λ the variation in push magnitude, the implementation uses

```text
λa꜀ = λNm₃ − λΛ꜀Bm₃.
```

The right side simplifies to λm₃. It equals λa꜀ only if the carried column
still equals the current push direction. The diagnostic measures a maximum
scaled discrepancy ‖m₃−a꜀‖ of **0.39458034** before the reported certificate.
The correct identity is

```text
λa꜀ = λNm₃ + λ(a꜀−m₃−Λ꜀Bm₃).
```

The missing contribution is λ(a꜀−m₃). A small sample finding no violation
does not remove this algebraic obligation. The nonlinear fallback also needs
to respect the coordinates of the current direction in the carried frame.

Both findings are recorded in [audit.json](audit.json). These are defects in
the proposed proof, **not exhibited escaping poses**. Brief 4 additionally
explains the need to cover every reachable contact transition, internal solver
correction and finite-pass residual. Fixing the two displayed expressions
alone does not complete all of those obligations.

## Answers and documentation correction

1. **Does an invocation reproduce sections 8–9?** Yes: use the post-8°-reply
   pose and the two commands above. The outputs agree at the precision relevant
   to the claimed 67.193u and 67.205u values.
2. **Do the discrepancies imply an uncommitted code state?** No. The current
   committed stack reproduces the numbers. No historical guard change is
   needed to explain this mismatch; the input pose was different.
3. **Is “0.002 rad” a unit slip?** Yes for these successful reproductions:
   the accepted CLI width is 0.002°. The 0.002-radian runs fail as shown.
4. **Is the enclosure argument sound?** It is not established as written.
   The wrong chord derivative and missing carried-frame term remain concrete
   defects. Reproduced `CERTIFIED` output must not be promoted to an enclosure
   theorem on the strength of the validator alone.

A replacement summary for the source document is:

> After blue's (foot 0, +1) reply to 8° from `ndpxhts24`, the current checker
> returns `CERTIFIED` for victim half-widths ±0.0002u in x and y and ±0.002°
> in rotation. Red's foot-0 arm returns k85 with radius bound 67.192689u;
> its foot-2 arm returns k112 with bound 67.204663u. These outputs reproduce,
> but the enclosure proof remains incomplete because of the park-Jacobian
> chord selection and carried-frame remainder defects documented in Brief 4
> and rechecked in Brief 6.

This is proposed replacement wording, not a claim that the experimental
branch's document has already been edited. The next proof task is to repair
the enclosure and re-establish its obligations; the reproduction mystery is
resolved.

## Sources and reproducibility

- [Current checker and source document](https://github.com/liaminhawai-cmd/Tau/tree/431f13129d57fb41dd17e0844b3bd55624e2c3b4/nn), pinned to `431f13129d57fb41dd17e0844b3bd55624e2c3b4`.
- [Original throw theorem](../../project-context/inputs/throw-theorem.md), worked example: blue (0,+1), 8°, then red (0,−1).
- [Brief 3](../brief3/tau-vertex-dwell-review.md) and [Brief 4](../brief4/tau-box-size-review.md), which preserve the intermediate pose and distinguish output from proof.
- [Manifest](source-manifest.json), [commands and setup](README.md), [CLI runs](results.json), and [current diagnostic](audit.json).

At PR #8 branch head `9c2919b95910d6460df7117b881c5c1fcaea7fac`, the checker,
contact-law and lemma document blobs match this research snapshot; the index
differs. The runs recorded here use the fully pinned research snapshot,
not an inferred mixture of branch files. All seven restored source blobs
were verified before publication.
