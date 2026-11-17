import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectGmail, markGmailExpired, removeGmailClientId, resetGmailForTests, saveGmailClientId, type GoogleOauth2 } from './auth';
import GmailConnect from './GmailConnect';
import GmailSettings from './GmailSettings';
import { GMAIL_SEND_SCOPE } from './config';

const CLIENT = ['1234567890-abcdef123456', 'apps', ['googleusercontent', 'com'].join('.')].join('.');
const TOKEN = 'ya29.FAKE-UI-TOKEN-not-real';

const google = (silent = false): GoogleOauth2 => ({
  initTokenClient: (cfg) => ({ requestAccessToken: () => { if (!silent) cfg.callback({ access_token: TOKEN, expires_in: 3599, scope: GMAIL_SEND_SCOPE }); } }),
  hasGrantedAllScopes: () => true,
  revoke: (_t, done) => done?.({ successful: true }),
});
const settings = () => renderToStaticMarkup(createElement(GmailSettings));
const connectBox = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(GmailConnect)));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  vi.stubGlobal('navigator', { onLine: true });
  resetGmailForTests();
});
afterEach(() => { vi.unstubAllGlobals(); resetGmailForTests(); });

describe('CAL-G1 connection section: every state the owner can be in', () => {
  it('Not configured: says so, asks for the client ID, offers no Connect button, loads nothing from Google', () => {
    const h = settings();
    expect(h).toContain('Not configured');
    expect(h).toContain('Save client ID');
    expect(h).not.toContain('Connect Gmail</button>');
    expect(h).not.toContain('Disconnect Gmail');
    expect(h).not.toContain('Remove client ID');
    expect(text(h)).toContain('Never paste a client secret');
    expect(connectBox()).toContain('Set up Gmail in Calendar settings');
  });
  it('Configured but not connected: "Not connected" with Connect Gmail', async () => {
    saveGmailClientId(CLIENT);
    const h = settings();
    expect(h).toContain('Not connected');
    expect(h).toContain('Connect Gmail</button>');
    expect(h).not.toContain('Disconnect Gmail');
    expect(h).toContain('Remove client ID');
    expect(h).toContain(CLIENT); // the public ID is shown back to the owner
    expect(connectBox()).toContain('Connect Gmail</button>');
  });
  it('Connected: "Connected for this browser session" with Disconnect Gmail, and no token on screen', async () => {
    vi.stubGlobal('google', { accounts: { oauth2: google() } });
    saveGmailClientId(CLIENT);
    await connectGmail();
    const h = settings();
    expect(h).toContain('Connected for this browser session');
    expect(h).toContain('Disconnect Gmail');
    expect(h).not.toContain('Connect Gmail</button>');
    expect(h).not.toContain(TOKEN);
    expect(connectBox()).toBe(''); // nothing to press
  });
  it('Authorization expired: says so and offers Reconnect Gmail', async () => {
    vi.stubGlobal('google', { accounts: { oauth2: google() } });
    saveGmailClientId(CLIENT);
    await connectGmail();
    markGmailExpired();
    const h = settings();
    expect(h).toContain('Authorization expired');
    expect(h).toContain('Reconnect Gmail</button>');
    expect(connectBox()).toContain('Reconnect Gmail</button>');
    expect(text(h)).toContain('Nothing is sent when you do');
  });
  it('Waiting for Google: offers Cancel, not a second Connect', async () => {
    vi.stubGlobal('google', { accounts: { oauth2: google(true) } });
    saveGmailClientId(CLIENT);
    void connectGmail();
    const h = settings();
    expect(h).toContain('Waiting for Google');
    expect(h).toContain('Cancel</button>');
    expect(h).not.toContain('Connect Gmail</button>');
    expect(connectBox()).toContain('Cancel</button>');
  });
  it('a useful error when Google authorization is unavailable (the library cannot load)', async () => {
    saveGmailClientId(CLIENT);
    await connectGmail(); // no Google library and no document in this test: it cannot load
    const h = text(settings());
    expect(h).toContain('could not load Google');
    expect(h).toContain('Not connected');
  });
  it('removing the client ID returns to Not configured', async () => {
    saveGmailClientId(CLIENT);
    removeGmailClientId();
    expect(settings()).toContain('Not configured');
  });
  it('the account is not guessed: the section says plainly that it cannot show which Google account was chosen', () => {
    const t = text(settings());
    expect(t).toContain('Google does not tell it which account you chose and it cannot show one');
    expect(t).not.toMatch(/@gmail\.com|Connected as|signed in as/i);
  });
  it('the setup steps name the one origin (the domain, no path), the one scope, Testing status and the test user', () => {
    const t = text(settings());
    expect(t).toContain('https://marshmond.github.io');
    expect(t).toContain('no /ledger/');
    expect(t).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(t).toContain('Testing');
    expect(t).toContain('Test users');
    expect(t).toMatch(/Never copy or paste the client secret/);
  });
});

describe('CAL-G1 wiring guards: review screen and Messages', () => {
  const composer = readFileSync('src/modules/calendar/notify/NoticeComposer.tsx', 'utf8');
  const messages = readFileSync('src/modules/calendar/notify/MessagesSection.tsx', 'utf8');
  it('pressing the button never starts a send that the label did not promise: sending needs a sender that was connected when the screen drew AND still is', () => {
    expect(composer).toContain('const live = transport ? getTransport() : null;');
    expect(composer).toMatch(/if \(transport && !live\) \{ setProblem\(/);
    expect(composer).toContain('confirmAndSend({ subject: s, prepared, transport: live })');
    expect(composer).not.toMatch(/confirmAndSend\(\{[^}]*transport \}/);
  });
  it('the result screen reports the sender that handled the press, not whatever is connected a moment later', () => {
    expect(composer).toContain('setVia(live)');
    expect(composer).toMatch(/statusLabel\(v, !!via\)/);
  });
  it('connecting from the review screen only connects: the Connect button is the shared component and the Send button is separate', () => {
    expect(composer).toContain('<GmailConnect primary />');
    expect(composer).not.toMatch(/connectGmail/);
    expect(messages).not.toMatch(/connectGmail/);
  });
  it('"Check status" is offered only for a sender that can be asked', () => {
    expect(messages).toContain('const canCheck = !!transport?.status;');
    expect(messages).toContain('const waiting = canCheck &&');
  });
  it('both screens re-render when authorization starts or ends', () => {
    expect(composer).toContain('useTransport()');
    expect(messages).toContain('useTransport()');
    expect(readFileSync('src/modules/calendar/notify/useTransport.ts', 'utf8')).toContain('useSyncExternalStore(subscribeGmail');
  });
});
