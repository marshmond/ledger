import { describe, expect, it, vi } from 'vitest';
import { fromB64Url, fromUtf8 } from '../../../display/transport/bytes';
import type { OutboxRequest } from '../notify/transport';
import { GMAIL_SEND_URL } from './config';
import { gmailTransport, outcomeForError } from './transport';

const TOKEN = 'ya29.FAKE-TEST-TOKEN-not-real';
const req = (over: Partial<OutboxRequest> = {}): OutboxRequest => ({
  format: 'ledger-notice', v: 1, id: 'a'.repeat(64), requestId: 'a'.repeat(64), attempt: 1, noticeKind: 'updated',
  from: { name: 'Alex Sample', replyTo: 'alex@example.test' }, to: { name: 'Dana Test', address: 'dana@example.test' }, subject: 'Updated: Soccer practice', text: 'Hi Dana, the time changed.', ...over,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
type Call = { url: string; init: RequestInit };
function rig(answer: (c: Call) => Promise<Response> | Response, extra: Parameters<typeof gmailTransport>[0] = {}) {
  const calls: Call[] = [];
  const fetchFake = (async (url: string, init: RequestInit) => { const c = { url, init }; calls.push(c); return answer(c); }) as unknown as typeof fetch;
  const expired = vi.fn();
  return { calls, expired, t: gmailTransport({ fetch: fetchFake, token: () => TOKEN, online: () => true, onUnauthorized: expired, ...extra }) };
}
const OK = { id: '18c3f0a1b2d3e4f5', threadId: '18c3f0a1b2d3e4f5', labelIds: ['SENT'] };

describe('CAL-G1 Gmail transport: the request', () => {
  it('posts exactly one raw message to the Gmail send address, with the token only in the Authorization header', async () => {
    const { t, calls } = rig(() => json(200, OK));
    await t.submit(req());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GMAIL_SEND_URL);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].url).not.toContain('?');
    const init = calls[0].init;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify({ ...init, headers: undefined })).not.toContain(TOKEN); // nowhere else
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.referrerPolicy).toBe('no-referrer');
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(Object.keys(body)).toEqual(['raw']);
    const mime = fromUtf8(fromB64Url(body.raw));
    expect(mime).toContain('To: Dana Test <dana@example.test>');
    expect(mime).toContain('Reply-To: alex@example.test');
    expect(mime).not.toMatch(/^(From|Cc|Bcc):/im);
  });
  it('the address is the real Gmail one and the scope the app asks for is send-only', () => {
    expect(GMAIL_SEND_URL).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  });
  it('has no status check (Gmail cannot be asked with only the send permission) and says it cannot refuse a repeat itself', () => {
    const t = gmailTransport();
    expect(t.id).toBe('gmail');
    expect(t.label).toBe('Gmail');
    expect(t.live).toBe(true);
    expect(t.serverDedupe).toBe(false);
    expect('status' in t).toBe(false);
  });
});

