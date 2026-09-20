# Tau geometry and throw-proof reviews

For user intent, original briefs and operational context, start with
[CLAUDE-HANDOFF.md](../../CLAUDE-HANDOFF.md).

This directory preserves the mathematical findings and reproductions from the
review thread, plus the earlier depth-page proposal. **Start with the Brief 4
review for the latest checker audit.** Each report describes a pinned source
revision; earlier findings are historical, not claims about every later head.

| Review | Main subject | Source revision |
| --- | --- | --- |
| [Brief 4: the box-size gap](brief4/tau-box-size-review.md) | Rotation units; wrong park chord; carried-frame identity; local interval bounds; full-map derivative; moving tubes; second-arm transition | `1cf90f63fb597c039d99ff554242a12ff4b91f1a` |
| [Brief 3: vertex dwell](brief3/tau-vertex-dwell-review.md) | Exact vertex geometry, phantom interior branches, park timing, missing closure | `2d39d4d53855a9a1aeb86e2674a35ec0aef0e8da` |
| [Brief 2: throw lemmas and oriented split](brief2/tau-brief-2-response.md) | Contact ties, projection/overshoot bounds, walls and pivot-phase dependence | `e32f09d5be9600212c3d5294b70a3835f0517427` |
| [Dead-region geometry and proof audit](dead-geometry/tau-dead-region-analysis.html) | Exact swept-wall slices, swing events, rim geometry, search-log analysis and the proposed throw theorem | `e32f09d5be9600212c3d5294b70a3835f0517427` |
| [Initial contact-regularity response](contact-regularity.md) | Grazing, continuity versus differentiability, conditional stability bounds, finite-solver branches and swept-wall fibres | `76591b521d4e7303111958f938373caf6454607a` |
| [Depth-page proposal and findings](depth/README.md) | Audience, structure, worked examples and interpretation of self-play evidence | Historical editorial proposal |

## Current conclusions

The reviewed small-box `certified` result is not yet justified by its enclosure
argument. Brief 4 reproduces two implementation defects and a degrees/radians
mismatch. The proposed fixed ±0.1u invariant box fails on the nominal trajectory
before the throw. Positive local interval bounds at ±0.125u establish useful
geometry in three park slabs; they do not establish full trajectory containment
or a whole-cell throw certificate. The complete contact-map derivative and a
phase-indexed tube supply a more suitable formulation for the remaining proof.

The Brief 4 checker blob was unchanged at PR #18 head
`1ba97f2a9b7bf169c40972fa9476b10c77c3ee13` when checked. Its explanatory document
had changed. Follow the pinned source links and blob manifests when reproducing
a result.

## How the findings evolved

- Brief 2's contact-tie witness shows why distinct feasible branches must be
  retained. It is not evidence that the later checker discards those branches.
- Brief 3's overly broad vertex cone was the obstacle in that revision. The
  later checker adopted exact victim-vertex geometry and linearisation. Brief
  4 audits that implementation rather than repeating the old cone objection.
- The earlier assumption that one vertex regime persists across the first
  k74 push was corrected: pre-push park k74–98; post-push park k79–104.
- Brief 4's carried-frame identity error is separate from zero lever arm or
  frame conditioning. The report gives the missing term explicitly.
- The historical depth proposal predates the subsequently merged third and
  fourth editions of `depth.html`; it is archived for reference, not installed
  as a replacement for the current page.

## Reports and reproduction packages

Each report directory contains its readable report and a README. Download an
HTML report to read its standalone illustrated version in a browser. The
archives preserve the earlier delivered reports, scripts, figures and results:

- [Dead-region geometry package](archives/tau-geometry-reproduction.zip)
- [Brief 2 package](archives/tau-brief-2-reproduction.zip)
- [Brief 3 package](archives/tau-vertex-dwell-reproduction.zip)
- [Brief 4 package](archives/tau-box-size-reproduction.zip)

The Brief 4 scripts are also present as ordinary reviewable source files.
Its larger saved traces are in its archive; extract the `brief4/` directory
beside these files, or regenerate them using the README commands. The original
Tau engine files are fetched at pinned revisions rather than copied into the
packages. The dead-region package records the supplied search-log input hashes;
the original uploaded logs are now preserved separately in
[project context](../project-context/README.md).

`SHA256SUMS` covers the committed reports, scripts, figures and archives. This
addition changes documentation and reproduction tooling only. It does not merge
the experimental proof branches or change the game, live ladder or deployed
depth page.


| [Brief 5: from dead points to regions](brief5/tau-dead-region-classes-review.md) | L17 corpus-loading audit, six-dimensional dead balls, sampled-label limits, finite reply covers, moving tubes and forced-win induction | `c1ac39e771f8115797a4b8672587860fb676ad1b` |


## Brief 5 current conclusion

The 261-point / 63-ball corpus is valuable training data for a region
characterisation, but the published L17 zero-hit measurement used the older
hard-coded table and cannot test it. The balls vary both pieces and have
positive six-dimensional volume, while the deadness labels remain sampled. The
next rigorous object is a finite cover of legal replies by verified winning
responses, propagated through guarded event cells or a phase-indexed moving
 tube. No new nonempty proved dead region has been claimed here.


## Brief 6: the missing 8-degree reply

[Read the Brief 6 response](brief6/response.md). Both historical small-box
outputs reproduce from the **post-reply** pose on committed code. The unit
correction and two enclosure defects remain. The [reproduction package](brief6/README.md)
records the seed/post-reply comparison, current-engine replay, degree/radian
runs and the repeated chord/frame audit at `431f13129d57fb41dd17e0844b3bd55624e2c3b4`.


## Brief 7: repaired checker, positive contact-chart bound

[Read the response](brief7/response.md) and [reproduce the checks](brief7/README.md).
The two prior repair hunks are present at `18efad5398798b65b477f9af4be17947a358d3ce`.
The singleton failure reproduces, with artificial width appearing before the
park. A new interval calculation verifies positive radial contact derivatives
across candidate park domains; full tube inclusion remains open. The report
gives an explicit contact-shell chart, audits the repaired identity and fallback,
and recommends the surviving second arm as the first complete-proof target.
