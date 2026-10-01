# Crossing and stopping certificate for the shared reply

2 October extension: [the completed adaptive cover](ARM1-EXPANDED-COVER.md)
reuses this crossing result on 8°–8.1°, with final-throw and ko bounds checked
in each of its 32 cells. The local-family numbers in this original packet
continue to refer to 8°–8.01°.

2 October 2026 (Australia/Sydney). **The prescribed reply passes the crossing
and stopping rules in the specified real-arithmetic model.** It spends one
crossing, never needs the corner exception, remains on the board through
46.125°, and stops before the next substep would carry its own foot off.

Combined with [the local contact enclosure](ARM1-LOCAL-THROW.md), this gives a
legal winning reply for every legal defender stop in the exact-real
8°–8.01° family defined there, conditional on that enclosure's arithmetic and
contact-model assumptions. The final lower throw margin remains above 3.261u.
This does not prove that the full defender arm or the whole position is lost,
nor establish correspondence with every floating-engine execution.

## Claim and scope

Use the stored binary64 seed and the pinned source
`ce0e61d1e7482e3d1252aadadf97bd4269f71e29`. Start a fresh attacker turn at the
original attacker pose, pin its original foot 0, and use negative 3° calls.
Each full call has eight 0.375° substeps. The real path is the same analytic
rotation used by the contact certificate: β_k = 0.375k degrees. The first 123
substeps are accepted; attempted substep 124 is rejected by the own-rim check,
before the crossing or contact program runs, and its real rotation is undone.

The crossing and own-rim argument is independent of the defender pose.
`crossingSubstep` reads only the active piece's feet and its turn state, and
`resolvePush` changes only the opponent's pose. The earlier free-motion result
keeps this attacker at its original pose throughout defender arm (1,−),
α∈[0°,18°], in the stated real model. Thus the same crossing certificate can be
reused while the contact cover is extended along that arm. This reuse does not
apply to other arms that first move the attacker into a different pose.

The winning endpoint and repetition-rule conclusion below are currently proved
only for α∈[8°,8.01°]. The seed is used **as stored**. No uncertainty in the
original four-decimal recording is included. Defender-stop legality outside
the selected protocol, and other input schedules, are not certified here.

## What the crossing function actually does on this path

All feet start clear of all four printed lines. The certified contacts at the
queried substeps are:

| Substeps | Attacker angle | Feet touching a line | Crossing counter |
| --- | --- | --- | ---: |
| 0–35 | 0°–13.125° | None | 0 |
| 36–43 | 13.5°–16.125° | Foot 1 on outer ring `r1` | 1 |
| 44–123 | 16.5°–46.125° | None | 1 |

At step 36, foot 1 enters from inside the outer ring and opens the one paid
episode. At step 44, all non-pivot feet are clear, so the episode closes.
Nothing opens another episode. The final contact and earned sets are empty;
`justCrossed` is exactly `['r1']`. These are substep event bounds, not claimed
exact continuous times of first and last magnet contact.

There are no side-arc span queries: every side-arc radial-band test is false.
There are also no corner-intersection or pending-merge distance queries. This
avoids any need to certify an unused corner construction or an `atan2` result.
The source replay raises an error if either unused rule branch is entered.

`check_arm1_crossing.js` extracts and executes the **unchanged
`crossingSubstep` function** from the pinned HTML. Its geometry helpers return
interval-certified contact sets and centreline sides. It does not run the
rules on rounded representative points, and it does not port the state machine
to Python. The source executes 982 contact-set queries and one centreline-side
query, accepting all 123 substeps. The CFG parameters are checked against the
actual pinned declaration, including `lineStick = 0`.

## Numerical bounds

`arm1_crossing.py` encloses each queried foot using the existing outward-rounded
arithmetic and Taylor trigonometry, then adds an independent ±1e−7u interval to
each planar coordinate. Every predicate below is uniform over these enlarged
boxes. They are deliberately permitted perturbations of the queried geometry;
their existence does not prove that a floating trajectory stays inside them.

