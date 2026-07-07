# Tau — backlog & open threads

## Recently shipped (builds 47–53)
- **Four board skins** (build 53), cycled by the ☀ button darkest→lightest and looping: Dark, Slate,
  Dojo (warm sand), Yellow. Default follows device theme (dark→Dark, light→Yellow); the choice is
  remembered. Dojo's 3D board brightness was matched to its flat 2D map.
- **Replay pacing rebuilt** (build 53): the smoothing blends the *arc fraction* (how far along the
  swing) between the true recorded timing and an eased curve, then samples the path once — instead of
  averaging two poses, which cut chords across the curve and *added* the jerkiness a mid blend value
  was supposed to remove. Baked values: turnLen 0.41, velBlend 0.66, curveExp 3.4.
- **Replay audio for both players** + a 2× volume boost (playback is slower than real time, so foot
  speed — and thus the synthesised slide/scrape volume — was too quiet, and only tracked Blue).
- **Replay UI**: during a replay the Surrender button is replaced by a Share this game / Skip bar;
  the Watch menu now always offers browsable categories (Live now, Most recent, Top-rated, **Most
  watched** = saved most often, My replays) and every replay ends with a "Watch another" escape.
  Most-watched is backed by SQL section 10 (save_count + bump_save_count) and degrades gracefully.
- **Physical-game waitlist reframed** (build 50): the sell is "Tau is a real tabletop game", not a
  steel edition. The modal captures interest in **free DIY print-and-play files** and/or the **full
  shipped kit** (`interest` column: diy / kit / both).
- **iOS safe-area** (build 52): controls, logo and build tag clear the notch / status bar / home bar.

## Recently shipped (builds 42–46)
- **Cinematic replay pacing** baked in from the tuner dump (turn-length blend, eased velocity,
  capped thinking-gap pauses). Recordings now carry timestamps; share links stay smoothed.
- **10 languages** (en/ja/zh-Hans/zh-Hant/ko/de/fr/es/pt/ru), auto-detected, 🌐 corner menu.
- **Portrait layout rework**: wordmark hidden in-game, wide 3D tile, ~20% bigger touch board.
- **Steel-edition waitlist** (menu line → email modal → `waitlist` table; SQL section 9).
- **Play-the-AI-while-you-wait** in the online queue, with opponent-found handoff.
- **Watch fallback**: most-recent / top-rated finished game replays when nothing is live.
- **Theme follows device** light/dark on first run (explicit toggle still wins).
- **Expert AI double-cross retune** (47): park moves in the search, zone/park-aware eval,
  tournament-verified (parity head-to-head, defence vs the forced double-cross opener 3–1).
- **My replays** (48): local saved-games collection in Watch — save/share/delete, offline-capable.
- **Landscape layout fill** (47): wide 3D tile absorbs leftover width on sideways phones.

## In flight
- **Cinema mode** (trailer capture): a UI-less, clean render with slow-mo on the ring-out, driven by a
  shared-replay link. Build this before the short-form video push — it *is* the trailer pipeline.
- **Board colour playtest** (`board_colors.html` sandbox, delivered): zone-value shading from the
  physical colour-grading theory vs flat digital look; dump-values workflow to pick a scheme.

## Premium visual skins (Steam / deluxe build — needs a graphics upgrade)
These go beyond the flat-colour skin system (which is albedo only) — they need PBR materials,
textures and post-processing that suit the paid Steam build, not the lightweight web game:
- **Antique wood + metal:** a real wood board (albedo + normal + roughness maps for grain/wear) with
  metallic pieces (high metalness, low roughness, an environment map for reflections). Heirloom look.
- **Glass / transparent:** board and pieces in translucent glass — Three.js `transmission` +
  `thickness` + `ior`, black inlaid lines, driven hard by lighting: bloom on the highlights, soft
  shadows, maybe caustics. The kind of thing a GPU makes sing and the web build shouldn't attempt.
Both are "cosmetic environments/skins" that justify the paid tier (see the Steam section in the GTM
doc). Ship the free web game flat; save material-heavy skins for the deluxe.

## Product backlog (not yet built)
- **Larger board size option** (~30% bigger) for touch/"fat fingers".
- **Steam "Coming Soon" wishlist page** (near-free, high value — do early; see GTM doc).
- **Physical deliverables v1 delivered** (box dieline SVGs at 267/293mm, insert tray SVG, pricing
  calculator HTML + parametric `make_box.py`); iterate with real supplier quotes and a measured
  prototype (confirm which disc is the true outer diameter — playing surface 266.7 vs DXF base
  plate 293.3).

## Known limitations (deliberate, deferred)
- **Server-side move validation.** `finish_match` trusts the client-reported winner. Fine for a
  casual beta; a real hardening pass would validate the move sequence server-side before awarding
  ELO. Revisit if cheating shows up.
- **Shared-replay links are downsampled** (~0.15u steps), so the "exactly as played / real-time" end
  of the replay tuner looks close to constant-velocity when fed a share link. Full within-swing speed
  variance only exists in the live game's full-resolution recording. The tuner's built-in demo shows
  the full contrast; if you need to tune against a *specific real game*, we'd add a full-resolution
  export to the live game.

## Deploy gotcha (for reference)
- GitHub Pages' deploy step occasionally fails transiently ("Deployment failed, try again later")
  while the build itself succeeds — the site then serves the previous build. Re-running the "pages
  build and deployment" workflow (or pushing again) publishes the new build. Confirm via the faint
  build-number tag in the bottom-left corner of the live site.

## How to keep this pack useful
When something ships or a decision changes, update the relevant file here and re-upload it to the
Project. The highest-value things to keep current: the **"what SQL has been applied"** section in
`03_backend_and_sql.md`, this backlog, and the build number / live state in `01_product_overview.md`.
