import { beforeEach, describe, expect, it } from 'vitest';
import type { FinanceDB } from '../db';
import { createStore } from '../core/store';
import { scanText } from '../lib/leakTestkit';
import { blankAsset } from '../modules/assets/model';
import { createAsset } from '../modules/assets/data';
import { FINANCE_ID } from '../modules/calendar/model';
import { blankArrangement } from '../modules/services/model';
import { createArrangement } from '../modules/services/data';
import { createProject } from '../modules/projects/data';
import { blankProject } from '../modules/projects/model';
import { encodeProjection, validateProjection, type DisplayEntry } from './contract';
import { appendDecision, setKillSwitch } from './grantStore';
import { ALL_DATES_SUBJECT, subjectOf } from './grants';
import { addEvent, addFamilyDate, addTask, calendar, household, projectionOf, stubStorage, testKey, TODAY, weekly } from './displayTestkit';
import { readDisplayState, previewCalendarShare } from './readState';

/**
 * CS-1 privacy evidence. A household is seeded with deliberately sensitive text in EVERY field the display must never carry (notes, places,
 * contact details, birth years, project names, provider and bill and asset details, Finance rows). The projection is built through the real path
 * (grants, source adapters, builder) and its serialized text is searched. Hostile text is written as `HOSTILE-...` words so a match is unmistakable.
 */
beforeEach(() => stubStorage());

const HOSTILE = /HOSTILE|ACCT-|PAYEE|SERIAL|MORTGAGE|2014|Rosa|Furnace Co|Lee Dental|Greenfield/i;
const SECRET_NUMBERS = ['98765', '4242424242424242', '555-0100'];
const text = (p: unknown) => JSON.stringify(p);