| Bound | Certified result |
| --- | ---: |
| Radial line-band predicates, including turn start | 1,488 |
| Smallest strict separation from a radial band boundary | >0.0002147074u |
| Smallest separation from any tested circle centreline | >0.03870825u |
| Largest attacker foot radius at accepted queried poses | <67.1666610573u |
| Rim threshold enclosure | [67.16699999999999, 67.16700000000002]u |
| Attacker foot 1 radius at rejected 46.5° step | >67.3035497880u |
| Rejected step's outward excess over the rim | >0.1365497880u |

The strict band comparison is the source's `abs(distance − radius) < 0.81`.
All intervals decide it without equality or tolerance substitutions. Centreline
side bounds also exclude zero. The earlier 33-cell attacker-rim certificate,
rechecked for this packet, additionally covers **every real angle** between 0°
and 46.125°, with radius at most 67.16669730206605u. That continuous rim bound
does not include the new per-query coordinate padding.

## Why the final stop counts and wins

The accepted 46.125° rotation exceeds the 2° minimum move. Every command has
the same negative sign, so the direction lock never rejects a later command.
The pinned release handler has no extra requirement to stop away from a line;
in this case the final feet are clear anyway.

Ko needs a separate argument: a past matching endpoint is allowed only if the
opponent moved enough during this turn. The local contact certificate encloses
the defender's final pose for all α∈[8°,8.01°]. Comparing that box with the
initial family gives a defender-hub displacement of at least
**6.995410503470216u**, strictly above `koEps = 0.25u`. Thus `koSamePiece` is
false, `koContactThisTurn` is true, and `koViolation` is false regardless of
the preceding history. This argument uses the actual displacement rule, not
the solver's last `pushContact` flag.

The same pose-box composition bounds the defender's final foot 1 radius below
by **70.42874748518838u**, giving a lower throw margin of
**3.261747485188365u**. The tiny last-digit change from the previous packet is
from extra outward operations when recomputing feet from its archived pose
box. The contact trajectory and its original bound are unchanged.

The attacker is on the board and the defender is off, so `endTurn` awards the
attacker the win. `commitTurn` checks the move cap only if the game is not
already over. The initial defender family is also checked to be entirely on
the board; this is a throw during the response, not a pre-existing fall.

## Verification

The generator records engine and evaluator hashes, all 124 sets of foot boxes,
every radial predicate, the rejected next pose, and the exact contact-artifact
hash it composes with. Python recomputation checks the complete record and
rejects four corruptions: a missing queried pose, a changed contact set, an
inflated guard margin and an inflated final throw margin. This checker shares
the interval evaluator with the generator; it is not an independent formal
arithmetic verifier.

Separately, `trace-arm1-crossing.js` instruments an in-memory copy of the engine
for the 8° defender stop reached with quarter-degree calls. Its final poses,
turn state, stopping result and committed winner match an uninstrumented
engine exactly. The source-rule replay matches all **123** resulting crossing
states, **124** contact-set triples and **1,476** centreline-side predicates.
All **756** observed attacker-foot coordinates checked—including the attempted
rim exit and final pose after rollback—lie in the certified boxes. An exact
copy of the endpoint was deliberately inserted into ko history; the engine
still correctly accepts the pushing move and commits an attacker win.

Two further source-rule controls reject an injected second episode and fail
closed on an injected corner query. The archived run used Node v24.19.0 and
Python 3.12.14. The earlier complete local contact enclosure and continuous
attacker-rim cover were rechecked successfully as part of this continuation.

These engine comparisons are finite consistency checks, **not** a uniform
floating-point error theorem. In particular, the analytic exact-real rotation
and a sequence of binary64 rotations are different maps. The ±1e−7u boxes
provide a concrete target for an attacker-path correspondence bound, but do
not supply that bound or a contact-solver rounding bound.

## Reproduce

From the repository root:

```sh
python docs/geometry-reviews/brief6-single-reply/arm1_crossing.py
python docs/geometry-reviews/brief6-single-reply/check_arm1_crossing.py
node docs/geometry-reviews/brief6-single-reply/trace-arm1-crossing.js
node docs/geometry-reviews/brief6-single-reply/check_arm1_crossing.js
python docs/geometry-reviews/brief6-single-reply/check_arm1_prefix.py
python docs/geometry-reviews/brief6-single-reply/check_reply_cover.py
```

The next contact task is a gap-free cover of more legal defender angles, using
this shared legality certificate. The whole-arm cover, the remaining defender
arms and uniform correspondence with the floating engine remain open.
