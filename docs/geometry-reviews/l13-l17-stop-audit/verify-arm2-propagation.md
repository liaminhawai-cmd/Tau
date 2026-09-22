# Independent replay of the composed arm-2 throw enclosure

21 September 2026. An independent re-run of
[`docs/geometry-reviews/arm2-propagation`](../arm2-propagation/README.md) at
`codex/l11-stop-audit` `e65124f9d`, on a different machine and a different Node runtime. This is
the "independent numerical replay" half of the Opus lane; it checks reproducibility and the package's
own consistency gates. It does not review the mathematics of the zonotope propagation.

## Result: the package reproduces

The pinned source resolves. `contact-map/source-loader.js` verifies six blobs; all six match
`claude/board-game-video-adaptation-cf8a93` (`index.html` `c79872b8f`, `nn/engine.js` `e7d333a50`,
`nn/contact-law.js` `b9c7860e8`, `nn/forced-win.js` `999af955e`, `nn/opening.js` `4dba6585c`,
`nn/throw-cert.js` `e321f0ab7`). Worth recording in both lanes: **the geometry proof and internal
L17 are pinned to the same revision, and it is not `main`.**

Running the README's documented chain end to end reproduces every headline number exactly:

| Claim | Archived | This replay |
| --- | --- | --- |
| `completedCorrections` | 380 | 380 |
| `failure` | `None` | `None` |
| `finalExposedFootRadiusLower` | 67.20213881297005u | 67.20213881297005u |
| `edgeUpper` | 67.16700000000002u | 67.16700000000002u |
| `clearanceLower` | 0.03513881297003251u | 0.03513881297003251u |
| `maxEnclosureMassRadius` | 0.006219371650946094u | 0.006219371650946094u |
| `maxFeatureBranches` | 3 | 3 |
| contact exclusions checked | 454, no failure | 454, no failure |
| min other-leg / hub-leg / hub-hub distance | 2.9054727690578344 / 7.3492798384006015 / 18.85038002015257 | identical |
| engine cases / substep containment checks / failures | 41 / 4592 / none | 41 / 4592 / none |
| `minFinalFootRadius` | 67.2130762624424u | 67.2130762624424u |
| `maxScaledAttackerPoseDifference` | 1.7435608512528234e-13 | 1.7435608512528234e-13 |

`summarize.py`'s assertions all pass on the regenerated chain.

Across the whole ~31,800-line package the **only** lines that differ are two `seconds` timing
fields, one `runtime` string, and the SHA-256 digests that those three lines change. Every numeric
result is bit-identical.

## What this adds: one of the package's own open obligations is now partly discharged

The README lists as open: *"Portability of that path to other runtimes ... [is] not established
here"* and *"The recorded attacker path already comes from the pinned engine; other-runtime
portability is separate."*

`engine-attacker-path.json` records all 112 attacker poses. Regenerating it here changed **exactly
one line** — `"runtime": "v24.19.0"` → `"runtime": "v22.22.2"`. All 112 poses, x, y and rotation,
are identical to the last bit on a different Node major version and a different machine.

That is two runtimes, not a bound, so it is **not** the uniform floating-point correspondence proof
the README asks for in obligation 1. It is a previously-unestablished data point on the portability
question specifically, and it removes "the path might be a v24 artefact" as a live worry.

## Two small things to pass back

1. **`seconds` is inside the hashed payload.** `summarize.py` asserts that `contact-exclusions.json`
   and `engine-check.json` carry the SHA-256 of `propagation-1.0.json`, and that file embeds its own
   elapsed time. So the hash changes on every regeneration, and an independent replayer cannot run
   `summarize.py` against the *archived* artifacts at all — they must regenerate the whole chain,
   and then they are checking their own run's self-consistency rather than the archive's. Hashing a
   canonical form with timing stripped would make the committed package verifiable as committed.
   (This cost one confused pass here; the README's note that "elapsed-time fields may differ" warns
   about the symptom but not that it breaks the gate.)