/** A household with a hostile record behind every module the display must not read. */
async function hostileHousehold() {
  const h = await household();
  const { d } = h;
  // Finance rows
  await d.accounts.add({ name: 'HOSTILE-ACCT checking', type: 'checking', openingBalanceCents: 98765, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
  // A project, an asset, a service arrangement with provider details, and a bill-like event
  const projectId = await createProject({ ...blankProject({ name: 'HOSTILE-Greenfield kitchen remodel' }) } as never, d);
  const assetId = await createAsset(blankAsset({ name: 'HOSTILE Furnace Co boiler', serialNumber: 'HOSTILE-SERIAL-1', address: 'HOSTILE 1 Private Way', notes: 'HOSTILE-asset-note', purchaseCents: 98765 }), d);
  return { ...h, projectId, assetId };
}

describe('nothing is shown unless the owner approved it', () => {
  it('a full household with no decisions produces an empty projection (private by default)', async () => {
    const h = await hostileHousehold();
    await addEvent(h.d, 'Swim meet', '2026-11-11', { contactIds: [h.sam] }, 10 * 60);
    await addTask(h.d, 'Sign the form', { contactIds: [h.sam], dueDate: '2026-11-12' });
    const { projection } = await projectionOf(h.d);
    expect(projection.entries).toEqual([]);
    expect(projection.tasks).toEqual([]);
    expect(projection.people).toEqual([]);
    expect(projection.grantsSeen).toEqual([]);
    expect(await validateProjection(projection)).toMatchObject({ ok: true });
  });
});

describe('a hostile household: only approved, owner-written text appears', () => {
  async function seed() {
    const h = await hostileHousehold();
    const { d } = h;
    const family = await calendar(d, 'Family');
    // Calendar events (every one has sensitive notes, a place and reminders)
    const hostileFields = { notes: 'HOSTILE-event-note', location: 'HOSTILE-secret-place', priority: 'high' as const, reminders: [30] };
    const swim = await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [h.sam, h.coach] }, 10 * 60, hostileFields);
    const dentist = await addEvent(d, 'Dentist appointment', '2026-11-13', { contactIds: [h.alex] }, 9 * 60, hostileFields);
    const school = await addEvent(d, 'School concert', '2026-11-18', { calendarId: family, contactIds: [h.robin] }, 18 * 60, hostileFields);
    const mortgage = await addEvent(d, 'MORTGAGE payment', '2026-11-15', { calendarId: family, type: 'bill', trackDone: true }, undefined, hostileFields);
    const card = await addEvent(d, 'Card due', '2026-11-16', { calendarId: family, type: 'finance' }, undefined, hostileFields);
    const weird = await addEvent(d, 'Weird type', '2026-11-17', { calendarId: family, type: 'something-new' }, undefined, hostileFields);
    const linked = await addEvent(d, 'Linked to a bill', '2026-11-19', { calendarId: family }, undefined, hostileFields);
    await createStore(d).shared.links.add({ module: 'calendar', id: linked }, { module: 'bills', id: 'obligation:1' }, 'about');
    const inProject = await addEvent(d, 'Project day', '2026-11-20', { calendarId: family, projectId: h.projectId }, undefined, hostileFields);
    const retired = await addEvent(d, 'Handed over', '2026-11-21', { calendarId: family }, undefined, hostileFields);
    await d.moduleRecords.update(retired, { data: { ...(await d.moduleRecords.get(retired))!.data, retired: { module: 'ledger', recordId: 5, note: 'HOSTILE-moved' } } });
    const busy = await addEvent(d, 'Therapy HOSTILE-private', '2026-11-12', { contactIds: [h.alex] }, 14 * 60, hostileFields);
    const recurring = await addEvent(d, 'Piano', '2026-11-10', { calendarId: family, contactIds: [h.sam], recurrence: weekly }, 16 * 60, hostileFields);
    // an occurrence override that carries notes and a place
    const rec = (await d.moduleRecords.get(recurring))!;
    await d.moduleRecords.update(recurring, { data: { ...rec.data, overrides: { '2026-11-17': { title: 'Piano (recital)', notes: 'HOSTILE-override-note', location: 'HOSTILE-override-place' } }, skipped: ['2026-11-24'] } });
    // the Finance derived calendar can never be shared, and an event placed on it is never inherited
    const onFinance = await addEvent(d, 'On the Finance layer', '2026-11-22', { calendarId: FINANCE_ID });
    // Tasks
    const task = await addTask(d, 'Sign the form', { contactIds: [h.sam, h.alex], dueDate: '2026-11-12', dueTime: '08:30', notes: 'HOSTILE-task-note', projectId: h.projectId, checklist: [{ id: 1, text: 'HOSTILE-check', done: false }], status: 'doing' });
    const privateTask = await addTask(d, 'Private errand', { notes: 'HOSTILE-private-task' });
    const billTask = await addTask(d, 'Pay the HOSTILE electric bill', { dueDate: '2026-11-14' }, [{ module: 'ledger', id: 'account:1' }]);
    const doneTask = await addTask(d, 'Finished chore', { status: 'done', completedAt: 1 });
    // Family dates
    await addFamilyDate(d, { label: "Grandma's birthday party", monthDay: '11-20', year: 1950, memberId: h.samId });
    // Household Services arrangement with provider details and a visit label; Home & Assets plan
    const arr = await createArrangement({
      data: blankArrangement({ title: 'HOSTILE Rosa cleaning', notes: 'HOSTILE-arrangement-note', visitTime: '09:00', expected: { basis: 'perVisit', cents: 98765 }, renewalDate: '2026-12-01', noticeByDate: '2026-11-25', cadence: { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: '2026-11-10' } }),
      provider: { name: 'HOSTILE Rosa Cleaning', phone: 'HOSTILE-555-0100', email: 'HOSTILE-rosa@example.test' }, today: TODAY,
    }, d);
    const plan = await addTask(d, 'Replace HOSTILE Furnace Co filter', { dueDate: '2026-11-30', repeat: { mode: 'after', rule: { freq: 'monthly', interval: 3, end: { type: 'never' } } } }, [{ module: 'assets', id: `asset:${h.assetId}` }]);
    return { ...h, family, swim, dentist, school, mortgage, card, weird, linked, inProject, retired, busy, recurring, onFinance, task, privateTask, billTask, doneTask, arr, plan };
  }

  it('the preview carries only owner-approved titles, and not one hostile value', async () => {
    const s = await seed();
    const { d } = s;
    await appendDecision({ subject: subjectOf('event', s.swim), decision: 'show' }, d);
    await appendDecision({ subject: subjectOf('event', s.busy), decision: 'show', level: 'busy' }, d);
    await appendDecision({ subject: subjectOf('calendar', s.family), decision: 'show' }, d);
    for (const id of [s.mortgage, s.card, s.weird, s.linked, s.inProject, s.retired]) await appendDecision({ subject: subjectOf('event', id), decision: 'show' }, d); // an item-level show must not rescue them
    await appendDecision({ subject: subjectOf('calendar', FINANCE_ID), decision: 'show' }, d);
    await appendDecision({ subject: subjectOf('event', s.onFinance), decision: 'show' }, d);
    await appendDecision({ subject: subjectOf('task', s.task), decision: 'show', titleAtGrant: 'Sign the form' }, d);
    for (const id of [s.billTask, s.doneTask]) await appendDecision({ subject: subjectOf('task', id), decision: 'show' }, d);
    await appendDecision({ subject: ALL_DATES_SUBJECT, decision: 'show' }, d);
    await appendDecision({ subject: subjectOf('visit', s.arr.id), decision: 'show', label: 'Cleaner', people: [s.alexId] }, d);
    await appendDecision({ subject: subjectOf('reminder', s.plan), decision: 'show', label: 'Furnace filter', people: [s.samId] }, d);

    const { projection, report } = await projectionOf(d);
    const out = encodeProjection(projection);
    expect(out).not.toMatch(HOSTILE);
    for (const secret of SECRET_NUMBERS) expect(scanText(projection)).not.toContain(secret);

    const titles = projection.entries.map((e) => e.title).sort();
    expect(titles).toContain('Swim meet'); // approved, owner-written
    expect(titles).toContain('Busy'); // generic
    expect(titles).toContain('School concert'); // inherited from the shared Family calendar
    expect(titles.filter((t) => t === 'Piano')).not.toEqual([]); // a recurring series on the shared calendar
    expect(titles).toContain('Piano (recital)'); // the override's TITLE only
    expect(titles).toContain('Cleaner');
    expect(titles).toContain('Furnace filter');
    expect(titles).toContain("Grandma's birthday party");
    expect(titles).toContain("Sam Example's birthday");
    // not eligible, even though shared and individually approved
    for (const t of ['MORTGAGE payment', 'Card due', 'Weird type', 'Linked to a bill', 'Project day', 'Handed over', 'On the Finance layer', 'Dentist appointment', 'Therapy HOSTILE-private']) expect(titles, t).not.toContain(t);
    expect(projection.tasks.map((t) => t.title)).toEqual(['Sign the form']);
    expect(projection.tasks[0]).toMatchObject({ status: 'doing', due: { date: '2026-11-12', time: '08:30' } });
    // the skipped Piano date is absent
    const pianoDates = projection.entries.filter((e) => e.title.startsWith('Piano')).map((e) => e.start.date);
    expect(pianoDates).not.toContain('2026-11-24');
    expect(pianoDates).toContain('2026-11-10');

    // the report tells the owner why things are missing
    const why = Object.fromEntries(report.rejected.map((r) => [r.title, r.rejection.code]));
    expect(why).toMatchObject({ 'MORTGAGE payment': 'finance', 'Card due': 'finance', 'Weird type': 'unknown-type', 'Linked to a bill': 'linked', 'Project day': 'project', 'Handed over': 'retired', 'Pay the HOSTILE electric bill': 'linked' });
    expect(Object.keys(why)).not.toContain('Finished chore');
    expect(report.rejected.some((r) => r.title === 'On the Finance layer')).toBe(true);

    expect(await validateProjection(projection)).toMatchObject({ ok: true });
  });

  it('a Finance-type or retired event in an otherwise approved calendar is absent from the projection AND the calendar preview', async () => {
    const s = await seed();
    await appendDecision({ subject: subjectOf('calendar', s.family), decision: 'show' }, s.d);
    const preview = await previewCalendarShare(s.d, s.family, { today: TODAY });
    const titles = preview.eligible.map((e) => e.title);
    expect(titles).toEqual(expect.arrayContaining(['School concert', 'Piano']));
    for (const t of ['MORTGAGE payment', 'Card due', 'Weird type', 'Linked to a bill', 'Project day', 'Handed over']) expect(titles).not.toContain(t);
    expect(preview.rejected.map((r) => r.title).sort()).toEqual(['Card due', 'Handed over', 'Linked to a bill', 'MORTGAGE payment', 'Project day', 'Weird type']);
    const { projection } = await projectionOf(s.d);
    expect(projection.entries.map((e) => e.title)).not.toEqual(expect.arrayContaining(['MORTGAGE payment']));
  });

  it('people are only household members, as ids, with no contact details; a Contact who is not a member never appears', async () => {
    const s = await seed();
    await appendDecision({ subject: subjectOf('event', s.swim), decision: 'show' }, s.d); // names Sam (a member) and Coach (only a Contact)
    const { projection } = await projectionOf(s.d);
    expect(projection.people.map((p) => p.name)).toEqual(['Sam Example']);
    expect(projection.people[0]).toMatchObject({ color: 'blue', group: 'child' });
    expect(Object.keys(projection.people[0]).sort()).toEqual(['color', 'group', 'id', 'name']);
    expect(text(projection)).not.toMatch(/Coach/);
    expect(text(projection)).not.toMatch(/spouse|grandparent|parent/i); // the role word is never published, only adult, child or other
  });

  it('Busy keeps the date and time and the people but none of the details', async () => {
    const s = await seed();
    await appendDecision({ subject: subjectOf('event', s.busy), decision: 'show', level: 'busy' }, s.d);
    const { projection } = await projectionOf(s.d);
    const e = projection.entries[0] as DisplayEntry;
    expect(e).toMatchObject({ title: 'Busy', source: 'events', allDay: false, start: { date: '2026-11-12' } });
    expect(e.start.time).toMatch(/^14:00$/);
    expect(projection.people.map((p) => p.name)).toEqual(['Alex Example']);
    expect(text(projection)).not.toMatch(/Therapy|HOSTILE/);
  });

  it('a birthday carries a name and a date, never a year, an age or the member\'s note', async () => {
    const s = await seed();
    await appendDecision({ subject: ALL_DATES_SUBJECT, decision: 'show' }, s.d);
    const { projection } = await projectionOf(s.d);
    const b = projection.entries.find((e) => e.title === "Sam Example's birthday")!;
    expect(b).toMatchObject({ source: 'dates', allDay: true, start: { date: '2026-11-12', time: null }, end: { date: '2026-11-12', time: null }, repeat: true });
    expect(scanText(projection)).not.toMatch(/2014|HOSTILE|1950/);
    expect(projection.entries.filter((e) => e.title.includes('party'))).toHaveLength(1);
  });

  it('a visit carries only the owner\'s label and schedule; a maintenance reminder the same', async () => {
    const s = await seed();
    await appendDecision({ subject: subjectOf('visit', s.arr.id), decision: 'show', label: 'Cleaner' }, s.d);
    await appendDecision({ subject: subjectOf('reminder', s.plan), decision: 'show', label: 'Furnace filter' }, s.d);
    const { projection } = await projectionOf(s.d);
    const visits = projection.entries.filter((e) => e.source === 'visits');
    expect(visits.length).toBeGreaterThan(1);
    for (const v of visits) expect(v).toMatchObject({ title: 'Cleaner', allDay: false, repeat: true, status: 'scheduled' });
    expect(visits[0].start.time).toBe('09:00');
    const rem = projection.entries.filter((e) => e.source === 'reminders');
    expect(rem).toHaveLength(1);
    expect(rem[0]).toMatchObject({ title: 'Furnace filter', start: { date: '2026-11-30', time: null }, allDay: true });
    expect(text(projection)).not.toMatch(HOSTILE);
    expect(scanText(projection)).not.toContain('98765');
  });

  it('a paused or ended arrangement shows no visits even though the visit was approved', async () => {
    const s = await seed();
    await appendDecision({ subject: subjectOf('visit', s.arr.id), decision: 'show', label: 'Cleaner' }, s.d);
    expect((await projectionOf(s.d)).projection.entries.some((e) => e.source === 'visits')).toBe(true);
    for (const status of ['paused', 'ended']) {
      await s.d.moduleRecords.update(s.arr.id, { 'data.status': status });
      expect((await projectionOf(s.d)).projection.entries.filter((e) => e.source === 'visits'), status).toEqual([]);
    }
  });

  it('a visit with no label is not shown', async () => {
    const s = await seed();
    await expect(appendDecision({ subject: subjectOf('visit', s.arr.id), decision: 'show', label: '  ' }, s.d)).rejects.toThrow(/Type the name/);
    // a record without one written by a bad or newer device is also hidden
    await s.d.moduleRecords.add({ module: 'display', kind: 'grant', data: { v: 1, subject: subjectOf('visit', s.arr.id), decision: 'show', supersedes: [], deviceId: 'x' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const { projection } = await projectionOf(s.d);
    expect(projection.entries.filter((e) => e.source === 'visits')).toEqual([]);
  });

  it('the global switch empties the projection but the history is kept', async () => {
    const s = await seed();
    await appendDecision({ subject: subjectOf('event', s.swim), decision: 'show' }, s.d);
    await appendDecision({ subject: subjectOf('task', s.task), decision: 'show' }, s.d);
    const before = await projectionOf(s.d);
    expect(before.projection.entries.length + before.projection.tasks.length).toBeGreaterThan(0);
    await setKillSwitch(true, s.d);
    const killed = await projectionOf(s.d);
    expect(killed.projection.entries).toEqual([]);
    expect(killed.projection.tasks).toEqual([]);
    expect(killed.projection.people).toEqual([]);
    expect(killed.projection.grantsSeen).toHaveLength(3);
    expect(killed.report.killed).toBe(true);
    expect(killed.report.events).toHaveLength(1); // the owner can still see what a resume would show
    await setKillSwitch(false, s.d);
    expect((await projectionOf(s.d)).projection.entries.length).toBe(before.projection.entries.length);
  });
});

describe('excluded modules are not read on the way to the projection', () => {
  async function trace(d: FinanceDB, run: () => Promise<unknown>) {
    const reads: { module: string; id: number }[] = [];
    d.moduleRecords.hook('reading', (obj) => { const o = obj as { module: string; id: number }; reads.push({ module: o.module, id: o.id }); return obj; });
    const tables: Record<string, number> = {};
    for (const t of d.tables) if (t.name !== 'moduleRecords') t.hook('reading', (obj) => { tables[t.name] = (tables[t.name] ?? 0) + 1; return obj; });
    await run();
    return { reads, tables };
  }

  it('with no visit or reminder approved: only Calendar, Tasks, Family and the decisions are read; no Finance, Bills, Projects, Assets or Services row', async () => {
    const h = await hostileHousehold();
    await addEvent(h.d, 'Swim meet', '2026-11-11', { contactIds: [h.sam] }, 10 * 60);
    await addTask(h.d, 'Sign the form');
    await createArrangement({ data: blankArrangement({ title: 'HOSTILE Rosa cleaning' }), today: TODAY }, h.d);
    await appendDecision({ subject: subjectOf('event', 1), decision: 'show' }, h.d);
    const { reads, tables } = await trace(h.d, () => projectionOf(h.d));
    expect([...new Set(reads.map((r) => r.module))].sort()).toEqual(['calendar', 'display', 'family', 'tasks']);
    // the only other tables touched are the shared contacts (members' own Contacts), the shared links and the Calendar's own settings row
    expect(Object.keys(tables).sort().filter((t) => !['contacts', 'links', 'settings'].includes(t))).toEqual([]);
  });

  it('a Contact who is not a household member is never read', async () => {
    const h = await hostileHousehold();
    const seen: number[] = [];
    h.d.contacts.hook('reading', (obj) => { seen.push((obj as { id: number }).id); return obj; });
    await projectionOf(h.d);
    expect(seen).not.toContain(h.coach);
    expect(seen.sort()).toEqual([h.sam, h.robin, h.alex].sort());
  });

  it('an approved visit reads only that arrangement of Household Services (and Tasks); an approved reminder reads no asset', async () => {
    const h = await hostileHousehold();
    const other = await createArrangement({ data: blankArrangement({ title: 'HOSTILE other service', cadence: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } }, anchorDate: TODAY } }), today: TODAY }, h.d);
    const mine = await createArrangement({ data: blankArrangement({ title: 'HOSTILE my service', cadence: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } }, anchorDate: TODAY } }), today: TODAY }, h.d);
    const plan = await addTask(h.d, 'Replace filter', { dueDate: '2026-11-30', repeat: { mode: 'after', rule: { freq: 'monthly', interval: 3, end: { type: 'never' } } } }, [{ module: 'assets', id: `asset:${h.assetId}` }]);
    await appendDecision({ subject: subjectOf('visit', mine.id), decision: 'show', label: 'Cleaner' }, h.d);
    await appendDecision({ subject: subjectOf('reminder', plan), decision: 'show', label: 'Filter' }, h.d);
    const { reads } = await trace(h.d, () => projectionOf(h.d));
    const modules = new Set(reads.map((r) => r.module));
    expect(modules.has('assets')).toBe(false);
    expect(modules.has('bills')).toBe(false);
    expect(modules.has('projects')).toBe(false);
    const servicesIds = [...new Set(reads.filter((r) => r.module === 'services').map((r) => r.id))];
    expect(servicesIds).toEqual([mine.id]);
    expect(servicesIds).not.toContain(other.id);
  });

  it('a hidden or ineligible subject does not cause its source to be read at all', async () => {
    const h = await hostileHousehold();
    const arr = await createArrangement({ data: blankArrangement({ title: 'HOSTILE svc' }), today: TODAY }, h.d);
    await appendDecision({ subject: subjectOf('visit', arr.id), decision: 'show', label: 'Cleaner' }, h.d);
    await appendDecision({ subject: subjectOf('visit', arr.id), decision: 'hide' }, h.d); // revoked
    const { reads } = await trace(h.d, () => projectionOf(h.d));
    expect(reads.some((r) => r.module === 'services')).toBe(false);
  });

  it('building a preview, and the calendar preview, write nothing', async () => {
    const h = await hostileHousehold();
    const family = await calendar(h.d, 'Family');
    await addEvent(h.d, 'School concert', '2026-11-18', { calendarId: family });
    await appendDecision({ subject: subjectOf('calendar', family), decision: 'show' }, h.d);
    const snapshot = async () => JSON.stringify(await Promise.all(h.d.tables.map(async (t) => [t.name, await t.toArray()])));
    const before = await snapshot();
    await projectionOf(h.d);
    await readDisplayState(h.d, { today: TODAY, tz: 'UTC', nowMs: 1, idKey: await testKey() });
    await previewCalendarShare(h.d, family, { today: TODAY });
    expect(await snapshot()).toBe(before);
  });
});

describe('Task associations are associations, not assignments', () => {
  it('a Task naming two people is one item that lists both', async () => {
    const h = await household();
    const t = await addTask(h.d, 'Pack lunches', { contactIds: [h.sam, h.alex], dueDate: '2026-11-10' });
    await appendDecision({ subject: subjectOf('task', t), decision: 'show' }, h.d);
    const { projection } = await projectionOf(h.d);
    expect(projection.tasks).toHaveLength(1);
    expect(projection.tasks[0].people).toHaveLength(2);
    expect(Object.keys(projection.tasks[0]).sort()).toEqual(['due', 'id', 'people', 'repeat', 'status', 'title']);
  });
  it('a Task naming nobody has no people', async () => {
    const h = await household();
    const t = await addTask(h.d, 'Water plants');
    await appendDecision({ subject: subjectOf('task', t), decision: 'show' }, h.d);
    const { projection } = await projectionOf(h.d);
    expect(projection.tasks[0].people).toEqual([]);
    expect(projection.people).toEqual([]);
  });
});

