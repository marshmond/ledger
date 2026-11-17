/**
 * CS-2: reads and writes the ONE display file in a private GitHub repository (GitHub's REST "contents" API).
 *
 * Read-only use (the tablet) and read-write use (a publishing Ledger device) share this client; which one a token can do is decided by the
 * token's own permissions in GitHub. Every failure is turned into a `DisplayStoreError` with a code, so callers can tell a rejected token from
 * a missing repository from a busy server without guessing from text. Tokens are only ever sent in the Authorization header: never in a URL,
 * a log line or an error message.
 *
 * Verified from GitHub's documentation, NOT yet against a live repository (CS-2 acceptance does that): the contents API returns the file as
 * base64 in a JSON object with its `sha`; a PUT with the previous `sha` replaces the file, and a stale or missing `sha` is refused with 409 or
 * 422; a conditional GET with `If-None-Match` answers 304 and does not use the rate limit; browsers may call api.github.com with an
 * Authorization header (CORS). The `ETag`, `Date` and token-expiry response headers may not be readable by a page: the code works without them.
 */
import { fromB64, toB64 } from './bytes';

export const DISPLAY_FILE = 'display.bin';

export interface DisplayRepoConfig { owner: string; repo: string; token: string }
export type StoreErrorCode = 'unauthorized' | 'forbidden' | 'not-found' | 'rate-limited' | 'conflict' | 'too-large' | 'network' | 'server' | 'bad-response';

export class DisplayStoreError extends Error {
  constructor(public code: StoreErrorCode, message: string, public status?: number, public retryAfterSeconds?: number) {
    super(message);
  }
}

export interface DisplayFile { sha: string; bytes: Uint8Array; etag: string | null }
export interface ServerInfo {
  /** The server's clock from the `Date` header, when the browser lets the page read it. */
  serverDate: number | null;
  /** When the token stops working, from GitHub's expiry header, when readable (ISO text). */
  tokenExpiresAt: string | null;
}
export type ReadResult = ({ kind: 'file'; file: DisplayFile } | { kind: 'not-modified' } | { kind: 'missing' }) & { info: ServerInfo };
export interface RepoCheck {
  private: boolean;
  /** True/false when GitHub says; null when it does not say. */
  canWrite: boolean | null;
  hasDisplayFile: boolean;
  /** Names of other files at the top of the repository (the repository should hold the display file and nothing else). */
  otherFiles: string[];
  archived: boolean;
}
export interface DisplayStore {
  read(opts?: { etag?: string | null }): Promise<ReadResult>;
  /** Writes the file. `sha` is the version being replaced, or null to create it. Throws code `conflict` if the file is not at that version. */
  write(bytes: Uint8Array, sha: string | null, message: string): Promise<{ sha: string; info: ServerInfo }>;
  check(): Promise<RepoCheck>;
}

const NAME = /^[A-Za-z0-9._-]{1,100}$/;
export const isRepoPart = (s: string) => NAME.test(s) && s !== '.' && s !== '..';

function explain(status: number, message: string): { code: StoreErrorCode; text: string } {
  if (status === 401) return { code: 'unauthorized', text: 'GitHub did not accept the key. It may have expired or been deleted.' };
  if (status === 404) return { code: 'not-found', text: 'GitHub could not find the display repository, or the key cannot see it.' };
  if (status === 409 || status === 422) return { code: 'conflict', text: 'The display file changed while it was being updated.' };
  if (status === 413) return { code: 'too-large', text: 'The display file is too large for GitHub.' };
  if (status === 403 || status === 429) return { code: 'forbidden', text: `GitHub refused the request${message ? ` (${message.slice(0, 120)})` : ''}. Check the key's permissions for this repository.` };
  if (status >= 500) return { code: 'server', text: 'GitHub had a problem. Try again in a few minutes.' };
  return { code: 'bad-response', text: message ? message.slice(0, 160) : `GitHub error ${status}.` };
}

function infoOf(res: Response): ServerInfo {
  let serverDate: number | null = null;
  let tokenExpiresAt: string | null = null;
  try {
    const d = res.headers.get('date');
    const t = d ? Date.parse(d) : NaN;
    serverDate = Number.isFinite(t) ? t : null;
    const x = res.headers.get('github-authentication-token-expiration'); // e.g. "2027-01-31 00:00:00 UTC"
    const p = x ? Date.parse(x.replace(' UTC', 'Z').replace(' ', 'T')) : NaN;
    tokenExpiresAt = Number.isFinite(p) ? new Date(p).toISOString() : null;
  } catch { /* headers not readable */ }
  return { serverDate, tokenExpiresAt };
}

