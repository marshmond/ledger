/** The synced file: the snapshot as JSON, compressed, then encrypted with the passphrase (AES-GCM). The host only ever sees noise. */
import { deriveKey } from '../backup';
import type { Snapshot } from './merge';

const MAGIC = [0x4c, 0x53, 0x59, 0x31]; // "LSY1"
const SALT = 16;
const IV = 12;

async function through(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = t.writable.getWriter();
  w.write(data as BufferSource).catch(() => undefined);
  w.close().catch(() => undefined);
  return new Uint8Array(await new Response(t.readable).arrayBuffer());
}

export async function encodeSnapshot(s: Snapshot, pass: string): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify({ app: 'ledger-sync', v: 1, tables: s.tables, tombstones: s.tombstones }));
  const zipped = await through(json, new CompressionStream('gzip'));
  const salt = crypto.getRandomValues(new Uint8Array(SALT));
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await deriveKey(pass, salt), zipped as BufferSource));
  const out = new Uint8Array(MAGIC.length + SALT + IV + ct.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + SALT);
  out.set(ct, MAGIC.length + SALT + IV);
  return out;
}

export async function decodeSnapshot(bytes: Uint8Array, pass: string): Promise<Snapshot> {
  if (bytes.length < MAGIC.length + SALT + IV + 16 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('That file is not a Ledger sync file.');
  const salt = bytes.slice(MAGIC.length, MAGIC.length + SALT);
  const iv = bytes.slice(MAGIC.length + SALT, MAGIC.length + SALT + IV);
  const ct = bytes.slice(MAGIC.length + SALT + IV);
  let zipped: Uint8Array;
  try {
    zipped = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await deriveKey(pass, salt), ct as BufferSource));
  } catch {
    throw new Error('Wrong sync passphrase, or the synced file is damaged.');
  }
  const parsed = JSON.parse(new TextDecoder().decode(await through(zipped, new DecompressionStream('gzip'))));
  return { tables: parsed.tables ?? {}, tombstones: parsed.tombstones ?? {} };
}

export function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0));
