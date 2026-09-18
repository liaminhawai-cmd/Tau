# Astra's second answer: the sampling phase decides the programme, and what that costs us

Thread "Astra's dead-region answer" (2026-09-18), after the first check in `astra-dead-region-check.md`. liam forwarded GPT Astra's reply to brief 2 (contact lemmas and the oriented split). The contact-lemma half belongs to the throw-theorem thread; this note covers the cell and wall half, which lands directly on PR 18 and PR 23.

Astra computed against `e32f09d`, PR 18's head, and says so. Everything below marked confirmed was recomputed here on that same code with the scripts named at the end; the closed-form oracle `limitAt` and the full engine ladder `limitLadder` agree in every case.

## 0. Short answer

Astra's central correction is right, it is checkable, and it changes what a cell may claim.

**At a fixed pivot foot, the swing limit is not a function of the pivot-plane geometry.** Moving only the victim's rotation by about a thousandth of a radian, with the pivot foot held to twelve decimal places, gives limits of 95⅓°, 63⅔° and 95⅓° on arm (0,+) at 6dgqa1fd8. Every pivot-plane event-order and tangency test is identical at those three poses. `limitLadder`, the engine itself, reproduces all three.

**The mechanism is the substep grid.** Two events of foot 2, leaving r1's inner band edge and reaching a0's outer band edge, sit 0.1215° apart at every pose of that family. A substep is 1/3°. When the two land in the same substep the engine hands contact from one line to the other inside a single sampled step with the piece's crossing episode still charged, so nothing is billed and the swing runs on to r0 at 95⅓°. When they land in different substeps the foot is off both lines in between, the episode closes, the entry onto a0 opens a second one, and the swing stops at 63⅔°. Which happens is decided by the absolute phase of the substep grid, which no pivot-plane curve can see.

**Consequence for us.** A stopping programme read off a pose grid is not a property of the cell. Where such a strip raises a limit, an envelope built from grid programmes would have a `hi` below the true limit somewhere in the box, and the certificate would then never sweep the replies that are actually available there. That is the one way this could have been unsound rather than merely conservative.

**Measured exposure.** Over the ±1u box at ndpxhts24 and 6dgqa1fd8, on a 25³ grid plus 20,000 random poses per point (35,625 poses, all six arms), every arm whose envelope forms has its true limit at or below the envelope's `hi`, with about 0.73° of headroom. So no instance of the unsound case was found; but the grid cannot see strips this thin, and finding none is not the same as there being none.

**Shipped in response** (PR 23): a cell is refused where one foot can meet two different lines inside one substep anywhere in the box. Two events of different feet inside one substep stay accepted, because whichever the engine sees first stops the arm, so the minimum of the two enclosures still bounds the limit. That distinction is what keeps ndpxhts24's ±1u box certifying whole while the 6dgqa1fd8 and l5807vazg strips are refused.

Astra also endorses the union of stopping envelopes from PR 23 and says to keep it, on the same reasoning we used: where both candidate events really stop the move, their minimum avoids a split that buys nothing.

## 1. The counterexamples, recomputed

Script `phase1.js`, on `e32f09d` plus PR 23's changes (neither touches `limitAt` or `limitLadder`).

| Astra's claim | Recomputed here | Verdict |
|---|---|---|
| 6dgqa1fd8, arm (0,+), pivot foot at (−2.158446313719631, 24.74125961918767) held fixed, three θ within 0.004 rad: limits 95⅓, 63⅔, 95⅓ | 95.3333, 63.6667, 95.3333, pivot identical to 12 decimals; programmes `cross a0,r1 stop r0`, `cross r1 stop r1`, `cross a0,r1 stop r0`; `limitLadder` agrees on all three | confirmed |
| At offset (−0.66, 0, −0.66) arm (0,+) runs to 95⅓ although the foot circle cannot reach the corner disc (\|P₀−K6\| = 41.1039 > ρ+0.81 = 40.8117) | 95.3333 by both oracle and ladder; nearest corner to the pivot 41.1039u, so the moving foot stays at least 1.10u from it, well outside the 0.81u disc | confirmed: this programme is not a corner merge |
| 0r8c3cohc, arm (2,+), pivot foot 2 fixed, θ varied by under ⅓°: a narrow window with a much shorter limit | reproduced: 66.0° over most of a 0.46° sweep, 8.0° on a window three samples wide, 65.667° after it, ladder agreeing at each | mechanism confirmed; the exact limits differ from Astra's 63⅔/5⅔/63⅓ because these are different θ values in the same family |
| `newPending` in `crossingSubstep` is initialised and read but never populated | confirmed: declared at `index.html:2767`, read at `index.html:2896`, assigned nowhere; the same holds on `main` | confirmed, and it is a live rule bug, see section 4 |

The bin arithmetic behind the first row, from `phase2.js`:

| pose | f2 leaves r1 (52.49) | f2 reaches a0 (40.81) | same substep? | limit |
|---|---|---|---|---|
| 1 | 63.7600° (bin 192) | 63.8814° (bin 192) | yes | 95.3333° |
| 2 | 63.6655° (bin 191) | 63.7870° (bin 192) | no | 63.6667° |
| 3 | 63.5433° (bin 191) | 63.6648° (bin 191) | yes | 95.3333° |

