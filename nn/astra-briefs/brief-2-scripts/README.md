# Scripts and data behind brief 2

Everything here was run on 2026-09-18 against the search code at PR 18's commit e32f09d
(`nn/forced-win.js`, `nn/contact-law.js`, `nn/engine.js` on branch claude/project-thread-kyx87p);
the scripts `require('../forced-win.js')` and `require('../contact-law.js')`, so copy them next to
that `nn/` to rerun. `throw-cert.js` (the interval checker) is the copy in the project files.

- `throw-trace.js` -> `ndpxhts24-throw-rows.json`: the ndpxhts24 throw (blue reply (0,+) 8 deg, red arm (0,-)) substep by substep with the engine's replica: contact location, crossing angle, hf, lever arm, normal, foot gain.
- `checker-runs.txt`: `throw-cert.js` on the post-reply pose at three box sizes plus the Lipschitz cone; per-substep carried boxes.
- `spread.js` -> `engine-spread.txt`: spread of 40 engine trajectories from the same boxes.
- `walls.js` -> `walls-plane-fits.txt`, `programs-21cubed.txt` (verify3.js from the Astra-check thread): the 21^3 program maps of the +-1u boxes at 6dgqa1fd8, 0r8c3cohc, l5807vazg, each wall's plane fit and the arm's event ladder.
- `identify.js`, `verify-walls.js` -> `wall-identities.txt`: matching each wall's plane against closed-form candidates (start-side circles, tangency circles, corner discs, event-order differences), and the rot-independence check of the two-foot order wall.

## Revision, 14:30

Job 1 of the brief was rewritten after the throw-bound thread proved two of the three
lemmas it originally asked for. Its write-up is `/mnt/project-files/throw-contact-lemmas.md`
and its checker is `nn/throw-cert.js` on branch `claude/project-thread-kyx87p` (commit 4532987,
580 lines, with `nn/throw-spread.js` as the measurement tool). Job 1 now asks about the one
obstacle left: the contact point crossing a chord vertex of the attacker's 12-segment leg.

The vertex positions quoted in section 1.5 come from `throw-trace.js` here: over the 24 degrees
of sweep in contact the contact point walks 5.04u down the attacker's leg and 2.74u down the
victim's, at 0.070u per 1/3-degree substep against a 3.023u chord, so it crosses exactly three
vertices (attacker phi = 22.5 deg at sweep 10.6, attacker phi = 15.0 at 24.2, victim phi = 30.0
at 24.4). The checker stops at 12.0 degrees, which is the first of them.
