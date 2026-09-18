# Scripts and data behind brief 3

Run from a directory whose parent holds `forced-win.js` and `contact-law.js` at PR 18's commit
e32f09d, as with the brief-2 scripts.

- `second-crossing.js` -> `second-crossing.txt`: the traced geometry either side of the first
  crossing and of the trouble at 24.4 degrees, with the lever arm's zero crossing.
- `dwell.js` -> `dwell.txt`: the evidence that the victim's contact point sits exactly on its
  phi = 30 vertex from sweep 24.49 degrees to the end, with zero deviation.
- `throw-cert-at-2b307e2f2.js`, `THROW-CONTACT-LEMMAS-at-2b307e2f2.md`: the throw-bound thread's
  checker and write-up as of commit 2b307e2f2 on claude/project-thread-kyx87p, copied here because
  brief 3 ships the checker's source rather than describing it. They are that thread's files; the
  copies are a snapshot, not a fork.

Note on substep conventions: `swing` divides the 46-degree sweep by
`ceil(rad/stepMax)`, which for a 1/3-degree cap gives 139 substeps of 0.330935
degrees here, while the checker's own run uses 138 of 0.33333. Substep indices
agree between the two; sweep angles differ by about 0.18 degrees at the same
index. Compare indices, not angles. Both runs put the last ordinary substep at
73 and the first parked one at 74.
