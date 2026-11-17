import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addContact, addEvent, extras, fresh } from '../../../display/displayTestkit';
import { fromB64Url, fromUtf8 } from '../../../display/transport/bytes';
import { buildBackup } from '../../../lib/backupFile';
import type { FinanceDB } from '../../../db';
import { loadEvents, removeOccurrence, restoreEventData, saveEdit, snapshotEvent } from '../data';
import { occurrencesOf, pickFields, type Occurrence } from '../occurrences';
import { msAt } from '../time';
import { classifyContacts, pickRecipients } from '../notify/recipients';
import { offerAfterDelete, offerAfterRestore, offerAfterSave, senderConnected, type NoticeOffer } from '../notify/offers';
import { confirmAndSend, loadNoticeRows, loadRequests, prepare, refreshStatuses, retryRequest, sendApproved } from '../notify/send';
import { getTransport, type NoticeTransport } from '../notify/transport';
import { saveNoticeSettings } from '../notify/settings';
import { statusLabel, statusWords } from '../notify/words';
import type { MessageOptions } from '../notify/types';
import { connectGmail, disconnectGmail, getGmailState, resetGmailForTests, saveGmailClientId, type GoogleOauth2 } from './auth';
import { GMAIL_SEND_SCOPE } from './config';

const CLIENT = ['1234567890-abcdef123456', 'apps', ['googleusercontent', 'com'].join('.')].join('.');
const TOKEN = 'ya29.FAKE-FLOW-TOKEN-not-real';
const OPTS: MessageOptions = { includeLocation: false, includePeople: true, personalMessage: '', senderName: 'Alex Sample', replyTo: 'alex@example.test', zoneLabel: 'Test Standard Time', today: '2026-11-16' };
const OK = { id: '18c3f0a1b2d3e4f5', threadId: '18c3f0a1b2d3e4f5', labelIds: ['SENT'] };

let d: FinanceDB;
let sent: { url: string; raw: string; auth: string }[];
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Replaces the browser's fetch with a fake Gmail. Every call is recorded; `answer` decides what Gmail says. */
function fakeGmail(answer: (n: number) => Response | Promise<Response> = () => reply(200, OK)) {
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { raw: string };
    sent.push({ url, raw: body.raw, auth: (init.headers as Record<string, string>).Authorization });
    return answer(sent.length);
  });
}
const mimeOf = (i: number) => fromUtf8(fromB64Url(sent[i].raw));

const googleOk: GoogleOauth2 = {
  initTokenClient: (cfg) => ({ requestAccessToken: () => cfg.callback({ access_token: TOKEN, expires_in: 3599, scope: GMAIL_SEND_SCOPE }) }),
  hasGrantedAllScopes: () => true,
  revoke: (_t, done) => done?.({ successful: true }),
};
async function connected(): Promise<NoticeTransport> {
  expect(saveGmailClientId(CLIENT).ok).toBe(true);
  vi.stubGlobal('google', { accounts: { oauth2: googleOk } });
  expect(await connectGmail()).toEqual({ ok: true });
  return getTransport()!;
}

beforeEach(() => {
  d = fresh();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  vi.stubGlobal('navigator', { onLine: true });
  resetGmailForTests();
  sent = [];
  return saveNoticeSettings({ senderName: 'Alex Sample', replyTo: 'alex@example.test' }, d).then(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); resetGmailForTests(); });

