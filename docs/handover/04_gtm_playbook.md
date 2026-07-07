# Tau — go-to-market playbook (consolidated)

This merges the launch playbook drafted across earlier sessions with corrections and additions.
Where my view differs from the earlier drafts, it's marked **[revision]**.

## Phase 0 — harden & seed (one evening, before any post)
- **Apply the SQL patches** (stale-match GC, username hygiene, the live-ELO `finish_match`, and run
  `recompute_all_elo()` once). See `03_backend_and_sql.md`.
- **Seed the world.** Get ~10 friends/training partners to sign in and play a few ranked games so the
  first strangers don't land in a ghost town — they should see "N playing now", a leaderboard with
  real names, and live/recent games in Watch.
- **[revision] Cold-open insurance.** Also seed a few **shared-replay games into Watch** so a visitor
  landing at 3am to an empty lobby still sees *something*. An empty cold-open is the #1 killer.
- **Record one hero clip** (15–25s) ending on the ring-out. Export vertical (9:16) for
  TikTok/Shorts/Reels and landscape (16:9) for Reddit/X/storefronts.
  - **[revision] Use the shared-replay pipeline, not a live capture.** Replay a hand-picked share
    link — it's deterministic and re-shootable frame-for-frame. Build "cinema mode" first (see
    `05_backlog`).
  - **[revision] Language: pieces *slide* off (sumo ring-out), they don't tumble.** Frame the clip
    and all copy as ring-out. (The beaten piece topples as a flourish, but the skill is the slide.)
- **Cloudflare:** proxy on (orange cloud, SSL Full) once HTTPS is enforced → free caching + drop in
  **Cloudflare Web Analytics** to see which channel actually converts.

## Phase 1 — free shelf space (week 1)
1. **itch.io first** (permanent storefront, not a one-shot post). HTML project, upload the file or
   iframe `tau-game.com`, set free. Cover = og-image, trailer = hero clip, 3 screenshots (menu,
   mid-push, the slide-off). Tags: board-game, abstract, multiplayer, physics, pvp, two-player.
2. **Reddit — one sub/day** (batching looks like spam; reply to every comment in hour one).
   - r/WebGames, r/playmygame — link post + landscape clip.
   - **[revision] r/boardgames** (huge; strict self-promo rules — lead with the physical-designer
     story) and **r/tabletopgamedesign** (loves physical→digital) beat the tiny r/abstractgames.
   - **[revision] r/threejs, r/gamedev** for the single-file / determinism tech angle.
3. **Hacker News "Show HN"** (weekday ~9am ET). Title: *"Show HN: Tau – my physical board game as one
   self-contained HTML file."*
   - **[revision] Lead the first comment with the determinism decision** (don't re-simulate physics
     on both clients because sin/cos aren't bit-identical across engines → broadcast the trajectory
     and converge on an authoritative state). Then: single file, zero deps, inlined Three.js,
     crossing rule as a state machine, 3-ply minimax over the physics sim.
   - **[revision] Do NOT mention the martial-arts angle on HN** — it reads as spin there.
4. **BoardGameGeek** — thread in the Abstract Games forum; the "physical designer releases free
   digital version" story is legit, not an ad. Eventually a BGG database entry.
5. **Product Hunt** — save for week 2–3, after week-1 feedback is patched. One shot.

## Phase 2 — the kuzushi / sumo angle (genuinely good)
Tau is *kuzushi* (off-balancing) and *sumo ring-out* as a board game. Grapplers say "jiu-jitsu is
human chess"; Tau is the inverse — **chess that plays like grappling**.
- **Target the sweet spot, not the A-tier.** Best ROI: **analytical BJJ/judo/sumo creators, 10k–80k**
  — they need weekly material and "this is literally kuzushi/ring-out" writes their video for them.
- On specific names discussed: **Firas Zahabi** is a strong fit (chess + philosophy + answers his
  community). Danaher is A-tier/celebrity (inbox wall). **[revision] Of the A-tier, Mighty Mouse (DJ)
  is the one that could land organically — he's a hardcore gamer/streamer — but warm him via
  short-form content, don't cold-DM.** Askren/Whittaker are lottery tickets. **Sumo-analysis channels
  are an overlooked gold mine** — their ruleset (out of the ring / anything but soles down = loss) is
  literally Tau.
- **The killer move you alone have: send physical sets.** For your top 3–5 dream creators, mail a
  printed set to their gym with a handwritten note + a card with the URL. A physical balance game
  arriving at a martial-arts academy is unboxing content the day it lands. Warm them first (comment on
  their stuff for a week or two).
