// Tau — Steam desktop wrapper.
// Opens on the bundled premium showcase (www/steam.html — the GPU-heavy art-directed boards
// with a playable takeover vs-AI game) with the full client (www/index.html, premium mode) one
// keypress/link away. Initialises the Steamworks API (overlay, achievements, rich presence,
// playtime tracking) and bridges it to the game pages via preload.js -> window.tauSteam.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Steam expects a single running instance per user.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// One place to change the app id: steam_appid.txt (also what the Steam API itself reads in dev).
// 480 is Valve's public test app (Spacewar) — replace with the real id from partner.steamgames.com.
let STEAM_APP_ID = 480;
try {
  STEAM_APP_ID = parseInt(fs.readFileSync(path.join(__dirname, 'steam_appid.txt'), 'utf8'), 10) || 480;
} catch {}

// Spend real GPU on the premium renderer: never fall back to software because a driver is on
// Chromium's blocklist, rasterize on the GPU, and on dual-GPU MacBooks prefer the discrete
// chip. The game itself opts into the heavy render path via the ?premium=1 query below.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('force_high_performance_gpu');
}

// ---- Steamworks -------------------------------------------------------------------------------
// All of this degrades gracefully: no Steam client running (or no module) -> steam stays null,
// the game plays exactly the same, and window.tauSteam reports available: false.
let steamworks = null;
let steam = null;
try {
  steamworks = require('steamworks.js');
} catch {
  // Module not installed on this platform — non-Steam build.
}
if (steamworks) {
  // A packaged Steam build launched from outside Steam should bounce through the client (so
  // overlay/DRM/ownership work). Never do this on the shared test app id or in dev, where it
  // would launch Valve's Spacewar instead of us.
  if (app.isPackaged && STEAM_APP_ID !== 480) {
    try {
      if (steamworks.restartAppIfNecessary(STEAM_APP_ID)) app.quit();
    } catch {}
  }
  try {
    steam = steamworks.init(STEAM_APP_ID);
    // The overlay needs in-process-gpu + per-frame invalidation on Electron; must run pre-ready.
    steamworks.electronEnableSteamOverlay();
  } catch {
    steam = null; // Steam not running — keep playing without it.
  }
}

// The bridge the game pages call through preload.js (window.tauSteam). Every handler is
// defensive: page code can't crash the main process with a bad payload.
ipcMain.handle('steam:status', () => {
  if (!steam) return { available: false };
  try {
    return { available: true, appId: STEAM_APP_ID, name: steam.localplayer.getName() };
  } catch {
    return { available: false };
  }
});
ipcMain.handle('steam:unlock', (e, name) => {
  if (!steam || typeof name !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(name)) return false;
  try {
    return steam.achievement.isActivated(name) ? true : steam.achievement.activate(name);
  } catch {
    return false;
  }
});
ipcMain.handle('steam:rich-presence', (e, status) => {
  if (!steam) return false;
  try {
    // 'status' shows in the friends list once the key is defined in the app's Rich Presence
    // localisation on partner.steamgames.com; harmless no-op until then.
    steam.localplayer.setRichPresence('status', String(status ?? '').slice(0, 255));
    steam.localplayer.setRichPresence('steam_display', '#Status');
    return true;
  } catch {
    return false;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#15181c',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External links (rules page, Supabase auth redirects…) open in the
  // system browser, never inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // F11 toggles fullscreen, Esc leaves it; F2 flips between the premium showcase
  // (steam.html) and the full game client — the usual desktop-game feel.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
    } else if (input.key === 'F2') {
      loadPage(win, !win.webContents.getURL().includes('steam.html'));
      event.preventDefault();
    }
  });

  loadPage(win, true);
}

// The Steam build opens on the premium showcase (steam.html): the six art-directed boards with
// mirror reflections, MSAA and the takeover vs-AI game — ?steam=1 tells it to show the
// "full game" link. The full client (menus, online) runs with ?premium=1, which switches its
// 3D view onto the premium desktop render path (shadows, ACES, reflections, full resolution).
function loadPage(win, showcase) {
  if (showcase) {
    win.loadFile(path.join(__dirname, 'www', 'steam.html'), { query: { steam: '1' } });
  } else {
    win.loadFile(path.join(__dirname, 'www', 'index.html'), { query: { premium: '1' } });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

module.exports = { steamworks, steam };
