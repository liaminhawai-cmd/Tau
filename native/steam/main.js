// Tau — Steam desktop wrapper.
// Loads the bundled game (www/index.html) in a frameless-friendly window and,
// when the Steamworks native module is present, initialises the Steam API so
// the overlay, playtime tracking and (later) achievements work.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Steam expects a single running instance per user.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Spend real GPU on the premium renderer: never fall back to software because a driver is on
// Chromium's blocklist, rasterize on the GPU, and on dual-GPU MacBooks prefer the discrete
// chip. The game itself opts into the heavy render path via the ?premium=1 query below.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('force_high_performance_gpu');
}

let steamworks = null;
try {
  // Optional: only present in Steam builds (`npm i steamworks.js`).
  // steam_appid.txt next to the executable supplies the app id in dev.
  steamworks = require('steamworks.js').init();
} catch {
  // Not running under Steam / module not installed — the game works fine
  // without it; online play goes through Supabase either way.
}

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

  // F11 toggles fullscreen, Esc leaves it — the usual desktop-game feel.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
    }
  });

  // ?premium=1 switches the game's 3D view onto its premium desktop render path
  // (shadows, ACES tone mapping, environment reflections, uncapped resolution).
  win.loadFile(path.join(__dirname, 'www', 'index.html'), { query: { premium: '1' } });
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

module.exports = { steamworks };
