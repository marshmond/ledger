/**
 * CS-2: the encrypted display file ("LDP1") and the keys behind it.
 *
 * File layout (bytes):   "LDP1" | version (1) | revision (4, big-endian) | salt (16) | iv (12) | AES-GCM ciphertext
 *   - the ciphertext is the gzip of canonical JSON  { v:1, publisher:{id,mode}, projection }
 *   - the first nine bytes are authenticated (AES-GCM additional data): changing the version or the revision, or swapping in another file's
 *     header, makes decryption fail. The revision is a plain publish counter; it reveals nothing about the household.
 *   - a fresh random salt and a fresh random iv are made for EVERY file.
 *
 * Keys. One display passphrase (made by Ledger, never the sync or backup passphrase) gives one master key:
 *     PBKDF2-SHA256(passphrase, fixed domain salt, 310,000 rounds)  ->  HKDF master key (non-extractable)
 *   and from the master key, by HKDF with different labels:
 *     file key  = AES-GCM-256, salt = the file's own salt          (changes with every file)
 *     id key    = HMAC-SHA256, used for the opaque ids in the file (the SAME on every publisher with the passphrase, so ids stay stable)
 * The domain salt is a fixed public string on purpose: the passphrase is a random 160-bit value Ledger generates, so a per-installation
 * salt adds nothing, and a fixed one lets a second publishing device derive identical ids from the passphrase alone.
 *
 * Imports only the projection contract and its own helpers. The tablet app uses this file as it is.
 */
import { canonicalJson, MIN_READER, validateProjection, VERSION, type DisplayProjection, type IdKey } from '../contract';
import { concat, fromUtf8, sameBytes, utf8 } from './bytes';

export const MAGIC = new Uint8Array([0x4c, 0x44, 0x50, 0x31]); // "LDP1"
export const ENVELOPE_VERSION = 1;
export const KDF_ITERATIONS = 310_000;
const SALT = 16;
const IV = 12;
const HEADER = MAGIC.length + 1 + 4;
const MIN_FILE = HEADER + SALT + IV + 16;
/** A decompressed payload this large is refused before it is parsed (the contract itself caps a projection at 500 KB). */
const MAX_PLAIN = 2_000_000;
const DOMAIN_SALT = utf8('ledger-display/passphrase-salt/v1');
const INFO_FILE = utf8('ledger-display/file-key/v1');
const INFO_IDS = utf8('ledger-display/opaque-ids/v1');

/** Who wrote the file: a random id per publishing device, and whether that device keeps in step through Ledger sync. */
export interface PublisherInfo { id: string; mode: 'sync' | 'single' }
export interface DisplayKeys { master: CryptoKey }

export const PASSPHRASE_RE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A random display passphrase: 160 bits as eight groups of four letters and digits. Meant to be saved in a password manager. */
export function generatePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 160; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g)!.join('-');
}
export const normalizePassphrase = (s: string) => s.trim().toUpperCase().replace(/[\s_]+/g, '-');

export async function deriveDisplayKeys(passphrase: string, iterations = KDF_ITERATIONS): Promise<DisplayKeys> {
  const base = await crypto.subtle.importKey('raw', utf8(normalizePassphrase(passphrase)) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: DOMAIN_SALT as BufferSource, iterations, hash: 'SHA-256' }, base, 256);
  return { master: await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']) };
}

/** The key that makes entry, person and decision ids opaque. Identical for every device that has the passphrase. */
export function idKeyOf(keys: DisplayKeys): Promise<IdKey> {
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0) as BufferSource, info: INFO_IDS as BufferSource }, keys.master, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
}
const fileKey = (keys: DisplayKeys, salt: Uint8Array) =>
  crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: INFO_FILE as BufferSource }, keys.master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

// ---------------- gzip ----------------

async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const w = t.writable.getWriter();
  w.write(data as BufferSource).catch(() => undefined);
  w.close().catch(() => undefined);
  const r = t.readable.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > limit) { await r.cancel().catch(() => undefined); throw new Error('too large'); }
    chunks.push(value);
  }
  return concat(...chunks);
}

// ---------------- seal ----------------

const isId16 = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{16}$/.test(s);
export const newPublisherId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

function header(revision: number): Uint8Array {
  const h = new Uint8Array(HEADER);
  h.set(MAGIC, 0);
  h[4] = ENVELOPE_VERSION;
  new DataView(h.buffer).setUint32(5, revision, false);
  return h;
}

