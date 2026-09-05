# Tau — native builds (Android · Apple · Steam)

The web game (`../index.html`) is fully self-contained, so every native
version is the same game bundled offline in a thin platform shell:

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

Steam now opens `index.html?steam=1&premium=1`: the production rules, AI,
online play and replays with a desktop presentation in `desktop/`. The old
`steam.html` entry redirects here, preserving query parameters and replay links.
There is one game simulation.

The first desktop board uses walnut grain, brass markings and blue/copper metal
pieces, with soft shadows and the game's studio reflections. The menu, match and
rematch use the same scene. Balanced graphics cap resolution at 1.5× and shadow
maps at 1024; High allows 2× and 2048. Both respect lower device resolution.
If WebGL cannot initialize, an overhead board remains playable.

Play starts the selected AI level and side. Same-screen play is untimed. Esc
opens the match menu and pauses offline matches, including an AI turn; an online
opponent's clock continues. Settings persist locally. The result screen offers
Rematch, the next level after a win, a replay when recorded, and Main menu.
Ranked, online and tutorial screens still use their existing game flows.

| Input | Controls |
| --- | --- |
| Mouse | Click a foot to pin; drag another to swing; right-drag the camera |
| Keyboard | 1–3 pin/re-pick; arrows swing; Enter ends turn; Backspace cancels; Esc menu |
| Standard controller | LB/RB choose foot; A pins/ends turn; left stick swings; B cancels; Start menu |
| Controller menus | D-pad moves focus; A activates; left/right changes selectors and sliders |
| Window | F11 toggles fullscreen; Settings also offers fullscreen in Electron |

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
