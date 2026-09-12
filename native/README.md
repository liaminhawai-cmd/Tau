# Tau — native builds (Android · Apple · Steam)

The web game (`../index.html` plus its three.js bundle in `../vendor/three/`)
needs no server, so every native version is the same game bundled offline in a
thin platform shell:

| Target | Directory | Shell | Output |
|---|---|---|---|
| Android | `app/` | Capacitor 8 | `.apk` (debug) / `.aab` (Play Store) |
| iOS | `app/` | Capacitor 8 | Xcode project → `.ipa` |
| Steam (Win/Linux/macOS) | `steam/` | Electron 38 | depot folders via electron-builder |

`scripts/sync-www.mjs` copies the game + icons from the repo root into each
shell's `www/` — run it (via the npm scripts below) after any game change so
the bundled copy stays current. Online play/accounts still work in all
shells: the game talks straight to Supabase.

## CI (easiest way to get builds)

`.github/workflows/native-builds.yml` builds everything on GitHub runners:
Android debug APK + unsigned release AAB, an unsigned iOS `.app`, and
Steam depot folders for Windows/Linux/macOS. Run it from the Actions tab
("Native builds" → Run workflow) and download the artifacts. It also runs
automatically on pushes to `main` that touch the game or `native/`.

## Android (`app/`)

```bash
cd native/app
npm ci
npm run android:apk      # debug APK → android/app/build/outputs/apk/debug/
npm run android:aab      # release AAB → android/app/build/outputs/bundle/release/
```

Requires the Android SDK (`ANDROID_HOME`) + JDK 21 locally, or just use CI.
App id `com.taugame.app`, portrait-locked, icons/splash generated from
`icon-512.png` (regenerate with `npx capacitor-assets generate` after a logo
change — sources in `app/assets/`).

**Play Store**: the release AAB is unsigned. Create an upload keystore once
(`keytool -genkey -v -keystore tau-upload.keystore -alias tau -keyalg RSA -keysize 2048 -validity 10000`),
sign in `android/app/build.gradle` (`signingConfigs`) or in Play Console with
Play App Signing, bump `versionCode`/`versionName` in `android/app/build.gradle`
per release.

## iOS (`app/`)

The Xcode project is committed at `app/ios/App/App.xcodeproj` (Capacitor 8,
Swift Package Manager — no CocoaPods). Building/signing needs a Mac:

```bash
cd native/app
npm ci
npm run ios:open         # syncs www/ then opens Xcode
```

In Xcode: set your team under Signing & Capabilities, then Product →
Archive → distribute to TestFlight / App Store. Bundle id `com.taugame.app`,
iPhone portrait-locked. CI produces an unsigned `.app` as a compile check.

## Steam (`steam/`)

```bash
cd native/steam
npm ci
npm start                # run the desktop build locally
npm run dist:linux       # dist/linux-unpacked/  (depot content)
npm run dist:win         # dist/win-unpacked/    (cross-builds from Linux too)
npm run dist:mac         # dist/mac*/Tau.app     (needs macOS)
```

Steam opens `index.html?steam=1&premium=1`: the production rules, AI,
online play and replays with a desktop presentation in `desktop/`. There is one
game simulation behind every match. `steam.html` is the six-board premium
showcase (noir, math, sumo, cosy, alien, colossus — mirror reflections, MSAA,
physically-driven sound, a playable takeover): the desktop menu's **Showcase
boards** button opens it, **F2** in the wrapper flips between the two pages from
either side, and its "full game →" link returns to the desktop client. The
showcase is attract-mode only — real matches all run in the one simulation.

The desktop board opens on Walnut — wood grain, brass markings and blue/copper
metal pieces — with soft shadows and the game's studio reflections; the rest of
the catalogue is below. The menu, match and rematch
use the same scene. Balanced graphics cap resolution at 1.5× and shadow maps at
1024; High allows 2× and 2048. Both respect lower device resolution.

