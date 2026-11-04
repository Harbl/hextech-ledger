// Cache the app shell so a dropped wifi connection mid-tournament doesn't take
// the scoreboard down. Bump CACHE to force clients onto a new version.
// addAll() rejects as a whole if any one URL 404s, which silently stops the
// worker installing -- so every entry here must really exist. A test checks it.
// v2 drops the legend/domain meta charts for Riot's developer terms -- a shop
// running offline must not keep being served the old build from cache.
// v3 moves signup import from UVS to playriftbound.com.
// v4 brings the 1v1 mirror back, reading playriftbound.com.
// v5 takes 2v2 pairings from Riot (captains only).
const CACHE = 'hextech-ledger-v5';
const SHELL = ['.', 'index.html', 'app.css', 'app.js',
  'data/legends.json', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never cache the Riot event relay -- signups must be live, and an offline
  // fallback to index.html would import nobody without saying why.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/riot/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
