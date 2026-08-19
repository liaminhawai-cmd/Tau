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

The Steam build is the *pretty* one, and it opens on the **premium showcase**
(`steam.html`, bundled together with `vendor/three`): six art-directed boards
(noir, math, sumo, cosy, alien, colossus) with exact mirror reflections,
MSAA, physically-driven sound — and it's playable: grab one of blue's glowing
feet to take over from the AI. From there, "full game →" (or **F2**) flips to
the full client (menus, online, coach), which the wrapper runs with
`?premium=1`: a premium render path in the game's own 3D view — PCF soft
shadows, ACES filmic tone mapping, a PMREM studio environment for
reflections, lacquered clearcoat pieces and uncapped resolution. The
web/mobile builds are untouched by both (try them in a browser:
`steam.html`, `index.html?premium=1`). The wrapper also passes Chromium GPU
flags (`ignore-gpu-blocklist`, GPU rasterization, discrete-GPU preference on
macOS) so all of it lands on real hardware.

The wrapper (`steam/main.js`) also adds desktop niceties: single-instance,
F11/Esc fullscreen, F2 showcase/full-game toggle, external links open in the
system browser. It also
initialises Steamworks **if** `steamworks.js` is installed
(`npm i steamworks.js`) — optional, for overlay/achievements; the game runs
fine without it. `steam_appid.txt` holds 480 (Valve's test app) — replace
with the real app id.

**Shipping**: create the app + one depot per OS on
[partner.steamgames.com](https://partner.steamgames.com), fill the ids into
`steam/steamworks/app_build.vdf`, then upload with
`steamcmd +login <builder> +run_app_build .../app_build.vdf +quit`.
Launch options: `Tau.exe` (Windows) / `Tau` (Linux) / `Tau.app` (macOS).
The backlog's premium skins (`docs/handover/05`) slot into this build later.