Settings offers fourteen boards, and the list is the whole catalogue rather than
a desktop-only sub-set: the browser build's original skins (Dark, Slate, Dojo,
Yellow), the wood finishes (Walnut, Ebony, Maple), the six looks that used to be
locked inside the showcase page (Noir, Math, Sumo, Cosy, Alien, Colossus), and
Marble — a white stone table with black-marble rings and glass pieces: a small
solid coloured ball on legs of clear glass that leave it colourless and take on
its colour as they come down to solid coloured feet. Glass shows through glass:
three's transmission is screen-space and shows only the opaque scene, so a leg
behind another leg used to vanish. With two glass pieces up, the desktop draws
the frame in two passes: everything but the piece nearest the camera goes into
an off-screen picture (the far piece is real glass over the board there), then
that picture is painted across the screen, colour and depth, and the near piece
is rendered on top, so its legs refract the far piece as they refract the board.
Against the dark room a clear leg is drawn by its edges: a Fresnel rim along
them.

Colossus brings its arena into the match: fourteen plain stone steps climbing
away from the sand, the arched wall above them, the hanging dust, and a crowd of
two thousand little stone tripods in the two sides' colours standing on every
step, one instanced draw. The flat board's round tile paints nothing behind the
disc in a desktop match, so the arena shows around it. The camera sits lower
and wider on that board so the tiers rise behind the far rim; haze grades with
distance. A loser goes over at half speed, feet dragging dust through the sand,
a burst at the rim, and the stands leap.

You start on Walnut and **unlock** the rest by playing. The everyday boards open
with wins and games played (Dojo after a win, Slate after three games, Maple,
Dark, Ebony, Yellow along the way); the deluxe looks wait for the high rungs of
the ladder (Cosy 5, Sumo 7, Noir 9, Math 10, Alien the top) or a hundred games
(Colossus at fifty, Marble at a hundred). Finished matches against the AI or
online count, pass-and-play counts as played, the lab never counts. Settings
lists a locked board with what opens it, the result sheet announces an unlock,
and progress is kept locally. A saved board you have not unlocked falls back to
Walnut.

For testing, type **ALLBOARDS** on the main menu (outside text fields). Every
board becomes selectable in Settings. Type it again to restore the normal locks;
earned boards remain available, and a selected testing-only board returns to
Walnut. The override survives a restart and does not alter wins, ladder progress
or Steam achievements.

Each is a single entry defining the flat board's palette, the 3D surface,
markings, rim and backdrop, **and** the piece material, so one choice repaints
both views and the pieces together and they cannot drift apart. Changing it
re-bakes the 1536² surface texture, which is why it only happens on an actual
change and not on every theme refresh. `wood.grain` scales the timber figure, so
slate, drafting paper and Alien's membrane are not printed with oak.

The showcase looks are not re-creations: `desktop/boards.js` is the art module
both pages share, so the game bakes each surface with the very code the showcase
uses (its themes, canvas painters, noise and the Alien membrane shader) and gives
every piece the showcase's per-part materials — Noir's glass, Sumo's lacquer,
Alien's thin-film chitin, Colossus' carved stone. The showcase's own scene (bloom
pass, colosseum stands) stays on that page; these are the same looks rendered by
the game, which is what makes them playable rather than only watchable. Colossus
plays in daylight, so the floating HUD flips to ink over it, decided by the
backdrop's real luminance rather than by which board it is.

Most boards grade their zones the way the flat board always has — the centre a
touch lighter, each band out a touch darker, the lens segments darker again — so
the two views agree about which band a foot is on. Yellow, Math and Alien stay
flat on purpose. The wooden boards are assembled: the centre disc, each ring
band and the six lens segments are separate pieces that meet at the printed
curves, each cut from its plank at its own angle so the grain turns at every
joint, with each zone a different shade of the same timber. There are no
straight cuts anywhere; the joints are the rings and arcs themselves. Slate is
assembled the same way, its cleavage running a different way on each piece, and
so is Marble: its veining turns at every joint, in a neutral grey that favours
neither colour. The bake and the per-pixel shader use the same `woodFrame`, so
the printed figure and the live grain agree on every piece.

Wood and marble boards carry per-pixel surface detail on top of the baked
texture: a fragment-shader pass (`installDetailShader`) adds grain, pores, veins
and glints from world position, so the closer the camera leans in the more there
is to see instead of a texture going soft at 4K. Alien gets its membrane the same
way. The glass looks deliberately get less of it: detail on a refracting surface
reads as dirt. Math runs the showcase's live construction in the game: every foot
projects its pivot-sweep circle onto the board, faint along empty stretches and
bold where it approaches a crossing with an opposite-colour ring or a printed
line, read off the rendered pieces so it glides with the swing.

The flat board draws the pieces at the real tube's width, with the crown and the
foot pads of the 3D piece in plan, so the two views agree about how fat a tripod
is at any board size.

