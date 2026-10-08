// Service worker: lets the app open and work with no connection once it has been loaded once.
// - Same-origin files only. Requests to other sites (e.g. the price-data API) are never cached or touched.
// - Pages: network first (so updates arrive on reload), falling back to the saved copy when offline.
// - Other files (scripts, styles, icons): saved copy first, refreshed in the background.
// Your financial data is NOT in this cache; it lives in the browser's database (IndexedDB).
const VERSION = 'ledger-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // Pre-save the app shell, including the hashed script/style files named in index.html, so the very first
      // offline launch works.
      const urls = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
      try {
        const html = await (await fetch('./index.html', { cache: 'reload' })).text();
        for (const m of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) urls.push(m[1]);
      } catch (_) {
        /* offline during install: the on-demand cache below will fill in */
      }
      await Promise.all([...new Set(urls)].map((u) => cache.add(u).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      if (req.mode === 'navigate') {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (_) {
          return (await cache.match(req)) || (await cache.match('./')) || (await cache.match('./index.html')) || Response.error();
        }
      }
      const cached = await cache.match(req);
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || (await refresh) || Response.error();
    })(),
  );
});
