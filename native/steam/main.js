// Tau — Steam desktop wrapper.
// Opens the production game with the desktop presentation: one menu, simulation and match flow.
// Initialises the Steamworks API (overlay, achievements, rich presence,
// playtime tracking) and bridges it to the game pages via preload.js -> window.tauSteam.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { startLoopbackAuth } = require('./loopback-auth');

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

// ---- Google sign-in -------------------------------------------------------------------------
// Two steps, because the renderer can only ask Supabase for an authorize URL once it knows which
// loopback address to put in it: 'auth:google-begin' reserves the port and mints the state,
// 'auth:google' hands the finished URL to the system browser and waits for the code to come back.
let pendingAuth = null;
function endPendingAuth() {
  if (!pendingAuth) return;
  const flow = pendingAuth;
  pendingAuth = null;
  flow.cancel();
}
ipcMain.handle('auth:google-begin', async () => {
  endPendingAuth();   // a second click abandons the first attempt; there is only one port
  try {
    pendingAuth = await startLoopbackAuth();
    return { port: pendingAuth.port, redirectUri: pendingAuth.redirectUri, state: pendingAuth.state };
  } catch (e) {
    pendingAuth = null;
    return { error: (e && e.message) || 'Could not start sign-in.' };
  }
});
ipcMain.handle('auth:google', async (event, payload) => {
  const flow = pendingAuth;
  const url = payload && typeof payload.url === 'string' ? payload.url : '';
  const state = payload && typeof payload.state === 'string' ? payload.state : '';
  if (!flow) return { error: 'Sign-in was not started.' };
  if (state !== flow.state || !/^https:\/\//i.test(url)) {
    endPendingAuth();
    return { error: 'Sign-in request was rejected.' };
  }
  try {
    shell.openExternal(url);
  } catch (e) {
    endPendingAuth();
    return { error: 'Could not open your browser.' };
  }
  try {
    return await flow.result;
  } finally {
    if (pendingAuth === flow) pendingAuth = null;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#101410',
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

  // F11 owns fullscreen. Escape belongs to the game's pause/settings/back controls.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
    // F2 flips between the desktop game and the six-board premium showcase (steam.html),
    // from either side — the showcase's own "full game →" link comes back here too.
    if (input.key === 'F2') {
      const url = (win.webContents.getURL && win.webContents.getURL()) || '';
      if (url.includes('steam.html')) loadPage(win);
      else win.loadFile(path.join(__dirname, 'www', 'steam.html'), { query: { steam: '1' } });
      event.preventDefault();
    }
  });

  win.on('closed', endPendingAuth);   // never leave a loopback listener behind

  loadPage(win);
}

// Both Steam and steam.html route into this same game. No second rules implementation.
function loadPage(win) {
  win.loadFile(path.join(__dirname, 'www', 'index.html'), { query: { steam: '1', premium: '1' } });
}

ipcMain.handle('desktop:fullscreen', (event, value) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (typeof value === 'boolean') win.setFullScreen(value);
  return win.isFullScreen();
});
ipcMain.handle('desktop:quit', () => { app.quit(); });

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', endPendingAuth);

app.on('window-all-closed', () => {
  app.quit();
});

module.exports = { steamworks, steam };
