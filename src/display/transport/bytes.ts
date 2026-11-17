/** Small byte and text helpers shared by the display transport. They import nothing, so the tablet app can use them. */

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);

export function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Throws on text that is not base64. */
export function fromB64(s: string): Uint8Array {
  const clean = s.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('not base64');
  return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
}
export const toB64Url = (u: Uint8Array) => toB64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function fromB64Url(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(b + '='.repeat((4 - (b.length % 4)) % 4));
}

export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
