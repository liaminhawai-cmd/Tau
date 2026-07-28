# Tau — overnight report

## TL;DR
Seven builds pushed (42–48), all live on tau-game.com: cinematic replay pacing (your dump values),
10 languages incl. Traditional Chinese, a portrait layout that fills the screen, the steel-edition
**email waitlist**, play-the-AI-while-you-wait matchmaking, and Watch-menu replays of finished
games. The Expert AI double-cross work is measured and shipped (47), which also fixes the landscape-phone layout you flagged at 12:35am. Physical
deliverables (box dielines, insert tray, cost model v2.1) are attached as files. **One action needs
you: run SQL section 9 (waitlist table) — the capture modal fails gracefully until it exists.**

---

## Shipped builds (42–48, all live)
- **42 — replay pacing.** Your tuner JSON is the live pacing: per-turn length = 50/50 blend of real
  and smoothed, velocity 24% toward an ease-4.2 curve, pauses = 60% toward 600ms (real thinking gap
  capped at 2s). Live games now record timestamps so "original" timing is exact on any screen;
  share links keep the smoothed profile (they carry no timing — you said that's fine since links
  are the pipeline).
- **43 — languages.** 繁體中文 (Taiwan vocabulary — 登入/載入/連結, not a char-swap), plus 한국어,
  Deutsch, Français, Español, Português (BR), Русский. zh-TW/HK/MO & zh-Hant* → Traditional;
  other zh → Simplified. 🌐 menu lists all ten; `<html lang>` follows. Also: **first visit now
  follows the device's light/dark preference** (your question — yes, and it's done; the ☀ toggle
  still wins once used).
