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

  win.loadFile(path.join(__dirname, 'www', 'index.html'));
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
