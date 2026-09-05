// Exposes a tiny, safe Steam surface to the game pages. The game treats every call as
// fire-and-forget and works identically when Steam is absent (window.tauSteam missing on
// web/mobile, or status() -> { available: false } in a non-Steam desktop launch).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tauSteam', {
  // -> { available, appId?, name? }
  status: () => ipcRenderer.invoke('steam:status'),
  isFullscreen: () => ipcRenderer.invoke('desktop:fullscreen'),
  setFullscreen: (value) => ipcRenderer.invoke('desktop:fullscreen', !!value),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  // Unlock an achievement by its Steamworks API name (idempotent) -> bool
  unlock: (name) => ipcRenderer.invoke('steam:unlock', name),
  // Set the friends-list rich presence line -> bool
  setStatus: (text) => ipcRenderer.invoke('steam:rich-presence', text),
});
