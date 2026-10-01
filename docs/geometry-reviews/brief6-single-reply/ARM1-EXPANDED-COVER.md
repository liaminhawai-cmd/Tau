# A gap-free extension to 8°–8.1°

2 October 2026 (Australia/Sydney). **The continuous local winning-reply cover
now extends from 8° to 8.1°**, compared with 8°–8.01° in the first completed
contact enclosure. There are 32 closed adjoining cells and no pending or
unresolved gaps. The nominal covered angle width is ten times larger.

For every legal defender stop in this family, the prescribed shared reply is
legal and wins in the specified real-arithmetic model. The outward-rounded
lower throw margin over the entire cover is **3.2520719877884825u**.
The whole defender arm, other defender arms and correspondence with floating
engine execution remain open. Angle width is not a measure of the fraction
of the full lost-position proof completed.

## Exact statement

Use the same stored seed, engine pin, real geometry, interval arithmetic
assumptions and source-ordered contact program as
[the first local enclosure](ARM1-LOCAL-THROW.md). For α in the closed interval
with binary64 endpoints `8.0` and `8.1`, the defender's initial response pose
is its exact real rotation about original foot 1 through −α degrees. The
attacker remains at its original stored pose, as established by the earlier
free-motion certificate on this arm.

The attacker pins original foot 0 and follows the same negative reply: accepted
poses β_k = 0.375k degrees, k=1,…,123, with the ten-pass contact program at each
pose. The existing [crossing certificate](ARM1-CROSSING.md) applies unchanged:
it depends only on this attacker path, not on the defender's changing pose.
The attempted next substep exits the attacker's own rim and is rolled back.

Every input angle belongs to at least one checked cell. In that cell, every
contact branch admitted by the enclosure must be included or rigorously
excluded. Successful point trajectories do not substitute for the cell's
continuous propagation. At the accepted endpoint the defender has a foot
outside the rim by at least the stated margin, while the attacker remains
inside.

The defender starts entirely on the board in every cell. Its hub moves at
least **6.964532604551188u** during the response, above the 0.25u ko distance
threshold. Thus the final stop is permitted regardless of preceding ko
history. The minimum-move and direction-lock conclusions also transfer from
the shared reply certificate.

The endpoints and seed are interpreted as their exact stored binary64 values.
No uncertainty in the original four-decimal recording is included. This is
not a theorem about arbitrary input schedules or a rounding-error enclosure
for the JavaScript engine.

## Why subdivision was necessary

The old attempt to propagate [8°,8.1°] as one cell failed during contact.
The new coordinator keeps the already checked [8°,8.01°] cell and proposes
adjoining small intervals above it. A failed interval is bisected; neither
failure nor success at a few points changes its proof status.

All 22 rejected proposals in this continuation failed an enclosure guard for
the horizontal component of a contact normal at attacker substep 97. Smaller
cells resolved those guards without changing the solver or assuming away the
branch. These were failed bounds, not demonstrated escapes or throws in the
wrong direction. An independent 80-digit point diagnostic at 8.07° also
completed without entering the unsupported floor branch.

| Nominal cell width | Accepted cells |
| --- | ---: |
| 0.01° | 5 |
| 0.005° | 2 |
| 0.0025° | 7 |
| 0.00125° | 18 |

The exact endpoints, including binary64 subdivision endpoints, are in
`arm1-expanded-reply-cover.json`. There were **53 new enclosure attempts**:
31 accepted cells and 22 rejected parent proposals. Together with the original
cell, that yields 32 accepted cells. The proof kernel and its five recorded
source hashes are unchanged.

`extend_arm1_cover.py` runs independent interpreter processes because the jet
evaluator has per-pass global state. It never runs two propagations in the
same interpreter at once. Each completed result is saved atomically; in-flight
intervals remain in the pending list until their results are accepted or split.
A stopped calculation therefore retains an explicit account of every gap.
The checker verifies that accepted, pending and unresolved intervals partition
the requested domain, and that the completed accepted cover has no gaps.

## Verification

`check_arm1_extension.py` re-executes all 32 cells, including the reused original
cell, and compares each full canonical propagation hash. The checker also
recomputes the shared crossing geometry, executes the pinned source crossing
function on its certified predicates, and bounds the initial on-board state,
final throw and ko displacement separately in every new cell.

At each cell's endpoints and midpoint, the independent 80-digit Decimal solver
checks all three defender coordinates after every one of the 123 substeps.
This gives **96 trajectory cases at 65 distinct angles**, and **35,424 coordinate
containment checks**, with zero failures. Shared endpoints are deliberately
tested against both adjacent enclosures; the cases are not claimed to be
independent observations. These are implementation cross-checks. Continuous
coverage follows from the interval enclosure and complete cover.

Three corruption controls reject a missing internal cell, an inflated claimed
margin and a forged propagation digest. The earlier 61-cell free-motion
certificate was also rechecked, including its overlap and known-distance
controls. The new run uses Python 3.12.14; the reused source-rule checker runs
on Node v24.19.0.

`arm1-expanded-validation.json` records per-cell composition bounds, complete
propagation hashes, the Decimal final poses and complete-trajectory hashes,
source/artifact hashes and the aggregate results. The interval verifier shares
the enclosure kernel with the generator. The Decimal implementation is
separate, but its finite trajectories are not a formal verifier or a uniform
floating-engine bound. The earlier floating-engine checks for the shared
attacker path remain the scope documented in the crossing packet.

## Reproduce and continue

From the repository root:

```sh
python docs/geometry-reviews/brief6-single-reply/extend_arm1_cover.py
python docs/geometry-reviews/brief6-single-reply/check_arm1_extension.py
```

The generator resumes an existing compatible checkpoint. To rebuild without
overwriting the archived cover, choose a new output filename and pass it to
the checker:

```sh
python docs/geometry-reviews/brief6-single-reply/extend_arm1_cover.py --output arm1-rebuilt-cover.json
python docs/geometry-reviews/brief6-single-reply/check_arm1_extension.py --input arm1-rebuilt-cover.json --output arm1-rebuilt-validation.json
```

For an active generation run, `--follow` lets the checker verify completed
cells while further proposals are evaluated. A verification report is written
only after the whole cover is complete and all its leaves pass.

The next coverage task is to continue beyond this local band and identify
where the present enclosure needs another branch treatment or representation.
The shared crossing proof can be reused wherever the attacker still starts
at the original pose. Full-arm coverage and floating-point correspondence
remain distinct unfinished obligations.
