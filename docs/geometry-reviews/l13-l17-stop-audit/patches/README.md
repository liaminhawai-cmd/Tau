# Patches

Supplied as patches rather than applied. Both change how every rung from L3 up generates its root
stop candidates in the shipped game, so "preserve existing game rules and public ladder until an
evidence-backed change is reviewed" applies to them. The evidence is in `../README.md`; the decision
is not this packet's to make.

| Patch | Base | Sites |
| --- | --- | --- |
| `0001-restore-the-configured-stop-stride.patch` | `main` `8b31eec8b` (`index.html` blob `2fbb3e401`) | `ladderSampledPlanGen`, `ladderRoots3`, corner-book third move |
| `0002-restore-the-stride-on-the-L17-branch.patch` | `claude/board-game-video-adaptation-cf8a93` `ecda57807` (`index.html` blob `c79872b8f`) | the three above plus `ladderDeadEscape` |

Both add one constant, `MARK_EPS_RAD = 1e-9`, and subtract it from the stride in each mark
comparison. Nothing else changes: the tolerance decides which *reachable* stops get examined, never
which stops exist, and never how a chosen stop is played.

Apply with `git apply <patch>` from the repository root of the matching revision. `0002` will not
apply to `main` — `main` has no `ladderDeadEscape`.