The pair's separation is 0.12148° at all three. Only the phase moves.

## 2. What this does to the envelope, measured

`phase4.js`: for each arm whose envelope forms over the ±1u box, the worst value of (true limit − envelope `hi`) over a 25³ grid plus 20,000 random poses.

| point | arms with an envelope | worst (limit − hi) |
|---|---|---|
| ndpxhts24 | all six | −0.73° (arms 0,+ / 0,− / 1,+ / 2,−), −1.07° (arms 1,− / 2,+) |
| 6dgqa1fd8 | five; (0,+) refused for a programme change | −0.73° on all five |

So `hi` bounded the limit everywhere tested, including the 1.8% of the ndpxhts24 box where two events do share a substep. That is the different-foot case, where sharing a substep cannot extend the limit.

`phase3.js` maps where substep collisions live at all, over 9³ poses per point:

| point | arm | poses with two reachable events in one substep | closest pair |
|---|---|---|---|
| ndpxhts24 | (0,−) | 1.8% | 0.0219° |
| 6dgqa1fd8 | (0,+) | 4.1% | 0.0006° |
| l5807vazg | (2,+) | 26.7% | 0.0046° |
| l5807vazg | (0,+) | 7.8% | 0.0010° |
| 0r8c3cohc | (2,−) | 3.2% | 0.0084° |

Every other arm at every point: none.

## 3. The guard, and why it is shaped that way

`phase5.js` measured how often a guard would fire before it was written. The rule shipped in PR 23:

> Refuse a cell when, anywhere in the box, two events of the **same foot** on **different lines**, both reachable before the envelope's `hi`, come within 1.1 substeps of each other.

Same foot and different lines, because that is the pair the engine can hand over inside one step with the episode still charged. Different feet cannot: whichever is sampled first ends the swing. The scan is the envelope's 5×5 grid in x and y with 41 samples across the box in rotation, since the strips are thin in rotation and wide in the other two. It costs about five seconds per cell against certificates that take minutes.

What it does to the four points' ±1u boxes: ndpxhts24 keeps all six envelopes, l5807vazg's arm (2,+) is refused by the guard at every box size down to ±0.25u, and 6dgqa1fd8 and 0r8c3cohc are refused first by their programme changes anyway.

This is a sampled test of a geometric condition, not a proof, and it inherits the standard of everything else in the file. Astra's W3 is the proof version: carry the bin indices as part of the cell and evaluate the state machine over the whole cell. That is a bigger change and is not done.

## 4. The rule bug in the shipped game

`crossingSubstep` grants a corner merge when a foot reaches a second line within `cornerEps` of the printed corner, and records it as a promise to be validated later, when the merged line's centreline is actually crossed: a foot that slips past the corner should then be billed for a real second crossing. That validation never runs. `newPending` is never written, so `st.pendingMerge` is always empty and the deferred check at `index.html:2799` returns immediately every time.

This is in the shipped game on `main`, not only in the search code, so it affects real play, the trainer, and every certificate ever computed. It is not something to fix quietly: repairing it changes which moves are legal, which changes limits, which invalidates existing certificates and possibly some training data. It is liam's call, and nothing here touches it.

## 5. What else of Astra's to take, and what not

- **Take the shared-foot chart at 0r8c3cohc.** Astra is right that the three named walls there (C, D, E) all live in one physical foot's plane, foot 0, which is also the pivot of arms D and E; the brief described them as two pivots. Its explicit chart, P₀ from the two radii r = \|P₀\| and s = \|P₀−(66.667,0)\| with a Jacobian determinant of about 0.816 at the seed, is well conditioned and avoids inverting anything implicitly. This is the natural next step for the oriented split, and is not done.
- **Take the domain clip at l5807vazg**, which PR 23 already does, and Astra's point that the on-board volume is the honest denominator, which PR 23 now reports.
- **Take the warning about phantom replies.** Sweeping every pose in a cell to the envelope's `hi` gives a pose stops it cannot actually reach. That is conservative for the verdict, since unreachable stops can only add work, but a gap that straddles a pose's true limit is bridged partly on evidence from a pose that cannot occur. Worth fixing by carrying the reply domain per pose; not done.
- **Do not take** "an event-order swap is a jump". Astra agrees with the union here: where both events stop, the limit is continuous and the minimum of the enclosures is right.
- **Not checked**: the contact lemmas A, B, C, D of sections 2 to 7, the numerical predictions of section 6, and the figures. Those belong to the throw-theorem work, which is a separate thread and has its own contact-localisation lemmas in `nn/THROW-CONTACT-LEMMAS.md`.

## Files

- `phase1.js`: the fixed-pivot counterexamples, oracle and ladder.
- `phase2.js`: the bin arithmetic behind them.
- `phase3.js`: where substep collisions live over each point's box.
- `phase4.js`: whether the envelope's `hi` bounds the limit over the box.
- `phase5.js`: how often the guard fires, and the separation ranges it sees.

Astra's report and reproduction bundle are in the project's uploads; not copied here.
