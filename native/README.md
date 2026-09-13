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

Both `app/` and `steam/` sync with `--premium`, which additionally bundles
`desktop/` (the premium showcase board catalogue -- marble, colossus, cosy,
alien, math, walnut -- plus glass-through-glass and the desktop presentation)
and the full `vendor/three/`. `index.html` turns that presentation on for
`?steam=1` (the Electron wrapper) OR when it detects it is running inside a
Capacitor native shell (`window.Capacitor.isNativePlatform()`), which is how
the Android/iOS app gets it with no URL param to set. The plain web/PWA build
gets neither the files nor the flag.

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

### Google sign-in in the app

Google's OAuth servers refuse an app WebView outright (`disallowed_useragent`),
so the web's redirect flow can never work inside the APK — no client-side trick
gets around it. The app instead asks Android's Credential Manager through
`@capgo/capacitor-social-login` and hands Supabase the ID token that comes back
(`signInWithIdToken`). The plugin is already wired up, with Facebook/Apple/
Twitter switched off in `capacitor.config.json` so only Google's SDK ships.

It stays dormant until a client ID is set: with `TAU_GOOGLE_NATIVE_CLIENT_ID`
empty (top of the Supabase section in `index.html`) the panel is exactly as it
was — username & password, no dead Google button. To switch it on:

1. **Google Cloud Console → Credentials → Create OAuth client ID → Android.**
   Package name `com.taugame.app`, SHA-1 of the certificate the build is signed
   with (`keytool -list -v -keystore <keystore> -alias <alias>`; Play App
   Signing shows its own SHA-1 in Play Console → Setup → App integrity). This
   is what makes Google trust the app; nothing from it is pasted into code.
   A debug APK is signed with a different, per-machine debug key, so add that
   SHA-1 too if you want to test before a signed release.
2. **Copy the WEB client ID** — the one the Supabase dashboard's Google provider
   already uses — into `TAU_GOOGLE_NATIVE_CLIENT_ID`. Android's ID token is
   addressed to the *web* client, not the Android one; that trips people up.
3. **Supabase → Authentication → Providers → Google**: add that same web client
   ID under *Authorized Client IDs*, so Supabase accepts tokens with that
   audience.

A client ID can also be tried from the device console (`TAU_GOOGLE_NATIVE_CLIENT_ID
= '…'`, then reopen the sign-in panel) before committing it.

Known gap: unlike the web's `linkIdentity`, an ID-token sign-in cannot fold a
guest's play into the Google account — Supabase has no link-by-ID-token — so a
guest who signs in this way lands on the Google account rather than carrying
their anonymous one over. iOS needs its own iOS OAuth client
(`TAU_GOOGLE_IOS_CLIENT_ID`) plus that client's reversed ID as a URL scheme in
the Xcode project.

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

Colossus brings its arena into the match: the pitch is a stone plinth twenty
units above a sand floor, then thirty-six stone tiers -- each step a little
over one unit high, about half a crowd figure, the way a stadium's rows are
built for the people in them (the old tiers rose fifteen units a riser and the
crowd on them was two and a half tall) -- the arched wall above them and the
hanging dust. The crowd is several thousand little Taus, one packed row per
step, in the pieces' ordinary lacquered blue and red, built to the real piece's
proportions (quarter-circle legs, slim tubes, a small crown bead, no head), one
instanced draw. A fallen titan lands on the sand: a look can set `floorY` and
index.html's stepFall lands there (through `tauDesktop.fallFloorY()`) instead
of on the game's black floor, which the look hides.
The flat board's round tile paints nothing behind the
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

**How to play** draws the same tripod the match does on its flat board: legs at
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

The web build and the PWA now scale up their own rendering on a device that can
carry it -- shadows, reflections, uncapped resolution -- auto-detected from a
quick hardware guess (or forced with ?quality=basic|balanced|high, or from the
console with tauSetQuality(...)); a weak device keeps exactly the old plain
path. Steam and the paid Android app still own the CONTENT -- the showcase
board catalogue, unlocks, glass-through-glass, material acoustics -- since
that's real production work, not a rendering toggle. The standalone Showcase
boards page is gone from the desktop menu; every board is reachable and
unlockable directly in a real match now.