The game runs three.js r169 from `vendor/three/three.global.js`, a classic-script
bundle of the same ES modules the showcase imports (rebuild it with
`node scripts/build-three-global.mjs` after touching `vendor/three/`). The
long-embedded r128 copy in `index.html` could neither refract — its transmission
was an alpha blend, so glass was a tinted ghost — nor do thin-film iridescence;
now the Marble pieces bend the table behind them and Alien's chitin shifts colour
with the angle. Colour management is three's own (hex colours are sRGB, textures
are flagged, the renderer encodes); light intensities carry the ×π that r155
stopped folding in, so the exposure is unchanged.

In a match the 3D view takes the whole window and the flat 2D board floats over
its bottom-left corner, clipped to a circle — the board it draws is a disc, and a
square tile spends a third of its area on empty corners. Drag the grip on its
outer edge along the diagonal to resize it. Past half the window's short side the
two **trade places**: the 3D view eases back into the opposite corner as the
inset, so the flat board becomes the board you are playing on rather than a
minimap that has grown until it covers the pieces it was drawn from. The handover
is continuous across the drag, and the inset clears the Menu button rather than
sliding under it. Both builds go through the one sizing function in index.html
(`resize()`): the browser gets the side-by-side split, the desktop gets the
corner layout, and neither has a second copy of the maths. Desktop is never
missing a view the web build has. If WebGL cannot initialize, the flat board
alone remains playable.

Replays, shared recordings and spectating use the same desktop corner layout,
with a smaller overhead board and room beneath it for replay controls. Captions
and controls align with the 3D view. Watching temporarily caps the overhead size;
returning to play restores the saved size and the resize grip.

The home screen never scrolls: the menu is pinned to the window and clips, and
the offsets the corner layout gives the 3D tile in a match are cleared on the way
back. Behind the menu the ambient demo simulates each next endgame silently (a
whole game in a few hundred milliseconds); the render loop holds the pieces
still until the recorded tail is ready, so arriving at the menu no longer shows a
game flashing by at speed.

**Learn to play** draws the same tripod the match does on its flat board: legs at
the tube's diameter, the crown, the tube-end feet with their pins, in the board
skin's own piece colours, beside the 3D view of the real thing; the whole-game
preview plays at a pace that can be followed. On the 3D pane the foot you hold
glows as it does on the flat board and the cursor turns to a hand over a foot,
so on the push-off slide, where the 3D pane is the only board, a press is seen
to land. The corners-once and two-feet slides are guided: the foot to hold
pulses and dotted rails with arrowheads show the way, on both boards, found at
slide start by swinging a scratch copy of the piece under the real rules until
the goal is met. You still make the move yourself. Done returns to the home
screen with the 3D view laid out for it (it used to come back as a thumbnail in
the corner). The home panel itself scales to a short window rather than
scrolling.

**Sound is in the board's materials.** The design is the web build's: one noise
voice through a bandpass whose pitch tracks the moving piece from low at the
centre to high at the rim, gated by speed, a scrape riding it, a click on pick-up,
a thump as the move begins, the voice climbing into the room on a win or loss.
What the board changes is the noise itself and the room. Each surface bakes its
own looping buffer (a spectral tilt, an amplitude grain, sparse crackle, faint
glassy rings on polished stone), so the same sweep is a chalky rasp on walnut, a
grainy hiss on Colossus's sand and a fine fizz on marble; the surface also sets
how sharp the peak is, how bright the tone stays and how much the room gives
back. The piece sets the impacts: metal ticks, glass pings, stone knocks, wood
toks, and the thump and the rim impact scale with its weight. The Sound panel's
tuning still applies; every material term is a factor on it.

Play starts the selected AI level and side. Same-screen play is untimed. Esc
opens the match menu. The match keeps going underneath it, offline or online, with
the board visible behind the sheet, so the opponent finishes its swing while you
are in Settings, and an online opponent's clock continues. Settings persist locally. The result screen offers
Rematch, the next level after a win, a replay when recorded, and Main menu.
Ranked, online and tutorial screens still use their existing game flows. The
menu's **Lab** button opens the analysis lab (the `#lab` dev route — bench any
two brains, build custom openings, position tools), which a packaged build with
no URL bar could not otherwise reach.

