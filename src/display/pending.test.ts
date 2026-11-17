import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceDB } from '../db';
import { createEvent, loadEvents, newEventData, saveEdit } from '../modules/calendar/data';
import { blankFields, type EventFields } from '../modules/calendar/model';
import { occurrencesOf } from '../modules/calendar/occurrences';
import { msAt } from '../modules/calendar/time';
import { completeTask } from '../modules/tasks/data';
import { appendDecision, loadGrantRows } from './grantStore';
import { effectiveForEvent, resolveGrants, subjectOf } from './grants';
import { applyEventChoice, applyTaskChoice } from './pending';
import { addEvent, addTask, calendar, extras, household, projectionOf, stubStorage, weekly } from './displayTestkit';

/** CS-1 final correction: an editor's family-display choice is a pending form change, written with Save, in the same transaction, and nowhere else. */
beforeEach(() => { vi.restoreAllMocks(); stubStorage(); });

const edited = (date: string, minutes: number, title: string): EventFields => ({ ...blankFields(date, msAt(date, minutes)), title, startDate: date, endDate: date });
const grantCount = async (d: FinanceDB) => (await loadGrantRows(d)).length;
const occ = async (d: FinanceDB, id: number, key: string) => occurrencesOf((await loadEvents(d)).find((e) => e.id === id)!, key, key)[0];
const titles = async (d: FinanceDB) => (await projectionOf(d)).projection.entries.map((e) => `${e.title}@${e.start.date}`);
const failNthAdd = (d: FinanceDB, n: number) => {
  const orig = d.moduleRecords.add.bind(d.moduleRecords);
  let count = 0;
  vi.spyOn(d.moduleRecords, 'add').mockImplementation(((...a: Parameters<typeof orig>) => { count++; if (count === n) throw new Error('disk full'); return orig(...a); }) as typeof orig);
};

