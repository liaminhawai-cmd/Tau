# Tau — technical architecture

## Shape of the codebase
- **One file: `index.html`** (~5,100 lines) contains everything — markup, CSS, game loop, physics,
  2D + 3D rendering, AI, networking, i18n, PWA registration. No build step, no framework.
- **Three.js r128** is **inlined** (UMD, ~600KB) for the 3D board view — no external CDN request.
- Supporting files: `sw.js` (service worker, cache `tau-v2`), `manifest.webmanifest`, icons
  (`icon-192/512`, `apple-touch-icon`, `favicon-32`), `og-image.png` (social card), `CNAME`.
- The physical-design source (STLs, board layout) lives outside this file; dimensions used by the
  game are captured in the `CFG` constants (board radius 66.667u, rings at 40 & 53.3u, foot radius
  23.095u, etc.) which mirror the real printed parts.

## Rendering
- **2D canvas** (top-down) and **3D (Three.js)** run together; 3D is always on. A smart auto-camera
  gently fits and re-centres each turn.
- The falling/losing piece is animated with a 3-phase physics tip-over (slide → pivot → free fall)
  and the camera zooms out to follow it.

## The crossing rule (the core mechanic, as a state machine)
- Implemented in `crossingSubstep(before, after, state)`, shared by the real game (`applySwing`).
- A swing is broken into ~0.4° sub-steps; the engine counts ring/arc transitions mid-motion and
  **rolls back** the exact sub-step that would exceed one crossing, creating a hard barrier at the
  rulebook limit.
- Key tolerances (all magnet/pad-scale, tuned against the physical game):
  - `crossEps 0.4` — foot-centre band for counting a crossing / rest checks.
  - `holdEps 0.45` — magnet-scale band that keeps a crossing "episode" open (prevents one smooth
    swing chaining two crossings; to double-cross you must genuinely park a foot on a line one turn
    and continue over it the next — "left, left, then right").
  - `touchEps 0.8` — pad-scale band that stops a foot short of *mounting* a not-yet-visited line once
    the turn's single crossing is spent.

## AI (5 tiers)
Labels → engines:
- **Easy** = simple heuristic (`aiChoosePlan`).
- **Medium** = zone heuristic.
- **Hard** = 1-ply search (`aiChoosePlanZone`).
- **Very hard** = 2-ply minimax (`aiChoosePlanHard`).
- **Expert** = 3-ply minimax (`aiChoosePlanMaster`), searching over the actual physics simulation.
Ladder holds in self-play (Expert beats Very hard ~65%).

## Physics / push model
- Rigid tripod with rotational inertia; contact solved with an iterative push solver (10 iters per
  sub-step, penetration-capped to avoid tunnelling). Only the mover's turn is simulated locally.

## Replay & shareable links
- Every match records **per-frame poses** `[blueX, blueY, blueRot, redX, redY, redRot]` (motion
  frames, ~60fps, near-identical frames skipped).
- Playback is **arc-length parameterised**: it advances through cumulative piece travel at a constant
  rate (default 22 units/sec) so a fast flick and a slow drag inside one swing play back evenly.
  (This is the thing currently being tuned — see the replay tuner and `05_backlog`.)
- **Shareable replays** pack the whole recording *into the link* (`#r=` fragment): downsample to
  ~0.15u steps, delta-encode, int16-quantise, deflate, base64url. No server. Opening the link boots
  straight into a replay viewer. **This doubles as the trailer pipeline** — a link replays the exact
  game, frame-perfect, ready for screen capture.

## Online multiplayer (sync model)
- Whoever's turn it is computes their move locally (instant feedback) and **broadcasts the recorded
  trajectory + the authoritative resulting state**. The other client never re-runs the physics — it
  only replays the keyframes and snaps to final state. This deliberately avoids two clients
  independently simulating "the same" turn, because `sin/cos` aren't bit-identical across browser
  engines and hundreds of sub-steps could drift apart. (This determinism decision is the strongest
  "Show HN" talking point.)
- Trust model: a player's own turn is self-reported. Fine for a casual beta; **server-side move
  validation is a known future hardening pass**, not v1.

## i18n
- `LANG` auto-detected (`ja*`/`zh*`), override in `localStorage.tauLang`. `t(str)` / `tf(str, vars)`
  with `{name}` placeholders and an `I18N` dictionary. English source string is the fallback.

## PWA
- `sw.js`: network-first for the HTML (online players always get the newest build), cache-first for
  assets, never touches cross-origin Supabase. Bump the `CACHE` constant on asset changes.
