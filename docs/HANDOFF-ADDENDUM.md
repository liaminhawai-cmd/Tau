# Handoff addendum — work after 2026-09-20

`CLAUDE-HANDOFF.md` on `main` is the entry point and is accurate as written. This file
records what changed **after** it, so a new Claude does not redo finished work or cite
resolved defects as open.

**None of this is on `main`.** It is on **`claude/board-game-video-adaptation-cf8a93`**,
which at the time of writing is ~5,250 commits ahead of `main` and 141 behind. The
divergence is mostly committed `nn/data` training rows. `main` does not touch
`nn/throw-cert.js`, `nn/contact-law.js` or `nn/forced-win.js`, so the checker work below
does not conflict with it; `index.html` and `depth.html` differ on both sides and would.

## 1. Brief 4's two defects are REPAIRED, not open

The handoff says: *"start from the latest checker source and reproduce the two defects
before altering it."* Done, and then repaired — commit `1ab1c8222`, `nn/throw-cert.js`.
Both of Brief 4's ablation predictions reproduced exactly first:

| Brief 4 predicted | measured |
| --- | --- |
| chord fix alone still certifies, at k84 | `CERTIFIED` at substep 84 (was 85) |
| adding the frame term refuses at k83, two leg pairs | `REFUSED` at 83, "(0,0) 3.15, (1,2) 3.56" |

* **Defect 1**, `parkJacobian`'s chord selection: `segClosest3` solves for the *second*
  segment's parameter, so the degenerate point must go first. The correct order was
  already documented at the bottom of the same file. One-line fix.
* **Defect 2**, the carried basis: the frame-independent identity
  `lambda a_c = lambda N m3 + lambda (a_c - m3 - Lam_c B m3)` now carries the dropped
  `lambda (a_c - m3)`. Brief 4's alternatives (carry a_c's coordinates in the new frame,
  or differentiate the complete correction per its section 5) were **not** taken, and
  whether the identity version hides the same assumption elsewhere is an open question in
  Brief 7.

## 2. The measurement Brief 4 section 9 asked for

With both defects repaired, sweeping the box down to a **zero-width singleton** on the
post-reply pose:

```
arm (0,-1)  section 8's:  REFUSED at EVERY box size, singleton included  (k83-84)
arm (2,-1)  section 9's:  CERTIFIED at every box size, singleton included (k112)
```

A singleton has no width to inflate, so arm (0,-1)'s failure is **intrinsic slack in the
representation through the chord-vertex park**, not a box-size limit. Brief 4 section 9
anticipated this. Fixed boxes are dead for that arm at any size.

**The throw itself survives.** Arm (2,-1) has no park, did not lean on the defective
bookkeeping, and still certifies. Red needs only one arm, so the repair relocates the
throw rather than destroying it — and a parkless arm may be a much cheaper proof target
than the one section 8 was chasing. That is question 3 of
[Brief 7](dead-regions/astra-brief-7-park-representation.md), which is the live brief.

Nothing here is a proof. Brief 4 section 10's obligations are untouched.

## 3. The dead corpus: enumeration is a dead end

`docs/dead-regions/` holds 261 certified dead points and 63 certified balls, mined from
self-play and all passing engine falsification. Measured in the metric the certificates
are issued in (`nn/dead-corpus-geometry.js`):

```
closest two same-mover certified positions   5.57u   (median 30.07u)
largest certified radius in the corpus       0.35u   (median 0.095u)
entries within 1u of another                 0 of 261
certified 6-volume, sum (pi^2/45)*eps^6      1.845593e-3 u^6   (reproduces Astra's figure)
```

The separation is sixteen times the largest radius. **The set is 261 isolated needles**,
so a lookup table over it cannot be a playing-strength mechanism — which answers the
"does an L11 that knows the dead spots get stronger" question without a game, and
without depending on which table the shipped rung carries. Do not ship the corpus into
`index.html`'s `DEAD_CERTS` at `DEAD_CERT_EPS = 1.0`: that would claim a radius three
times the largest ever certified, on 198 points carrying no certified radius at all.

## 4. A replicated enrichment that is NOT a region

`docs/dead-regions/region-enrichment.md`. Dead positions concentrate where the victim's
middle foot sits 0.5–1.5u **outside the 53.3u printed ring** (`maxCrossingsPerTurn` is 1,
so the turn's crossing budget is spent or about to be — a statement about the rules).

```
INSIDE  121/203 dead = 59.6%  [52.9, 66.4]
OUTSIDE  47/203 dead = 23.2%  [17.4, 29.0]
lift 2.57x, z = 7.46, p = 8.9e-14
```

Held out on 6,351 fresh seeds of the same provenance. An initial fitted figure of 74.4%
purity was **inflated by search bias** — it was the maximum over thousands of candidate
boxes; split-half validation gives 2.53x and the powered test 2.57x, in close agreement.

**It certifies nothing.** Two positions in five inside it are not dead. Its use is mining
at 2.57x the hit rate, and as a pointer for where a provable sub-region might be sought.

## 5. Other state a new Claude should not re-derive

* `docs/dead-regions/SEARCH-GUIDE.md` — how `forced-win.js` and `contact-law.js` work.
* The cover rule in `forced-win.js` is **resolution-relative by design**, like the sliver
  and engine-probe rules. Every gap reaching it is at most one engine substep wide, so a
  Lipschitz allowance scaled to its sample spacing would be false rigour. See
  `gap-cover-result.md`.
* PR #8's 46 unique files (`throw-cert.js`, `throw-audit/`, `THROW-CONTACT-LEMMAS.md`,
  `dead-region-check/`, brain-map tooling) are on this branch. `contact-law.js` took PR
  #8's optimised version after checking it over 3,132 swings on all 261 certified poses:
  bit-identical output, 3.76x faster.
* `nn/THROW-CONTACT-LEMMAS.md` carries a status block: its section 8 "it closes" is **not
  established**, and its box is ±0.002 **degrees**, not radians.
* Trainer/league: `ADMIT_CEILING` 4x→1.5x target and standings ranked on the CI lower
  bound (the board was sorted by a point estimate, so its top was whoever had the
  smallest sample). The committee's `d2`/`d2w` pair now both field, so `@posw` is
  measurable as a difference. See `nn/GLOSSARY.md`.