export function githubDisplayStore(cfg: DisplayRepoConfig, f: typeof fetch = (...a) => fetch(...a)): DisplayStore {
  if (!isRepoPart(cfg.owner) || !isRepoPart(cfg.repo)) throw new DisplayStoreError('bad-response', 'The repository name is not valid.');
  const base = `/repos/${cfg.owner}/${cfg.repo}`;

  async function call(path: string, init: RequestInit = {}, extra: Record<string, string> = {}): Promise<Response> {
    let res: Response;
    try {
      res = await f(`https://api.github.com${path}`, {
        ...init,
        cache: 'no-store',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra },
      });
    } catch {
      throw new DisplayStoreError('network', 'Could not reach GitHub. Check the internet connection.');
    }
    if (res.ok || res.status === 304) return res;
    let message = '';
    try { message = ((await res.json()) as { message?: string }).message ?? ''; } catch { /* no body */ }
    const e = explain(res.status, message);
    let code = e.code;
    let retry: number | undefined;
    const remaining = res.headers.get('x-ratelimit-remaining');
    const retryAfter = res.headers.get('retry-after');
    if (res.status === 429 || (res.status === 403 && (remaining === '0' || retryAfter || /rate limit/i.test(message)))) {
      code = 'rate-limited';
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      retry = retryAfter && Number(retryAfter) > 0 ? Number(retryAfter) : Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil(reset - Date.now() / 1000)) : 60;
    }
    throw new DisplayStoreError(code, code === 'rate-limited' ? 'GitHub is limiting requests for now. Ledger will wait and try again.' : e.text, res.status, retry);
  }

  async function repoExists(): Promise<boolean> {
    try { await call(base); return true; } catch (e) { if (e instanceof DisplayStoreError && e.code === 'not-found') return false; throw e; }
  }

  return {
    async read(opts = {}) {
      let res: Response;
      try {
        res = await call(`${base}/contents/${DISPLAY_FILE}`, {}, opts.etag ? { 'If-None-Match': opts.etag } : {});
      } catch (e) {
        if (e instanceof DisplayStoreError && e.code === 'not-found') {
          // A missing file in an existing repository is "no display file yet"; a missing repository is an error.
          if (await repoExists()) return { kind: 'missing', info: { serverDate: null, tokenExpiresAt: null } };
        }
        throw e;
      }
      const info = infoOf(res);
      if (res.status === 304) return { kind: 'not-modified', info };
      let body: { sha?: unknown; content?: unknown; encoding?: unknown; type?: unknown; size?: unknown };
      try { body = await res.json(); } catch { throw new DisplayStoreError('bad-response', 'GitHub sent an answer that could not be read.'); }
      if (body.type !== 'file' || typeof body.sha !== 'string' || !/^[0-9a-f]{40}$/.test(body.sha)) throw new DisplayStoreError('bad-response', 'GitHub sent an unexpected answer.');
      let bytes: Uint8Array;
      try {
        if (body.encoding === 'base64' && typeof body.content === 'string' && body.content.length > 0) bytes = fromB64(body.content);
        else {
          // Files over 1 MB come without content: read the exact version by its sha.
          const raw = await call(`${base}/git/blobs/${body.sha}`, {}, { Accept: 'application/vnd.github.raw+json' });
          bytes = new Uint8Array(await raw.arrayBuffer());
        }
      } catch (e) {
        if (e instanceof DisplayStoreError) throw e;
        throw new DisplayStoreError('bad-response', 'GitHub sent a file that could not be read.');
      }
      return { kind: 'file', file: { sha: body.sha, bytes, etag: res.headers.get('etag') }, info };
    },

    async write(bytes, sha, message) {
      const res = await call(`${base}/contents/${DISPLAY_FILE}`, { method: 'PUT', body: JSON.stringify({ message, content: toB64(bytes), ...(sha ? { sha } : {}) }) });
      let out: { content?: { sha?: unknown } };
      try { out = await res.json(); } catch { throw new DisplayStoreError('bad-response', 'GitHub did not confirm the update.'); }
      const newSha = out.content?.sha;
      if (typeof newSha !== 'string') throw new DisplayStoreError('bad-response', 'GitHub did not confirm the update.');
      return { sha: newSha, info: infoOf(res) };
    },

    async check() {
      const r = (await (await call(base)).json()) as { private?: boolean; archived?: boolean; permissions?: { push?: boolean } };
      let names: string[] = [];
      try {
        const list = (await (await call(`${base}/contents`)).json()) as { name: string }[];
        names = Array.isArray(list) ? list.map((x) => String(x.name)) : [];
      } catch (e) {
        if (!(e instanceof DisplayStoreError && e.code === 'not-found')) throw e; // an empty repository answers 404
      }
      return {
        private: r.private === true,
        canWrite: typeof r.permissions?.push === 'boolean' ? r.permissions.push : null,
        archived: r.archived === true,
        hasDisplayFile: names.includes(DISPLAY_FILE),
        otherFiles: names.filter((n) => n !== DISPLAY_FILE),
      };
    },
  };
}
