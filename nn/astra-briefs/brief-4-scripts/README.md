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

- `thickness-spread.js` -> `thickness-spread.txt`: our own check of section 14. For each substep it
  prints the penetration D - g entering the next push, per pose, and its spread over the box, which
  is the slab's thickness along the normal. Away from the vertex crossing the spread is 1e-4 to
  8e-4u; at the crossing it peaks at 4.6e-3, 5.7e-3, 5.8e-3 and 6.0e-3u for boxes of +-0.0125,
  +-0.025, +-0.05 and +-0.1u, against their predicted 5.98e-3, 6.13e-3, 6.35e-3 and 7.14e-3u. Same
  peak location, same near-independence of the box, and the measurements sit under the predictions,
  which is the right side for a bound. The entry substep is the odd one out at 4e-3 to 2e-2u, since
  the poses are not all on the shell yet. The penetration itself is ~4.8e-2u, which is 0.00582 rad
  times a moment arm of about eight units. Rotation defaults to their pairing (0.248 deg at 0.1u,
  scaled); run as `node thickness-spread.js <box u> [rot rad] [poses]`.

- `tangential-spread.js` -> `tangential-spread.txt`: our own check of section 15, the sideways half.
  It measures the WHOLE deviation from the centre in the foot-displacement metric (dx, dy, R drot)
  rather than splitting it at G, which is close to the same thing once the along-G part has
  collapsed onto the shell. From first contact to the centre's throw at substep 84 the extent goes
  x1.13, x1.13, x1.07, x1.07 at boxes of +-0.0125, +-0.025, +-0.05 and +-0.1u, with the extent
  itself exactly proportional to the box (0.018, 0.036, 0.073, 0.145u). So: same proportionality,
  same near-flat interior, same anomaly at the small boxes, and the park carrying the growth. One
  honest difference: measured this way the interior stretch grows slightly (x1.036 over 60
  substeps) where their tangential split has it slightly contracting, which is what you would
  expect if some of the difference is G's own rotation. Rotation defaults to box/R; run as
  `node tangential-spread.js <box u> [rot rad|-] [poses]`.

- `throw-cert-at-0bcb6f2b4.js`, `THROW-CONTACT-LEMMAS-at-0bcb6f2b4.md`, `gain-bound-at-0bcb6f2b4.js`,
  `gain-bound-at-0bcb6f2b4.txt`, `slab-shape-at-0bcb6f2b4.js`, `slab-shape-at-0bcb6f2b4.txt`: the
  throw-bound thread's checker, write-up and section 13 to 15 programs at commit 0bcb6f2b4 on
  claude/project-thread-kyx87p, the commit whose results brief 4 quotes. They are that thread's
  files; these copies are a snapshot, not a fork, pinned rather than tracking that thread's head,
  which moves every few minutes. All were verified against the repository by blob hash, read from a
  directory listing of that commit rather than recalled: throw-cert.js
  b8fb4c6f3bc69beedd8b8973e96994d65dc2c96a (unchanged since 1cf90f63f), THROW-CONTACT-LEMMAS.md
  67ddbbb713a5df5fb0cb79e812c94bbac8521ddb, gain-bound.js eb415d5966a2a493f465278d7ef50bc100fbad2b,
  gain-bound.txt caba4270531afe1c194483af488c523e2ce84b02, slab-shape.js
  3c0823b0f50281369084f62ac401b2ad7ab63bf4, slab-shape.txt 6257009aecd4e62c2e21da6f86588e067b04ebd9,
  thickness.js 1fd166f3f4392de0610cb1a2e1a93ceee4dff30c, thickness.txt
  63ed3ac74bb819bf3a9a14d6e212099ac74f3b8e, tangential.js
  906f36fd6f2db694057c4cbab53cdd71ef3a28d3, tangential.txt
  1c09c8377ca9c474917b375816695e71206d0e52. Section 14 is the answer to question 1(b): the
  penetration entering a substep is one substep of the attacker's advance, because the push resets
  every pose onto the shell, so the thickness never accumulates.
  Section 13 is the one brief 4's question 1 now turns on: H3 computed rigorously rather than
  sampled, certifying nothing over a +-0.1u box because the blanket pad is 0.2414u, and closing
  (3.5144u against 3.2026u needed) once the set is taken to be a thin slab instead.

- `gap-spread.js` -> `gap-spread.txt`: our own check of that shape claim. For each substep it prints
  the range, over the pose box, of the separation between attacker and victim entering the substep,
  beside the spatial spread of the poses themselves. At +-0.1u the poses span 0.19u of the plane
  while their separation range averages 2.2e-3u over the 124 whole-box-contact substeps and 1.9e-4u
  through the park, a ratio of 86. The throw-bound thread measures the pre-push distance instead and
  gets 3.3e-3u and 9.3e-4u; different quantity, same conclusion. Contact is taken as motion, as in
  `lapse.js`. Run as `node gap-spread.js <box u> <rot rad> <poses>`.


The substep-grid warning from `brief-3-scripts/README.md` applies here too: `swing` divides one
call into `ceil(rad/stepMax)` equal substeps, so asking for a whole sweep in one call integrates
a different trajectory from the search's degree-at-a-time swings. `park-monotone.js` chains
one-degree calls for that reason.