async function occ(id: number, key: string): Promise<Occurrence> {
  const rec = (await loadEvents(d)).find((e) => e.id === id)!;
  return occurrencesOf(rec, key, key).find((o) => o.key === key)!;
}
const people = async () => ({
  dana: await addContact(d, 'Dana Test', { email: 'dana@example.test' }),
  lee: await addContact(d, 'Lee Sample', { email: 'lee@example.test' }),
});
async function recital() {
  const p = await people();
  const id = await addEvent(d, 'Recital', '2026-11-22', {}, 14 * 60);
  const o = await occ(id, '2026-11-22');
  const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
  return { p, id, o, offer };
}
const recipientsFor = async (offer: NoticeOffer, ids: number[]) => pickRecipients(classifyContacts(await d.contacts.toArray(), offer.involved), ids).picked;
async function approve(offer: NoticeOffer, ids: number[], transport: NoticeTransport | null) {
  const prepared = await prepare(offer.subject, await recipientsFor(offer, ids), OPTS, await loadRequests(d));
  return { prepared, result: await confirmAndSend({ subject: offer.subject, prepared, transport }, d) };
}
const views = () => loadRequests(d);

describe('CAL-G1 flow: connected or not decides whether Gmail can be used at all', () => {
  it('disconnected: there is no sender, the after-save questions stay quiet, and approving only saves an approval', async () => {
    const { p, offer } = await recital();
    fakeGmail();
    expect(getTransport()).toBeNull();
    expect(senderConnected()).toBe(false);
    const { result } = await approve(offer, [p.dana], getTransport());
    expect(result).toMatchObject({ kind: 'recorded', delivered: false });
    expect((await views())[0].state).toBe('confirmed');
    expect(sent).toHaveLength(0);
  });
  it('a configured but not connected Gmail is still no sender (nothing is offered, nothing can send)', async () => {
    fakeGmail();
    expect(saveGmailClientId(CLIENT).ok).toBe(true);
    expect(getGmailState()).toMatchObject({ configured: true, phase: 'idle' });
    expect(getTransport()).toBeNull();
    expect(senderConnected()).toBe(false);
  });
  it('connected: Gmail is the sender (live, named Gmail); disconnecting or expiring removes it again', async () => {
    fakeGmail();
    const t = await connected();
    expect(t).toMatchObject({ id: 'gmail', label: 'Gmail', live: true });
    expect(senderConnected()).toBe(true);
    await disconnectGmail();
    expect(getTransport()).toBeNull();
    expect(senderConnected()).toBe(false);
  });
  it('connecting by itself sends nothing and writes no notification record', async () => {
    fakeGmail();
    await recital();
    const before = (await loadNoticeRows(d)).rows.length;
    await connected();
    expect(sent).toHaveLength(0);
    expect((await loadNoticeRows(d)).rows.length).toBe(before);
  });
});

describe('CAL-G1 flow: an explicit Send reaches Gmail and the result is recorded honestly', () => {
  it('Gmail accepting a message is recorded as "Accepted by Gmail" with the message id, and claims nothing more', async () => {
    const { p, offer } = await recital();
    fakeGmail();
    const t = await connected();
    const { result } = await approve(offer, [p.dana], t);
    expect(result).toMatchObject({ kind: 'recorded', delivered: true });
    expect(sent).toHaveLength(1);
    const v = (await views())[0];
    expect(v.state).toBe('accepted');
    expect(v.ref).toBe(OK.id);
    expect(v.transport).toEqual({ id: 'gmail', label: 'Gmail', live: true });
    expect(statusLabel(v, true)).toBe('Accepted by Gmail');
    const words = statusWords(v, true);
    expect(words).toContain('cannot tell whether it reached an inbox');
    expect(`${statusLabel(v, true)} ${words}`).not.toMatch(/delivered|received|opened|was read|has been read/i);
    // the record kept what Gmail confirmed (the id), and the exact approved text
    const progress = (await loadNoticeRows(d)).rows.filter((r) => r.data.t === 'progress');
    expect(progress.map((r) => (r.data.t === 'progress' ? `${r.data.state}${r.data.ref ? `:${r.data.ref}` : ''}` : ''))).toEqual(['unknown', `accepted:${OK.id}`]);
  });
  it('uses the token in the Authorization header only and never stores it in the history', async () => {
    const { p, offer } = await recital();
    fakeGmail();
    await approve(offer, [p.dana], await connected());
    expect(sent[0].auth).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(await d.moduleRecords.toArray())).not.toContain(TOKEN);
  });
  it('each person gets their OWN message: one request each, only their address, no Cc or Bcc, and never anyone else\'s address', async () => {
    const { p, offer } = await recital();
    fakeGmail();
    await approve(offer, [p.dana, p.lee], await connected());
    expect(sent).toHaveLength(2);
    const [a, b] = [mimeOf(0), mimeOf(1)];
    const mine = (m: string, yes: string, no: string) => { expect(m).toContain(`<${yes}>`); expect(m).not.toContain(no); expect(m).not.toMatch(/^(Cc|Bcc|From):/im); expect(m.match(/@/g)).toHaveLength(1 + 1); /* the To address and Reply-To */ };
    mine(a, 'dana@example.test', 'lee@example.test');
    mine(b, 'lee@example.test', 'dana@example.test');
    expect(a).not.toContain('Lee Sample');
    expect(b).not.toContain('Dana Test');
  });
  it('the address on record is the one the message used, and the reply address goes in Reply-To only', async () => {
    const { p, offer } = await recital();
    fakeGmail();
    await approve(offer, [p.dana], await connected());
    expect(mimeOf(0)).toContain('Reply-To: alex@example.test');
    expect((await views())[0].recipient.email).toBe('dana@example.test');
  });
});

