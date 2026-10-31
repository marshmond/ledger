/** A `RemoteStore` backed by one file in a private GitHub repository, through GitHub's REST API with a token you create. */
import { toB64 } from './codec';
import { RemoteConflict, type RemoteFile, type RemoteStore } from './engine';

export interface GhConfig {
  owner: string;
  repo: string;
  token: string;
}
export const SYNC_FILE = 'ledger-sync.bin';

export class GhError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function explain(status: number, message: string): string {
  if (status === 401) return 'GitHub did not accept the token. It may be mistyped or expired.';
  if (status === 403) return `GitHub refused the request${message ? ` (${message})` : ''}. Check the token has "Contents: read and write" for this repository.`;
  if (status === 404) return 'GitHub could not find that repository, or the token does not have access to it.';
  return message || `GitHub error ${status}.`;
}

export function parseRepo(text: string): { owner: string; repo: string } | null {
  const m = text.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, '') } : null;
}

function caller(cfg: GhConfig, f: typeof fetch) {
  return async function call(path: string, init: RequestInit = {}, raw = false) {
    const res = await f(`https://api.github.com${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      let message = '';
      try { message = ((await res.json()) as { message?: string }).message ?? ''; } catch { /* no body */ }
      throw new GhError(res.status, explain(res.status, message));
    }
    return res;
  };
}

export const BACKUP_DIR = 'backups';
export interface BackupStore {
  /** The backup files in the repository's backups folder (empty if the folder does not exist yet). */
  list(): Promise<{ name: string; sha: string }[]>;
  /** Adds a new file; resolves false if one with that name already exists. */
  add(name: string, text: string, message: string): Promise<boolean>;
  remove(name: string, sha: string, message: string): Promise<void>;
}

/** Dated backup files in a `backups` folder of the same private repository sync uses (sync's own file is not touched). */
export function githubBackups(cfg: GhConfig, f: typeof fetch = (...a) => fetch(...a)): BackupStore {
  const call = caller(cfg, f);
  const dir = `/repos/${cfg.owner}/${cfg.repo}/contents/${BACKUP_DIR}`;
  return {
    async list() {
      try {
        const rows = (await (await call(dir)).json()) as { name: string; sha: string; type?: string }[];
        return Array.isArray(rows) ? rows.filter((r) => r.type !== 'dir').map(({ name, sha }) => ({ name, sha })) : [];
      } catch (e) {
        if (e instanceof GhError && e.status === 404) return []; // no backups folder yet (a missing repo shows up when the upload fails)
        throw e;
      }
    },
    async add(name, text, message) {
      try {
        await call(`${dir}/${name}`, { method: 'PUT', body: JSON.stringify({ message, content: toB64(new TextEncoder().encode(text)) }) });
        return true;
      } catch (e) {
        if (e instanceof GhError && (e.status === 409 || e.status === 422)) return false;
        throw e;
      }
    },
    async remove(name, sha, message) {
      await call(`${dir}/${name}`, { method: 'DELETE', body: JSON.stringify({ message, sha }) });
    },
  };
}

export function githubRemote(cfg: GhConfig, f: typeof fetch = (...a) => fetch(...a)): RemoteStore & { checkRepo(): Promise<{ private: boolean }> } {
  const base = `/repos/${cfg.owner}/${cfg.repo}`;
  const call = caller(cfg, f);
  const checkRepo = async () => ({ private: Boolean(((await (await call(base)).json()) as { private?: boolean }).private) });

  return {
    checkRepo,
    async getFile(): Promise<RemoteFile | null> {
      let list: { name: string; sha: string }[];
      try {
        list = (await (await call(`${base}/contents`)).json()) as { name: string; sha: string }[];
      } catch (e) {
        if (e instanceof GhError && e.status === 404) {
          await checkRepo(); // throws if the repo itself is missing; otherwise it is simply empty
          return null;
        }
        throw e;
      }
      const hit = Array.isArray(list) ? list.find((x) => x.name === SYNC_FILE) : undefined;
      if (!hit) return null;
      // Read the exact version we listed, so what we merge and the version we replace always match.
      const blob = await call(`${base}/git/blobs/${hit.sha}`, {}, true);
      return { sha: hit.sha, bytes: new Uint8Array(await blob.arrayBuffer()) };
    },
    async putFile(bytes, sha, message) {
      try {
        const res = await call(`${base}/contents/${SYNC_FILE}`, { method: 'PUT', body: JSON.stringify({ message, content: toB64(bytes), ...(sha ? { sha } : {}) }) });
        return ((await res.json()) as { content: { sha: string } }).content.sha;
      } catch (e) {
        if (e instanceof GhError && (e.status === 409 || e.status === 422)) throw new RemoteConflict(e.message);
        throw e;
      }
    },
  };
}

