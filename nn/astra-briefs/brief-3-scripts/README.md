# Scripts and data behind brief 3

Run from a directory whose parent holds `forced-win.js` and `contact-law.js` at PR 18's commit
e32f09d, as with the brief-2 scripts.

- `grid138.js` -> `grid138.txt`: the trace behind brief 3's tables, on the search's own grid.
  It chains 46 one-degree `swing` calls, which is what the search does, so the sweep is exactly
  138 substeps of exactly 1/3 degree. It prints the final victim pose so the chaining can be
  checked against a real ladder run.
- `chord-census.js` -> `chord-census.txt`: which chord pair holds the global minimum, and where
  along each chord, either side of the park. Uses the pre-push victim pose at each substep, which
  is what the push law's contact search sees; against the post-push pose the victim's contact
  reads a few hundredths of a chord off its vertex instead of exactly on it.
- `second-crossing.js` -> `second-crossing.txt`, `dwell.js` -> `dwell.txt`: the earlier traces.
  **Both are on the wrong grid** and their sweep angles are about 0.18 degrees low; `grid138.js`
  supersedes them. Kept because they are what brief 3's first version was measured from.
- `throw-cert-at-2b307e2f2.js`, `THROW-CONTACT-LEMMAS-at-2b307e2f2.md`: the throw-bound thread's
  checker and write-up as of commit 2b307e2f2 on claude/project-thread-kyx87p, copied here because
  brief 3 ships the checker's source rather than describing it. They are that thread's files; the
  copies are a snapshot, not a fork.

## The substep grid, and a bug that was in the earlier scripts

`applySwing` splits ONE CALL into `ceil(rad / stepMax)` EQUAL substeps, with `stepMax` the engine's
`substepDeg = 0.4`. So the substep size is a function of the call size, not a global grid, and a
different call pattern integrates a different trajectory. The search always swings a degree at a
time, so its substeps are `ceil(1 / 0.4) = 3` per degree, exactly 1/3 degree each, and this
46-degree sweep is exactly 138 of them.

`second-crossing.js` and `dwell.js` instead asked for the whole 46 degrees in one call with
`stepDeg: 1/3`. That is wrong twice over. It is a different call pattern; and
`46 * DEG / ((1/3) * Math.PI / 180)` evaluates to `138.00000000000003`, one ulp over, so `ceil`
returns 139 and the step quietly becomes 0.330935 degrees. Measured from this start, the final
victim pose:

    46 calls of 1 degree (the search)   -29.984213, -46.700479, 73.25817
    one call of 46 degrees              -29.988932, -46.707706, 73.26953   hub off by 0.008631u
    one call, 139 substeps              -29.983992, -46.699751, 73.24964   hub off by 0.000761u

0.000761u is the same order as the +-0.001u boxes being certified, so on this work it is not noise.
Substep indices happen to agree either way (73 ordinary, 74 parked), which is why the error showed
up only as angles that were about 0.18 degrees low. Use `Math.round` rather than `Math.ceil` when
converting a limit to a substep count, or better, chain one-degree calls as `grid138.js` does.

`normal-jumps.txt`: the closest-point normal's azimuth either side of both crossings, measured
from the pose entering each substep. The jump is 11.0 degrees at the first crossing and 13.0 at
the second, so the size of the discontinuity is not what separates the passable one from the
blocking one.
