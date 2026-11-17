import { describe, expect, it } from 'vitest';
import { fromB64, fromB64Url, fromUtf8 } from '../../../display/transport/bytes';
import { buildMime, buildRaw, encodedWords, foldHeader, isMailAddress, MimeError, nameTokens, textTokens } from './mime';

/** What a mail program would show: the headers (unfolded) and the decoded body. */
function parse(mime: string) {
  const [head, ...rest] = mime.split('\r\n\r\n');
  const lines = head.replace(/\r\n[ \t]/g, ' ').split('\r\n');
  const headers = new Map<string, string>();
  for (const l of lines) { const i = l.indexOf(':'); headers.set(l.slice(0, i).toLowerCase(), l.slice(i + 1).trim()); }
  const body = fromUtf8(fromB64(rest.join('\r\n\r\n').replace(/\r\n/g, '')));
  return { headers, body, lines };
}
/** Decodes RFC 2047 encoded words (B form, UTF-8) back to text. */
const decodeWords = (s: string) => s.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=\s*/g, (_m, b) => fromUtf8(fromB64(b)));

const to = { name: 'Dana Test', address: 'dana@example.test' };

describe('CAL-G1 MIME: structure', () => {
  it('has one To, a subject, MIME headers, a base64 UTF-8 text body, and no From, Cc, Bcc or attachment', () => {
    const m = buildMime({ to, subject: 'Updated: Soccer practice', text: 'Hello Dana.\nSee you there.' });
    const p = parse(m);
    expect(p.headers.get('to')).toBe('Dana Test <dana@example.test>');
    expect(p.headers.get('subject')).toBe('Updated: Soccer practice');
    expect(p.headers.get('mime-version')).toBe('1.0');
    expect(p.headers.get('content-type')).toBe('text/plain; charset="UTF-8"');
    expect(p.headers.get('content-transfer-encoding')).toBe('base64');
    for (const h of ['from', 'cc', 'bcc', 'sender', 'return-path', 'message-id', 'date']) expect(p.headers.has(h), h).toBe(false);
    expect(m).not.toMatch(/multipart|attachment|filename=/i);
    expect(p.body).toBe('Hello Dana.\r\nSee you there.\r\n');
    expect(m.endsWith('\r\n')).toBe(true);
    expect(m.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/); // every line end is CRLF
  });
  it('uses CRLF line ends everywhere and wraps the body at 76 characters', () => {
    const m = buildMime({ to, subject: 'Long', text: 'x'.repeat(500) });
    expect(m).not.toMatch(/(?<!\r)\n/);
    for (const line of m.split('\r\n')) expect(line.length).toBeLessThanOrEqual(78);
    expect(parse(m).body).toBe(`${'x'.repeat(500)}\r\n`);
  });
  it('the raw value is base64url (no +, / or padding) and decodes to exactly the message', () => {
    const input = { to: { name: 'Zoë', address: 'zoe@example.test' }, subject: 'Ünïcode ✓ ?>>>', text: 'Café ??? ~~~ >>>' };
    const raw = buildRaw(input);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromUtf8(fromB64Url(raw))).toBe(buildMime(input));
    // Several messages, so that the two characters standard base64 uses and base64url replaces certainly come up somewhere.
    for (let i = 0; i < 40; i++) expect(buildRaw({ to: { name: `Name ${'>?'.repeat(i)}`, address: `p${i}@example.test` }, subject: `s${'?>'.repeat(i)}`, text: '???>>>' })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('CAL-G1 MIME: UTF-8 names, subjects and text', () => {
  it('a non-ASCII name becomes an encoded word that decodes to the same name', () => {
    const m = buildMime({ to: { name: 'José Müller-Łukasiewicz', address: 'jose@example.test' }, subject: 's', text: 't' });
    const t = parse(m).headers.get('to')!;
    expect(t).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <jose@example\.test>$/);
    expect(decodeWords(t.replace(/ <.*$/, ''))).toBe('José Müller-Łukasiewicz');
  });
  it('a non-ASCII subject with emoji and a long one are split into encoded words of at most 75 characters, never cutting a character', () => {
    const subject = 'Updated: Fußballtraining 🎉⚽ für alle Kinder — Mittwoch, 18. November, 17:00 Uhr in der großen Halle 🏟️ (nicht vergessen!)';
    const words = textTokens(subject);
    expect(words.length).toBeGreaterThan(2);
    for (const w of words) { expect(w.length).toBeLessThanOrEqual(60); expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/); }
    expect(decodeWords(words.join(' '))).toBe(subject); // fromUtf8 is strict, so a half-cut character would have thrown
    const m = buildMime({ to, subject, text: 't' });
    for (const line of m.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76); // RFC 2047: a line holding an encoded word is at most 76 characters
    expect(decodeWords(parse(m).headers.get('subject')!)).toBe(subject);
  });
  it('a plain short subject is left readable; a long plain one folds between words; a word too long to fold is encoded', () => {
    expect(foldHeader('Subject', textTokens('New: Dentist, Fri, Nov 20'))).toBe('Subject: New: Dentist, Fri, Nov 20');
    const long = `Updated: ${'meeting '.repeat(20)}end`;
    const folded = foldHeader('Subject', textTokens(long));
    for (const line of folded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    expect(folded.replace(/\r\n /g, ' ')).toBe(`Subject: ${long}`);
    const oneWord = 'Updated: '.padEnd(120, 'a');
    expect(decodeWords(textTokens(oneWord).join(' '))).toBe(oneWord);
    expect(foldHeader('Subject', textTokens(''))).toBe('Subject:');
  });
  it('quotes an ASCII name that needs it and escapes quotes and backslashes', () => {
    expect(nameTokens('Smith, Jo')).toEqual(['"Smith, Jo"']);
    expect(nameTokens('Jo "JJ" Smith\\')).toEqual(['"Jo \\"JJ\\" Smith\\\\"']);
    expect(nameTokens('Dana Test')).toEqual(['Dana', 'Test']);
    expect(nameTokens('')).toEqual([]);
  });
  it('a long encoded name moves the address to the next line instead of making an over-long one', () => {
    const m = buildMime({ to: { name: 'José Müller-Łukasiewicz de la Fuente Hernández-Ñúñez', address: 'jose.long.address@subdomain.example.test' }, subject: 's', text: 't' });
    for (const line of m.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    expect(parse(m).headers.get('to')).toMatch(/<jose\.long\.address@subdomain\.example\.test>$/);
  });
  it('the body keeps every UTF-8 character (accents, CJK, emoji, a long dash) and normalises line ends to CRLF', () => {
    const text = 'Café ☕\r\nサッカーの練習 ⚽\rZoë — 5:00 PM\n';
    const p = parse(buildMime({ to, subject: 's', text }));
    expect(p.body).toBe('Café ☕\r\nサッカーの練習 ⚽\r\nZoë — 5:00 PM\r\n');
  });
  it('encodedWords never splits a surrogate pair or a multi-byte character, whatever the length', () => {
    for (let n = 1; n < 40; n++) {
      const s = '🎈é中'.repeat(n);
      expect(decodeWords(encodedWords(s))).toBe(s);
    }
  });
});

describe('CAL-G1 MIME: nothing typed can add a header or a recipient', () => {
  it('line breaks in a name or subject cannot start a new header', () => {
    const m = buildMime({ to: { name: 'Dana\r\nBcc: evil@example.test', address: 'dana@example.test' }, subject: 'Hi\r\nBcc: evil@example.test\nX-Evil: 1', text: 'ok' });
    const p = parse(m);
    expect(p.headers.has('bcc')).toBe(false);
    expect(p.headers.has('x-evil')).toBe(false);
    expect(p.lines.filter((l) => /^[A-Za-z-]+:/.test(l)).map((l) => l.split(':')[0]).sort()).toEqual(['Content-Transfer-Encoding', 'Content-Type', 'MIME-Version', 'Subject', 'To']);
    expect(m.toLowerCase()).not.toContain('\r\nbcc:');
  });
  it('an address that is not a plain ASCII address is refused, not repaired', () => {
    const bad = ['a@b', 'a b@c.test', 'a@b.test\r\nBcc: x@y.test', 'a@b.test,c@d.test', '"quoted"@x.test', 'ünï@x.test', 'a@b..test', '.a@b.test', 'a.@b.test', '<a@b.test>', 'a@-b.test', '', ' ', 'a@b.test;c@d.test', 'x'.repeat(65) + '@b.test'];
    for (const address of bad) {
      expect(() => buildMime({ to: { name: 'N', address }, subject: 's', text: 't' }), JSON.stringify(address)).toThrow(MimeError);
      expect(isMailAddress(address), JSON.stringify(address)).toBe(false);
    }
    for (const ok of ['dana@example.test', 'first.last+tag@sub.example.test', "o'neil@example.test", 'a_b-c@x-y.example.test']) expect(isMailAddress(ok), ok).toBe(true);
  });
  it('the recipient is exactly the one address, and the other recipients never appear', () => {
    const m = buildMime({ to, subject: 'Hi Dana', text: 'Hi Dana' });
    expect(m).toContain('<dana@example.test>');
    expect(m.match(/@/g)).toHaveLength(1);
  });
  it('Reply-To is added only when it is an ordinary address', () => {
    expect(parse(buildMime({ to, subject: 's', text: 't', replyTo: 'alex@example.test' })).headers.get('reply-to')).toBe('alex@example.test');
    expect(parse(buildMime({ to, subject: 's', text: 't', replyTo: 'alex@example.test\r\nBcc: x@y.test' })).headers.has('reply-to')).toBe(false);
    expect(parse(buildMime({ to, subject: 's', text: 't', replyTo: '' })).headers.has('reply-to')).toBe(false);
    expect(parse(buildMime({ to, subject: 's', text: 't', replyTo: null })).headers.has('reply-to')).toBe(false);
  });
  it('an absurdly large message is refused instead of built', () => {
    expect(() => buildMime({ to, subject: 's', text: 'x'.repeat(200_000) })).toThrow(MimeError);
  });
});
