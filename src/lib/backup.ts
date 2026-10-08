import type { FinanceDB } from '../db';

export interface BackupFile {
  version: 1;
  exportedAt: string;
  accounts: unknown[];
  categoryGroups: unknown[];
  categories: unknown[];
  txns: unknown[];
  importBatches: unknown[];
}

export async function exportAll(d: FinanceDB): Promise<BackupFile> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: await d.accounts.toArray(),
    categoryGroups: await d.categoryGroups.toArray(),
    categories: await d.categories.toArray(),
    txns: await d.txns.toArray(),
    importBatches: await d.importBatches.toArray(),
  };
}

/** Replaces ALL data with the backup's contents. */
export async function importAll(d: FinanceDB, b: BackupFile) {
  if (b.version !== 1) throw new Error('Unsupported backup version');
  const tables = [d.accounts, d.categoryGroups, d.categories, d.txns, d.importBatches];
  await d.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await d.accounts.bulkAdd(b.accounts as never[]);
    await d.categoryGroups.bulkAdd(b.categoryGroups as never[]);
    await d.categories.bulkAdd(b.categories as never[]);
    await d.txns.bulkAdd(b.txns as never[]);
    await d.importBatches.bulkAdd(b.importBatches as never[]);
  });
}

// ---- passphrase encryption (PBKDF2 -> AES-GCM) so backups are safe to store anywhere ----

const b64 = (u: Uint8Array) => {
  let s = '';
  u.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(text: string, pass: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    await deriveKey(pass, salt),
    new TextEncoder().encode(text),
  );
  return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) });
}

export async function decryptText(payload: string, pass: string): Promise<string> {
  const p = JSON.parse(payload);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(p.iv) as BufferSource },
      await deriveKey(pass, unb64(p.salt)),
      unb64(p.data) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Wrong passphrase or corrupted backup');
  }
}
