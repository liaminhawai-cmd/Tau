# Defender arm (1,−): first response enclosure

1 October update: [the next enclosure](ARM1-LOCAL-THROW.md) completes the
prescribed real-model response for a nonzero 8°–8.01° band. The failed box runs
below remain part of the development record; they are no longer the furthest
completed contact propagation.

28 September 2026. **The complete one-arm winning-reply theorem remains open.**
This packet adds two continuous geometric results, one contact witness, and a
reproducible failed propagation experiment. None is a full lost-position proof.

## The statement we are trying to prove

Start from the six stored binary64 seed coordinates in `free_motion.POSE`.
The defender pins foot 1 and rotates negatively through an angle α. The existing
real-geometry exclusion leaves the attacker at its original pose. Consider
α in [2°,18°], restricting the eventual game theorem to the stops actually legal
under the selected protocol; 18° is an enclosure-domain endpoint, not a claimed
legal limit.

The proposed response pins attacker foot 0 and uses negative 3° calls. The
pinned engine subdivides each such call into eight 0.375° substeps. The first
mathematical target is its real-arithmetic analogue: at each accepted attacker
substep run the source-ordered ten-pass contact solver, then prove a strictly
positive final defender foot margin. Both leg and hub contacts, cached geometry,
branch changes and termination must be covered. There is no ko history in this
research harness. Full game history and floating execution are separate obligations.

The proposed real path runs through β=46.125°; this endpoint is supported by
the pinned diagnostic traces, not yet certified by the crossing-rule proof.
The new rim certificate removes the self-fall concern along this path, but not
the crossing-rule or terminal-throw obligations.

## New certified geometric results

The mathematical model and outward arithmetic assumptions are those of
`free_motion.py` and `interval_core.py`: real rigid rotations, real π, stored
binary64 shape constants, and 12 straight segments per curved leg. This is about
the stored seed, not an uncertainty neighbourhood of the original recorded pose.

1. **Uniform no-contact prefix.** For every α∈[2°,18°] and every β∈[0°,5.625°],
   the defender at its post-defence pose and attacker at its response pose have
   no leg–leg, hub–leg or hub–hub contact. A cover of 26 closed rectangles proves
   the entire two-angle domain, including rectangle boundaries. It is not a grid
   of successful point tests. Thus the defender has not moved during this prefix
   in the stated real contact model.
2. **Attacker rim clearance.** Throughout β∈[0°,46.125°], all three attacker feet
   have radius at most **67.16669730206605u**. The throw threshold has lower bound
   **67.16699999999999u**, leaving more than **0.0003u** clearance. The cover has
   33 closed angle intervals. This is a small safety margin, not the defender's
   much larger sampled throwing margin, and it must not be used as an engine
   rounding budget without a correspondence argument.
3. **A genuine contact obstruction.** At α=2°, β=6°, before allowing any response
   push, explicit points on attacker leg 0 segment 3 and defender leg 0 segment 4
   are at most **2.871235957610166u** apart, below the leg contact threshold lower
   bound **2.8799999999999994u**. The two point parameters are merely proposals;
   interval evaluation certifies their distance. This proves the no-push geometric
   continuation has overlapping tubes by 6°. It does not locate the exact first
   contact, nor describe the pose after the solver has corrected it.

`check_arm1_prefix.py` rechecks every numerical bound, verifies the rectangular
cover without trusting its subdivision tree, verifies rim coverage, and checks
the contact witness. A removed-cell control and a corrupted-bound control must
both be rejected. The checker shares the geometric/arithmetic evaluator with
the generator; it is not a separately implemented formal verifier.

## What the contact traces changed

`trace-arm1.js` instruments only a private in-memory engine copy, verifying the
two source hashes used by the earlier packet. The instrumented and unmodified
engines must return byte-identical poses, angles, stopping reasons and margins
for all 65 requested targets from 2° to 18° at 0.25° spacing. Targets beyond the
limit repeat the same reached endpoint; these are not 65 distinct legal states.

All traces have the same attacker path, ending at 46.125° after 123 accepted
substeps. Under these quarter-degree defender calls the observed defender limit
is 16.750000000000018°. First response contact occurs at different substeps
(16 through 88). The smallest final defender margin in this trace set is about
2.317u. These are diagnostics, not uniform bounds.

Crucially, the contact program is **not a single leg-pair map**. It uses attacker
hub versus defender leg contacts, leg pair (attacker 0, defender 0), and in part
of the range defender hub contacts and leg pair (attacker 1, defender 2).
The prior arm-2 zonotope proof excluded all those extra contacts. Reusing that
proof as-is would omit active branches here.

## Attempted full propagation and its actual failure

`reply_box_attempt.py` is an experimental conservative axis-box propagator,
not a certified solver. It enumerates segment closest-point branches, allows
contact/no-contact alternatives, processes leg and hub contacts in source order,
and holds the geometry at the start of each pass while applying corrections to
the live defender pose. Any potentially unsupported exceptional branch is
reported as unresolved. Its results are not added to the certified claims.

| Initial defender angle domain | Last completed substep | Unresolved at | Reason |
| --- | ---: | --- | --- |
| [8°,8°] | 61 | substep 62, pass index 4 | Axis-box width exceeds 0.1u |
| [8°,8.000001°] | 57 | substep 58, pass index 3 | Axis-box width exceeds 0.1u |

Even a singleton accumulates outward arithmetic uncertainty and dependency
overestimation. The 0.1u cutoff is an exploration limit, not a physical threshold
or counterexample. This demonstrates failure of this implementation/representation,
not impossibility of a proof and not instability of the actual game.

An additional engine comparison exposes the numerical distinction directly:
the floating quarter-degree defender path's 8° rotation lies outside the
ideal-rotation initial enclosure by **1.3322676295501878e-15 radians**. For each
attempt, 56 completed pre-contact rotation coordinates are therefore not
contained (112 of 354 total coordinate comparisons across the two runs).
This is expected from the different arithmetic models, but it means we cannot
call these boxes engine enclosures. We have not silently added a tolerance or
used sampled agreement as a uniform rounding argument.

## Next concrete implementation

Generalize the earlier correlation-preserving propagation to the actual contact
program: include hub–segment closest features and distinguish cached geometry
from the live lever arm within a pass. Recheck it first against a single 8°
response trace, then enclose a nonzero angle interval, then build an adaptive
cover of the defender domain. Trace regimes can guide that cover, but their
boundaries themselves need certified treatment. Crossing/stop legality and the
floating-engine connection remain explicit gates after contact propagation.

## Reproduce

From the repository root, using the same pinned engine files as the parent README:

```sh
node docs/geometry-reviews/brief6-single-reply/trace-arm1.js
python docs/geometry-reviews/brief6-single-reply/arm1_prefix.py
python docs/geometry-reviews/brief6-single-reply/check_arm1_prefix.py
python docs/geometry-reviews/brief6-single-reply/reply_box_attempt.py --suite
# Run separately after the expected unresolved exit:
python docs/geometry-reviews/brief6-single-reply/compare_arm1_engine.py
```

The final command deliberately exits 1 when the enclosure becomes unresolved.
Trace metadata records Node; experimental propagation records elapsed seconds.
The geometric certificate and checker are deterministic on the arithmetic
platform assumptions already stated. No production game or trainer code changes.
