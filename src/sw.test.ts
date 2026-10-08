import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * Drives the real public/sw.js inside a simulated service-worker environment, so offline behavior is tested without a
 * browser: install pre-caches the app shell (including hashed files named in index.html), pages fall back to the saved
 * copy when the network is gone, and other sites' requests are never touched.
 */

const ORIGIN = 'https://me.github.io';
const BASE = `${ORIGIN}/my-repo/`;
const INDEX_HTML = `<!doctype html><html><head>
<link rel="manifest" href="./manifest.webmanifest" />
<script type="module" crossorigin src="./assets/index-ABC.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-XYZ.css">
</head><body><div id="root"></div></body></html>`;

const abs = (u: string | { url: string }) => new URL(typeof u === 'string' ? u : u.url, BASE).href;

function makeWorld() {
  const files: Record<string, string> = {
    [BASE]: INDEX_HTML,
    [BASE + 'index.html']: INDEX_HTML,
    [BASE + 'manifest.webmanifest']: '{}',
    [BASE + 'assets/index-ABC.js']: 'console.log(1)',
    [BASE + 'assets/index-XYZ.css']: 'body{}',
    [BASE + 'icons/icon.svg']: '<svg/>',
    [BASE + 'icons/icon-192.png']: 'png',
    [BASE + 'icons/icon-512.png']: 'png',
    [BASE + 'icons/apple-touch-icon.png']: 'png',
  };
  const state = { online: true, networkCalls: [] as string[] };

  const fakeFetch = async (u: string | { url: string }) => {
    const url = abs(u);
    state.networkCalls.push(url);
    if (!state.online) throw new TypeError('Failed to fetch');
    const body = files[url];
    return body === undefined ? new Response('nope', { status: 404 }) : new Response(body, { status: 200 });
  };

  const stores = new Map<string, Map<string, Response>>();
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      async match(r: string | { url: string }) { return m.get(abs(r))?.clone(); },
      async put(r: { url: string }, res: Response) { m.set(abs(r), res); },
      async add(u: string) { const res = await fakeFetch(u); if (!res.ok) throw new Error('bad'); m.set(abs(u), res); },
      async keys() { return [...m.keys()].map((url) => ({ url })); },
    };
  };
  const caches = {
    async open(name: string) { return cacheFor(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); },
  };

  const handlers: Record<string, (e: unknown) => void> = {};
  let claimed = false;
  let skipped = false;
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    skipWaiting: async () => { skipped = true; },
    clients: { claim: async () => { claimed = true; } },
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, caches, fetch: fakeFetch, Response, URL, Promise, Set, Request });

  const run = async (type: string, extra: Record<string, unknown> = {}) => {
    let waited: Promise<unknown> | undefined;
    let responded: Promise<Response> | undefined;
    handlers[type]({ waitUntil: (p: Promise<unknown>) => (waited = p), respondWith: (p: Promise<Response>) => (responded = p), ...extra });
    if (waited) await waited;
    return responded ? await responded : undefined;
  };
  const get = (url: string, mode = 'cors') => run('fetch', { request: { method: 'GET', url, mode } });
  return { state, files, stores, run, get, flags: () => ({ claimed, skipped }), setOnline: (v: boolean) => (state.online = v) };
}

describe('service worker', () => {
  it('install pre-caches the app shell, including the hashed script and style named in index.html', async () => {
    const w = makeWorld();
    await w.run('install');
    const cached = [...w.stores.get('ledger-v1')!.keys()];
    for (const f of ['index.html', 'manifest.webmanifest', 'assets/index-ABC.js', 'assets/index-XYZ.css', 'icons/icon-192.png']) {
      expect(cached).toContain(BASE + f);
    }
    expect(w.flags().skipped).toBe(true);
  });

  it('opens the app offline after install: a page navigation is served from the saved copy', async () => {
    const w = makeWorld();
    await w.run('install');
    w.setOnline(false);
    const res = await w.get(BASE, 'navigate');
    expect(res && (await res.text())).toContain('id="root"');
    const js = await w.get(BASE + 'assets/index-ABC.js');
    expect(js && (await js.text())).toContain('console.log');
  });

  it('online page loads come from the network (so updates arrive) and refresh the saved copy', async () => {
    const w = makeWorld();
    await w.run('install');
    w.files[BASE] = INDEX_HTML.replace('root', 'root2');
    const res = await w.get(BASE, 'navigate');
    expect(await res!.text()).toContain('root2');
    w.setOnline(false);
    expect(await (await w.get(BASE, 'navigate'))!.text()).toContain('root2');
  });

  it('a deep link navigation offline falls back to the app shell', async () => {
    const w = makeWorld();
    await w.run('install');
    w.setOnline(false);
    const res = await w.get(BASE + 'some/other/path', 'navigate');
    expect(res && (await res.text())).toContain('id="root"');
  });

  it('never touches other sites (price API) or non-GET requests', async () => {
    const w = makeWorld();
    await w.run('install');
    w.state.networkCalls.length = 0;
    expect(await w.get('https://api.twelvedata.com/price?symbol=VTI&apikey=k')).toBeUndefined();
    expect(await w.run('fetch', { request: { method: 'POST', url: BASE + 'x', mode: 'cors' } })).toBeUndefined();
    expect(w.state.networkCalls).toEqual([]);
    const keys = [...w.stores.get('ledger-v1')!.keys()];
    expect(keys.some((k) => k.includes('twelvedata'))).toBe(false);
  });

  it('other static files are cached on first use and then served from cache', async () => {
    const w = makeWorld();
    await w.run('install');
    w.files[BASE + 'assets/late.js'] = 'late';
    expect(await (await w.get(BASE + 'assets/late.js'))!.text()).toBe('late');
    w.setOnline(false);
    expect(await (await w.get(BASE + 'assets/late.js'))!.text()).toBe('late');
  });

  it('activate removes old cache versions and takes control', async () => {
    const w = makeWorld();
    w.stores.set('ledger-v0', new Map());
    await w.run('install');
    await w.run('activate');
    expect([...w.stores.keys()]).toEqual(['ledger-v1']);
    expect(w.flags().claimed).toBe(true);
  });

  it('install tolerates being offline (cache fills in on demand later)', async () => {
    const w = makeWorld();
    w.setOnline(false);
    await expect(w.run('install')).resolves.toBeUndefined();
  });
});