describe('Cancel and close write nothing', () => {
  it('the controls only report a pending choice; they never write (source check), and the editors pass it to the save calls only', () => {
    const control = readFileSync('src/display/DisplayControl.tsx', 'utf8');
    expect(control).not.toMatch(/appendDecision|grantStore|applyEventChoice|applyTaskChoice|\.put\(|\.add\(/);
    const ev = readFileSync('src/modules/calendar/EventEditor.tsx', 'utf8');
    const tk = readFileSync('src/modules/tasks/TaskEditor.tsx', 'utf8');
    expect(ev.match(/displayChoice/g)!.length).toBeGreaterThan(2);
    expect(ev).toMatch(/saveEdit\(occ, fields, extras\(\), scope, undefined, displayChoice\)/);
    expect(ev).toMatch(/createEvent\(newEventData\(fields, extras\(\)\), undefined, displayChoice\)/);
    expect(ev).not.toMatch(/appendDecision/);
    expect(tk).toMatch(/applyTaskChoice\(db, task\.id, displayChoice\)/);
    expect(tk).not.toMatch(/appendDecision/);
  });

  it('with no choice pending, saving an edit writes no decision', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    await saveEdit(await occ(d, id, '2026-11-11'), edited('2026-11-11', 11 * 60, 'Swim meet (later)'), extras(), 'all', d, null);
    await saveEdit(await occ(d, id, '2026-11-11'), edited('2026-11-11', 12 * 60, 'Swim meet (later still)'), extras(), 'all', d, undefined);
    expect(await grantCount(d)).toBe(0);
  });
});

describe('Save persists the intended decision, once, on the right record', () => {
  it('an existing event: show, then Busy, then hide are each written with Save and append (nothing is edited)', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    const save = (c: 'show' | 'busy' | 'hide') => saveEdit(occ_(id), edited('2026-11-11', 10 * 60, 'Swim meet'), extras(), 'all', d, c);
    const occ_ = (x: number) => ({ ...(occurrencesOf((loaded.find((e) => e.id === x))!, '2026-11-11', '2026-11-11')[0]) });
    let loaded = await loadEvents(d);
    await save('show');
    expect(await titles(d)).toEqual(['Swim meet@2026-11-11']);
    loaded = await loadEvents(d);
    await save('busy');
    expect(await titles(d)).toEqual(['Busy@2026-11-11']);
    loaded = await loadEvents(d);
    await save('hide');
    expect(await titles(d)).toEqual([]);
    const rows = await loadGrantRows(d);
    expect(rows).toHaveLength(3);
    expect(resolveGrants(rows).get(subjectOf('event', id)).headIds).toEqual([rows[2].id]);
    expect(rows.every((r) => r.deletedAt == null)).toBe(true);
  });

  it('a choice that equals what is already in effect writes nothing (including "Not shown" on a private event)', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    await d.transaction('rw', d.moduleRecords, async () => { expect(await applyEventChoice(d, id, 'hide')).toBe(false); });
    await appendDecision({ subject: subjectOf('event', id), decision: 'show' }, d);
    const n = await grantCount(d);
    await d.transaction('rw', d.moduleRecords, async () => { expect(await applyEventChoice(d, id, 'show')).toBe(false); });
    expect(await grantCount(d)).toBe(n);
  });

  it('a newly created event gets its decision only with the creation, and a shared-calendar event can be created already private', async () => {
    const { d } = await household();
    const fam = await calendar(d, 'Family');
    await appendDecision({ subject: subjectOf('calendar', fam), decision: 'show' }, d);
    const before = await grantCount(d);
    const id = await createEvent(newEventData(edited('2026-11-12', 9 * 60, 'Dentist'), extras({ calendarId: fam })), d, 'hide');
    expect(await titles(d)).toEqual([]); // never visible, not even for an instant of the same write
    expect(resolveGrants(await loadGrantRows(d)).get(subjectOf('event', id)).state).toBe('hide');
    expect(await grantCount(d)).toBe(before + 1);
    const shown = await createEvent(newEventData(edited('2026-11-13', 9 * 60, 'Concert'), extras({ calendarId: fam })), d, null); // no choice: inherits, writes nothing
    expect(await grantCount(d)).toBe(before + 1);
    expect(await titles(d)).toEqual(['Concert@2026-11-13']);
    void shown;
  });

  it('a Task: Save writes the decision on the ROOT of its repeat chain, so a successor stays covered; the same choice twice writes once', async () => {
    const { d } = await household();
    const rule = { mode: 'fixed' as const, rule: { freq: 'weekly' as const, interval: 1, end: { type: 'never' as const } } };
    const root = await addTask(d, 'Weekly chore', { dueDate: '2026-11-09', repeat: rule });
    const { spawnedId } = await completeTask(root, '2026-11-09', d);
    await d.transaction('rw', d.moduleRecords, async () => { expect(await applyTaskChoice(d, spawnedId!, 'show')).toBe(true); });
    expect(resolveGrants(await loadGrantRows(d)).get(subjectOf('task', root)).state).toBe('show');
    expect((await projectionOf(d)).projection.tasks.map((t) => t.title)).toEqual(['Weekly chore']);
    await d.transaction('rw', d.moduleRecords, async () => { expect(await applyTaskChoice(d, spawnedId!, 'show')).toBe(false); });
    expect(await grantCount(d)).toBe(1);
    await d.transaction('rw', d.moduleRecords, async () => { expect(await applyTaskChoice(d, spawnedId!, 'hide')).toBe(true); });
    expect((await projectionOf(d)).projection.tasks).toEqual([]);
  });

  it('a Task with an ambiguous chain is left alone', async () => {
    const { d } = await household();
    const t = await addTask(d, 'Orphan', {});
    await d.moduleRecords.update(t, { 'data.recurFrom': 987654321 });
    await d.transaction('rw', d.moduleRecords, async () => { expect(await applyTaskChoice(d, t, 'show')).toBe(false); });
    expect(await grantCount(d)).toBe(0);
  });
});

describe('failures leave nothing behind', () => {
  it('a failed event creation leaves neither the event nor a decision', async () => {
    const { d } = await household();
    const events = (await loadEvents(d)).length;
    failNthAdd(d, 2); // 1st add = the event, 2nd add = the decision
    await expect(createEvent(newEventData(edited('2026-11-12', 9 * 60, 'Dentist'), extras()), d, 'show')).rejects.toThrow('disk full');
    vi.restoreAllMocks();
    expect(await grantCount(d)).toBe(0);
    expect((await loadEvents(d)).length).toBe(events);
  });

  it('a failed edit of an existing event leaves the event unchanged and no decision', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    const o = await occ(d, id, '2026-11-11');
    failNthAdd(d, 1); // the decision is the first add
    await expect(saveEdit(o, edited('2026-11-11', 15 * 60, 'Changed'), extras(), 'all', d, 'show')).rejects.toThrow('disk full');
    vi.restoreAllMocks();
    expect(await grantCount(d)).toBe(0);
    expect((await loadEvents(d))[0].data.title).toBe('Swim meet');
  });

  it('a failed series split does not partially carry a decision or a pending one', async () => {
    const { d } = await household();
    const a = await addEvent(d, 'Piano', '2026-11-02', { recurrence: weekly }, 16 * 60);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show' }, d);
    const rows = await d.moduleRecords.count();
    const o = await occ(d, a, '2026-11-16');
    failNthAdd(d, 3); // new event, carried decision, then the pending decision fails
    await expect(saveEdit(o, edited('2026-11-16', 17 * 60, 'Piano (new)'), extras({ recurrence: weekly }), 'following', d, 'busy')).rejects.toThrow('disk full');
    vi.restoreAllMocks();
    expect(await d.moduleRecords.count()).toBe(rows); // all or nothing
    expect((await loadEvents(d))[0].data.recurrence?.end).toEqual({ type: 'never' });
    expect(await grantCount(d)).toBe(1);
  });
});

