// Exposes a tiny, safe Steam surface to the game pages. The game treats every call as
// fire-and-forget and works identically when Steam is absent (window.tauSteam missing on
// web/mobile, or status() -> { available: false } in a non-Steam desktop launch).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tauSteam', {
  // -> { available, appId?, name? }
  status: () => ipcRenderer.invoke('steam:status'),
  isFullscreen: () => ipcRenderer.invoke('desktop:fullscreen'),
  setFullscreen: (value) => ipcRenderer.invoke('desktop:fullscreen', !!value),
  // F11 belongs to the window, not to the page, so the page is told when it has been pressed --
  // otherwise the remembered Fullscreen setting and the window it describes drift apart.
  onFullscreenChange: (fn) => ipcRenderer.on('desktop:fullscreen-changed',
                                             (_e, value) => { try { fn(!!value); } catch (_) {} }),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  // Unlock an achievement by its Steamworks API name (idempotent) -> bool
  unlock: (name) => ipcRenderer.invoke('steam:unlock', name),
  // Set the friends-list rich presence line -> bool
  setStatus: (text) => ipcRenderer.invoke('steam:rich-presence', text),
  // Reserve the loopback port Google will come back to -> { port, redirectUri, state } | { error }
  googleAuthBegin: () => ipcRenderer.invoke('auth:google-begin'),
  // Open that authorize URL in the system browser and wait -> { code } | { cancelled } | { error }
  googleSignIn: (url, state) => ipcRenderer.invoke('auth:google', { url: String(url ?? ''), state: String(state ?? '') }),
});