- **44 — layout.** In a game the wordmark row is hidden and portrait mode gives the 3D view a wide
  tile instead of a mostly-empty square: the touch board grew ~20% on a phone. Desktop unchanged.
  (Note: 44 went out with its corner tag still saying "build 43" — my miss; 45 corrected the
  sequence, so don't be confused by screenshots from that window.)
- **45 — waitlist + queue-AI.**
  - *Steel edition — get notified* line under the menu → email modal, all languages. Emails land in
    a new `waitlist` table: insert-only for everyone (even signed-out), unreadable via the API.
    **Export**: SQL editor → `select email, lang, created_at from public.waitlist order by
    created_at;` → Download CSV. **You must run apply_to_live_db.sql section 9 first.**
  - Online queue: after ~5s with nobody around, the searching modal offers **Play the AI while you
    wait** (keeps polling). When someone appears: "Opponent found!" → one tap abandons the AI game
    and enters the match. Leaving to the menu leaves the queue.
- **46 — Watch fallback.** Empty Watch now offers **Most recent game** and **Top-rated game** —
  finished ranked games replayed through the shared-replay viewer (cinematic pacing, tap-to-skip,
  the tumble at the end). Uses the spectate policy you already ran; no new SQL.
- **48 — My replays.** "Save replay" on every game-over sheet keeps the game locally (same
  payload as a share link, titled with the players, 30 max). Watch grows a "My replays" section:
  play, ⧉ share, ✕ delete — and it works fully offline in the installed PWA (verified). This is
  the v1 of your saved-collection idea, shipped rather than recommended.
- **47 — Expert retune + landscape.** The AI work below, plus: sideways phones no longer waste
  side margins — the 3D view absorbs the leftover width as a wide tile (your 12:35am screenshot
  was the trigger; portrait got the same treatment in 44).

## Expert AI (the double-cross blindness)
**Diagnosis.** Expert's move set was six *swing-to-the-limit* moves — it could never stop early to
park a foot in the grace band (centre 0.4–0.8u from a line), so the two-turn double-cross wasn't in
its vocabulary; and its eval was pure rim-margin, blind to the central head start the double-cross
buys (it only noticed once rim distances moved — too late). Your suggestion (use the Hard-mode zone
values + more lookahead) was directionally right.

**Change.** Move generation now records **park stops** during each sweep (a moving foot pausing in
a line's grace band) as extra root candidates alongside all six limit moves; the deeper plies pick
up the grace automatically, so a ply-1 park shows its two-feet-for-one-crossing payoff at ply 3.
Leaves now score margin **plus** small positional terms: your zone/cell values (×0.5) and ×0.8 per
grace-armed foot (mine minus theirs — so it also *values disturbing your park*, the defence you
found missing).

**Measurement** (headless AI-vs-AI harness, jittered starts, colour-swapped):
- Ladder intact: new Expert beat Very hard 10/16 (62.5%) — same territory as before (~65%).
- First tuning (heavy weights, and pruning that could drop limit moves from the deep search) was a
  **regression** head-to-head vs the old Expert — caught by the harness, root-caused (the strongest
  margin move sometimes never got searched), fixed: all six limit moves are always deep-searched,
  parks compete only with each other, weights halved.
- Behavioural probe: across 24 opening plans (6 jittered starts × 4 turns), the retuned Expert
  **deliberately chose an early-stop park twice** — the "left, left" setup move it previously could
  not even represent, now played when (and only when) the 3-ply search says it pays.
- Final head-to-head: **10–13 (+1 draw) over 24 colour-swapped games vs the old Expert — parity
  within noise at that sample size** (the heavy first draft had lost 2–6 as red). The point wasn't
  raw head-to-head anyway; it was the new vocabulary, which the next two lines prove.
- **Defence test (your exploit, directly):** red FORCED to open with its best double-cross park,
  both sides Expert from there — the retuned Expert as blue wins **3–1**. The opener that
  blindsided the old Expert no longer does.
- From the exact standard start it still prefers limit moves for the first few turns — the 3-ply
  search doesn't rate the park line best there, it plays parks when they concretely pay (that's
  by design; the alternative — bribing it with heavy park bonuses — is what caused the regression).
  **Try your red opener against build 47** and tell me what happens; if it still beats Expert,
  next session I'll experiment with an opening-phase park bias, tournament-verified like tonight.

## Answers to your questions
- **Trad vs Simplified:** shipping *both* is the correct answer and it's done. Traditional doesn't
  offend mainlanders (it reads as classical/HK/TW); Simplified genuinely irritates many Taiwanese.
  What matters is the *split by locale*, which is what I wired (zh-TW/HK/MO → Traditional).
- **Which languages were bang-for-buck and why:** Korean (huge gaming market, board-game café
  culture), German (largest EU board-game market, Essen), French (strong hobby market), Spanish
  (Mexico + LatAm + Spain in one), **Portuguese (Brazil = BJJ homeland — your kuzushi marketing
  angle's biggest audience)**, Russian (chess + sambo/judo culture). Skipped for now: Hindi
  (English works for Indian gamers online), Arabic/Farsi (RTL = real layout work — revisit if the
  Iran wrestling angle firms up).
- **Rankings/W-L:** the live-ELO fix + recompute you ran settled this; standings now compound
  correctly. (Watch it for a few days; the recompute is safe to re-run.)
- **Saved-games collection idea:** good instinct — **shipped tonight as build 48** (local-only
  v1: save from any game-over sheet, browse/replay/share/delete from Watch, offline-capable). A
  shareable server-side collection (public profiles with pinned games) is the v2 if this gets
  used — a table + RLS + UI, about a window of work.

## Colour theory (your schemes) + the sandbox
Attached: **board_colors.html** — your colour-grading theory live: cells shaded by
crossings-to-centre (sampled from your board_design.pdf yellow), plus Blue/Grey colourways,
piece-colour pickers, flat-vs-graded toggle, dark/bright room toggle, and Dump values.

The honest read on the theory:
- **Physical board: your grading works.** At a table, the value gradient is *teaching paint* — it
  shows a beginner where safety lives before they've internalised the crossing rule, and the yellow
  family is high-visibility without fighting the red/blue pieces. Klask-style tactile games benefit
  from exactly this kind of legible field.
- **Digital: you already answered it yourself** ("you figure it out for yourself pretty quick") —
  and the AI difficulty labels do the teaching instead. On screen the gradient adds visual noise to
  a UI that sells itself on minimalism, and it would fight the piece-glow cues. My recommendation:
  keep the digital board flat; if you want the grading anywhere digital, put it in the how-to-play
  slides (teach with it, then take it away).
- **Yellow "slightly off":** the PDF's centre yellow (#F7E600-ish) is close to peak-chroma screen
  yellow, which glares on monitors; the sandbox's preset warms it slightly. On steel under UV print
  it will read richer than on screen — judge on a printed sample, not the monitor.
- **Grey for dark mode: yes** — the sandbox's "Grey — dark room" preset is that idea; it reads
  premium and lets the piece colours own the scene.
- **Device light/dark detection: shipped** (build 43).

## Physical deliverables (attached)
Measured from your actual files first, as asked: piece bbox **85.8 × 75.1 × 53.8 mm** (feet at
46.19 mm from hub axis, pads ~3.8 mm below the foot plane) from tripod_smoove_2021.stl; playing
surface **Ø266.7 mm**; Bord.dxf also carries a **Ø293.3 mm base-plate circle**.
- **One question for you (didn't guess):** is the physical board's true outer diameter 266.7 or
  293.3? I generated the box at **both** sizes; bin the wrong one. Also confirm board thickness
  (dielines assume ≤4 mm).
- **tau_box_dieline_267.svg / _293.svg** — round telescoping hatbox: bottom disc + wall strip with
  fold-under glue tabs, lid disc + shallower wall (45% depth), 1 SVG unit = 1 mm, greyboard 2 mm,
  lid slip 0.6 mm/side. Inner depth 70 mm (board + tray + 54 mm pieces + pads). The base wall strip
  is ~890 mm long — die shops handle that, or split it into two arcs.
- **make_box.py** — everything above is parametric; the +30% board is one constant.
- **tau_insert_tray.svg** — die-cut top tray, cavities traced from the STL (hub keep-out + three
  leg channels + pad pockets per piece, interlocked at 60°), finger notches, stack notes.
- **Cost model:** your Project-side **v2 is the canonical one** — it's better-sourced than what I'd
  drafted (named suppliers, your 2021 NT$ quotes, Klask/Crokinole anchors), so I retired mine and
  attached **tau_cost_model_v2.1.html**: your v2 untouched *plus* payment/platform fees and a
  returns allowance now actually taken out of profit, and an "Across quantities" panel (10–500)
  that makes tooling amortisation visible. All your supplier figures preserved.
- **GTM doc magnetism fix:** done — 04_gtm_playbook.md now says magnetic ferritic steel (430 / mild
  steel), flags the 304/316 non-magnetic trap for RFQs, and the same trap is flagged inside the
  cost model's board options. My earlier "avoid magnets" advice was wrong and is corrected
  everywhere it lived.

## Replays: verified public
A fresh browser profile (no cookies, no account) opening a share link boots straight into the
replay — no login wall anywhere in the path. The game data lives in the URL fragment, so it never
even reaches a server. Social embeds show your OG card. Confirmed with an automated pass tonight
(screenshot in the bundle).

## Store estimates (in your "5×-pro 5-hour window" currency)
- **Android (TWA wrapper of the PWA):** ~**1 window** of agent work (manifest/TWA packaging,
  icons, store listing copy) + your human-side Play Console setup ($25, an afternoon incl. the
  12-tester requirement for new personal accounts). Cheapest of the three by far.
- **iOS (Capacitor wrapper):** ~**2–3 windows** (wrapper, safe-area/gesture polish, StoreKit-free
  v1) — but the gating cost is yours: a Mac with Xcode, the $99/yr account, and App Review
  friction (they reject thin wrappers; the offline single-player + Game Center hooks are the
  usual cure — that's the 3rd window).
- **Steam (Electron/Tauri + Steamworks):** ~**2 windows** for a solid wrapper with achievements +
  overlay + cloud saves; **+3–6 windows** if the paid version gets real content (balance-puzzle
  campaign, table environments) — which is what actually justifies a price tag. $100 app fee,
  ~2–8 week review. **Do the free "Coming Soon" wishlist page early regardless.**

## Files in this bundle
`replay pacing already live` · board_colors.html · tau_box_dieline_267.svg · tau_box_dieline_293.svg ·
tau_insert_tray.svg · make_box.py · tau_cost_model_v2.1.html · tau-project-handover.zip (docs
refreshed: magnetism fix, waitlist section, shipped-list) · screenshots (waitlist modal, signed-out
replay, colour sandbox, phone layout before/after).

## Needs you
1. **Run SQL section 9** (waitlist) — top of the list; the site UI is already live.
2. Confirm **board outer diameter** (266.7 vs 293.3) + thickness for the box dieline.
3. Section 6 (username hygiene) if you never ran it.
4. Play the new Expert and try your red double-cross opener on it — tell me if it still gets
   blindsided (the harness says otherwise, but your hands are the real test).
