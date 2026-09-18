# Scripts and data behind brief 4

- `park-monotone.js` -> `park-monotone.txt`: the section 3 measurement. Samples victim start
  poses from a box about ndpxhts24's, runs each on the search's grid (46 one-degree swing calls,
  so 138 substeps of exactly 1/3 degree), and tracks the exposed foot's radius per substep. Run
  as `node park-monotone.js <box u> <rot rad> <poses>` from a directory whose parent holds
  `forced-win.js` and `contact-law.js` at PR 18's commit e32f09d, as with the earlier briefs.
  The output file is the five box sizes the brief tabulates. The first pose sampled is always
  the centre, and start legality (on the board, not already touching) is reported per run. The
  last block of each run reports the whole-sweep monotonicity count, the smallest gain over each
  pose's OWN contact window (which is the number that matters: a pose not yet touching has a
  zero gain, so a box-wide first-contact substep understates it), and the contraction of the
  foot-radius spread from first contact to the last pose's throw.

- `throw-cert-at-1cf90f63f.js`, `THROW-CONTACT-LEMMAS-at-1cf90f63f.md`: the throw-bound thread's
  checker and write-up at commit 1cf90f63f on claude/project-thread-kyx87p, the commit whose
  results brief 4 quotes. They are that thread's files; these copies are a snapshot, not a fork.
  Both were verified against the repository by blob hash: b8fb4c6f3bc69beedd8b8973e96994d65dc2c96a
  and 87f479d63a929f2844ff719b238c293a8e832fd8 respectively. The write-up is byte-identical at
  the thread's later head fbad09315, checked, so the snapshot is current; only the checker's own
  audit scripts moved after 1cf90f63f.

The substep-grid warning from `brief-3-scripts/README.md` applies here too: `swing` divides one
call into `ceil(rad/stepMax)` equal substeps, so asking for a whole sweep in one call integrates
a different trajectory from the search's degree-at-a-time swings. `park-monotone.js` chains
one-degree calls for that reason.
