// Tau service worker — makes the game installable and playable offline (single-player at least).
// Bump CACHE on any asset change so stale caches are dropped. The HTML itself is fetched
// network-first (so an online player always gets the newest build), with the cached copy as the
// offline fallback; static assets are cache-first. Cross-origin requests (Supabase auth/realtime)
// are never touched — they always go straight to the network.
const CACHE = 'tau-v30';  // bump on asset changes so clients drop the old cache (v30: light-board crossing flash is teal energy, not dark ink)
const ASSETS = [
  './', './index.html', './tau-logo.png',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png',
  './manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== 'GET') return;   // Supabase etc. -> network only

  if (req.mode === 'navigate') {   // pages: newest when online, cached when offline
    e.respondWith(
      fetch(req).then(r => {
        const cp = r.clone();
        // refresh the game's offline shell only for the game itself; other pages (e.g. the hidden
        // /depth.html) are cached under their own URL so they never clobber the game shell.
        const isGame = (url.pathname === '/' || url.pathname.endsWith('/index.html'));
        const key = isGame ? './index.html' : req;
        caches.open(CACHE).then(c => c.put(key, cp));
        return r;
      }).catch(() => caches.match(req).then(r => {
        // Offline fallback: serve the cached copy of THIS page if we have one. Only the game's
        // own routes fall back to the game shell — a hidden page (depth/set/about/try) must never
        // be answered with the game, which is exactly the "depth.html shows the game" bug.
        if (r) return r;
        const isGame = (url.pathname === '/' || url.pathname.endsWith('/index.html'));
        return isGame ? caches.match('./index.html') : Response.error();
      }))
    );
    return;
  }
  e.respondWith(   // static assets: cache-first, fill the cache on first network hit
    caches.match(req).then(r => r || fetch(req).then(resp => {
      if (resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return resp;
    }))
  );
});
