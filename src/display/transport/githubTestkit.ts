/**
 * Test-only: an in-memory stand-in for the part of GitHub's REST API the display uses, with deterministic failure injection.
 * Never imported by the app. It behaves the way GitHub's documentation says (sha compare-and-swap on PUT, ETag and 304 on GET, 401 for a bad
 * key, 403 for a read-only key writing, 404 for a repository the key cannot see), so the real client code runs unchanged against it.
 */
import { fromB64, toB64 } from './bytes';

export interface FakeToken { can: 'read' | 'write'; expired?: boolean }
export interface FakeGithubOptions { owner: string; repo: string; isPrivate?: boolean; tokens: Record<string, FakeToken>; others?: string[] }
interface Injected { status: number; headers?: Record<string, string>; body?: unknown }

export function createFakeGithub(o: FakeGithubOptions) {
  const files = new Map<string, { sha: string; bytes: Uint8Array }>();
  for (const n of o.others ?? []) files.set(n, { sha: pad(`other-${n}`), bytes: new Uint8Array([1]) });
  let counter = 0;
  const s = {
    files,
    tokens: o.tokens,
    isPrivate: o.isPrivate !== false,
    networkDown: false,
    clock: Date.now(),
    requests: [] as { method: string; path: string; token: string; ifNoneMatch: string | null }[],
    queue: [] as Injected[],
    /** Runs just before a PUT is applied: lets a test make another device write first. */
    beforePut: null as null | (() => void),
    putCount: 0,
    readCount: 0,
    failNext(status: number, headers?: Record<string, string>, body?: unknown) { s.queue.push({ status, headers, body }); },
    /** Puts bytes in the file as if another device had written it. */
    seed(bytes: Uint8Array) { const sha = pad(`v${++counter}`); files.set('display.bin', { sha, bytes }); return sha; },
    get file() { return files.get('display.bin'); },
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', date: new Date(s.clock).toUTCString(), ...headers } });

  const fetchFake: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const token = (headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const method = (init.method ?? 'GET').toUpperCase();
    s.requests.push({ method, path: url.pathname, token, ifNoneMatch: headers.get('if-none-match') }); // an attempt counts even if the network is down
    if (s.networkDown) throw new TypeError('Failed to fetch');
    const injected = s.queue.shift();
    if (injected) return json(injected.status, injected.body ?? { message: 'injected' }, injected.headers);
    const t = s.tokens[token];
    if (!t || t.expired) return json(401, { message: 'Bad credentials' });
    const base = `/repos/${o.owner}/${o.repo}`;
    if (!url.pathname.startsWith(base)) return json(404, { message: 'Not Found' });
    const rest = url.pathname.slice(base.length);
    if (rest === '') return json(200, { private: s.isPrivate, archived: false, permissions: { push: t.can === 'write', pull: true } });
    if (rest === '/contents') {
      if (files.size === 0) return json(404, { message: 'This repository is empty.' });
      return json(200, [...files].map(([name, f]) => ({ name, sha: f.sha, type: 'file' })));
    }
    if (rest === '/contents/display.bin') {
      if (method === 'GET') {
        s.readCount++;
        const f = files.get('display.bin');
        if (!f) return json(404, { message: 'Not Found' });
        const etag = `"${f.sha}"`;
        if (headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, date: new Date(s.clock).toUTCString() } });
        return json(200, { type: 'file', sha: f.sha, size: f.bytes.length, encoding: 'base64', content: toB64(f.bytes) }, { etag });
      }
      if (method === 'PUT') {
        if (t.can !== 'write') return json(403, { message: 'Resource not accessible by personal access token' });
        s.beforePut?.();
        const body = JSON.parse(String(init.body)) as { content: string; sha?: string };
        const f = files.get('display.bin');
        if (f && body.sha !== f.sha) return json(body.sha ? 409 : 422, { message: body.sha ? 'display.bin does not match' : "Invalid request. \"sha\" wasn't supplied." });
        if (!f && body.sha) return json(422, { message: 'sha does not match' });
        s.putCount++;
        const sha = pad(`v${++counter}`);
        files.set('display.bin', { sha, bytes: fromB64(body.content) });
        return json(200, { content: { sha } });
      }
    }
    const blob = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest);
    if (blob) {
      const f = [...files.values()].find((x) => x.sha === blob[1]);
      return f ? new Response(f.bytes as BufferSource, { status: 200 }) : json(404, { message: 'Not Found' });
    }
    return json(404, { message: 'Not Found' });
  };
  return Object.assign(s, { fetch: fetchFake });
}

function pad(seed: string): string {
  let h = 0;
  let out = '';
  for (let i = 0; out.length < 40; i++) {
    h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}
