import { scanText } from '../../lib/leakTestkit';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { addDays, addMonths } from '../../lib/dates';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { completeTask, getTask, removeTasks, saveTask } from '../tasks/data';
import { taskDueItems } from '../tasks/dueProvider';
import { applyLifecycle, planLifecycle } from './changes';
import { createArrangement, getArrangement, tasksOfArrangement } from './data';
import { servicesDueItems } from './dueProvider';
import { cadenceBetween, blankArrangement, type Cadence } from './model';
import { HORIZON_MONTHS, horizonEnd, plannedVisitDates } from './plannedVisits';
import { logStandaloneVisit } from './visits';
import { setContractDates } from './contractData';

/** Invented data only. 2026-11-06 is a Friday. Real Dexie, real Tasks, real backup and SyncEngine. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-s4cal-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };
const weekly = (anchor: string): Cadence => ({ mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } }, anchorDate: anchor });
const semi = (anchor: string, a: object, b: object): Cadence => ({ mode: 'fixed', anchorDate: anchor, rule: { freq: 'monthly', interval: 1, monthly: 'date', end: { type: 'never' } }, semi: { a, b } as never });
const add = (d: FinanceDB, cadence: Cadence | null, over: Partial<ReturnType<typeof blankArrangement>> = {}) =>
  createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence, ...over }), provider: { name: "Rosa's Cleaning" }, today: TODAY }, d);
const q = (today: string, from = today, to = addDays(today, 800)) => ({ from, to, today, overdueDays: 0 });
const visits = async (d: FinanceDB, today = TODAY, from?: string, to?: string) => (await servicesDueItems(d, q(today, from, to))).filter((i) => i.id.startsWith('services:visit-'));
const dates = async (d: FinanceDB, today = TODAY, from?: string, to?: string) => (await visits(d, today, from, to)).map((i) => i.date);
const openTasks = async (d: FinanceDB, id: number) => (await tasksOfArrangement(id, d)).filter((t) => t.data.status !== 'done');
const rowCounts = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.count(), await d.links.count(), await d.txns.count(), (await d.moduleRecords.toArray()).map((r) => r.updatedAt).join()]);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

describe('S4 correction 1: rolling 12-month expected visits on the Calendar', () => {
  it('the horizon convention: today through the same day 12 calendar months later, both ends included, clamped to the month length', () => {
    expect(HORIZON_MONTHS).toBe(12);
    expect(horizonEnd('2026-11-06')).toBe('2027-11-06');
    expect(horizonEnd('2028-02-29')).toBe('2029-02-28');
    expect(horizonEnd('2027-01-31')).toBe('2028-01-31');
    expect(horizonEnd('2026-12-31')).toBe('2027-12-31');
    expect(horizonEnd('2027-02-28')).toBe('2028-02-28');
  });
  it('1. every other Friday: every expected Friday for 12 months, 14 days apart across the year end, plus the one open Task', async () => {
    const d = fresh();
    const r = await add(d, biweekly);
    const got = await dates(d);
    expect(got).toHaveLength(26);                       // the open Task is the 27th occurrence (11-06 itself)
    expect(got[0]).toBe('2026-11-20');
    expect(got[got.length - 1]).toBe('2027-11-05');     // 2026-11-06 + 364 days; the next would be 2027-11-19, past the horizon
    for (let i = 1; i < got.length; i++) expect(dayDiff(got[i - 1], got[i])).toBe(14);
    expect(got).toContain('2027-01-01');                 // across the year boundary, same parity
    expect(new Date('2027-01-01T00:00:00Z').getUTCDay()).toBe(5);
    expect((await openTasks(d, r.id)).map((t) => t.data.dueDate)).toEqual([TODAY]); // and ONE actionable Task
  });
  it('2. the 1st and 15th: both occurrences every month (the Task holds the first, the layer the rest)', async () => {
    const d = fresh();
    const r = await add(d, semi('2026-11-01', { kind: 'day', day: 1, adjust: 'none' }, { kind: 'day', day: 15, adjust: 'none' }));
    const got = await dates(d);
    expect((await openTasks(d, r.id)).map((t) => t.data.dueDate)).toEqual(['2026-11-15']); // the one actionable Task; it carries no repeat
    expect(got[0]).toBe('2026-12-01');                    // 2026-11-15 is the open Task
    expect(got).toContain('2027-02-01'); expect(got).toContain('2027-02-15');
    expect(got[got.length - 1]).toBe('2027-11-01');       // 2027-11-15 is beyond the horizon
    expect(got).toHaveLength(23);                          // Dec 2026 to Oct 2027 = 11 months x 2, plus 2027-11-01
  });
  it('3. the 15th and the last business day: the existing S3 rules over February, a leap year, short months and weekends', async () => {
    const d = fresh();
    const s = semi('2026-11-15', { kind: 'day', day: 15, adjust: 'none' }, { kind: 'lastBusinessDay' });
    await add(d, s);
    const a = await dates(d);
    expect(a).toContain('2027-02-15'); expect(a).toContain('2027-02-26');   // 28 Feb 2027 is a Sunday: the last business day is Friday the 26th
    expect(a).not.toContain('2027-02-28');
    expect(a).toContain('2027-04-30'); expect(a).toContain('2027-07-30');  // Friday 30 Apr and Friday 30 Jul
    expect(a).toContain('2027-05-31'); expect(a).not.toContain('2027-05-28');       // 31 May 2027 is a Monday, itself the last business day
    const leap = await dates(d, '2027-12-20');                               // clock moved on, no database write: a leap-year February
    expect(leap).toContain('2028-02-29'); expect(leap).toContain('2028-02-15'); // 29 Feb 2028 is a Tuesday
    expect(leap).toContain('2028-04-28'); expect(leap).not.toContain('2028-04-30'); // 30 Apr 2028 is a Sunday
    // and exactly what the one S3 adapter says, nothing else
    expect(a).toEqual(cadenceBetween(s, '2026-11-16', horizonEnd(TODAY)));
  });
  it('4. an assigned time is shown the same way on every expected visit; no time means all day', async () => {
    const d = fresh();
    await add(d, biweekly, { visitTime: '09:30' });
    const v = await visits(d);
    expect(v.every((i) => i.time === '09:30' && i.allDay === false)).toBe(true);
    const d2 = fresh();
    await add(d2, biweekly);
    expect((await visits(d2)).every((i) => i.allDay && i.time === undefined)).toBe(true);
  });
  it('5. boundaries: the last horizon day is included, the day after is not; narrow ranges, a single day and ranges outside the horizon', async () => {
    const d = fresh();
    await add(d, weekly('2026-11-07'));                       // Saturdays; 2027-11-06 is exactly 12 months on
    const all = await dates(d);
    expect(all[all.length - 1]).toBe('2027-11-06');
    expect(all).not.toContain('2027-11-13');
    expect(await dates(d, TODAY, '2026-12-05', '2026-12-05')).toEqual(['2026-12-05']);   // a single day
    expect(await dates(d, TODAY, '2026-12-06', '2026-12-06')).toEqual([]);               // a day with no visit
    expect(await dates(d, TODAY, '2026-12-01', '2026-12-31')).toEqual(['2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26']);
    expect(await dates(d, TODAY, '2020-01-01', '2026-11-05')).toEqual([]);                // history is the visit records, not this layer
    expect(await dates(d, TODAY, '2027-11-07', '2028-03-01')).toEqual([]);                // beyond the horizon
    expect(await dates(d, TODAY, '2027-11-06', '2027-11-06')).toEqual(['2027-11-06']);
  });
  it('6. a moved visit shows once, by its Task, and does not shift the standing cadence; later dates follow the arrangement', async () => {
    const d = fresh();
    const r = await add(d, biweekly);
    const t = (await openTasks(d, r.id))[0];
    await saveTask(t.id, { ...(await getTask(t.id, d))!.data, dueDate: '2026-11-08' }, d); // Friday visit moved to Sunday
    const g = await dates(d);
    expect(g[0]).toBe('2026-11-20');                       // the usual Friday after the move
    expect(g).not.toContain('2026-11-06'); expect(g).not.toContain('2026-11-08');
    expect((await getArrangement(r.id, d))!.data.cadence?.anchorDate).toBe(TODAY);
    // moved past the next usual date: that date is passed over, exactly as the scheduler does when it is logged
    await saveTask(t.id, { ...(await getTask(t.id, d))!.data, dueDate: '2026-11-22' }, d);
    const g2 = await dates(d);
    expect(g2[0]).toBe('2026-12-04');
    // moved earlier
    await saveTask(t.id, { ...(await getTask(t.id, d))!.data, dueDate: '2026-11-04' }, d);
    expect((await dates(d))[0]).toBe('2026-11-20');
  });
  it('7. a future occurrence already represented by the open Task is not shown twice; the Tasks layer shows exactly that one', async () => {
    const d = fresh();
    const r = await add(d, weekly(TODAY));
    const task = (await openTasks(d, r.id))[0];
    expect(await dates(d)).not.toContain(task.data.dueDate!);
    const both = [...(await taskDueItems(d, q(TODAY))).filter((i) => i.sourceRecordId === task.id), ...(await visits(d))].map((i) => i.date);
    expect(new Set(both).size).toBe(both.length);          // no date has two visible visits
    expect(both[0]).toBe(TODAY);
    expect((await openTasks(d, r.id))).toHaveLength(1);
  });
  it('8. an occurrence finished in Tasks and not yet logged is never shown again (repeating and twice-monthly schedules)', async () => {
    const d = fresh();
    const r = await add(d, biweekly);
    await completeTask((await openTasks(d, r.id))[0].id, TODAY, d); // finished in Tasks; Tasks spawns the next one for 11-20
    const g = await dates(d);
    expect(g[0]).toBe('2026-12-04');
    expect(g).not.toContain('2026-11-06'); expect(g).not.toContain('2026-11-20');
    const s = fresh();
    const r2 = await add(s, semi('2026-11-01', { kind: 'day', day: 1, adjust: 'none' }, { kind: 'day', day: 15, adjust: 'none' }));
    const t2 = (await openTasks(s, r2.id))[0];
    expect(t2.data.dueDate).toBe('2026-11-15');
    await completeTask(t2.id, TODAY, s);                           // no repeat: nothing spawns
    expect(await openTasks(s, r2.id)).toHaveLength(0);
    const g2 = await dates(s, TODAY);                                // finished early (today is 11-06): the 11-15 visit must not come back as an expected one
    expect(g2[0]).toBe('2026-12-01');
    expect(g2).not.toContain('2026-11-15');
  });
  it('9. a renewal, a notice and a visit on the same day are three separate entries with unique ids', async () => {
    const d = fresh();
    const r = await add(d, biweekly, { renewalDate: '2026-11-20', noticeByDate: '2026-11-20' });
    const day = (await servicesDueItems(d, q(TODAY, '2026-11-20', '2026-11-20')));
    expect(day.map((i) => i.id).sort()).toEqual([`services:notice-${r.id}:2026-11-20`, `services:renewal-${r.id}:2026-11-20`, `services:visit-${r.id}:2026-11-20`]);
    expect(new Set(day.map((i) => i.title)).size).toBe(3);
    // renewal and notice markers are intact beside the visits
    const all = await servicesDueItems(d, q(TODAY));
    expect(all.filter((i) => !i.id.startsWith('services:visit-')).map((i) => i.title).sort()).toEqual(['Notice deadline: House cleaning', 'Renewal: House cleaning']);
  });
  it('10. pause, resume, end and provider replacement', async () => {
    const d = fresh();
    const r = await add(d, biweekly);
    expect((await dates(d)).length).toBe(26);
    await applyLifecycle({ action: 'pause', arrangementId: r.id, expect: (await planLifecycle(r.id, 'pause', TODAY, d)).expect, today: TODAY }, d);
    expect(await dates(d)).toEqual([]);
    await applyLifecycle({ action: 'resume', arrangementId: r.id, expect: (await planLifecycle(r.id, 'resume', TODAY, d)).expect, today: TODAY }, d);
    expect((await dates(d)).length).toBe(26);
    const rep = await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: (await planLifecycle(r.id, 'replace', TODAY, d)).expect, today: TODAY, replace: { provider: { name: 'New Maids' } } }, d);
    const v = await visits(d);
    expect(new Set(v.map((i) => i.sourceRecordId))).toEqual(new Set([`arrangement:${rep.successorId}`])); // the old arrangement stopped; the successor carries on
    expect(v.every((i) => i.title.endsWith('New Maids'))).toBe(true);
    await logStandaloneVisit({ arrangementId: r.id, input: { status: 'completed', cancelledBy: null, date: '2026-11-03', title: 'Past clean', chargedCents: null, chargeKind: null }, today: TODAY }, d); // history is still writable and untouched
    await applyLifecycle({ action: 'end', arrangementId: rep.successorId!, expect: (await planLifecycle(rep.successorId!, 'end', TODAY, d)).expect, today: TODAY }, d);
    expect(await dates(d)).toEqual([]);
  });
  it('a schedule "after each visit", an on-demand arrangement and a damaged schedule produce nothing (and never throw)', async () => {
    const d = fresh();
    await add(d, { mode: 'after', rule: { freq: 'monthly', interval: 3, end: { type: 'never' } }, anchorDate: TODAY });
    await add(d, null, { title: 'On demand' });
    const bad = await add(d, semi('2026-11-01', { kind: 'day', day: 1, adjust: 'none' }, { kind: 'day', day: 15, adjust: 'none' }), { title: 'Damaged' });
    await d.moduleRecords.update(bad.id, { 'data.semiCadence': { anchorDate: '2026-11-01', semi: 'garbage' } } as never);
    expect(await dates(d)).toEqual([]);
  });
  it('an end date on the schedule stops the expected visits at it', async () => {
    const d = fresh();
    await add(d, { ...weekly(TODAY), rule: { freq: 'weekly', interval: 1, end: { type: 'until', date: '2026-12-04' } } });
    expect(await dates(d)).toEqual(['2026-11-13', '2026-11-20', '2026-11-27', '2026-12-04']);
  });
  it('11. the clock advances with no database write: the horizon moves, new dates appear, and nothing is stored or changed', async () => {
    const d = fresh();
    const r = await add(d, biweekly);
    const before = await rowCounts(d);
    const a = await dates(d, TODAY), b = await dates(d, '2026-12-04');
    expect(await rowCounts(d)).toBe(before);                  // no row added, no row touched
    expect(a[a.length - 1]).toBe('2027-11-05');
    expect(b[b.length - 1]).toBe('2027-12-03');               // a new date at the far end
    expect(b).not.toContain('2026-11-20');                    // and none before the new today
    expect(a.filter((x) => b.includes(x)).length).toBeGreaterThan(20);
    expect((await openTasks(d, r.id)).length).toBe(1);
  });
  it('12. no reminder, Task, Event, visit or Finance row is ever created by reading, and nothing is marked done', async () => {
    const d = fresh();
    await add(d, biweekly, { renewalDate: '2027-01-01' });
    const before = await rowCounts(d);
    for (let i = 0; i < 3; i++) await servicesDueItems(d, q(TODAY));
    expect(await rowCounts(d)).toBe(before);
    expect((await d.moduleRecords.toArray()).filter((r) => r.kind === 'visit' || r.kind === 'event')).toHaveLength(0);
    expect((await visits(d)).every((i) => i.status === 'open' && !i.actions)).toBe(true);
  });
  it('13. the entries carry the same wording as the visit Task and nothing private: no phone, email, notes, link, account number or amount', async () => {
    const d = fresh();
    await createArrangement({
      data: blankArrangement({ title: 'Lawn care', cadence: weekly(TODAY), notes: 'gate code 4455 account 99887766', refs: [{ label: 'Contract', url: 'https://example.com/secret' }], expected: { basis: 'perVisit', cents: 12345 } }),
      provider: { name: 'Pat Lawns', phone: '555-0100', email: 'pat@example.com' }, today: TODAY,
    }, d);
    const text = scanText((await visits(d)).map(({ openSource: _o, ...rest }) => rest));
    expect(text).not.toMatch(/4455|99887766|secret|12345|123\.45|555-0100|pat@example/);
    expect((await visits(d))[0].title).toBe('Lawn care: Pat Lawns');
  });
  it('14. a backup and restore into a separate database gives exactly the same entries (ids and dates)', async () => {
    const d = fresh();
    await add(d, biweekly, { visitTime: '08:00', renewalDate: '2027-01-01' });
    await add(d, semi('2026-11-01', { kind: 'day', day: 1, adjust: 'none' }, { kind: 'lastBusinessDay' }), { title: 'Lawn care' });
    const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
    const dst = fresh();
    await dst.open();
    await restoreChecked(dst, checkBackupText(JSON.stringify(await buildBackup(d, mem()))).file, mem());
    const shape = async (x: FinanceDB) => (await servicesDueItems(x, q(TODAY))).map((i) => `${i.id}|${i.title}|${i.date}|${i.time ?? ''}`);
    expect(await shape(dst)).toEqual(await shape(d));
    expect((await shape(d)).length).toBeGreaterThan(40);
  });
  it('an older arrangement with none of the S4 fields still produces its expected visits', async () => {
    const d = fresh();
    const r = await add(d, biweekly);
    await d.moduleRecords.update(r.id, { 'data.renewalDate': undefined, 'data.noticeByDate': undefined } as never);
    expect((await dates(d)).length).toBe(26);
    expect((await servicesDueItems(d, q(TODAY))).filter((i) => !i.id.startsWith('services:visit-'))).toEqual([]);
  });
  it('contract dates edited later change only the contract markers, never the expected visits', async () => {
    const d = fresh();
    const r = await add(d, biweekly);
    const before = await dates(d);
    await setContractDates(r.id, { renewalDate: '2027-01-01', noticeByDate: '2026-12-01' }, null, d);
    expect(await dates(d)).toEqual(before);
  });
  it('nothing is ever produced before today, even with no open Task to start after (history is the visit records)', async () => {
    const d = fresh();
    const r = await add(d, weekly('2026-09-04'));                          // a schedule that began in September, so there ARE earlier cadence dates
    await removeTasks((await openTasks(d, r.id)).map((t) => t.id), d);   // nothing scheduled at all
    expect(await dates(d, TODAY, '2026-10-01', '2026-11-05')).toEqual([]);
    expect((await dates(d, TODAY, '2026-10-01', '2026-11-14'))).toEqual(['2026-11-06', '2026-11-13']); // today onward only
  });
  it('the pure function itself refuses paused, ended, on-demand and after-each-visit schedules', () => {
    const base = blankArrangement({ title: 'x', cadence: weekly(TODAY) });
    const none = { openDue: null, openOccurrence: null, lastDoneOccurrence: null };
    const rec = (over: object) => ({ id: 1, createdAt: 1, updatedAt: 1, data: { ...base, ...over } });
    const win = (a: ReturnType<typeof rec>) => plannedVisitDates(a as never, none, TODAY, TODAY, '2027-11-06');
    expect(win(rec({}))).not.toEqual([]);
    expect(win(rec({ status: 'paused' }))).toEqual([]);
    expect(win(rec({ status: 'ended', endReason: 'cancelled' }))).toEqual([]);
    expect(win(rec({ cadence: null }))).toEqual([]);
    expect(win(rec({ cadence: { mode: 'after', rule: { freq: 'monthly', interval: 3, end: { type: 'never' } }, anchorDate: TODAY } }))).toEqual([]);
  });
  it('date arithmetic is calendar-only: no timezone shift, whatever the zone (the horizon and every cadence date are plain ISO days)', () => {
    for (const t of ['2026-03-08', '2026-11-01', '2027-03-14', '2027-12-31', '2028-02-29']) {
      const end = horizonEnd(t);
      expect(end).toBe(addMonths(t, 12));
      const a = { id: 1, createdAt: 1, updatedAt: 1, data: blankArrangement({ title: 'x', cadence: weekly(t) }) };
      const got = plannedVisitDates(a, { openDue: null, openOccurrence: null, lastDoneOccurrence: null }, t, t, end);
      expect(got[0]).toBe(t);
      for (let i = 1; i < got.length; i++) expect(dayDiff(got[i - 1], got[i])).toBe(7);
      expect(got[got.length - 1] <= end && addDays(got[got.length - 1], 7) > end).toBe(true);
    }
  });
});

describe('S4 correction 1: two devices (real SyncEngine)', () => {
  function remoteStore() {
    const r = {
      puts: 0, file: null as RemoteFile | null,
      async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
      async putFile(bytes: Uint8Array, sha: string | undefined) {
        if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
        r.puts++; r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() }; return r.file.sha;
      },
    };
    return r satisfies RemoteStore;
  }
  it('both devices show identical expected visits; a visit moved on one device does not shift the cadence on either', async () => {
    const remote = remoteStore();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`s4cal-meta-${n++}`), remote, 'a good passphrase') }; };
    const A = mk(), B = mk();
    const r = await add(A.d, biweekly, { visitTime: '09:00' });
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const same = async () => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
    expect(await dates(B.d)).toEqual(await dates(A.d));
    await sleep(15);
    const t = (await openTasks(A.d, r.id))[0];
    await saveTask(t.id, { ...(await getTask(t.id, A.d))!.data, dueDate: '2026-11-08' }, A.d);
    await same();
    for (const x of [A, B]) {
      const g = await dates(x.d);
      expect(g[0]).toBe('2026-11-20');
      expect(g).toHaveLength(26);
    }
    expect(await dates(B.d)).toEqual(await dates(A.d));
  });
});
