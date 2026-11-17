/**
 * CS-2: the pairing code. One piece of text that gives a tablet everything it needs and nothing else: the display repository's name, the
 * READ-ONLY key and the display passphrase. It never contains the publishing (write) key or anything from Ledger's own sync.
 *
 * The code is a secret: whoever holds it, and can reach GitHub, can read the approved family schedule. It is never put in a web address, a log
 * or an error message. It has a small checksum so a mistyped or half-copied code is caught before anything is saved.
 */
import { fromB64Url, fromUtf8, toB64Url, utf8 } from './bytes';
import { isRepoPart } from './githubFile';
import { normalizePassphrase, PASSPHRASE_RE } from './envelope';

export const PAIRING_PREFIX = 'LDPAIR1.';
export interface PairingData { owner: string; repo: string; token: string; passphrase: string }

/** FNV-1a, 32 bits: catches typing and copying mistakes. It is not a security feature. */
function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;

/** Why a token or passphrase would be refused, or null. Used before building a code. */
export function pairingProblem(d: PairingData): string | null {
  if (!isRepoPart(d.owner) || !isRepoPart(d.repo)) return 'The repository name is not valid. Use the form owner/name.';
  if (!TOKEN_RE.test(d.token.trim())) return 'That does not look like a GitHub key.';
  if (!PASSPHRASE_RE.test(normalizePassphrase(d.passphrase))) return 'That is not a display passphrase made by Ledger.';
  return null;
}

export function encodePairing(d: PairingData): string {
  const problem = pairingProblem(d);
  if (problem) throw new Error(problem);
  const body = toB64Url(utf8(JSON.stringify({ v: 1, o: d.owner, r: d.repo, t: d.token.trim(), p: normalizePassphrase(d.passphrase) })));
  return `${PAIRING_PREFIX}${body}.${checksum(body)}`;
}

export type PairingResult = { ok: true; data: PairingData } | { ok: false; message: string };
export function decodePairing(text: string): PairingResult {
  const bad = (message: string): PairingResult => ({ ok: false, message });
  const t = text.replace(/\s+/g, '');
  if (!t.startsWith(PAIRING_PREFIX)) return bad('That is not a Ledger pairing code.');
  const rest = t.slice(PAIRING_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot < 1) return bad('The pairing code is incomplete. Copy the whole code.');
  const body = rest.slice(0, dot);
  if (checksum(body) !== rest.slice(dot + 1)) return bad('The pairing code was changed or cut short. Copy it again.');
  let o: Record<string, unknown>;
  try { o = JSON.parse(fromUtf8(fromB64Url(body))); } catch { return bad('The pairing code could not be read.'); }
  if (typeof o !== 'object' || o === null || o.v !== 1 || Object.keys(o).sort().join() !== 'o,p,r,t,v') return bad('This pairing code is from a different version.');
  const data = { owner: String(o.o), repo: String(o.r), token: String(o.t), passphrase: String(o.p) };
  const problem = pairingProblem(data);
  return problem ? bad(problem) : { ok: true, data };
}
