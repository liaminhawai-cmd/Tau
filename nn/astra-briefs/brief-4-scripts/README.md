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

- `gain-floor.js` -> `gain-floor.txt`: the quantity the barrier theorem actually sums -- at each
  substep, the MINIMUM over every pose in the box of the exposed foot's radial gain. Substeps where
  some pose is not yet in contact have a minimum of exactly zero and cannot be counted. Prints the
  count of full, partial and no-contact substeps, the floor over the countable ones, and separately
  the smallest nonzero gain any single pose ever has, which nothing sums. The floor is a minimum
  over the sample, so it can only fall as poses are added: at +-0.125u/+-0.01 rad this sample gives
  6.5e-3u where the throw-bound thread's gives 9.2e-4u. Both are the FIRST qualifying substep,
  and that substep alone is sample-dependent, which is what `slab-start.js` shows; the floor is
  not the number to quote.

- `sustained-contact.js` -> `sustained-contact.txt`: per-pose first contact across a box, whether
  any pose's contact lapses after it begins (none does ON THIS ARM; see `lapse.js`), the substep
  from which the WHOLE box is in sustained contact, and the smallest per-substep gain from there on. This is the number a per-slab
  (H2)/(H3) has to work with; a minimum taken over the mixed window, where some poses of the box are
  touching and others are not, is a statement about the slab boundary rather than about the contact,
  and comes out near zero for that reason. Superseded by `gain-floor.js` for the brief's table: its
  "smallest gain from there on" skipped the first qualifying substep, which is where the floor
  actually sits.

- `slab-start.js` -> `slab-start.txt`: the same per-substep minimum as `gain-floor.js`, printed as a
  profile rather than reduced to its floor, at 200, 600 and 2000 poses. It answers whether the low
  value at the first qualifying substep is sampling or geometry: only that substep moves with the
  sample (6.5e-3, 6.5e-3, 3.9e-3u at +-0.125u), and every substep from the next one on is stable to
  three significant figures. Hence the brief's rule: begin the first slab one substep after the
  whole box is in contact, and carry ~9e-3u a substep from there. The same holds at +-0.25u, where
  first full contact is at substep 18 and a slab from 19 carries 9.5e-3u. Run as
  `node slab-start.js <box u> <rot rad> <poses>`.

- `lapse.js` -> `lapse.txt`: does contact ever lapse once it has begun, and is any lapse before the
  throw. Contact is read off motion, since the victim is a free body and moves exactly when pushed.
  On arm (0,-1) contact never lapses at all (0 of 200 at +-0.125u and at +-0.5u). On arm (2,-1)
  every pose loses contact, first at substep 211 and 209 respectively, but the throw there is at
  substep 111 to 113 and 0 of 200 lapse before their own throw. So the defensible claim is the
  scoped one: contact does not lapse before the throw. Run as
  `node lapse.js <foot> <dir> <one-degree calls> <box u> <rot rad> <poses>`. Both of these
  reproduce the throw-bound thread's corrections independently on this harness.

- `throw-cert-at-1cf90f63f.js`, `THROW-CONTACT-LEMMAS-at-1cf90f63f.md`: the throw-bound thread's
  checker and write-up at commit 1cf90f63f on claude/project-thread-kyx87p, the commit whose
  results brief 4 quotes. They are that thread's files; these copies are a snapshot, not a fork.
  Both were verified against the repository by blob hash: b8fb4c6f3bc69beedd8b8973e96994d65dc2c96a
  and 87f479d63a929f2844ff719b238c293a8e832fd8 respectively. It is pinned at the commit whose
  certificate results the brief quotes rather than tracking that thread's head, which moves every
  few minutes. The write-up is byte-identical through fbad09315; a section 11, writing up that
  thread's own version of the brief's section 3 measurement, landed at 4a73d2a78 and so is not in
  this snapshot.

The substep-grid warning from `brief-3-scripts/README.md` applies here too: `swing` divides one
call into `ceil(rad/stepMax)` equal substeps, so asking for a whole sweep in one call integrates
a different trajectory from the search's degree-at-a-time swings. `park-monotone.js` chains
one-degree calls for that reason.