describe('recurrence: the decision goes to the right identity', () => {
  const split = async (d: FinanceDB, id: number, choice: 'show' | 'busy' | 'hide' | null) =>
    saveEdit(await occ(d, id, '2026-11-16'), edited('2026-11-16', 17 * 60, 'Piano (new)'), extras({ recurrence: weekly }), 'following', d, choice);
  const eff = async (d: FinanceDB, id: number) => effectiveForEvent(resolveGrants(await loadGrantRows(d)), id, 1);

  it('this and following with a pending choice puts it on the NEW id; the old event keeps its own', async () => {
    const { d } = await household();
    const a = await addEvent(d, 'Piano', '2026-11-02', { recurrence: weekly }, 16 * 60);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show' }, d);
    const b = await split(d, a, 'busy');
    expect(b).not.toBe(a);
    expect((await eff(d, a)).show).toBe('details');
    expect((await eff(d, b)).show).toBe('busy');
  });

  it('this and following with NO pending choice still carries an explicit hide, so a shared calendar is not inherited', async () => {
    const { d } = await household();
    const fam = await calendar(d, 'Family');
    await appendDecision({ subject: subjectOf('calendar', fam), decision: 'show' }, d);
    const a = await addEvent(d, 'Piano', '2026-11-02', { calendarId: fam, recurrence: weekly }, 16 * 60);
    await appendDecision({ subject: subjectOf('event', a), decision: 'hide' }, d);
    const b = await saveEdit(await occ(d, a, '2026-11-16'), edited('2026-11-16', 17 * 60, 'Piano (new)'), extras({ calendarId: fam, recurrence: weekly }), 'following', d, null);
    expect(resolveGrants(await loadGrantRows(d)).get(subjectOf('event', b)).state).toBe('hide');
    expect(await titles(d)).toEqual([]);
  });

  it('a pending choice that equals what the split already carried writes nothing extra', async () => {
    const { d } = await household();
    const a = await addEvent(d, 'Piano', '2026-11-02', { recurrence: weekly }, 16 * 60);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show' }, d);
    await split(d, a, 'show');
    expect(await grantCount(d)).toBe(2); // the original and the carried one
  });

  it('editing ONE occurrence or the WHOLE series puts the pending choice on the one event that holds the series', async () => {
    const { d } = await household();
    const a = await addEvent(d, 'Piano', '2026-11-02', { recurrence: weekly }, 16 * 60);
    await saveEdit(await occ(d, a, '2026-11-09'), edited('2026-11-09', 18 * 60, 'Piano (late)'), extras({ recurrence: weekly }), 'one', d, 'show');
    expect(resolveGrants(await loadGrantRows(d)).get(subjectOf('event', a)).state).toBe('show');
    expect(await loadEvents(d)).toHaveLength(1);
    await saveEdit(await occ(d, a, '2026-11-02'), edited('2026-11-02', 15 * 60, 'Piano lesson'), extras({ recurrence: weekly }), 'all', d, 'hide');
    expect(resolveGrants(await loadGrantRows(d)).get(subjectOf('event', a)).state).toBe('hide');
  });
});

describe('append-only and conflict behavior still hold', () => {
  it('saving over a conflict writes a decision that supersedes every current head and settles it', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    for (const decision of ['show', 'hide'] as const) {
      await d.moduleRecords.add({ module: 'display', kind: 'grant', data: { v: 1, subject: subjectOf('event', id), decision, supersedes: [], deviceId: 'x' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    }
    expect(resolveGrants(await loadGrantRows(d)).get(subjectOf('event', id)).conflict).toBe(true);
    await d.transaction('rw', d.moduleRecords, async () => { expect(await applyEventChoice(d, id, 'show')).toBe(true); });
    const s = resolveGrants(await loadGrantRows(d)).get(subjectOf('event', id));
    expect(s).toMatchObject({ state: 'show', conflict: false });
    expect(await grantCount(d)).toBe(3);
  });
});
