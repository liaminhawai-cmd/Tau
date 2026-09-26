# Brief 6: single-reply proof attempt

26 September 2026. This continues the corrected reply maps at
`aa02f0b51b0d4c08da34fc5cf868cecbeda63b2b`.

**The lost-position theorem is still open.** This packet independently reproduces
the corrected map, tests a larger finite set of defender stops, and establishes
two continuous real-geometry contact exclusions. It does not certify the
attacker's winning response over all defender stops.

## Reproduction and new diagnostics

The source is the L11 audit pin `ce0e61d1e7482e3d1252aadadf97bd4269f71e29`:

- `index.html` SHA256: `3cee71df1f26afd79cbbc83a5c208780e29e170cd7111fabaafb4ab75bc479c4`
- `nn/engine.js` SHA256: `106b90e0a6981c817c2789f88b175a546f9a7fc229af20f50218495533af443e`

The corrected mapper was independently executed on Node v24.19.0. Its complete
Brief 6 output has Git blob hash `aab13991d35579ce94eb60261bd6f33cae939818`,
identical to the committed output: 156 and 603 punished stops, no endpoint
counterexamples, for the one-degree and quarter-degree sweeps respectively.

The new probe plays each requested defender target from a fresh initial state,
using a repeated command pattern and a final residual command. Targets are
spaced by 0.125 degrees, starting at 2 degrees, plus the pattern's observed arm
endpoint. It then plays attacker reply (0,-) with three-degree calls until the
engine stops it. Each reply begins in a fresh engine game with the actual
post-defence pose; no hypothetical reply can alter the defender's sweep.

| Defender command pattern, degrees | Legal sampled trials | Failed replies | Smallest final throw margin, u |
| --- | ---: | ---: | ---: |
| 0.25 | 1,192 | 0 | 2.183135619580753 |
| 1 | 1,191 | 0 | 2.183865074040696 |
| 3 | 1,189 | 0 | 2.187082424693827 |
| 0.17, 0.83, 1.7, 2.9 repeated | 1,189 | 0 | 2.183202134600279 |

There are **4,761 legal sampled trials**, with no terminal defender wins and no
illegal or non-winning attacker replies. These are trial counts, not claimed
distinct states or independent statistical observations. Targets that hit a
limit early are reported at their actually reached angle. Every arm's weakest
trial records the complete defender command sequence, both resulting poses,
the reply angle and the limit reason.

The overall minimum is on defender arm (0,-), target 8.375 degrees. The original
603-stop grid's minimum was approximately 2.204276u at 8.5 degrees. The extra
samples improve the empirical minimum; they do not establish a uniform lower
bound. The margin is the defender's final maximum foot radius minus
`CFG.edgeU + CFG.edgeEps`, not a maximum transient radius during the reply.

## Continuous real-geometry results

`free_motion.py` uses outward interval arithmetic and Taylor bounds for sin/cos.
It encloses real rigid rotations of the original defender pose about its
original pivot foot. The geometry uses 12 straight segments per quarter-circle
leg, radius/height 23.095, leg tube radius 1.44 and hub radius 1.9 times that.
The numerical seed coordinates and shape constants are treated as their exact
binary64 values; the trigonometric formulas use real pi enclosed by `PI`.

This is a claim about `ndpxhts24` **as stored**, not about an uncertainty box
around the unrounded original position. The initial leg clearance on arm (1,-)
is only about 1.3e-4u. Rounding a rotation to four decimal places can hide
5e-5 radians, or about 1.15e-3u at a foot, before accounting for coordinate
rounding. No tolerance for that recording uncertainty is included in this
certificate; extending it to the original trajectory requires a separate bound.

All nine leg-pair distances, six hub-leg distances and the hub-hub distance are
bounded throughout every accepted angle cell. The cells are checked to form a
contiguous cover, with shared endpoints and no gaps.

| Defender arm | Angle domain | Attacker assumption | Cells | Leg distance lower, u | Hub-leg lower, u | Hub-hub lower, u |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| (1,-) | 0 to 18 degrees | Original attacker pose, fixed | 15 | 2.88000586364327 | 6.500950166640525 | 20.412950033530652 |
| (2,-) | 2 to 16 degrees | Any fixed pose in the box below | 46 | 2.8814935987643704 | 4.212925981092005 | 14.00707194314844 |

Every bound strictly exceeds its corresponding contact threshold (approximately
2.88, 4.176 and 5.472u). Thus there is **no contact anywhere in these specified
real-geometry families**. For arm (1,-), this proves that the real contact model
leaves the attacker at its original pose throughout the stated rotation.

The arm (2,-) result is conditional on the attacker already lying in:

```
x   in [-11.762, -11.760]
y   in [-23.279, -23.276]
rot in [2.9440, 2.9441] radians
```