| Input | Controls |
| --- | --- |
| Mouse | Click a foot to pin; drag another to swing; right-drag the camera |
| Keyboard | 1–3 pin/re-pick; arrows swing; Enter ends turn; Backspace cancels; Esc menu |
| Controller (both schemes) | D-pad ←/→ choose foot; A pins/ends turn; B cancels; Start menu; left stick moves the camera |
| …**Triggers** scheme (default) | RT turns clockwise, LT anticlockwise; how hard you pull sets the speed |
| …**Right stick** scheme | Push the right stick left or right; how far you push sets the speed |
| Controller menus | D-pad moves focus; A activates; left/right changes selectors and sliders |
| Window | F11 toggles fullscreen; F2 flips game ↔ showcase; Settings also offers fullscreen in Electron |

The controller scheme is a Settings choice, and the two differ only in which
fingers hold the turn: the D-pad picks the foot and the left stick moves the
camera in both, so neither moves when you switch. **Triggers** is the default and
the pull is analog, so a feather press is a slow controllable creep. The pad
pulses each time a foot crosses a printed line, the rule that decides the turn.
Note the game itself allows one swing direction per turn, so reversing does not
unwind a swing — that is the rulebook, not the input.

An earlier build made the right stick a true dial: its bearing drove the piece
one to one, so you wound your thumb in a circle to turn it. Accurate on paper and
awkward in the hand — playtesting rejected it outright, and it is gone. Speed on
an axis is what both schemes give now.

The left stick is a **look** control: push right and the view turns right, so the
board swings left across the screen; push down and the view tips down onto the
board. That is the opposite of a mouse drag, where you have hold of the board
itself and it follows the cursor — both are right for their own modality, and
they are not expected to agree. Y is the axis people genuinely disagree about, so
Settings has **Invert camera Y**; X does not, because "push right, look right" is
settled.

```bash
# From the repository root: browser development preview
npm ci
npm run preview:steam
# Desktop regression tests (install native/steam dependencies first)
npm run test:steam
```

The tests execute the shipped game and desktop presentation offline in JSDOM,
with simulated input, timers and a CPU canvas. They cover fallback launch,
keyboard/controller turns, pause/AI resume, settings, results and rematch. They
do not certify rendering, audio, real controller hardware or the Steam overlay.
Before a release, play a complete match in the packaged application on the target
GPU, check a physical controller, and test the overlay with the real Steam app ID.

The wrapper also provides single-instance launch and external links in the system
browser. Ordinary web/mobile entry points do not enable the desktop presentation.

**Steam features** (via `steamworks.js`, a production dependency shipped in
the build): the wrapper initialises the Steam API on launch — overlay
(Shift+Tab, wired for Electron), playtime tracking, and a bridge the game
pages use through `window.tauSteam` (see `steam/preload.js`):

- **Achievements** — a human win (vs the AI, ladder/ranked or online;
  never pass-and-play or AI-vs-AI) unlocks
  `ACH_WIN_ONE_GAME`. The existing test integration uses that API name on app 480;
  define it (plus any new ones) under
  Achievements on partner.steamgames.com for the real app.
- **Rich presence** — the friends list shows what you're doing ("In a match vs the AI",
  "In the menus"). Uses the
  `status` key with `steam_display` → `#Status`; add that key in the app's
  Rich Presence localisation on the partner site to make it visible.
- **Graceful degradation** — no Steam client running (or a non-Steam build):
  `steam` stays null, `window.tauSteam.status()` reports
  `{available:false}`, and the game plays identically. On the web,
  `window.tauSteam` simply doesn't exist; every game-side hook is guarded.
- **Launch discipline** — a packaged build with a real app id relaunches
  through Steam when started from outside it (`restartAppIfNecessary`);
  disabled on test id 480 and in dev so it never bounces you into Spacewar.

`steam_appid.txt` holds 480 (Valve's test app) — replace it with the real
app id; `main.js` reads it, so it's the only place to change. Steam Cloud
needs no code: configure Auto-Cloud on the partner site if wanted (game
progress currently lives in localStorage/Supabase).

**Shipping**: create the app + one depot per OS on
[partner.steamgames.com](https://partner.steamgames.com), fill the ids into
`steam/steamworks/app_build.vdf`, then upload with
`steamcmd +login <builder> +run_app_build .../app_build.vdf +quit`.
Launch options: `Tau.exe` (Windows) / `Tau` (Linux) / `Tau.app` (macOS).
The backlog's premium skins (`docs/handover/05`) slot into this build later.
