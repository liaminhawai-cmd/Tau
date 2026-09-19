hat is the draft PR I opened for this work, PR 18 ([liaminhawai-cmd/Tau#18](https://github.com/liaminhawai-cmd/Tau/pull/18)), on top of PR 17. I put you down as reviewer so it shows in your queue, but nothing needs you yet: it is still a draft while the 1.0u runs finish. The first point is done (8 of 37 leaves dead, 59% of the box, engine agreed on every certified leaf); the other three are running. I will send one reply with all four results and mark it ready for review then. PR 17 is the one waiting on your merge.

Built and run. PR 18 is ready for your review: [liaminhawai-cmd/Tau#18](https://github.com/liaminhawai-cmd/Tau/pull/18) (on top of PR 17, which is still waiting on your merge).

What it does: a certified dead point becomes a dead box of the victim's pose. The six reach envelopes come from an interval enclosure of the closed-form stopping event (exact inside a cell, refused at a wall), every grid and midpoint pose in the box gets a full certificate, the gap rule runs between pose neighbours per arm and stop, and a box that straddles a wall is split in half on that axis down to 0.1u. The engine is then played on random poses of every certified leaf.

Results at 1.0u on the victim's three axes, attacker fixed, 4 threads:

- ndpxhts24: 8 of 37 leaves dead, 59% of the box, 28 min. One curved wall of arm (0,-1) cuts the box (stop on ring a0 one side, ray r1 the other).
- 6dgqa1fd8: 4 of 20, 16%, 18 min. Three real escapes at V.y minus 1.0.
- 0r8c3cohc: 5 of 56, 5%, 21 min. Rim walls and three real escapes.
- l5807vazg: nothing certified. Its foot is one degree from the rim, so every sub-box has a foot reaching the rim, which the enclosure refuses.
- All 17 dead leaves pass 40 random poses times 8 moves in the engine. The 0.4u box at ndpxhts24 certifies whole in 3 minutes.

So the walls are exactly where the finding put them, and everything the splitting isolates on the dead side certifies. What limits the fraction is cutting a curved wall with axis-aligned boxes: the refused leaves are 0.25u slabs along one surface. The next step, if you want more of the box, is to split along the wall itself, which the closed form gives as the zero set of the difference of two event angles. Not in this PR.

One bug the engine caught: the first run let the engine sample the attacker while the certificate held it fixed, and one pose 0.9u off in the attacker's x found a non-losing reply. The certificate never claimed that box; a single-point axis is now flat and the recheck above is with that fix.

The azimuth scan of l5807vazg is dead at 60 of 72 azimuths in six arcs, symmetric under 180 degrees, and every failure sits on a stop the rotated limits opened. Details are in section 7 of the attached report.

explain simple

Simple version.

Before, we could prove one exact position was dead, and a tiny ball around it (0.17u). Now we can prove a whole box of positions is dead: move the losing piece anywhere inside the box and it still has no saving move.

How: your collision formula tells us exactly how far each of the six possible replies can swing, for every position in the box. Where that formula changes character (a foot starts hitting a different ring or line), that is a wall. Inside a wall-free box the replies behave smoothly, so we check a grid of positions with the full certificate, check that neighbouring grid points agree with each other the same way the certificate already checks neighbouring stops, and let the engine try random positions in the box as a sanity check.

What we got: around the best point, 59% of a 2u by 2u by 2u box is proven dead in half an hour. The rest is not "not dead", it is thin slices along the wall that our square boxes cannot fit against. Two other points are only dead in a smaller box, because real escapes appear within 1u. The fourth point sits on the rim, which the method cannot handle yet.

Squiggles: the walls are the squiggles, and they are exact. Regions between them are what the grid proves. Rotating a dead position round the board keeps it dead for most of the circle (60 of 72 angles).

Nothing here changes any batch verdict. It changes how much of the space one verdict covers.

great, so what percent of positions in 6d space (redx,y,θ,bluex,y,θ) are now proven dead?

Effectively zero, and it has to be for now.

The runs held the attacker at one exact pose, so each certified box is 3-dimensional (the loser's x, y, angle) inside the 6-dimensional space. A 3D slab has no 6D volume at all. Even if we count the boxes at full width on the attacker too, the sums are:

- Whole space, counting angle as arc length at the feet: roughly 8 x 10^11 u^6 (each piece's hub anywhere inside the rim, any angle).
- Best case for the four points at 1.0u: about 64 u^6 each, so under 10^-8 percent.

The reason is that dead positions live in a thin shell near the rim with the pieces touching, so "percent of all positions" will never be a useful number: almost all of the 6D space is open board where nothing is dead. The number that matters is what fraction of positions that actually arise in games fall inside a proven cell. Right now that is the four seed points themselves plus their boxes, and I have not measured it against the game data.

If you want that number, the run is: take the loser's position two plies before the end in every recorded game (the 334 seeds we already have), see how many land inside a certified cell, and grow cells around the ones that do not. That is the real coverage figure and it is a few hours of certificates. Say the word and I will run it.

how long do you want to do that for before you step back and look at it from ana anlaytyical approach to prove more dead spots mathemtially? probably good to build some data to strengthen intuiition and test assumptions before trying to zoom out ?

Agreed, and I would keep the data phase short: one more run, then step back.

The run: certify cells around the 84 seed positions we already know are dead (two plies before the end in recorded games), and see how many of the 334 losing positions land in a certified cell. A few hours of certificates. It gives the coverage number you asked about and, more usefully, a few dozen cells to read patterns from: which arms carry the walls, how the margins behave near the rim, whether the dead cells are all the same shape. What we have from four points already says a lot: the pieces are touching, throws start on the first substep, and the throw margins are 2.5 to 18u, never close to zero. So the throw side is robust and an analytic bound on it does not need to be tight.

Then the analytic pass, with three targets in order:

1. Positions with no legal reply. The swing limit depends only on the mover's pose, so that set is a closed-form region of the loser's three coordinates, whatever the attacker does. The certificate today counts "no legal reply" as an escape, not a loss. If the rules say a player who cannot move loses, that whole class is provable outright, and I need you to confirm which it is.
2. A sound lower bound on the push. The contact law moves the pushed foot by at least the overlap along the contact normal each substep, capped at 0.8u. A bound like that, proven once, turns "foot within d of the rim, attacker sweeps through it for k substeps" into a proof of a throw with no simulation, and the certified points suggest d is often more than 2u.
3. Walls as region boundaries. They are already exact; the fix is to cut along them instead of with square boxes, so a proven cell is the whole space between walls.

So my answer is: one run of data, about a day, then analytic. Two things I need from you: the rule on no legal move, and a yes to start the coverage run.

when is there no legal reply? i don't think that happens 2 i don't understand 3 soudns good

You are right on 1, and I withdraw it. I checked the three probes where the scan said "no legal reply": all six swing limits there are zero because the loser's foot is already over the rim. That is not a position at all, the piece is out. So there is no class of stuck positions to prove and target 1 is gone.

On 2, simpler. A throw is the attacker's swing shoving one of the loser's feet past the edge. Today the only way we know a throw happens is to simulate the shove, substep by substep, with the contact law's iterative solver. That is why the throw side of every certificate is sampled rather than proven. The idea is a guarantee of the form "when the attacker's leg sweeps into the loser's foot, the foot moves outward at least this much per degree of swing". If that can be shown from the contact law's formula once, then a rule like "foot within 2u of the rim and the attacker can sweep 10 degrees through it" becomes a proof of a throw with no simulation. The four dead points suggest the real shove is far larger than any bound we would need, so a loose bound would still cover them.

3 stays as agreed.

The coverage run over the 334 seed positions is still waiting on your yes.

yes make it a proof for 2

mathsify

Here is the mathematics, in the attached report. The short version:

The push law is one formula. When the attacker's leg touches the loser's at point p with horizontal normal n and the solver wants separation s, the loser's hub slides by λn and it spins by λ·rn/I, where rn is the lever arm (how far the hub sits from the line of the push), I = 0.7R² and λ = s/(1 + rn²/I). From that:

- Lemma 1: the touched point moves exactly s along n (error under 0.005u).
- Lemma 2: the slide is at least 41% of s, the spin at most 1.5 degrees per u of s.
- Lemma 3: the exposed foot's radial gain in one push is λ·[n·u + (rn/I)·R·(Jf)·u], with u the outward direction at the foot and f the foot's direction from the hub. Slide plus spin, and the spin's sign is fixed by the geometry.

One substep of the attacker moves its points by at most 0.32u, so the solver applies exactly the attacker's advance along the normal; its cap and floor never bind (checked on 300 engine throws: 0 firings, zero residual overlap, one tube pair in 90% of throws, contact mid-leg, normal outward).

The theorem: over a box of loser poses and a sweep, if one tube pair touches with interior closest points, the attacker keeps advancing into it (a ≥ a\_min), the gain coefficient stays positive (g ≥ g\_min), and the box is invariant under the pushes, then the loser is thrown once the sum of a\_min·g\_min/(1 + L²/I) over substeps reaches the foot's distance to the rim. No simulation in the proof. The hypotheses are geometry, checkable by interval arithmetic on the engine's polyline legs, the same kind of computation as the closed-form envelopes.

Evidence it is the right theorem: on the real throw at the ndpxhts24 dead point, Lemma 3 summed over 61 contact substeps gives 3.18u against the engine's 3.17u, with 3.15u needed. In a box of ±1u and ±3 degrees around that pose, all 127 valid poses are thrown by the same single tube pair.

What is not done: the interval checker that verifies the hypotheses over a whole box, and therefore no throw is yet machine-proved. Uniform bounds are too weak (0.44u, because the early pushes are 68 degrees off radial); the checker has to bound per slab of the sweep. I also withdrew the "no legal reply" class, as you said.

Building the checker is the next step if you want it.

yep go

Built the checker, and it does not close the proof yet. Here is where it stands, honestly.

What works: the checker carries a box of loser poses substep by substep under the attacker's exact rotation and bounds, by interval arithmetic on the engine's own polyline legs, which tubes can touch, the contact normal (from the closest-point vector being perpendicular to both legs), the attacker's advance, the separation the solver applies, and the foot's gain from Lemma 3. A validation mode simulates random poses from the box with the engine and checks every bound: zero violations in every run. The bounds are sound.

What fails: the box it carries grows about 1.3x per substep and a second tube pair stops being excludable by substep 20 to 29 of the 70 needed, whatever the starting box size (0.1u down to 0.01u). The engine's real trajectories from the same box do not spread at all: 40 poses from a 0.2u by 0.2u by 1 degree box stay within 0.15u, 0.04u and 1 degree from the first substep to the throw. Contact pulls them together. Interval arithmetic cannot see that, because three of its bounds are loose by construction: where along the leg the contact sits (plus or minus 0.8u, since the distance is flat at its minimum), the normal at a polyline vertex (a 7.5 degree wedge), and a second-order floor on each step.

What would fix it: three lemmas, each real geometry. The contact point is Lipschitz in the pose (strong convexity), the closest-point vector is Lipschitz with constant about 1 + 1/sin(crossing angle), and the contact constraint contracts the box along the normal. With those, the carried box should track the engine's non-spreading trajectories and the per-substep gains sum to the throw. I estimate days of careful work, not hours, with a real chance of success because the dynamics are measurably contractive.

Section 7 of the attached report has the numbers and the checker is attached beside it. Your call whether I keep going on those lemmas or stop here.

ok if thats not already covred in the other threads go for it

Message received from coordinator

Not covered elsewhere. The Astra thread only corrects the throw note (I will fold those corrections in with them) and works on the dead cells, so the three lemmas and the checker are mine. Starting on the contact-location bound first, then the two contraction lemmas, validating each against simulation before I trust it.

Service was busy

try opus

Your call whether I keep going. Two of the three lemmas are proved and built, and the checker's pose set now stays flat where it used to double every substep. The contact normal bound went from 8 degrees to 0.04, which matches what the engine actually does. Validated on 200 simulated poses, nothing violated. But it still only reaches 12 degrees of a 46 degree sweep, and throws finish at 28. One obstacle left, written up.

Message forwarded from project chat

Checked Astra's answer against our engine. Verdict, with one thing that matters:

**It found a real error.** My per-substep overshoot bound is not sound. The engine beats it on 75 of the 138 substeps, starting exactly at the first chord-vertex crossing (true 8.838e-6u against a bound of 8.025e-6u). My argument followed one material point through the push; what actually has to be bounded is the shortest distance afterwards, which gets re-minimised over every chord pair and at a crossing settles somewhere else. Astra's proved replacement is \~140x looser but holds, and I've taken it — it costs two substeps of reach. Pushed as `2b307e2f2`.

**Its counterexample reproduces to every digit**, including the 0.002465181u hub difference. But it's an instance of the vertex crossing I'd already written up — the two attacker chords involved share the φ=22.5° vertex — and my checker keeps *both* tied branches there at every box size from ±1e-7 to ±0.02, so the failure it warns about isn't one we have.

**Two claims don't land.** "Lemmas A and B are false globally" is true and beside the point: neither is claimed globally, both are per chord-rectangle, and its own results table grants them there. And it says it was never given `throw-cert.js`, so none of it is an audit of the checker that exists.

Separately, I found a bug in my own `--validate` harness — it was comparing poses against the *printed* box, which is rounded to 1e-3. Invisible at a ±0.005u box; at ±0.001u it was inventing containment failures. Fixed, and with it fixed I re-measured reach against box size, which changes the picture:

| boxreaches |       |
| ---------- | ----- |
| ±0.005u    | 11.3° |
| ±0.002u    | 24.3° |
| ±0.0005u   | 24.7° |

The sweep is 46° and the throw completes at 28°. So shrinking the box gets past the first crossing outright and lands within 3.7° of a throw — I'd said subdivision wouldn't help, and that was wrong for the first crossing. It's still right for the second: every box from ±0.0005u to ±0.003u dies within half a degree of 24.5.

Your call from last time is still open — worth me building the separate-regime branching that would close that last 3.7°, or park it here?

One update that changes the question I just asked you.

The other Astra thread traced my sweep and found something I'd got wrong: what I called the third vertex crossing isn't a crossing at all. The victim's contact point **parks** on that vertex at 24.67° and sits there — arc angle exactly 30.000000° for eleven substeps, through the throw and past it. My tracer was reading the chord index flip and calling it a transit. Verified directly and fixed; pushed as `248bda350`.

That's good news, because a parked contact should be the *easy* case: the contact point is then a known material point of the victim, so its position and lever arm are exact with no interval at all. Fewer unknowns, not more.

So the last 3.7° may not need the branching machinery I asked you about. It's two ordinary crossings plus one park, and I die at the second crossing, one substep before the park begins. The cheaper thing to try first is whether my vertex handling is paying for a cone it doesn't need.

(I also checked their third suggestion — that my enclosure basis degenerates where the lever arm passes through zero — and it's false. Measured condition number there is 1.008, the best of the whole sweep. Told them so, since it was headed into the next brief to Astra.)

Same question, better odds: want me to go after that last 3.7°?

Message received from coordinator

Correcting one thing I told you an hour ago, because it makes the decision I asked for look worse than I described it.

I said I die at the second crossing, one substep before the park begins. Wrong — they're the **same substep**. At 73 the attacker steps across its vertex *and* the victim's contact arrives 0.005u from its own, parking there. Across that one substep the lever arm flips from −2.10 to +0.53 and the contact normal swings 13°. Two vertex events on opposite legs at once, where the first crossing has one leg moving and the other's nearest vertex 1.4u away.

I had the data to see that and read it as sequential. The other thread caught it.

So the honest version of the question: the last 3.7° is one *simultaneous two-leg* vertex event, not an ordinary crossing. Still worth trying, in my view — the park on the far side of it should be the easy part — but it's a harder thing than I made it sound. Same question, same answer needed from you.