describe('CAL-G1 Gmail transport: what Gmail answered', () => {
  it('a 200 with a message id is "accepted", carrying the id', async () => {
    const { t } = rig(() => json(200, OK));
    expect(await t.submit(req())).toEqual({ kind: 'accepted', ref: OK.id });
  });
  it('a success with no message id, or an unreadable body, is NOT a confirmation: the outcome is unknown', async () => {
    expect(await rig(() => json(200, { labelIds: ['SENT'] })).t.submit(req())).toEqual({ kind: 'unknown' });
    expect(await rig(() => new Response('<html>oops</html>', { status: 200 })).t.submit(req())).toEqual({ kind: 'unknown' });
    expect(await rig(() => json(200, { id: 'has spaces and ✓' })).t.submit(req())).toEqual({ kind: 'unknown' });
    expect(await rig(() => new Response(null, { status: 204 })).t.submit(req())).toEqual({ kind: 'unknown' });
  });
  it('each failure is told apart: expired, API off, limits, bad address, other refusals', () => {
    expect(outcomeForError(401, '', '')).toEqual({ kind: 'rejected', reason: 'unauthorized' });
    expect(outcomeForError(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.')).toEqual({ kind: 'rejected', reason: 'unauthorized' });
    expect(outcomeForError(403, 'accessNotConfigured', 'Gmail API has not been used in project 123 before or it is disabled.')).toEqual({ kind: 'rejected', reason: 'api-disabled' });
    expect(outcomeForError(403, 'SERVICE_DISABLED', '')).toEqual({ kind: 'rejected', reason: 'api-disabled' });
    for (const r of ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded']) expect(outcomeForError(403, r, 'x')).toEqual({ kind: 'rejected', reason: 'quota' });
    expect(outcomeForError(429, '', 'User-rate limit exceeded (Mail sending)')).toEqual({ kind: 'rejected', reason: 'quota' });
    expect(outcomeForError(400, 'invalidArgument', 'Invalid To header')).toEqual({ kind: 'rejected', reason: 'address-rejected' });
    expect(outcomeForError(400, 'invalidArgument', 'Unable to parse')).toEqual({ kind: 'rejected', reason: 'service-refused' });
    expect(outcomeForError(403, 'domainPolicy', 'Gmail apps disabled')).toEqual({ kind: 'rejected', reason: 'service-refused' });
    expect(outcomeForError(404, '', '')).toEqual({ kind: 'rejected', reason: 'service-refused' });
  });
  it('a Google server fault or a request timeout is UNKNOWN, never "not sent": Gmail may have taken the message', () => {
    for (const s of [408, 500, 502, 503, 504]) expect(outcomeForError(s, 'backendError', 'Backend Error')).toEqual({ kind: 'unknown' });
  });
  it('real error bodies are read for their reason (API off, rate limit) and never copied into the result', async () => {
    const off = rig(() => json(403, { error: { code: 403, message: 'Gmail API has not been used in project 1 before or it is disabled. Enable it by visiting https://console.developers.google.com/', status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }));
    expect(await off.t.submit(req())).toEqual({ kind: 'rejected', reason: 'api-disabled' });
    const rate = rig(() => json(403, { error: { code: 403, message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } }));
    expect(await rate.t.submit(req())).toEqual({ kind: 'rejected', reason: 'quota' });
    const garbage = rig(() => new Response('not json', { status: 503 }));
    expect(await garbage.t.submit(req())).toEqual({ kind: 'unknown' });
  });
  it('an expired or refused token marks Gmail as expired so the screens ask to reconnect; other failures do not', async () => {
    const a = rig(() => json(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }));
    expect(await a.t.submit(req())).toEqual({ kind: 'rejected', reason: 'unauthorized' });
    expect(a.expired).toHaveBeenCalledTimes(1);
    const b = rig(() => json(403, { error: { message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } }));
    await b.t.submit(req());
    expect(b.expired).toHaveBeenCalledTimes(1);
    const c = rig(() => json(429, {}));
    await c.t.submit(req());
    expect(c.expired).not.toHaveBeenCalled();
  });
  it('the result never contains the token, the address or the text, whatever Gmail said', async () => {
    const { t } = rig(() => json(400, { error: { message: `Invalid To header ${TOKEN} dana@example.test Hi Dana`, errors: [{ reason: 'invalidArgument' }] } }));
    const out = JSON.stringify(await t.submit(req()));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('dana@');
    expect(out).not.toContain('Hi Dana');
  });
});

describe('CAL-G1 Gmail transport: nothing reaches Gmail when it cannot succeed', () => {
  it('no token: rejected as "unauthorized" and Gmail is never called', async () => {
    const { t, calls } = rig(() => json(200, OK), { token: () => null });
    expect(await t.submit(req())).toEqual({ kind: 'rejected', reason: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });
  it('offline: rejected as "offline" and Gmail is never called', async () => {
    const { t, calls } = rig(() => json(200, OK), { online: () => false });
    expect(await t.submit(req())).toEqual({ kind: 'rejected', reason: 'offline' });
    expect(calls).toHaveLength(0);
  });
  it('an address that cannot go in a header safely is refused before any call', async () => {
    const { t, calls } = rig(() => json(200, OK));
    expect(await t.submit(req({ to: { name: 'X', address: 'x@y.test\r\nBcc: evil@example.test' } }))).toEqual({ kind: 'rejected', reason: 'address-rejected' });
    expect(calls).toHaveLength(0);
  });
});

describe('CAL-G1 Gmail transport: a lost answer is "unknown", never a guess', () => {
  it('a dropped connection after sending (the request was made, the answer never came) is unknown', async () => {
    const { t, calls } = rig(async () => { throw new TypeError('network error'); });
    expect(await t.submit(req())).toEqual({ kind: 'unknown' });
    expect(calls).toHaveLength(1); // and it was NOT tried again on its own
  });
  it('a request that never answers is given up on after the time limit, as unknown, without a second request', async () => {
    const { t, calls } = rig(({ init }) => new Promise<Response>((_res, rej) => { init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }), { timeoutMs: 20 });
    expect(await t.submit(req())).toEqual({ kind: 'unknown' });
    expect(calls).toHaveLength(1);
  });
  it('an answer whose body never finishes is also given up on', async () => {
    const stuck = new Response(new ReadableStream({ start() { /* never delivers */ } }), { status: 200 });
    const { t } = rig(() => stuck, { timeoutMs: 30 });
    expect(await t.submit(req())).toEqual({ kind: 'unknown' });
  });
});