It does not prove that the initial push puts the attacker into that box for
every input schedule. The recorded one-degree and quarter-degree attacker
poses at the first legal stop are in this box, but that is only a membership
check for those runs. Arm (2,-) must not be called contact-free from the seed:
it moves the attacker slightly before 2 degrees, with a different resulting
pose under each schedule. Trying to certify it from zero with the original
attacker pose becomes unresolved around 0.0103 degrees. That failed enclosure
alone is not a contact witness; the engine's nonzero displacement supplies the
separate diagnostic evidence.

These domains include the corresponding stops in the corrected maps. Their
endpoints are chosen geometric domains, not certified legal-move limits for
arbitrary command schedules. No floating-engine correspondence is claimed.

### Why the exclusion bound is valid

Each interval vertex encloses its real position throughout an angle cell.
Every point of a segment is a convex combination of its endpoints. Axis-aligned
endpoint hulls therefore bound the entire segment and give an elementary
distance lower bound.

Where that is too loose, the checker proposes a finite normal n from approximate
closest points. It then computes both segments' endpoint projections with
outward intervals. If their projection ranges are separated by at least s,
every point pair has distance at least s/||n|| by Cauchy-Schwarz. The divisor is
bounded upward. The normal can be any nonzero finite vector: the approximate
closest-point routine is a proposal mechanism, not a trusted minimizer.
Subdividing the angle cell tightens the vertex boxes. Failure to find a
separating projection returns unresolved rather than asserting contact or
non-contact.

The independent Node v22.22.2 / Python 3.11.15 replay reported identical probe
numbers (apart from the Node version field) and the same 61 certified cells,
but exposed a byte-reproducibility bug: Python 3.12 changed floating `sum()`
to compensated summation. The approximate proposal dot products now use
explicit left-to-right addition, and `free-motion.json` has been regenerated.
The verifier includes a cancellation regression. This change affects the
proposed separating axes and numerical bounds, not the separating-axis
argument or the outward interval arithmetic, whose sums operate on `V` objects.

`interval_core.py` is copied from the prior propagation package, Git blob
`9dbd3027d5e78ed3ce60bee08622aad6ae6a495a`, with no arithmetic changes. Its
assumptions are binary64 outward rounding via nextafter and correctly rounded
basic arithmetic/sqrt on the checking platform. Sin/cos are bounded by Taylor
polynomials rather than trusted libm evaluations.

## What the full theorem still needs

The proposed statement must first fix the legal rules/history and command
protocol. For every legal defender move under that protocol, the reply policy
"pin attacker foot 0 and apply negative three-degree commands to the natural
limit" must remain legal and end with a defender foot strictly outside the rim.

1. **Reachable defender families.** Cover every legal stop, including boundaries
   and final partial commands. A nominal angle does not determine a floating
   engine state across different calling schedules. Covering arbitrary human
   input schedules is a larger obligation than one chosen protocol.
2. **Both-piece propagation.** On four arms the attacker varies across the
   sampled defender stops; on (0,-) its y coordinate spans almost 5u. On (2,-)
   the short initial push also depends on the command schedule. The two
   exclusions above simplify parts of this step but do not solve it generally.
3. **Uniform response enclosure.** Carry each reached family through the full
   (0,-) response. Include changing closest features, competing contact pairs,
   cached geometry within a solver pass, crossing/stop decisions and exceptional
   correction branches. A local derivative bound for one branch does not cover
   a branch switch automatically.
4. **Terminal and numerical correspondence.** Prove a uniform positive final
   foot margin, legal attacker motion and correspondence to the specified
   floating engine. The previous 0.035u arm-2 enclosure used another attacker
   pivot, one post-defence box and fixed recorded attacker poses; its theorem
   cannot be transferred to this response by substituting the larger sampled
   margin.

On a continuously covered, uniform quarter-degree grid with genuine certified
sample lower bound m, a certified Lipschitz constant L would suffice if
`L * 0.125 degrees < m`, with separate treatment of domain tails. Substituting
the observed 2.204276u would suggest about 17.6342u/degree, but **neither that
sample number nor a suitable uniform L has been certified here**. Measured
finite differences cannot fill that gap, and command/feature branches may
require a cover of separate maps rather than one global smoothness argument.

## Reproduce

From a checkout of this branch whose engine files match the hashes above:

```
node docs/geometry-reviews/l13-l17-stop-audit/reply-band-maps/map-position.js --pose '-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442' --label brief6-seed --json /tmp/brief6.json
bash docs/geometry-reviews/brief6-single-reply/regenerate.sh
python docs/geometry-reviews/brief6-single-reply/check_free_motion.py
```

For a byte-identical mapper archive, set `TAU_SOURCE_REV` to the full audit pin
above. `TAU_ROOT` can point to a separate extraction of the pinned engine. The
new probe refuses mismatching source hashes. `regenerate.sh` writes the four
diagnostic outputs and recomputes the continuous exclusion certificate. The
negative arm-2 experiment is available with `python free_motion.py
--test-unshifted-arm2` and intentionally exits nonzero.

No production physics, ladder behavior, trainer or medal policy is changed.
