import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { injectBuild } from './swBuild';

/**
 * The service worker across SEVERAL releases, driven inside a simulated worker environment (a browser is not needed): every screen file is
 * saved at install so every module opens offline; the cache of older releases is trimmed but the release before is kept for tabs that are
 * still open; and nothing outside this app's own caches is ever touched. (The single-release behaviour is in sw.test.ts, unchanged.)
 */

const ORIGIN = 'https://me.github.io';
const BASE = `${ORIGIN}/ledger/`;
const SW = readFileSync('public/sw.js', 'utf8');
const abs = (u: string | { url: string }) => new URL(typeof u === 'string' ? u : u.url, BASE).href;

type Store = Map<string, Response>;
/** What the "browser" keeps between releases: the named caches. A release is a set of server files plus the worker built for it. */
function browser() {
  const stores = new Map<string, Store>();
  return { stores };
}

const release = (id: string, chunks: string[], extra: Record<string, string> = {}) => {
  const files: Record<string, string> = {
    [BASE]: `<html>${id}</html>`,
    [BASE + 'index.html']: `<html>${id}</html>`,
    [BASE + 'manifest.webmanifest']: '{}',
    [BASE + 'icons/icon.svg']: '<svg/>',
    [BASE + 'icons/icon-192.png']: 'png',
    [BASE + 'icons/icon-512.png']: 'png',
    [BASE + 'icons/apple-touch-icon.png']: 'png',
    ...extra,
  };
  for (const c of chunks) files[BASE + c] = `body of ${c}`;
  return { id, files, sw: injectBuild(SW, id, chunks.map((c) => `./${c}`)), chunks };
};