/** Encrypts a projection. Refuses a projection that does not pass the contract validator, so nothing invalid is ever written. */
export async function sealProjection(keys: DisplayKeys, projection: DisplayProjection, publisher: PublisherInfo): Promise<Uint8Array> {
  const checked = await validateProjection(projection);
  if (!checked.ok) throw new Error(`Refusing to encrypt an invalid projection: ${checked.errors[0]}`);
  if (!Number.isInteger(projection.revision) || projection.revision < 0 || projection.revision > 0xffffffff) throw new Error('The revision does not fit in the file header.');
  if (!isId16(publisher.id) || (publisher.mode !== 'sync' && publisher.mode !== 'single')) throw new Error('Invalid publisher information.');
  const plain = utf8(canonicalJson({ v: 1, publisher: { id: publisher.id, mode: publisher.mode }, projection }));
  const zipped = await pipe(plain, new CompressionStream('gzip'), MAX_PLAIN);
  const salt = crypto.getRandomValues(new Uint8Array(SALT));
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const head = header(projection.revision);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: head as BufferSource }, await fileKey(keys, salt), zipped as BufferSource));
  return concat(head, salt, iv, ct);
}

// ---------------- open ----------------

export type OpenCode = 'not-a-display-file' | 'truncated' | 'unsupported-version' | 'needs-newer-reader' | 'cannot-decrypt' | 'invalid-payload' | 'invalid-projection' | 'revision-mismatch';
export type OpenResult =
  | { ok: true; projection: DisplayProjection; publisher: PublisherInfo; revision: number }
  | { ok: false; code: OpenCode; message: string };
const fail = (code: OpenCode, message: string): OpenResult => ({ ok: false, code, message });

/** Decrypts and fully validates a display file. Never throws; anything wrong is a result with a code and a plain message. */
export async function openEnvelope(keys: DisplayKeys, bytes: Uint8Array): Promise<OpenResult> {
  if (bytes.length < MAGIC.length || !sameBytes(bytes.subarray(0, MAGIC.length), MAGIC)) return fail('not-a-display-file', 'That file is not a Ledger family display file.');
  if (bytes.length < MIN_FILE) return fail('truncated', 'The display file is incomplete.');
  if (bytes[4] !== ENVELOPE_VERSION) return fail('unsupported-version', bytes[4] > ENVELOPE_VERSION ? 'This display file is from a newer version. Update this display.' : 'This display file format is not supported.');
  const head = bytes.slice(0, HEADER);
  const revision = new DataView(head.buffer).getUint32(5, false);
  const salt = bytes.slice(HEADER, HEADER + SALT);
  const iv = bytes.slice(HEADER + SALT, HEADER + SALT + IV);
  const ct = bytes.slice(HEADER + SALT + IV);
  let zipped: Uint8Array;
  try {
    zipped = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: head as BufferSource }, await fileKey(keys, salt), ct as BufferSource));
  } catch {
    return fail('cannot-decrypt', 'The display code or passphrase no longer matches, or the file was changed.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(await pipe(zipped, new DecompressionStream('gzip'), MAX_PLAIN)));
  } catch {
    return fail('invalid-payload', 'The display file could not be read.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fail('invalid-payload', 'The display file could not be read.');
  const o = parsed as Record<string, unknown>;
  const keysOk = Object.keys(o).sort().join() === 'projection,publisher,v';
  const pub = o.publisher as Record<string, unknown> | null;
  if (!keysOk || o.v !== 1 || typeof pub !== 'object' || pub === null || Object.keys(pub).sort().join() !== 'id,mode' || !isId16(pub.id) || (pub.mode !== 'sync' && pub.mode !== 'single')) {
    return fail('invalid-payload', 'The display file has unexpected contents.');
  }
  const p = o.projection as Record<string, unknown> | null;
  if (typeof p === 'object' && p !== null) {
    if (typeof p.version === 'number' && p.version > VERSION) return fail('needs-newer-reader', 'This display needs updating to read the newest data.');
    if (typeof p.minReader === 'number' && p.minReader > MIN_READER) return fail('needs-newer-reader', 'This display needs updating to read the newest data.');
  }
  const checked = await validateProjection(o.projection);
  if (!checked.ok) return fail('invalid-projection', `The display data is not valid: ${checked.errors[0]}`);
  if (checked.value.revision !== revision) return fail('revision-mismatch', 'The display file is inconsistent.');
  return { ok: true, projection: checked.value, publisher: { id: pub.id as string, mode: pub.mode as 'sync' | 'single' }, revision };
}