- **DM/email template — 4 sentences, no ask:** specific genuine first line (this is 80% of reply
  rate) → "I design board games and made one that's basically kuzushi/ring-out on a table: pin a
  foot, off-balance your opponent, slide them off the edge" → free, 5-min learn, tau-game.com →
  "no ask — thought an analytical grappler would spot traps board gamers miss; if you ever want to
  wreck [training partner] on camera I'll mail you the physical set."

## Phase 3 — short-form video engine (TikTok / Shorts / Reels)
The minimalist geometry + the tense slide-to-the-rim is scroll-stopping. Start the clip *right* as a
piece is being crowded to the edge; the split-second teeter before it slides out is the hook. Text
overlays: "A board game where you win by breaking your opponent's balance" / "Literally sumo, but on a
geometric board" / "One rule per turn. Infinite ways off the edge."

## Phase 4 — long-tail moat
- **Print-and-Play:** upload STLs + vector board to Printables/Thingiverse and the BGG PnP forum;
  every home-printed copy is an organic billboard. Link "try it instantly in your browser."
- **[revision] Discord: start with just an invite link.** The "high-level player queued" auto-webhook
  is premature — a rarely-firing channel looks worse than none. Add automation once volume justifies.

## Colourway decisions (updated build 53 — supersedes the earlier "no yellow" call)
- **Digital: four skins the player cycles** with the ☀ button, ordered darkest→lightest and looping:
  **Dark** (original flat dark) → **Slate** (graphite crossings-to-centre grading, steel-blue/clay-red
  pieces) → **Dojo** (warm sand board, indigo/vermilion pieces; 3D brightness matched to the 2D map)
  → **Yellow** (the original pale board). Default is device-driven: dark-mode → Dark, light-mode →
  Yellow; whatever you pick is remembered. (The earlier draft retired yellow and made Slate the sole
  light theme — that was reversed: players liked having all four to toggle.)
- **Physical editions:** lead with **Dojo** (warm/heirloom, marketing-hero) and offer **Slate**
  (cool/premium, flatters the ferritic metal) as the second colourway.

## Physical product notes
- **Pieces are fragile at the ankles.** Resin looks premium but is brittle — wrong for a pushed/
  dropped piece. Print samples/creator-gifts in **PETG/PLA+**; fillet the ankle joints and slightly
  widen foot pads. Injection molding is the endgame (high tooling, pennies/unit); print-on-demand
  until volume justifies a mold.
- **Packaging:** die-cut foam insert (EVA/PU) with a cavity per piece so nothing rattles and feet are
  cradled; at scale a thermoformed PET blister tray is cheapest. Rigid two-piece or magnetic-closure
  box reads premium. (Claude Code can generate the cavity layout + box dieline as SVG from piece
  dimensions.)
- **Board = thin sheet metal — and it must be MAGNETIC.** (Corrects an earlier draft of this doc
  that said to avoid magnets: wrong. The pieces' feet carry embedded magnets and the game's
  crossing/grace rules are tuned around magnetic feet on a magnetic board — the magnets ARE the
  mechanic's feel.) Spec a **ferritic** steel: **430 stainless** (magnetic, rust-resistant, premium)
  or **powder-coated mild steel** (cheaper, coating handles rust). **Beware 304/316 stainless — the
  common austenitic grades are NON-magnetic** and would silently break the mechanic if a supplier
  substitutes them; put "must be ferromagnetic (430/ferritic)" on the RFQ and test a sample with a
  magnet on receipt. **UV-print/screen-print the rings directly** rather than a vinyl sticker
  (stickers bubble/peel under sliding feet). **Safety:** bare cut metal has sharp edges — spec a
  rolled/hemmed or radiused edge.

## Paid Steam version
- **Don't build it yet.** "Same game, nicer lighting" isn't a reason to pay.
- **Do the near-free move now: put up a Steam "Coming Soon" page and collect wishlists.** Wishlists
  are the currency Steam's launch algorithm rewards; bank them for months before building.
- When you build the Deluxe, in priority order: (1) **single-player depth the browser lacks** — a
  campaign / hand-crafted balance puzzles ("force the ring-out in 2"); (2) **environments/vibe** —
  selectable tables (dojo, sumo dohyō, zen garden, mountain cabin) with real lighting + dust/particle
  on the slide-off; (3) **Steam social** — friends, invites, achievements, native leaderboards, cloud
  saves. **VR: shelve it** (big lift, small audience); a "cinematic tabletop" mode gets 80% of the wow
  for 20% of the work. Price low ($3.99–4.99).

## Execution order
Harden DB → seed leaderboard (+ replay games in Watch) → build cinema mode → record hero clips →
itch/Reddit/HN → martial-arts outreach + mail physical sets → PnP/Discord moat. Put up the Steam
"Coming Soon" wishlist page in parallel, decide scope from real demand.