describe('CAL-G1 flow: failures and uncertain outcomes are told apart', () => {
  it('Gmail refusing for a definite reason is "Not sent" with a plain reason, and a manual retry is possible once reconnected', async () => {
    const { p, offer } = await recital();
    let n = 0;
    fakeGmail(() => (++n === 1 ? reply(403, { error: { message: 'Gmail API has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }) : reply(200, OK)));
    const t = await connected();
    await approve(offer, [p.dana], t);
    const v = (await views())[0];
    expect(v).toMatchObject({ state: 'failed', reason: 'api-disabled' });
    expect(statusLabel(v, true)).toBe('Not sent');
    expect(statusWords(v, true)).toMatch(/Gmail service is switched off/);
    expect(await retryRequest({ requestId: v.requestId, transport: t }, d)).toBe('started');
    expect((await views())[0]).toMatchObject({ state: 'accepted', attempt: 2 });
    expect(sent).toHaveLength(2);
  });
  it('an expired permission (401) is "Not sent", Gmail goes back to expired, and nothing more is tried on its own', async () => {
    const { p, offer } = await recital();
    fakeGmail(() => reply(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }));
    const t = await connected();
    await approve(offer, [p.dana], t);
    expect((await views())[0]).toMatchObject({ state: 'failed', reason: 'unauthorized' });
    expect(getGmailState().phase).toBe('expired');
    expect(getTransport()).toBeNull();
    expect(sent).toHaveLength(1);
  });
  it('a Google server fault is "Outcome unknown", with the duplicate warning, and is not retried automatically', async () => {
    const { p, offer } = await recital();
    fakeGmail(() => reply(503, { error: { code: 503, message: 'Service Unavailable' } }));
    const t = await connected();
    await approve(offer, [p.dana], t);
    const v = (await views())[0];
    expect(v.state).toBe('unknown');
    expect(statusLabel(v, true)).toBe('Outcome unknown');
    expect(statusWords(v, true)).toContain('could send a second copy');
    expect(statusWords(v, true)).toContain('Sent folder');
    expect(sent).toHaveLength(1);
  });
  it('a response lost after Gmail may have taken the message is "Outcome unknown"; sending again needs an explicit yes, and "Send now" does nothing', async () => {
    const { p, offer } = await recital();
    fakeGmail(async () => { throw new TypeError('connection reset'); });
    const t = await connected();
    await approve(offer, [p.dana], t);
    const v = (await views())[0];
    expect(v.state).toBe('unknown');
    await sendApproved(v.requestId, t, d);
    expect(sent).toHaveLength(1); // not "confirmed", so Send now has nothing to do
    expect(await retryRequest({ requestId: v.requestId, transport: t }, d)).toBe('not-allowed');
    expect(sent).toHaveLength(1);
    fakeGmail();
    expect(await retryRequest({ requestId: v.requestId, transport: t, acceptDuplicateRisk: true }, d)).toBe('started');
    expect(sent).toHaveLength(1);
    const after = (await views())[0];
    expect(after).toMatchObject({ state: 'accepted', attempt: 2, duplicateRisk: true });
  });
  it('offline: nothing is sent, the reason says so, and the message can be retried later', async () => {
    const { p, offer } = await recital();
    fakeGmail();
    const t = await connected();
    vi.stubGlobal('navigator', { onLine: false });
    await approve(offer, [p.dana], t);
    expect(sent).toHaveLength(0);
    expect((await views())[0]).toMatchObject({ state: 'failed', reason: 'offline' });
    vi.stubGlobal('navigator', { onLine: true });
    expect(await retryRequest({ requestId: (await views())[0].requestId, transport: t }, d)).toBe('started');
    expect((await views())[0].state).toBe('accepted');
  });
  it('"Check status" has nothing to ask Gmail: nothing is requested and nothing changes', async () => {
    const { p, offer } = await recital();
    fakeGmail(() => reply(500, {}));
    const t = await connected();
    await approve(offer, [p.dana], t);
    const before = JSON.stringify(await views());
    expect(await refreshStatuses(t, d)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(await views())).toBe(before);
  });
});

describe('CAL-G1 flow: no duplicate from one device, one tab or two', () => {
  it('two Send presses at once produce one request to Gmail', async () => {
    const { p, offer } = await recital();
    fakeGmail(() => new Promise((r) => setTimeout(() => r(reply(200, OK)), 15)));
    const t = await connected();
    const [a, b] = await Promise.all([approve(offer, [p.dana], t), approve(offer, [p.dana], t)]);
    expect(sent).toHaveLength(1);
    expect([a.result.kind, b.result.kind].sort()).toEqual(['nothing-new', 'recorded']);
    expect((await views()).filter((v) => v.state === 'accepted')).toHaveLength(1);
  });
  it('a second tab pressing "Send now" for the same approved message while the first is mid-send does not send it again', async () => {
    const { p, offer } = await recital();
    fakeGmail(() => new Promise((r) => setTimeout(() => r(reply(200, OK)), 25)));
    await approve(offer, [p.dana], null); // approved while not connected
    const t = await connected();
    const id = (await views())[0].requestId;
    await Promise.all([sendApproved(id, t, d), sendApproved(id, t, d), sendApproved(id, t, d)]);
    expect(sent).toHaveLength(1);
    expect((await views())[0].state).toBe('accepted');
  });
  it('a message that is already waiting or done is never sent by Send now', async () => {
    const { p, offer } = await recital();
    fakeGmail();
    const t = await connected();
    await approve(offer, [p.dana], t);
    const id = (await views())[0].requestId;
    await sendApproved(id, t, d);
    await sendApproved(id, t, d);
    expect(sent).toHaveLength(1);
  });
  it('closing the page mid-send leaves "Outcome unknown", never "not sent" and never a second automatic send', async () => {
    const { p, offer } = await recital();
    let release: () => void = () => undefined;
    fakeGmail(() => new Promise((r) => { release = () => r(reply(200, OK)); }));
    const t = await connected();
    void approve(offer, [p.dana], t); // never awaited: the page "closes" here
    for (let i = 0; i < 200 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(sent).toHaveLength(1);
    expect((await views())[0].state).toBe('unknown'); // the claim is on record while Gmail has not answered
    const id = (await views())[0].requestId;
    await sendApproved(id, t, d);
    expect(sent).toHaveLength(1);
    release();
  });
});

describe('CAL-G1 flow: reconnecting never sends anything', () => {
  it('approved messages stay approved, and queued or unknown ones stay as they were, across a reconnect', async () => {
    const { p, offer } = await recital();
    fakeGmail(() => reply(500, {}));
    await approve(offer, [p.dana], null); // approved, not sent
    const t1 = await connected();
    await Promise.resolve();
    expect(sent).toHaveLength(0);
    expect((await views())[0].state).toBe('confirmed');
    await disconnectGmail();
    await connected();
    await Promise.resolve();
    expect(sent).toHaveLength(0);
    // an unknown outcome also stays put
    await sendApproved((await views())[0].requestId, t1, d);
    expect(sent).toHaveLength(1);
    expect((await views())[0].state).toBe('unknown');
    await disconnectGmail();
    await connected();
    expect(sent).toHaveLength(1);
    expect((await views())[0].state).toBe('unknown');
  });
  it('a draft is not lost when authorization runs out: the offer is still valid and approving without Gmail records no send', async () => {
    const { p, offer } = await recital();
    fakeGmail();
    await connected();
    await disconnectGmail(); // stands for "expired while composing"
    const { result } = await approve(offer, [p.dana], getTransport());
    expect(result).toMatchObject({ kind: 'recorded', delivered: false });
    expect(sent).toHaveLength(0);
  });
});

describe('CAL-G1 flow: stale messages cannot be sent', () => {
  it('an event changed after approval is not sent, whichever way it was approved', async () => {
    const { p, id, o, offer } = await recital();
    fakeGmail();
    await approve(offer, [p.dana], null);
    await saveEdit(o, { ...pickFields(o), startAt: msAt('2026-11-22', 16 * 60), endAt: msAt('2026-11-22', 17 * 60) }, extras(), 'all', d);
    const t = await connected();
    await sendApproved((await views())[0].requestId, t, d);
    expect(sent).toHaveLength(0);
    expect((await views())[0]).toMatchObject({ state: 'failed', reason: 'stale' });
    expect(id).toBeGreaterThan(0);
  });
});

describe('CAL-G1 flow: Save, Delete and Undo do not depend on Gmail', () => {
  it('with Gmail connected and every request failing, saving, deleting and undoing work and call Gmail zero times', async () => {
    await people();
    fakeGmail(async () => { throw new Error('Gmail is down'); });
    await connected();
    const id = await addEvent(d, 'Dentist', '2026-11-20', {}, 9 * 60);
    const o = await occ(id, '2026-11-20');
    await saveEdit(o, { ...pickFields(o), title: 'Dentist (new office)' }, extras(), 'all', d);
    const snap = (await snapshotEvent(id, d))!;
    await removeOccurrence(o, 'all', d);
    expect(await offerAfterDelete({ occ: o, scope: 'all', snap }, d)).not.toBeNull(); // the question may be asked; asking sends nothing
    await restoreEventData(id, snap, d);
    expect(await offerAfterRestore({ eventId: id, scope: 'single', affectedDate: '', told: [] }, d)).not.toBeNull(); // building the correction offer sends nothing either
    expect((await loadEvents(d)).find((e) => e.id === id)!.data.title).toBe('Dentist (new office)');
    expect(sent).toHaveLength(0);
  });
});

describe('CAL-G1 flow: the token is nowhere in Ledger\'s data, backups or sync', () => {
  it('after connecting and sending, no table, no backup text and no history row contains the token or the message body', async () => {
    const { p, offer } = await recital();
    fakeGmail();
    await approve(offer, [p.dana], await connected());
    expect(sent).toHaveLength(1);
    const dump = JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain('Bearer');
    expect(dump).not.toContain(sent[0].raw); // the encoded message is not stored, only the approved text in the record
    const backup = JSON.stringify(await buildBackup(d, { getItem: () => null }));
    expect(backup).not.toContain(TOKEN);
    expect(backup).not.toContain(CLIENT); // the client ID is device-only
  });
});
