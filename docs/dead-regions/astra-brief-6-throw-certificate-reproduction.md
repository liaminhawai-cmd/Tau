> ## CORRECTION (2026-09-20) — this brief's main finding was wrong
>
> **The numbers reproduce. This brief ran the certificate from the wrong pose.**
>
> `ndpxhts24` is a dead position with BLUE to move. The historical example is not
> the seed: it is the position after **blue's (0,+1) reply to 8 degrees**, from
> which red then throws. Section 8 and section 9 describe that post-reply pose.
> This brief certified from the seed, before blue's reply, and so measured a
> different geometry.
>
> With the post-reply pose, both recorded results reproduce exactly on committed
> code:
>
> ```
> POSE=-24.31126879077936,-37.34799285619334,1.3448263401595464,-11.7593,-23.2838,2.9442
>
> node nn/throw-cert.js 1 0 -1 1 0.0002 0.0002 0.002 --validate 200
>   thrown at substep 85 (28.33 deg): foot 1 radius >= 67.1927u   [doc: 28.33 deg, 67.193u]
>   CERTIFIED; 200 poses, 200 thrown, 0 violations
>
> node nn/throw-cert.js 1 2 -1 1 0.0002 0.0002 0.002 --validate 200
>   thrown at substep 112 (37.33 deg): foot 1 radius >= 67.2047u  [doc: substep 112, 67.205u]
>   CERTIFIED; 200 poses, 200 thrown, 0 violations
> ```
>
> Sections 4(a) and 4(b) below are therefore void, as is section 5's claim to have
> ruled out an invocation error -- the error was exactly that. The post-reply pose
> was in `nn/throw-audit/README.md` the whole time, as "the POSE used throughout",
> and this brief's author had already run the audit scripts with it.
>
> **Two findings survive.**
>
> * **The unit slip is real** (section 4(c)). The successful rotation half-width is
>   **0.002 degrees**. The document's stated +-0.002 **radian** box fails. Any
>   citation of section 8's box is 57x too wide.
> * **`CERTIFIED` is still not a proof**, for reasons that predate this brief.
>   Brief 4 documents two live defects in the enclosure, neither repaired:
>   `parkJacobian` differentiates the **wrong attacker chord** (`segClosest3` with
>   the degenerate point second returns the segment start, not the perpendicular
>   foot -- it selects chord 2 where the perpendicular foot is on chord 1, giving
>   dn_x/dx = 0.2035 against the real chord's 0.1249 at substep 74), and the
>   carried basis no longer satisfies m3 = a_c, so the identity used omits the
>   term lambda*(a_c - m3) -- with ||m3 - a_c|| reaching about 0.39 before the
>   reported certificate. Brief 4's ablation is the decisive part: fixing only the
>   chord selection still certifies, but **adding the missing frame term makes the
>   run refuse at k83**. The reported result depends on the disputed bookkeeping.
>
> So section 8's headline -- *"Update, later the same day: it closes"* -- is not
> established. The numbers are real and reproducible; the proof is not yet a proof.
>
> Resolved in PR #31 (merged to `main`), which carries the exact invocations, six
> seed/post-reply and degree/radian runs, an independent engine replay and two
> 200-pose validations.

# Brief 6: the throw certificate's recorded numbers do not reproduce

**Ask:** either produce the invocation that reproduces `nn/THROW-CONTACT-LEMMAS.md`
section 8, or confirm it does not reproduce on the committed code.

**Why it matters.** Everything in `docs/dead-regions/` is certified by *sampling* and
says so in its own README: a Lipschitz allowance read off the samples, engine playouts
as falsification, no enclosure argument behind any of it. Section 8 of
`THROW-CONTACT-LEMMAS.md` is different in kind. It claims an **enclosure proof** — a
parallelotope around the centre trajectory, the push coefficient pinned by the contact
constraint, "nothing is linearised" — and it claims that proof **closes**. That is the
strongest claim anywhere in this project and the only one that is not sampled. If it
holds it is the foundation the region programme should be built on. If its recorded
numbers are stale relative to its own code, that needs to be known before anything
cites them.

We cannot reproduce them. We may be invoking the tool wrongly; the CLI is undocumented
beyond one comment line. That is exactly why this is going to an outside checker.

---

## 1. The claims

`nn/THROW-CONTACT-LEMMAS.md`, lines 14-19:

> **Update, later the same day: it closes.** Sections 1 to 7 below are the state before
> that [...] Section 8 is what finally made it a proof. At a victim box of +-0.0002u in
> position and +-0.002 rad in rotation, every pose is thrown off the board by 28.33
> degrees of sweep, with the exposed foot's radius bounded below by 67.193u against a
> 67.167u rim. Two thousand sampled poses, zero containment violations.

Section 9, on the second arm:

> This seed has two throw arms. The second, attacker 1 about foot 2 in direction -1, has
> a 110.3 degree limit and throws at substep 112 of 331. It also certifies, at the same
> +-0.0002u / +-0.002 rad box: foot 1's radius at least 67.205u against the rim, 500
> poses, zero violations.

The seed throughout is the certified dead point `ndpxhts24` (`nn/dead-positions.jsonl`):

```
POSE=-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442
```

mover 0 (blue) is the side certified dead, so blue is the victim and **red, index 1, is
the attacker**.

## 2. The CLI

`nn/throw-cert.js` line 946, the only usage documentation that exists:

```
POSE=x,y,rot,x,y,rot node nn/throw-cert.js attacker pv dir jF hx hy hRotDeg [--validate N] [--rows] [--engine]
```

and line 948:

```js
const hx = +args[4], hy = +args[5], hr = +args[6] * DEG;
```

so the seventh argument is a **half-width in DEGREES**, multiplied by `DEG` internally.
The document states its box in **radians**. +-0.002 rad is +-0.11459 deg, 57x wider than
passing `0.002`. Both readings are tried below.

## 3. What we ran, and on which code

Every result below was produced **twice**: once on this branch
(`claude/board-game-video-adaptation-cf8a93`), and once on a scratch rebuild of PR #8's
own stack — `index.html` plus all 100 `nn/*.js` files taken straight from
`origin/claude/nn-arena-matches-tm1hi9`, the branch the document was written on, laid
out so `nn/engine.js`'s `HTML_PATH = ../index.html` resolves to PR #8's `index.html`.

**The two stacks agree with each other exactly, substep for substep and digit for
digit.** So nothing below is a branch difference, and nothing below is an artefact of
this branch's port of `contact-law.js`.

### The stack itself checks out

```
$ POSE=... node nn/throw-cert.js 1 2 -1 1 0.0002 0.0002 0.002 --engine --validate 200
engine check: victim after the swing -37.385491,-32.971827,1.649754
              vs replica            -37.385491,-32.971827,1.649754
              engine netRad 110.333 deg, thrown true
validate: 156 poses, 156 thrown by the replica, 0 violations;
          final foot radius min 67.219 (bound 67.198);
          post-push pair distance in [2.88000, 2.88004] (D 2.88)
```

`contact-law.js`'s REPLICA reproduces the shipped engine to six decimal places on this
sweep, and containment holds on every sampled pose. The machinery works. The question is
only whether the document's numbers describe it.

## 4. The three discrepancies

### (a) Section 8's arm does not certify at all

```
$ POSE=... node nn/throw-cert.js 1 0 -1 1 0.0002 0.0002 0.002
throw arm (0,-1) limit 46.00 deg = 138 substeps of 0.3333 deg; centre thrown 98
  first possible contact at substep 1 (0.33 deg): legs (0,0), centre distance 2.835, pad 0.001
REFUSED: substep 47 (15.67 deg): the push cone did not settle
```

The document says this arm closes, every pose thrown by 28.33 deg = substep 85, and that
"the CENTRE's radius at substep 84 is 67.1934u". The code throws the **centre** at
substep **98**, not 84, and refuses the enclosure at substep 47 — a third of the way to
where the document says it succeeds.

The 46-degree limit and the 138 substeps **do** match section 1 exactly, so the arm and
the seed are right.

`jF` only feeds the final rim test, which is never reached here, and we confirmed it
makes no difference — `jF` = 0, 1 and 2 all refuse at substep 47.

### (b) Section 9's arm certifies, but not where the document says

```
$ POSE=... node nn/throw-cert.js 1 2 -1 1 0.0002 0.0002 0.002 --validate 200
throw arm (2,-1) limit 110.33 deg = 331 substeps of 0.3333 deg; centre thrown 118
  thrown at substep 118 (39.33 deg): foot 1 radius >= 67.1975u over the whole set
                                     (centre 67.2191u), rim 67.167
CERTIFIED: every pose thrown by 39.33 deg (substep 118 of 331)
validate: 156 poses, 156 thrown, 0 violations
```

| | document | code |
| --- | --- | --- |
| arm limit | 110.3 deg | 110.33 deg, 331 substeps -- agrees |
| throws at substep | **112** | **118** |
| foot 1 radius bound | **67.205u** | **67.1975u** |

It certifies, and containment holds. Two of the three numbers differ.

### (c) The stated box refuses; a box 57x smaller certifies

Everything above passes `0.002` as the seventh argument, i.e. **+-0.002 degrees**.
Passing the document's stated **+-0.002 radians**:

```
$ POSE=... node nn/throw-cert.js 1 2 -1 1 0.0002 0.0002 0.11459 --validate 100
REFUSED: substep 107 (35.67 deg): after the push: contact point not localised
         on segments (0,0) (slack 1310.387u of 3.02u)
```

So the arm that certifies does so only at a rotation box 57x tighter than the one the
document reports, and the document's own box refuses.

## 5. What we ruled out

- **Not this branch's port.** PR #8's own stack gives byte-identical output.
- **Not a `contact-law.js` difference.** This branch took PR #8's version after checking
  it over 3,132 swings on all 261 certified dead poses: identical final pose, identical
  recorded sweep, identical flags, 3.76x faster.
- **Not the wrong attacker.** `attacker 0` refuses with a final foot radius of 41.9u --
  that side never approaches the rim. `attacker 1` is the throwing side, as section 9
  states.
- **Not `jF`.** All three foot indices refuse identically on section 8's arm.
- **Not a broken stack.** `--engine` shows replica and shipped engine agreeing to six
  decimals, and every `--validate` run reports zero containment violations.

## 6. What we are asking

1. Is there an invocation of `nn/throw-cert.js` on `ndpxhts24` that reproduces section 8
   — arm (0,-1), the centre thrown near substep 84-85, the enclosure closing with foot
   radius >= 67.193u? If so, what is it?
2. If not: does section 8 describe a code state that was never committed? The document
   records a guard bug fixed the same day (section 9: "It did not certify at any box size
   until a guard was corrected"), which is the kind of edit that could have moved these
   numbers after they were written down.
3. Is the "+-0.002 rad" box a unit slip for "+-0.002 deg"? If it is, section 8's headline
   box is 57x smaller than stated, which is worth correcting wherever it is cited.
4. Independently of the numbers: **is the section 8 argument sound?** The enclosure puts
   the park's linear part into the basis, Lohner-style, using `parkJacobian()`. That is
   the step that turns a multiplying enclosure into a stable one, and it is the part that
   would make this a proof rather than a tighter sampled bound. It is worth a read on its
   own merits even if the reproduction question resolves as a stale doc.

## 7. Reproducing our runs

Both files are on `claude/board-game-video-adaptation-cf8a93`. To rebuild PR #8's stack
for comparison:

```
mkdir -p /tmp/pr8/nn
git archive origin/claude/nn-arena-matches-tm1hi9 index.html | tar -x -C /tmp/pr8
git archive origin/claude/nn-arena-matches-tm1hi9 nn | tar -x -C /tmp/pr8 --wildcards 'nn/*.js'
cd /tmp/pr8 && POSE=-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442 \
  node nn/throw-cert.js 1 2 -1 1 0.0002 0.0002 0.002 --validate 60
```
