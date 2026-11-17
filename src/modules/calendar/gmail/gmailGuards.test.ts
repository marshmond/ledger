import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONNECT_HOSTS, GOOGLE_GSI_PATH, GOOGLE_SCRIPT_SRC } from '../../../shell/csp';
import { PREF_ITEMS } from '../../../lib/devicePrefs';
import { PREFERENCE_KEYS } from '../../../lib/backupFile';
import { GMAIL_SEND_SCOPE, GMAIL_SEND_URL, GOOGLE_SCRIPT_URL, TOLERATED_SCOPES } from './config';
import { GMAIL_CLIENT_ID_KEY } from './clientId';

const DIR = 'src/modules/calendar/gmail';
const own = () => readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
/** Code only: comments are explanations, not behaviour. */
const code = (f: string) => read(f).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p); }
  return out;
}

describe('CAL-G1 guard: the permission', () => {
  it('the one scope is gmail.send, and nothing broader is named in any Gmail source file', () => {
    expect(GMAIL_SEND_SCOPE).toBe('https://www.googleapis.com/auth/gmail.send');
    for (const f of own()) {
      const c = code(f);
      expect(c, f).not.toMatch(/gmail\.(readonly|modify|compose|metadata|insert|labels|settings)|mail\.google\.com\/|auth\/drive|auth\/calendar|gmail\.addons/i);
    }
    for (const s of TOLERATED_SCOPES) expect(s).not.toMatch(/gmail\.(readonly|modify|compose|metadata)|mail\.google\.com|drive|calendar/);
  });
  it('no offline access, refresh token, code model, hosted domain or client secret is used or named in code', () => {
    for (const f of own()) {
      const c = code(f);
      expect(c, f).not.toMatch(/initCodeClient|access_type|refresh_token|offline_access|client_secret|grant_type|authorization_code/i);
    }
    // the only mention of a secret's prefix is the check that REFUSES one
    const mentions = own().filter((f) => /GOCSPX/i.test(code(f)));
    expect(mentions).toEqual(['config.ts']);
  });
  it('the request asks for one scope in one call to the token client', () => {
    const c = code('auth.ts');
    expect(c.match(/scope: GMAIL_SEND_SCOPE/g)).toHaveLength(1);
    expect(c.match(/\.initTokenClient\(/g)).toHaveLength(1);
  });
});

describe('CAL-G1 guard: the token is only in memory', () => {
  it('no Gmail file other than the client-ID file touches browser storage, cookies or IndexedDB', () => {
    for (const f of own().filter((x) => x !== 'clientId.ts')) expect(code(f), f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|\bdb\b|moduleRecords|settings\.put/);
    expect(code('clientId.ts')).not.toMatch(/token/i);
  });
  it('nothing in the Gmail folder logs, so a token or an address can never reach a console', () => {
    for (const f of own()) expect(code(f), f).not.toMatch(/\bconsole\.(log|warn|error|info|debug|trace)|debugger/);
  });
  it('the token is exported nowhere except through the one function the sender calls at the moment of sending', () => {
    const c = code('auth.ts');
    expect(c).not.toMatch(/export (let|const|var) token/);
    expect(c.match(/export function gmailAccessToken/g)).toHaveLength(1);
    const users = walk('src').filter((f) => /gmailAccessToken/.test(readFileSync(f, 'utf8')) && !/gmail[\\/]/.test(f) && !/\.test\./.test(f));
    expect(users).toEqual([]);
  });
  it('the client ID key is on this device only: not in backups, not synced, and listed in the device-settings explanation', () => {
    expect(PREFERENCE_KEYS).not.toContain(GMAIL_CLIENT_ID_KEY);
    expect(PREF_ITEMS.some((i) => i.kind === 'device' && i.inBackup === false && i.keys?.includes(GMAIL_CLIENT_ID_KEY))).toBe(true);
    // nothing in the sync or backup code names it
    for (const f of walk('src/lib')) expect(readFileSync(f, 'utf8').includes(GMAIL_CLIENT_ID_KEY), f).toBe(f.endsWith('devicePrefs.ts'));
  });
});

describe('CAL-G1 guard: only an explicit Send can reach Gmail', () => {
  it('the Gmail send address appears in the config and is used by the Gmail transport alone', () => {
    const users = walk('src').filter((f) => /GMAIL_SEND_URL/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/\\/g, '/'));
    expect(users.sort()).toEqual([`${DIR}/config.ts`, `${DIR}/transport.ts`]);
  });
  it('only the notification sender code calls a transport, and only from the buttons\' functions', () => {
    const callers = walk('src').filter((f) => /\btransport\.submit\(|\.submit\(outboxRequestFor/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/\\/g, '/'));
    expect(callers).toEqual(['src/modules/calendar/notify/send.ts']);
    const send = readFileSync('src/modules/calendar/notify/send.ts', 'utf8');
    expect(send.match(/transport\.submit\(/g)).toHaveLength(1);
  });
  it('the Gmail files themselves never send: nothing there calls the sender functions', () => {
    for (const f of own()) expect(code(f), f).not.toMatch(/confirmAndSend|sendApproved|retryRequest|\bdeliver\(|refreshStatuses/);
    // and connecting is a button: the only callers of connectGmail are the two components, and neither calls it while rendering
    const callers = walk('src').filter((f) => /\bconnectGmail\(/.test(readFileSync(f, 'utf8')) && !/auth\.ts$/.test(f)).map((f) => f.replace(/\\/g, '/')).sort();
    expect(callers).toEqual([`${DIR}/GmailConnect.tsx`, `${DIR}/GmailSettings.tsx`]);
    for (const f of ['GmailConnect.tsx', 'GmailSettings.tsx']) for (const m of code(f).matchAll(/\bconnectGmail\(\)/g)) expect(code(f).slice(Math.max(0, m.index! - 40), m.index!), f).toMatch(/onClick=\{\(\) => \{/);
  });
  it('Save, Delete, Undo and the Calendar page import nothing from the Gmail folder', () => {
    for (const f of ['src/modules/calendar/EventEditor.tsx', 'src/modules/calendar/CalendarPage.tsx']) expect(readFileSync(f, 'utf8'), f).not.toMatch(/gmail\//);
  });
  it('the Gmail files start no timer that could call Gmail: the only timers are housekeeping in auth.ts and the request time limit', () => {
    for (const f of own()) {
      const timers = code(f).match(/setInterval|requestIdleCallback|addEventListener\(['"](online|visibilitychange|focus)/g) ?? [];
      expect(timers, f).toEqual([]);
    }
    expect(code('transport.ts').match(/setTimeout/g)).toHaveLength(1);
    expect(code('auth.ts').match(/setTimeout\(/g)).toHaveLength(3);
  });
});

describe('CAL-G1 guard: network and page security', () => {
  it('the Gmail host is in the allowed connection list and Google\'s script is allowed only by its exact address', () => {
    expect(CONNECT_HOSTS).toContain(new URL(GMAIL_SEND_URL).origin);
    expect(GOOGLE_SCRIPT_URL).toBe(GOOGLE_SCRIPT_SRC);
    expect(GOOGLE_SCRIPT_SRC.startsWith(GOOGLE_GSI_PATH)).toBe(true);
    expect(GMAIL_SEND_URL).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  });
  it('every outside address named in the Gmail source is one of the three expected Google addresses', () => {
    const allowed = new Set([GOOGLE_SCRIPT_URL, GMAIL_SEND_URL, 'https://marshmond.github.io']);
    for (const f of own()) for (const m of read(f).matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      const url = m[0].replace(/[.,;]+$/, '');
      if (/example\.|1234567890|console\.cloud\.google\.com|console\.developers\.google\.com/.test(url)) continue;
      expect(allowed.has(url) || url.startsWith('https://www.googleapis.com/auth/') || url === 'https://mail.google.com/', `${f}: ${url}`).toBe(true);
    }
  });
  it('the service worker never touches another site\'s requests, so Google\'s answers are never cached', () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    expect(sw).toMatch(/if \(req\.method !== 'GET'\) return;/);
    expect(sw).toMatch(/if \(url\.origin !== self\.location\.origin \|\|/); // another site's request is returned to the browser untouched, before any cache is opened
    // a POST (the only kind of call Ledger makes to Gmail) is never answered or stored by the worker either
    expect(sw.indexOf("req.method !== 'GET'")).toBeLessThan(sw.indexOf('caches.open(VERSION)', sw.indexOf("addEventListener('fetch'")));
  });
  it('the transport asks the browser not to cache, not to send cookies and not to send a referrer', () => {
    const c = code('transport.ts');
    expect(c).toMatch(/cache: 'no-store'/);
    expect(c).toMatch(/credentials: 'omit'/);
    expect(c).toMatch(/referrerPolicy: 'no-referrer'/);
  });
});
