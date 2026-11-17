/**
 * CAL-G1: builds the one email Gmail is asked to send, as a standards-style (RFC 5322 / MIME) message, base64url-encoded for the Gmail API.
 *
 * Rules this file keeps:
 *  - ONE recipient per message (a single `To`); never Cc or Bcc, so nobody ever sees anyone else's address.
 *  - No `From` header. Gmail sends from the account that authorised Ledger and fills the header in itself: Ledger cannot name, and therefore cannot
 *    spoof, another sender. (That Gmail fills it in is UNVERIFIED until the first live test; see the CAL-G1 report.)
 *  - Plain text only, UTF-8, no attachments.
 *  - Nothing the owner or a contact typed can add a header: line breaks and control characters are removed from every header value, and an address
 *    that is not plainly an ordinary ASCII address is refused rather than "fixed".
 *  - Non-ASCII names and subjects use RFC 2047 encoded words, split so that no character is ever cut in half.
 */
import { toB64, toB64Url, utf8 } from '../../../display/transport/bytes';

export type MimeProblem = 'address' | 'reply-to' | 'size';
export class MimeError extends Error {
  constructor(public readonly problem: MimeProblem) { super(problem); }
}

/** An ordinary mailbox: ASCII letters, digits and the usual punctuation, one `@`, dotted domain. Quoted local parts and international addresses are refused. */
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isMailAddress = (s: string): boolean => s.length <= 254 && ADDRESS.test(s) && !s.includes('..') && !s.startsWith('.') && !/\.@/.test(s);

/** The largest message Ledger will build (a notification is a few hundred bytes; this only stops something absurd). */
export const MAX_MESSAGE_BYTES = 64 * 1024;

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f' + String.fromCharCode(0x2028, 0x2029) + ']', 'g'); // control characters and the two Unicode line separators
const oneLine = (s: string) => s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
const isPrintableAscii = (s: string) => /^[ -~]*$/.test(s);

/** The longest line a header may have when it holds an encoded word (RFC 2047), and the longest single word that still fits one after its field name. */
const LINE = 76;
const TOKEN_MAX = 60;

/**
 * RFC 2047 "B" encoded words as a list. Each is at most 60 characters (36 bytes of text), so it fits on a header line of at most 76 characters even
 * after a field name, and no character is ever split (a code point at a time, so an emoji is not cut either).
 */
export function encodedWordList(text: string): string[] {
  const words: string[] = [];
  let chunk: number[] = [];
  const flush = () => { if (chunk.length) { words.push(`=?UTF-8?B?${toB64(Uint8Array.from(chunk))}?=`); chunk = []; } };
  for (const ch of Array.from(text)) {
    const bytes = Array.from(utf8(ch));
    if (chunk.length + bytes.length > 36) flush();
    chunk.push(...bytes);
  }
  flush();
  return words;
}
/** The words joined the way they appear inside a header (a line break and a space between them). */
export const encodedWords = (text: string): string => encodedWordList(text).join('\r\n ');

/** The pieces of a header value that may hold any text: plain words when it is short printable ASCII, otherwise encoded words. */
export function textTokens(value: string): string[] {
  const v = oneLine(value);
  if (!v) return [];
  const words = v.split(' ');
  return isPrintableAscii(v) && words.every((w) => w.length <= TOKEN_MAX) ? words : encodedWordList(v);
}

/** The pieces of a display name for `To`: plain, quoted, or encoded, whichever the text needs. Empty gives no name at all. */
export function nameTokens(name: string): string[] {
  const n = oneLine(name);
  if (!n) return [];
  if (!isPrintableAscii(n) || n.length > TOKEN_MAX) return encodedWordList(n);
  if (/^[A-Za-z0-9 !#$%&'*+/=?^_`{|}~-]+$/.test(n)) return n.split(' ');
  return [`"${n.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`];
}

/** One header, folded between pieces so that no line is longer than 76 characters (a fold is a line break before a space, which readers unfold). */
export function foldHeader(field: string, tokens: readonly string[]): string {
  const lines: string[] = [];
  let line = `${field}:`;
  for (const t of tokens) {
    if (line.length + 1 + t.length > LINE && line !== `${field}:`) { lines.push(line); line = ` ${t}`; } else line += ` ${t}`;
  }
  lines.push(line);
  return lines.join('\r\n');
}

const crlf = (s: string) => s.replace(/\r\n|\r|\n/g, '\r\n');
const fold76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');

export interface MailInput {
  to: { name: string; address: string };
  subject: string;
  text: string;
  /** Optional. Used only when it is an ordinary valid address; otherwise left out. */
  replyTo?: string | null;
}

/** The complete message, headers and body, with CRLF line ends. Exposed so tests can read exactly what Gmail would be given. */
export function buildMime(m: MailInput): string {
  const address = m.to.address.trim();
  if (!isMailAddress(address)) throw new MimeError('address');
  const reply = m.replyTo ? m.replyTo.trim() : '';
  const headers = [
    foldHeader('To', [...nameTokens(m.to.name), `<${address}>`]),
    ...(reply && isMailAddress(reply) ? [foldHeader('Reply-To', [reply])] : []),
    foldHeader('Subject', textTokens(m.subject)),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  const body = crlf(m.text.replace(/\u0000/g, ''));
  const mime = `${headers.join('\r\n')}\r\n\r\n${fold76(toB64(utf8(body.endsWith('\r\n') ? body : `${body}\r\n`)))}\r\n`;
  if (utf8(mime).length > MAX_MESSAGE_BYTES) throw new MimeError('size');
  return mime;
}

/** The `raw` value for Gmail's send call: the whole message as UTF-8 bytes, base64url without padding. */
export const buildRaw = (m: MailInput): string => toB64Url(utf8(buildMime(m)));