2. **The substep schedule is the same finite-map hazard the search audit ran into.** The path is 37
   one-degree calls plus a final third-degree call, and `|netRad|` is accumulated through
   `applySwing`'s substep loop, so after *k* calls it is not exactly *k*°. The package is already
   safe here, because it takes the **recorded** poses as its real inputs rather than nominal angles
   — and its own `maxScaledAttackerPoseDifference` of 1.74e-13 is exactly the size of that gap. The
   caution is only for any future step that reasons about the nominal angle instead. The same class
   of defect, at one ULP, silently drops 20.7% of the marks in the shipped dense stop grid; see
   [README.md](README.md).

## On the all-reply obligation

Obligation 2 — "cover every legal defender stop" — is where this lane has measurements, though at a
**different position** (the L11 stop audit's post-root pose, not the Brief 6 post-8°-reply pose), so
what follows is a remark about shape, not transferable data.

At that position the defender's reachable stops number **619 at 0.25° resolution across six arms**,
and the set that escapes a one-ply punishment is **170 of them, arranged in contiguous bands**:
2°–20.5° on one arm, 2°–18° on another, 10°–14.75°, 2°–5°, and two arms with no escape at all. Only
two isolated gaps interrupt those bands.

If that banding is typical, the all-reply obligation is a covering problem over a handful of
intervals per arm rather than an enumeration over hundreds of points, which is the difference
between tractable and not. Whether it is typical is not established — it is one position — but it is
cheap to test on more, and this lane can produce those maps on request.

## Reproducing

From `docs/geometry-reviews/arm2-propagation/`, with `$PINNED` a checkout whose six blobs
`source-loader.js` accepts:

    node ../contact-map/trace.js $PINNED
    python3 propagate.py ../contact-map/trace.json
    node engine-check.js $PINNED
    python3 propagate.py ../contact-map/trace.json 1 engine-attacker-path.json
    python3 check_contacts.py ../contact-map/trace.json propagation-1.0.json
    node engine-check.js $PINNED
    python3 summarize.py

Run here on Node v22.22.2 and Python 3.11.15; the archive was produced on Node v24.19.0. Whole chain
under 15 seconds.

## Addendum, 22 September 2026 — the disturbance/robustness result

`codex/arm2-replay-continuation` `62cb75ac2` ("Bound per-pass disturbance tolerance for the arm-2
throw") adds a conditional robustness result on top of the propagation package verified above:
survives an arbitrary **1e-8u disturbance per mass coordinate at every one of the 380 passes**
(inactive passes included), retaining a final exposed-foot radius lower bound of
**67.19296212818695u** against the same 67.16700000000002u edge — clearance **0.025962128186932883u**.

Reproduced independently (fresh `trace.json`, same pinned checkout as before):

| Run | Passes | Clearance lower (u) | Match |
| --- | ---: | ---: | --- |
| Zero disturbance (robustness wrapper) | 380 | 0.030356860428611295 | exact |
| 1e-8 per coordinate/pass | 380 | 0.025962128186932883 | exact |
| 1e-7 per coordinate/pass | — | `conditionalSuccess: false`, negative clearance | matches "not a completed throw bound" |
| `check_budget.py` | — | `localEuclideanErrorUpper: 1.9735434015526995e-09` | exact, matches the "less than 2e-9u" claim |

Also reproduced exactly: `minimumGradientLower: 1.163218842254502` and
`maximumPenetrationUpper: 0.14481296702833737` at the 1e-8 disturbance level, both cited directly in
the sharper local error lemma's worked example (`m=1.16`, `p_+<=0.15`).

Not independently re-derived here: the inversion-identity proof, the local error lemma itself, or
the "IF a runtime proof establishes delta/eta/rho <= 1e-9" conditional — those are the mathematical
content the document explicitly flags as not yet closed (geometry/closest-point error, branch
selection, pruning guards, early solver exit, terminal correspondence). This addendum verifies the
numbers the document reports, not the argument connecting them to the engine's actual arithmetic.
