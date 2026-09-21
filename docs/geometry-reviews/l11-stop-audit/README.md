# L11, dead zones, and the next useful proof
21 September 2026. Engine/search audited at main `ce0e61d1e7482e3d1252aadadf97bd4269f71e29`.

## A reproduced blind spot
L11 samples intermediate stops for its first move, then its depth-three continuation scorer considers only six opponent endpoints and six answering endpoints. A high continuation score is therefore not a certificate over every legal opponent stop.

The accompanying probe invokes the actual `ladderScore3` with L11's weights. Pose coordinates are x, y, rotation in radians, for piece 0 then piece 1:
`[-40.2848, 3.7263, 1.8209, -30.2905, 12.3529, 1.5755]`.
Piece 0 is the defender to move; piece 1 is the attacker.

- L11 continuation score: 1000015.513212251 (winning bonus is 1000000).
- Defender instead pivots about foot 0, direction +1, and stops at 2 degrees.
- Both pieces remain on board; the move meets the minimum move angle.
- All six attacker endpoint responses are legal and none has the defender off board.

Source fixture: `docs/dead-regions/screened-not-dead.jsonl`, game `retro-ratchet-20260918073412-de8-w1-j4-0-41`, k=2, from the Brief 5 corpus. The first such witness was found after checking six eligible control rows; this is a selected example, not a prevalence estimate.

Run `node reproduce.js /path/to/Tau` against the pinned checkout. Only observation exports and dependency seeds are added in memory. Engine cache reads/writes are disabled for reproducibility.

**Scope:** this is an interior-stop counterexample to L11's endpoint continuation model. It does not establish a full-game escape, rule out winning intermediate attacker stops, show that L11 chooses the precursor move in a game, or check a supplied ko history. It is not a newly proved dead zone.

## Does L11 miss genuine dead zones?
No specific new certified zone has yet been demonstrated to be a missed win in an otherwise identical L11 continuation test. If every legal defender reply loses to one of the same endpoint answers, L11's subset of replies also loses. Differences in move protocol, terminal detection and search reach must be checked before applying that reasoning to a certificate.

L11 can still fail to reach the setup: its initial stops are sampled and candidates pruned. It can also fail to avoid a trap whose decisive continuation lies beyond its horizon. These are distinct from certifying an already reached dead state.

## What could improve the ladder?
1. Challenge apparent forced wins with selected interior opponent stops. Prioritize contact/line events and low-margin intervals; use this fixture as a regression example.
2. Spend additional search on avoiding entry into a dead state, before the loss becomes inevitable. Existing L13 and L17 experiments already explore richer replies and dead-state guards; measure improvements over those implementations.
3. Train value/policy models on contrasting nearby positions and critical stopping angles. Keep sampled-dead, certified-dead, unresolved and tactical counterexample labels separate. A screen-only escape is not a proven safe training target.
4. Load and validate the intended certificate corpus before testing lookup benefits. The audited historical L17 run used an older table, not the advertised 261-point/63-ball corpus.

The historical L17 result was 56–40 over 96 games, reported +58 Elo with interval -11 to +133. That establishes neither a strength gain nor its cause. Use paired openings and swapped seats, separate component ablations, equal time budgets, and held-out game families. Also report missed-stop captures, decision changes, lookup hits and runtime.

## Further proof work, in order
1. Complete a sound local throw certificate for the shorter arm-(2,-1) continuation from the Brief 6 post-8-degree-reply pose. Verify every finite contact update, feature guard, residual bound and terminal crossing. A checker printing CERTIFIED is not enough.
2. Cover every legal defender reply interval from the original position, using different attacking responses on overlapping patches. One certified post-reply throw does not prove the original position dead.
3. Expand that cover to neighborhoods in both pieces' poses, producing genuine six-dimensional dead regions with explicit membership conditions.
4. Propagate proven regions backwards: an attacker needs one move into a losing region; the defender must have every legal reply covered. Record a decreasing finite-horizon rank and explicit terminal/no-legal-move rules.

Brief 7 already supplies a positive local contact-chart derivative bound (above 0.125 through the nominal throw on the specified boxes). This supports a better enclosure but does not prove tube containment or an entire dead zone. Preserving correlations through the complete contact map is the next substantive mathematical step. No new complete dead region is claimed by this audit.