function start(b: ReturnType<typeof browser>, rel: ReturnType<typeof release>, opts: { scope?: string; now?: () => number } = {}) {
  const state = { online: true, network: [] as string[] };
  const fakeFetch = async (u: string | { url: string }) => {
    const url = abs(u);
    state.network.push(url);
    if (!state.online) throw new TypeError('Failed to fetch');
    const body = rel.files[url];
    return body === undefined ? new Response('nope', { status: 404 }) : new Response(body, { status: 200 });
  };
  const cacheFor = (name: string) => {
    if (!b.stores.has(name)) b.stores.set(name, new Map());
    const m = b.stores.get(name)!;
    return {
      async match(r: string | { url: string }) { return m.get(abs(r))?.clone(); },
      async put(r: string | { url: string }, res: Response) { m.set(abs(r), res); },
      async add(u: string) { const res = await fakeFetch(u); if (!res.ok) throw new Error('bad'); m.set(abs(u), res); },
    };
  };
  const caches = {
    async open(name: string) { return cacheFor(name); },
    async keys() { return [...b.stores.keys()]; },
    async delete(name: string) { return b.stores.delete(name); },
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { origin: ORIGIN, href: BASE + 'sw.js' },
    registration: { scope: opts.scope ?? BASE },
    addEventListener: (t: string, fn: (e: unknown) => void) => { handlers[t] = fn; },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  runInNewContext(rel.sw, { self, caches, fetch: fakeFetch, Response, URL, Promise, Set, Request, JSON, Date: { now: opts.now ?? (() => Date.now()) } });
  const run = async (type: string, extra: Record<string, unknown> = {}) => {
    let waited: Promise<unknown> | undefined;
    let responded: Promise<Response> | undefined;
    handlers[type]({ waitUntil: (p: Promise<unknown>) => (waited = p), respondWith: (p: Promise<Response>) => (responded = p), ...extra });
    if (waited) await waited;
    return responded ? await responded : undefined;
  };
  const get = (path: string, mode = 'cors') => run('fetch', { request: { method: 'GET', url: path.startsWith('http') ? path : BASE + path, mode } });
  const text = async (path: string, mode?: string) => { const r = await get(path, mode); return r ? r.text() : undefined; };
  return { state, run, get, text, install: () => run('install'), activate: () => run('activate'), cacheNames: () => [...b.stores.keys()].sort() };
}

const A = release('aaaaaaaaaaaa', ['assets/index-AAAA1111.js', 'assets/BillsModule-AAAA2222.js', 'assets/LedgerModule-AAAA3333.js', 'assets/index-AAAA4444.css']);
// Release B changes the entry and Bills; Ledger and the stylesheet are unchanged (same hashed names).
const B = release('bbbbbbbbbbbb', ['assets/index-BBBB1111.js', 'assets/BillsModule-BBBB2222.js', 'assets/LedgerModule-AAAA3333.js', 'assets/index-AAAA4444.css']);
const C = release('cccccccccccc', ['assets/index-CCCC1111.js', 'assets/BillsModule-CCCC2222.js', 'assets/LedgerModule-CCCC3333.js', 'assets/index-CCCC4444.css']);

describe('every screen is saved at install, so every module opens offline', () => {
  it('saves the first-load files, every on-demand screen, the styles and the shell, in a cache named for the build', async () => {
    const b = browser();
    const w = start(b, A);
    await w.install();
    expect(w.cacheNames()).toEqual(['ledger-aaaaaaaaaaaa']);
    const saved = [...b.stores.get('ledger-aaaaaaaaaaaa')!.keys()];
    for (const c of A.chunks) expect(saved).toContain(BASE + c);
    for (const f of ['index.html', 'manifest.webmanifest', 'icons/icon-192.png']) expect(saved).toContain(BASE + f);
  });

  it('with the network gone, a module that was never opened before still loads from the saved copy', async () => {
    const b = browser();
    const w = start(b, A);
    await w.install();
    w.state.online = false;
    expect(await w.text('assets/BillsModule-AAAA2222.js')).toBe('body of assets/BillsModule-AAAA2222.js');
    expect(await w.text('assets/LedgerModule-AAAA3333.js')).toBe('body of assets/LedgerModule-AAAA3333.js');
    expect(await w.text(BASE, 'navigate')).toContain('aaaaaaaaaaaa');
    expect(await w.text(BASE + 'some/deep/link', 'navigate')).toContain('aaaaaaaaaaaa'); // a deep link falls back to the shell
  });

  it('a hashed file is served from the saved copy without asking the network again; a fixed-name file is still refreshed in the background', async () => {
    const b = browser();
    const w = start(b, A);
    await w.install();
    w.state.network.length = 0;
    await w.text('assets/BillsModule-AAAA2222.js');
    expect(w.state.network).toEqual([]);
    await w.text('manifest.webmanifest');
    expect(w.state.network).toEqual([BASE + 'manifest.webmanifest']);
  });
});

describe('a new release: the cache is trimmed, but only to a bounded size and never under an open tab', () => {
  it('copies unchanged hashed files from the previous release instead of downloading them again, and downloads only what changed', async () => {
    const b = browser();
    const wa = start(b, A);
    await wa.install();
    await wa.activate();
    const wb = start(b, B);
    await wb.install();
    const fetched = wb.state.network.filter((u) => u.includes('/assets/'));
    expect(fetched.sort()).toEqual([BASE + 'assets/BillsModule-BBBB2222.js', BASE + 'assets/index-BBBB1111.js'].sort());
  });

  it('keeps this release and the one before it; a third release removes the first', async () => {
    const b = browser();
    for (const r of [A, B]) { const w = start(b, r); await w.install(); await w.activate(); }
    expect(start(b, B).cacheNames()).toEqual(['ledger-aaaaaaaaaaaa', 'ledger-bbbbbbbbbbbb']);
    const wc = start(b, C);
    await wc.install();
    await wc.activate();
    expect(wc.cacheNames()).toEqual(['ledger-bbbbbbbbbbbb', 'ledger-cccccccccccc']);
  });

  it('the newest builds are chosen by install order, not by the clock: a device whose clock moves back, or two installs in the same millisecond, keeps the right ones', async () => {
    const b = browser();
    const times = { A: 3000, B: 2000, C: 1000 }; // the clock runs BACKWARDS from one install to the next
    for (const [r, k] of [[A, 'A'], [B, 'B'], [C, 'C']] as const) { const w = start(b, r, { now: () => times[k] }); await w.install(); await w.activate(); }
    expect(start(b, C).cacheNames()).toEqual(['ledger-bbbbbbbbbbbb', 'ledger-cccccccccccc']); // the two most recently INSTALLED, whatever the clock said
    const same = browser();
    for (const r of [A, B, C]) { const w = start(same, r, { now: () => 5000 }); await w.install(); await w.activate(); } // one millisecond for all
    expect(start(same, C).cacheNames()).toEqual(['ledger-bbbbbbbbbbbb', 'ledger-cccccccccccc']);
  });

  it('a tab still running the previous release can load a screen it had not opened yet, even after the new worker took over and the old files left the server', async () => {
    const b = browser();
    const wa = start(b, A);
    await wa.install();
    await wa.activate();
    const wb = start(b, B); // B is deployed: A's files are gone from the server
    await wb.install();
    await wb.activate();
    wb.state.online = true;
    wb.state.network.length = 0;
    expect(await wb.text('assets/BillsModule-AAAA2222.js')).toBe('body of assets/BillsModule-AAAA2222.js'); // A's Bills screen, from A's cache
    expect(wb.state.network).toEqual([]); // not even asked of the network
    wb.state.online = false;
    expect(await wb.text('assets/BillsModule-AAAA2222.js')).toBe('body of assets/BillsModule-AAAA2222.js');
  });

  it('two releases later, the oldest release is gone (so the cache cannot grow without limit)', async () => {
    const b = browser();
    for (const r of [A, B, C]) { const w = start(b, r); await w.install(); await w.activate(); }
    const w = start(b, C);
    w.state.online = false;
    expect((await w.get('assets/BillsModule-AAAA2222.js'))?.type).toBe('error'); // nothing saved, offline: no copy of A's screen to give
  });

  it('if a release could not save everything, the two releases before it are kept, so nothing the app had is lost', async () => {
    const b = browser();
    for (const r of [A, B]) { const w = start(b, r); await w.install(); await w.activate(); }
    const wc = start(b, C);
    wc.state.online = false; // the connection drops while the new release is being saved
    await wc.install();
    await wc.activate();
    expect(wc.cacheNames()).toEqual(['ledger-aaaaaaaaaaaa', 'ledger-bbbbbbbbbbbb', 'ledger-cccccccccccc']);
  });

  it('an install that could not reach the network still finishes (the screens are then saved when first used)', async () => {
    const b = browser();
    const w = start(b, A);
    w.state.online = false;
    await expect(w.install()).resolves.toBeUndefined();
  });
});

describe('only this app\'s own caches are ever touched (other apps share the web address)', () => {
  it('never deletes, reads or changes caches that belong to other apps', async () => {
    const b = browser();
    const foreign = ['fbb-v3', 'foodventory-cache', 'workbox-precache-v2-https://me.github.io/FBB/', 'my-ledger-notes', 'LEDGER-upper'];
    for (const name of foreign) b.stores.set(name, new Map([[BASE + 'x', new Response('theirs')]]));
    for (const r of [A, B, C]) { const w = start(b, r); await w.install(); await w.activate(); }
    for (const name of foreign) {
      expect(b.stores.has(name)).toBe(true);
      expect(await b.stores.get(name)!.get(BASE + 'x')!.text()).toBe('theirs');
    }
  });

  it('leaves alone a cache made by another copy of this app at a different address on the same site', async () => {
    const b = browser();
    const other = start(b, A, { scope: ORIGIN + '/ledger-test/' });
    await other.install(); // makes ledger-aaaaaaaaaaaa, marked with the other scope
    const mine = start(b, B);
    await mine.install();
    await mine.activate();
    const wc = start(b, C);
    await wc.install();
    await wc.activate();
    expect(wc.cacheNames()).toContain('ledger-aaaaaaaaaaaa'); // theirs: not trimmed by us
  });

  it('removes a leftover cache from before builds were tracked (the single constant name), once a build is installed', async () => {
    const b = browser();
    b.stores.set('ledger-v1', new Map([[BASE + 'assets/index-OLD00000.js', new Response('old bundle')]]));
    const w = start(b, A);
    await w.install();
    await w.activate();
    expect(w.cacheNames()).toEqual(['ledger-aaaaaaaaaaaa']);
  });

  it('the note kept inside each cache holds only the build id, its install order, the time, the address and whether it is complete', async () => {
    const b = browser();
    const w = start(b, A);
    await w.install();
    const note = JSON.parse(await b.stores.get('ledger-aaaaaaaaaaaa')!.get(BASE + 'ledger-generation.json')!.text());
    expect(Object.keys(note).sort()).toEqual(['at', 'build', 'complete', 'scope', 'seq']);
    expect(note.complete).toBe(true);
  });

  it('does not touch addresses outside its own folder or other sites, and never a POST', async () => {
    const b = browser();
    const w = start(b, A);
    await w.install();
    w.state.network.length = 0;
    expect(await w.get(ORIGIN + '/FBB/index.html')).toBeUndefined();
    expect(await w.get('https://api.github.com/repos/x/y')).toBeUndefined();
    expect(await w.run('fetch', { request: { method: 'POST', url: BASE + 'x', mode: 'cors' } })).toBeUndefined();
    expect(w.state.network).toEqual([]);
  });
});