Colossus's crowd was too sparse and its little figures aliased at a distance --
density is a spacing target applied per row (so a wide outer row gets
proportionally more figures than a narrow inner one) and the leg tube is drawn
a little thicker than true. Its bass decays longer and its reverb carries more
high end (a highshelf on the reverb SEND only, so the dry sand stays dark and
muffled -- only the room brightens). Cosy's brass hub ball is smaller, matching
its legs.

Two audio regressions from material acoustics are fixed: the default (metal)
piece's pick-up click and its win/loss rim impact both gained a new tone that
wasn't there before -- both are back to exactly their original sound. In
return, legs meeting legs now get a short contact tick the instant a shove
connects, by the moving piece's material -- once per squeeze, not once per
substep of it.

The walkthrough's corner and two-feet slides (and every try-it slide) now have
a Reset button: a wrong swing that boxes the piece in, or drifts off a guided
slide's one answer, no longer needs leaving the whole walkthrough to recover
from -- Reset puts the piece back at the slide's start pose without losing an
already-earned goal.

The losing piece's tumble used to fall forever into blank space until a
distance cutoff quietly hid it. There is now a dark floor 20cm (100 board
units -- 1u = 2mm) below the board, and the piece actually lands on it: free
fall stops dead at the floor, one material-keyed thump plays on touchdown (a
new `playImpact`-style case, `playLandingSound`), and the piece rests there
for a beat before being tucked away, same as before. The how-to-play finale
and the goal-slide ending share the exact same fall physics, so they land on
the same floor with the same thump instead of running to their own distance
cutoffs.

