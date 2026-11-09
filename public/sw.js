// Service worker: lets the app open and work with no connection once it has been loaded once.
// - Same-site files only, inside this app's own folder. Requests to other sites (e.g. the price-data API) are never cached or touched.
// - Pages: network first (so updates arrive on reload), falling back to the saved copy when offline.
// - Scripts, styles and icons: saved copy first. The build lists EVERY file of the app (the first-load files and every screen that loads
//   on demand), and installing saves them all, so every module opens offline, not only the ones visited before going offline.
// - Each build saves into its own cache (`ledger-<build>`). When a new build takes over, the build before it is kept for a while (an
//   already-open tab may still ask for its screens) and anything older is removed. Only caches this app made are ever touched: the same
//   web address also hosts other apps, and their caches are never read, changed or deleted.
// Your financial data is NOT in this cache; it lives in the browser's database (IndexedDB), which this file never touches.

const PREFIX = 'ledger-';
// These two lines are filled in by the build (see src/swBuild.ts). Unfilled (development, tests) the cache is called `ledger-v1`.
const BUILD = '__LEDGER_BUILD__';
const BUILD_FILES = /*LEDGER_FILES*/ [] /*END_LEDGER_FILES*/;
const VERSION = PREFIX + (BUILD.startsWith('__') ? 'v1' : BUILD);
const GENERATION = './ledger-generation.json'; // a small note inside each build's cache: when it was made and whether it is complete
const SCOPE = (self.registration && self.registration.scope) || self.location.origin;
const SCOPE_PATH = new URL(SCOPE).pathname;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
// A built file whose name carries a content hash (assets/BillsModule-DVHHmL1O.js) never changes under that name.
const HASHED = /\/assets\/.+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/;

const json = (v) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });

/** Other builds' caches that this app made, newest first. `marked` is false for a cache with no note inside (made by a version of this app from before builds were tracked). */
async function ownCaches() {
  const mine = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === VERSION) continue;
    let note = null;
    try { const hit = await (await caches.open(name)).match(GENERATION); note = hit ? await hit.json() : null; } catch (_) { /* unreadable: treat as unmarked */ }
    if (note && note.scope && note.scope !== SCOPE) continue; // another copy of the app at a different address: not ours to touch
    mine.push({ name, seq: (note && note.seq) || 0, at: (note && note.at) || 0, marked: !!note });
  }
  // Newest first by install order (`seq`, one more than the highest before it), NOT by the clock: a device whose clock moved back, or two
  // installs in the same millisecond, must not make the wrong build look old. The time is only a tie-break and a record.
  return mine.sort((a, b) => b.seq - a.seq || b.at - a.at);
}

/** Looks for a saved copy of a request in the older builds' caches (an open tab on the old build still asks for its own files). */
async function findInOlderBuilds(request) {
  for (const { name } of await ownCaches()) {
    const hit = await (await caches.open(name)).match(request);
    if (hit) return hit;
  }
  return undefined;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      const urls = [...SHELL, ...BUILD_FILES];
      // Files named in index.html too (development, or a build list that was not filled in), so the very first offline launch works.
      try {
        const html = await (await fetch('./index.html', { cache: 'reload' })).text();
        for (const m of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) urls.push(m[1]);
      } catch (_) {
        /* offline during install: the on-demand cache below will fill in */
      }
      let missing = 0;
      await Promise.all(
        [...new Set(urls)].map(async (u) => {
          try {
            if (await cache.match(u)) return;
            const hashed = HASHED.test(u);
            // A hashed file already saved by the previous build is copied, not downloaded again.
            const copy = hashed ? await findInOlderBuilds(u) : undefined;
            if (copy) { await cache.put(u, copy); return; }
            // Pages and other fixed names bypass the browser's own cache (it can hold the old copy for ten minutes).
            const res = await fetch(u, hashed ? undefined : { cache: 'reload' });
            if (!res.ok) throw new Error('bad status');
            await cache.put(u, res);
          } catch (_) {
            missing++;
          }
        }),
      );
      const seq = Math.max(0, ...(await ownCaches()).map((c) => c.seq)) + 1;
      await cache.put(GENERATION, json({ build: BUILD, seq, at: Date.now(), scope: SCOPE, complete: missing === 0 }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep this build and the one before it (two if this one could not save everything), remove the rest. Only caches this app made.
      let complete = true;
      try {
        const hit = await (await caches.open(VERSION)).match(GENERATION);
        complete = hit ? (await hit.json()).complete !== false : true;
      } catch (_) { /* keep the safer default */ }
      const older = await ownCaches();
      // An unmarked cache is the pre-tracking one: the tabs that used it hold the whole app in memory, so it is not kept.
      const keep = new Set(older.filter((c) => c.marked).slice(0, complete ? 1 : 2).map((c) => c.name));
      for (const { name } of older) if (!keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      if (req.mode === 'navigate') {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (_) {
          return (await cache.match(req)) || (await cache.match('./')) || (await cache.match('./index.html')) || (await findInOlderBuilds('./index.html')) || Response.error();
        }
      }
      const cached = await cache.match(req);
      if (cached && HASHED.test(url.pathname)) return cached; // a hashed file never changes: no need to ask the network again
      if (!cached) {
        const old = await findInOlderBuilds(req);
        if (old) return old; // an open tab running the previous build asking for one of its own files
      }
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