The premium home menu (Steam and the app) now uses the web app's own words
and shape -- Play (gold, with opponent and colour; this IS the web's "vs
AI"), then 1v1 · Watch · How to play · Leaderboard, and Settings · Controls ·
Lab underneath -- every entry routing to the web's own handler for that
button. Local 1v1 lives inside 1v1 as it does there; the web's physical-set
shop link stays out of a paid build. The tagline, the "A delicate balance"
heading, the material caption, the corner input hint, and the subtitles under
the match menu, the leave confirm and the 1v1 hub are gone. The in-match
"Step 1 / Step 2" coaching lines are gone on EVERY build, web included -- the
line under the board now carries state only (waiting on the opponent, AI
thinking).

Google sign-in in the app is switched on: `TAU_GOOGLE_NATIVE_CLIENT_ID` holds
the web client ID from the Supabase Google provider. For Google to trust the
app, an Android OAuth client (package `com.taugame.app` + a signing SHA-1)
must exist in the same Google Cloud project. CI debug builds are signed with
the pinned key at `app/android/app/debug.keystore` (checked in on purpose:
a fresh runner would otherwise mint a new throwaway key per build and the
SHA-1 would never be stable), whose fingerprint is

    SHA-1  DE:14:23:FC:7E:51:6B:4E:B9:F7:33:23:A5:E3:C0:C4:D9:20:71:19

Register that for CI debug APKs. A locally-built debug APK uses the same key
once this repo is checked out. The Play Store release is signed by a
different key (Play App Signing's, or your upload key) and needs its own
Android OAuth client with that SHA-1.

Pass no `scopes` in the login call. The plugin's Android side already
requests `email`/`profile`/`openid` by default -- naming them again in a
request-level `scopes` array (even the exact same ones) makes it demand a
native `MainActivity` change we have no use for
(`ModifiedMainActivityForSocialLoginPlugin`, needed only for scopes beyond
those defaults) and reject with "You CANNOT use scopes without modifying the
main activity." `nativeGoogleSignIn()` in index.html calls
`plugin.login({ provider: 'google', options: {} })` for exactly this reason.

**Steam has no Google sign-in yet**, and the button is hidden there on
purpose (`isSteamApp()` in index.html, gated like the app's `isNativeApp()`).
The web's redirect flow is the wrong tool in Electron: Google can refuse its
user-agent the way it refuses a WebView, and even when it lets it through
the redirect lands back on a URL with no `?steam=1` (deliberately, so it
matches Supabase's allowed list) -- which drops the whole premium
presentation and leaves the plain web layout in the game window, exactly
what tapping the button did. The right desktop flow is Google's loopback
redirect through the system browser (open the consent URL with
`shell.openExternal`, catch the callback on a temporary `127.0.0.1` server
in the main process, PKCE, exchange for an ID token, hand it to Supabase's
`signInWithIdToken` like the app does). Not built; username/password works.

The contact click is played by the per-frame audio driver
(`updateAudioMovement`), on the rising edge of `G.pushContact` between
rendered frames -- not from inside `applySwing`. The AI's planner runs
`applySwing` in tight loops over the live state while it thinks (snapshot,
sweep, restore, hundreds of times per turn), and a click fired from there
played every simulated shove: a crackle of stone knocks through the whole
think on Colossus with nothing on screen. A frame only ever sees the real
state, and the click also requires the piece to have moved that frame.

Colossus's crowd figures are built to the real piece's proportions now -- the
quarter-circle leg `fusedTripodGeometry` describes, radius equal to height,
with a short vertical foot, a slim tube and a small crown bead. The first
arched pass kept a big sphere for a head over a too-tall, too-fat arc and read
as mushrooms; straight cones before that read as three-legged stools.

In a match the 3D view now fills the whole window and the flat board floats
over it; the room, stands and dust carry on under the flat board instead of
stopping at its column, which used to leave the left third of the window a
blank strip. The corner layout's solved tile (`cornerView3d`) is unchanged
and is still where the dish is framed: the camera treats that tile as its
full image and draws the window as an oversized sub-rectangle of it
(`setViewOffset(w3, h3, -left, -top, W, H)` -- `applyCornerViewOffset` in
index.html, re-applied every frame by the desktop's `updateCamera`), so the
dish keeps exactly its old pixel size and the tile's aspect. The layout
solver's probe camera clears that offset before projecting (a clone carries
it), and the coach-ease aspect tracker stands down in this layout.

Noir's legs are thinner glass with gentler absorption (thickness 6 /
attenuation distance 6, was 11 / 2.4) so they read as tinted glass you see
through rather than opaque coloured plastic. Alien's pieces are
self-luminous: a bright bioluminescent tint per side as the emissive colour
(the dark body colour turned up only ever read as a slightly less dark
surface) at emissive intensity 0.9 (hub) / 1.1 (legs), hot enough for bloom.

**Controls** is its own section (home menu, match menu, F1, Y on a pad): a
drawn keyboard cluster and a drawn controller, each key and button carrying
the name of what it does, with the controller scheme switch. On desktop the
keyboard is rebindable from the same sheet -- click a key, press the new one;
one key does one job; Esc and F1 stay fixed. Bindings live in
`tauDesktopSettingsV1.keys`. Controllers are remapped by Steam Input rather
than in-game, and the app (no keyboard) shows the pictures without rebinding.

Sound: a shove still clicks once on first contact, and while the legs stay
pressed together AND moving it now plays one resonant drag instead -- the
board's noise through a narrow bandpass, pitched by where on the leg the
contact sits (`pushContactFoot`, 0 hub .. 1 foot): high near the foot like
the free end of a ruler, low near the body. Silent at rest and out of contact.

Fixed: on the phone, tapping the in-match Menu button opened the menu and
closed it in the same tap. The button opens on pointerdown; a touch tap then
delivers its click to whatever is under the lift point -- the modal backdrop
-- which counted as tap-outside. Tap-outside now requires the press to have
started on the backdrop. A mouse never hit this.

### Language

The premium presentation keeps no strings of its own. Every label a player
reads goes through index.html's `t()` / `tf()`, against the one set of
translation tables in `I18N` there (ja, zh-Hans, zh-Hant, ko, de, fr, es, pt,
ru, vi), and the language itself is index.html's `LANG` -- read once from
`localStorage.tauLang`, the same key the web app's corner globe writes. A
packaged build has no globe (the desktop CSS hides it), so Settings carries a
**Language** row next to Graphics, listing `LANG_NAMES` in each language's own
name. Choosing one calls `setLang(code)`: it stores `tauLang`, re-points
`LANG`, repaints the labels the page painted for itself, and calls
`tauDesktop.onLangChange()`. Nothing reloads -- a packaged build would drop its
baked board art and its GL context to do that.

Most of this layer needs no help: the Settings and Controls sheets, the match
and result modals and the "choose your controls" screen are written as they
open, so they open in whatever language is current (the Settings sheet
re-opens itself after a switch so the row you just used is in the new language
too). What does need help is anything painted ONCE at load and kept: the home
menu, its opponent list, the toolbar and the board's aria-labels. Those live in
`relabelHome()`, which runs at startup and again on every switch.

To add a string: wrap it in `t('…')` (or `tf('…', {…})` where a value goes
inside -- never string concatenation), and add its English source as a key to
**every** table in index.html. A string held in a const table of sources
(`KEY_ACTIONS`, `SEAT_NAMES`) stays English where it is defined and goes
through `t()` where it is used. The desktop test *every string the premium
layer translates has a translation* reads both shapes out of
`desktop/presentation.js`, checks each against the tables, and fails when a new
literal has no entry anywhere. Left untranslated on purpose: board finish names
(Walnut, Noir), controller makers' own button names (Xbox's A/B, PlayStation's
✕/○), key names (Esc, F1), the build tag and the ALLBOARDS testing messages.
Keep a new label short enough to survive a native `<select>`, which truncates
rather than wraps -- the Graphics row is the tight one.

### Ray tracing (Ultra)

An optional Settings checkbox, off by default and desktop-presentation only
(the plain web/PWA build never carries the files and never asks the question).
With it on, a frame that is standing still is **path traced** — soft shadows,
real bounce light, glass and thin film traced rather than approximated — and
the instant anything moves the ordinary rasteriser draws the frame again. It is
a way to look at a position, not a way to play: no control ever waits on a
traced sample.

**Stills only, and what counts as a still.** Every frame the desktop layer
hashes what the picture depends on: the camera's world and projection matrices,
the drawing-buffer size, each piece's world matrix (or "hidden"), the board, a
counter bumped whenever materials are rebuilt, `fall.active`, `aiAnim`,
`replayActive`, `G.pinned`, `G.netRad`, how far Colossus' stands are through
their jump, whether a sheet is open and `document.hidden`. Same hash two frames
running and the tracer takes the canvas; a different hash and the rasteriser
does, immediately. Matrices are quantised to 1e-3 because OrbitControls' damping
keeps trickling ever-smaller deltas into the camera for seconds after a drag —
at full precision the scene would never once read as at rest. The board's live
cues (the pinned foot's glow, the hover disc, a line-crossing flash) pulse frame
by frame and are not in the traced scene, so while one of them is up the
rasteriser keeps the frame: a board being played on is not a still.

Samples accumulate up to 256, after which nothing is drawn at all and the
finished frame simply stays on the canvas — an idle traced position costs no
GPU. A new viewpoint over the same world is `updateCamera()` only (no BVH work);
a piece moving, a board change or pieces hidden after a fall rebuild the traced
scene through `setScene()`. That build is synchronous: `setSceneAsync()` needs a
BVH web worker, which cannot be shipped inside a classic-script bundle, and the
rebuild lands on a frame that was already at rest.

**One three.js, not two.** The game runs a single `window.THREE`
(`vendor/three/three.global.js`), and the tracer is handed the game's own
meshes, materials and lights — every `instanceof` check inside it has to see the
same classes. So the bundle does not contain three at all:
`scripts/build-pathtracer-global.mjs` resolves `three` to a generated shim that
re-exports `window.THREE`'s names one by one, `three/examples/jsm/*` to the
vendored `vendor/three/addons/*`, and `three-mesh-bvh` to the vendored source.
The traced scene is a `THREE.Scene` whose `children` array is assigned the
game's objects directly rather than `add()`ed, which would reparent them out of
the live scene; three computes each world matrix from the object's real parent,
not from whoever is traversing it, so both scenes see the same transforms.

**What is in the traced scene**: the board surface, rim and trim, the landing
floor, both pieces, the look's surroundings, and the directional key and rim
lights. **What is not**: the dust and mote clouds (`THREE.Points` — a path
tracer has no notion of them), the glow, hover and coach overlays, the fog, the
hemisphere light (the tracer has no equivalent), and Colossus' instanced crowd,
which this version of the tracer would bake as a single figure at the group
origin. Ambient light instead comes from the same studio room the rasteriser
uses (`premiumEnvScene()` in index.html) rendered once into a cube map, which
the tracer converts to the equirect map it can sample. The board's per-pixel
detail shader is an `onBeforeCompile` hook, so the traced board is plain PBR
over the baked map — visibly smoother than the rasterised one.

**Fail-safe.** Anything that throws — the bundle failing to load, the tracer
failing to construct, a scene build, a sample — turns the mode off for the
session, puts the rasteriser back and shows "Ray tracing could not start on this
GPU." The saved setting is deliberately left on: the same profile may open
tomorrow on a machine that can run it.

**Cost.** `vendor/pathtracer/pathtracer.global.js` is ~212 kB and is injected
only when someone ticks the box, so a player who never does never downloads it.

```bash
# rebuild the bundle after changing the vendored sources or three's version
node scripts/build-pathtracer-global.mjs       # fetches esbuild 0.24.0 into a temp prefix
```

The vendored sources are `vendor/pathtracer/three-gpu-pathtracer` (0.0.23 — the
last release that supports three r169; 0.0.24 needs three ≥ 0.180) and
`vendor/pathtracer/three-mesh-bvh` (0.7.8), each with its LICENSE. Both are
committed alongside the built file, the same way three is vendored here.
`src/utils/UVUnwrapper.js` is the one file that wants `xatlas-web`; nothing in
the bundle imports it and the build stubs the module so it can never be pulled
in.

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

The Controls sheet was redrawn at a readable size: it takes a wider box than the
other dialogs (880px), the keyboard and pad pictures are drawn at 760 units
across with 15px labels, and on desktop the keyboard's caps ARE the rebind
buttons -- click a cap on the picture, press the new key. The pad is drawn as an
Xbox-style body and labelled for the make that is plugged in: the connected
pad's id string picks Xbox, PlayStation (△○✕□, L1/L2, Options, sticks low and
the D-pad up top), Nintendo (X/A/B/Y, ZL/ZR, +) or a generic numbered pad, with
a Layout select to override it and Xbox drawn when nothing is connected
(`padBrandOf` in presentation.js). Only the labels change between makes: the
browser's standard mapping already lines the buttons up by position. Below
700px of window the sheet goes compact: the keyboard becomes a key-then-meaning
list (still rebindable) and the pad is drawn bare with its legend underneath.

The sign-in panel is index.html's own `#acctPanel`, a flex child of the web menu
-- which the premium presentation stretches across the whole window, so on Steam
and in the app it landed as a bare column of plain web inputs pinned to the left
edge. It is now a centred sheet in the modals' language (gold primary, the same
box and shadow) with a dimmer behind it. Centred by `inset:0; margin:auto`, NOT
by a transform: a transformed element becomes the containing block for its own
fixed-position descendants, which shrinks the `::before` dimmer to the size of
the sheet sitting in front of it. The dimmer takes no pointer events, so the
document-level click-outside handler that closes the panel still sees the room
behind it.

Watching a leaderboard player's last game works on Steam and in the app the same
way it does on the web, and now looks like it: the row's link carried its web
blue and 12px INLINE, which no stylesheet can override, so on the premium sheet
it was a small blue link lost among gold standings -- and `.wide`, which the
leaderboard sets to make room for that column, lost to the premium modal's own
fixed width. The link's look now lives in CSS (gold on the premium
presentation), the wide box is honoured, and the column carries a "Last game"
heading. The same pairing is also a section of the Watch screen ("Top players'
latest games", `wsRenderTopPlayers`), ranked by leaderboard position -- the
dead `appendTopPlayersRecentGames` helper it replaces was never called from
anywhere.

A fallen piece now rests ON the ground instead of sinking into it. The landing
test clamped `t.position.y`, the piece's ORIGIN -- the plane its three pins
stand on -- but a piece arrives mid-tumble, rotated, so its origin is almost
never its lowest point: one that landed on its side or its crown buried
everything hanging below that plane, up to about 20 units of it. stepFallOn now
measures the lowest point of a small hull (the three pads, each leg's ankle and
arc midpoint, the crown bead, each inflated by the tube radius so the SURFACE
rests, not the centreline) under the piece's current rotation, and clamps that.
The clamp runs after the frame's rotation, which is what decides where "lowest"
is, and it re-runs each frame, so the piece keeps sitting on whichever part
touches down as the last of the spin bleeds off.

The board CASTS a shadow now, not just receives one. Without it the key light went
straight through the board and the pieces standing on it threw shadows down onto
the landing floor a hundred units below, as if the thing they were standing on
were not there -- and because the light rakes in from (70,130,45) those shadows
landed offset from the board's silhouette, so you saw them float on the floor
beside it. The solid rim does the casting rather than the single-sided top plane
(same footprint, and no coplanar caster/receiver to go acne-ridden), Colossus's
plinth casts too, and the key light's shadow box went from +/-95 to +/-125: the
board's own shadow disc reaches about 121 units out once projected down onto the
floor, and the tighter box cut it off with a hard straight edge.

A piece BOUNCES when it hits the floor instead of stopping dead. It keeps 0.38 of
its approach speed, the floor drags on the skid, and the impact both sheds and
adds spin -- shedding matters: a first cut that only ADDED spin could drive the
contact point down as fast as the bounce lifted the piece, so it never visibly
left the ground. Each landing is its own thump, quieter as they die away, and the
count varies naturally with the tumble (two to four from the 20cm floor). The
beat before the piece is tucked away starts when it stops bouncing rather than at
first contact, with `downT` as a backstop so a fall can never hold the camera for
more than a few seconds.

The landing floor moved from a literal 20cm (100 units) to 24 units under the
board. The real drop from a table is the honest number, but at that distance the
loss camera has to pull right back to hold the tumble and the board shrinks away
with it; a short drop reads as "off the board onto the surface below" and keeps
the camera in close, which is what Colossus's own arena floor already did.

The bounce is measured on the CONTACT POINT's closing speed, not the body's fall
speed. A tumbling piece swings the part that touches down on its own account, so
measuring only vy made a fast-spinning piece "land softly", bounce a little, and
have the same spin close the gap again before it could leave the ground -- one
dead thump instead of a bounce, and worse the shorter the drop. With the closing
speed (and a harder spin shed on impact) every drop height gives two or three
bounces that decay properly.

Choose your controls: a local 1v1 -- the one match with two people at one screen
-- opens with a full-screen device pick instead of seating whatever happens to be
plugged in. Blue is on the left, Red on the right, each with its own tripod over
the device that plays it. Blue chooses first: press any button on a pad and that
pad's make is drawn in the slot and asks for its own bottom face button by name
(A / X / B / 1), or press a key or click and it is keyboard and mouse; then Red
does the same. The same device on both sides is simply pass and play and the
screen says so, Esc or a pad's B steps back a stage (and cancels from the first),
and "Skip -- pass and play" is there for anyone who just wants the board.

Input is then gated by SEAT, and through index.html's single inputBlocked() gate
rather than inside each handler. That gate is the one thing every input path
already goes through -- keys, mouse, touch and pad all reach the board via
canPlay()/onDown() -- so the rule lives in one place and a handler added later
cannot forget it. But inputBlocked() is shared with the AI and online rules and
knows nothing about controllers, so the desktop layer tags who is pressing:
pollInput sets window.tauDesktop.inputDevice to 'pad' around the acting pad's
work and leaves it 'kbm' for everything else, and tauDesktop.seatBlocks(device)
answers whether that device is the colour to move. Which pad acts is settled
before that, in pollInput -- the acting pad is the one whose gamepad.index
matches the seat -- so a pad seated to the other colour never gets as far as the
gate; the tag is what keeps the keyboard and mouse off the board on a pad's turn,
and vice versa. Start (button 9) still answers on EVERY pad, so either player can
call the match menu without being handed the other's controller, and every pad's
buttons are remembered per frame -- otherwise the waiting pad fires everything it
was holding the moment the turn passes to it.

Two more things the seats deliberately do not do. With the same device on both
sides seatBlocks is always false: pass and play has nothing to gate. And a pad
that unplugs mid-match takes the gate off entirely rather than stranding the
player whose seat it was -- both colours share whatever is still connected. The
seats belong to the match that chose them and are dropped as soon as pollInput
sees no match, so vs the AI, online and replays never gate anything.

First run: a new player lands on the MENU. The how-to used to open itself at load,
which on a fresh profile (an incognito window is the easy way to see it) read as
the rules flashing up and vanishing again while the page was still settling. The
offer now comes when it is wanted -- the first time someone presses play, a single
"New to Tau?" with "Show me how" and "Just play". Either answer marks the profile
asked, so it never comes back. The test harness seeds `tauOnboard` by default so
only tests passing `opts.freshPlayer` see the offer.

Dust used to spawn only at the BOARD's surface -- `spawnDust` hard-coded its
puff to y 0.4..2.4 -- because the only two call sites were the slide (feet
dragging through the sand) and the rim burst (the tip-over), both of which
happen at board height. Once a look's floor sits well below the board
(Colossus's arena sand, 20 units down), that left the one moment the piece
actually hits the ground with no dust at all: a titan slams down onto sand in
total silence, dust-wise. `stepFallOn` now records every ground contact --
each bounce and the final resting one -- as `fall.lastImpact` (`{x,z,y,speed}`,
`y` being that contact's own floor) and counts them in `fall.bounces`;
`tickEffects` watches `fall.bounces` for an increase and throws a puff at
`fall.lastImpact`, sized by impact speed (a big cloud on the first landing, a
smaller kick on each bounce after, a last quiet settle when it comes to rest).
`spawnDust` takes that contact height as a parameter now instead of assuming
the board, and `tickDust`'s floor clamp reads a puff's OWN ground (stored in
its `userData.dust.floorY`) rather than a single hard-coded plane, so a puff
thrown up on the sand settles on the sand and one thrown up on the board still
falls on past the rim the way it always did.

A fallen piece now ROLLS and stays. It used to be hidden outright 0.6s after the
first contact, which read as the loser blinking out of existence the moment it
touched down. Once it is too slow to bounce again it keeps its sideways speed
under gentle friction with the spin still turning it over its own legs (the
contact clamp re-seats it on whatever is lowest each frame, which is what makes
that read as rolling rather than sliding on the spot), and "resting" now means
actually still rather than merely touching -- so neither a bounce nor a roll is
ever cut off. When it stops, only the animation ends: `fallenIdx` still keeps the
render loop from snapping the mesh back onto the board, but the piece lies where
it fell. The floor went to 34 units down to give the tumble a little more room.

The premium presentation hides index.html's `#buildTag`, so the Settings sheet
prints the build number at the bottom -- "which build am I running" is the first
question any bug report needs answered, and on Steam there was no way to tell.
The Controls sheet prints, live, which pads the game can actually see: a
controller that does nothing is otherwise impossible to tell apart from one the
browser never handed us, since the Gamepad API only reports a pad once its own
window has focus and a button has been pressed on it.

Pads are no longer filtered by `mapping === 'standard'`. Chromium only reports
that mapping for controllers it has a table for; a pad in DirectInput mode, a
USB adapter, or anything unusual reports an empty mapping, and filtering those
out made such a controller invisible to the ENTIRE game -- no seat on the
device-pick screen, nothing in the Controls readout, no way to press anything.
Their button numbers can sit in different places, which is what the readout now
warns about, but a pad that mostly works beats a pad that does nothing at all.

### Google sign-in on Steam (loopback OAuth)

The desktop build used to hide the Google button: a packaged Electron app has no
https origin for Google to return to, Google refuses to render its sign-in page
inside the game window at all, and the web redirect would come back to a URL
with no `?steam=1` on it — which dropped the game out of the desktop
presentation entirely. It now does what Google's own docs prescribe for
installed apps: the sign-in happens in the player's real browser and comes home
to a loopback server.

What happens on a click:

1. The renderer asks the wrapper for a port (`auth:google-begin`). The main
   process opens an `http` server bound to **127.0.0.1** on a fixed port —
   8765, else 8766, else 8767 — and mints a random `state` for this attempt.
2. The renderer asks Supabase for the authorize URL for exactly that address
   (`redirectTo: 'http://127.0.0.1:<port>/'`, `skipBrowserRedirect: true`, so
   nothing navigates), or `linkIdentity` with the same options when the player
   is currently a guest, which keeps their uid, rating and level clears.
3. It hands that URL back (`auth:google`); the main process opens it with
   `shell.openExternal` — the system browser, never the game window — and waits.
4. Google returns to Supabase, Supabase redirects the browser to
   `http://127.0.0.1:<port>/?code=…`. The server answers that one request with a
   small self-contained "you can close this tab" page, closes, and resolves the
   IPC promise with the code.
5. The renderer exchanges the code for a session and hands the tokens to the
   real client with `sb.auth.setSession(...)`.

The server only ever listens on loopback, rejects any request whose remote
address is not loopback, rejects a `state` that is not the one it minted,
answers anything that is not the redirect (a favicon probe) without ending the
flow, gives up after three minutes, and is torn down on window close and on
quit — a second click abandons the first attempt rather than leaking a listener.
A cancelled or timed-out flow is not an error: the panel goes back to how it
was and says nothing.

**Why a second Supabase client.** Only a client on the PKCE flow can exchange
that code, and it must be the same client that generated the verifier. The
shared client (`ensureSupabase`) stays exactly as it is — implicit flow — so the
web redirect path that works today is untouched; `steamGoogleSignIn()` creates a
short-lived client with `flowType: 'pkce'`, `persistSession: false` (which forces
the library's own in-memory storage, so nothing in `localStorage`/
`sessionStorage` is touched), `autoRefreshToken: false` and its own `storageKey`,
uses it for the authorize URL and the exchange, and then throws it away.

**The one manual step.** In the Supabase dashboard → **Authentication → URL
Configuration → Redirect URLs**, add all three, exactly, trailing slash included:

```
http://127.0.0.1:8765/
http://127.0.0.1:8766/
http://127.0.0.1:8767/
```

Sign-in fails with "redirect_to is not allowed" on any machine where the port
that got used is not on that list, which is why the ports are a fixed short list
rather than an ephemeral port.

**No new Google Cloud client is needed.** Google never sees 127.0.0.1: the only
redirect URI it is ever given is Supabase's own
`https://<project>.supabase.co/auth/v1/callback`, already registered for the web
build. The loopback address is purely between Supabase and the desktop app.

Tests: `native/steam/test/loopback.test.cjs` drives the real server over HTTP on
a free port (code, bad state, cancel, provider error, timeout, busy ports),
`wrapper.test.cjs` runs the real `main.js` IPC handlers end to end against a stub
Electron, and `desktop.test.cjs` covers the renderer with the bridge and both
Supabase clients stubbed. Electron itself cannot run in CI, so the only untested
link is `shell.openExternal` actually raising a browser.

Ray tracing moved from a checkbox into the Graphics picker (Balanced / High /
Ultra · ray tracing) with a line under it saying what it is doing. A checkbox
below the fold of a long sheet was simply never found, and "Ultra" is the word
someone looks for when they want the fancy mode. `settings.rayTrace` is now
derived from `settings.quality` so the two can never disagree, and Ultra renders
at the High budget when it is rasterising.

A landing is the piece's MATERIAL now, not one number for everything
(`FALL_MATERIALS`, keyed by the same `currentAcoustics().piece` the sound uses):
glass barely rebounds and skitters, stone lands dead and stops quickly, metal
rings on and rolls furthest. Two things fixed the "hits the ground and pauses"
look. A contact used to shed 70% of the spin, so the piece arrived, stopped
turning and slid flat -- it now keeps most of its tumble, by material. And the
roll is a real rolling constraint: the contact turns the piece at the rate its
own speed implies (v over the distance its contact sits below its centre) about
the axis across its direction of travel, so it tumbles to a halt instead of
skating.
