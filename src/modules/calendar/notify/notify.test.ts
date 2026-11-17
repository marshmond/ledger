import { beforeEach, describe, expect, it } from 'vitest';
import { addContact, addEvent, extras, fresh } from '../../../display/displayTestkit';
import { scanText } from '../../../lib/leakTestkit';
import type { FinanceDB } from '../../../db';
import { loadEvents, restoreEventData, removeOccurrence, saveEdit, snapshotEvent, type Scope } from '../data';
import { occurrencesOf, pickFields, type Occurrence } from '../occurrences';
import { msAt } from '../time';
import type { EventFields } from '../model';
import type { Recurrence } from '../recurrence';
import { detectChanges } from './facts';
import { classifyContacts, hasEligible, MAX_RECIPIENTS, pickRecipients } from './recipients';
import { offerAfterDelete, offerAfterRestore, offerAfterSave, offerForDetails, quietly, type NoticeOffer } from './offers';
import { buildMessage, tidyPersonal } from './wording';
import { foldRequests, readNotice, readRows } from './records';
import { confirmAndSend, declineOffer, loadNoticeRows, loadRequests, prepare, refreshStatuses, retryRequest, sendApproved, toldAboutCancellation } from './send';
import { saveNoticeSettings } from './settings';
import { statusLabel, statusWords } from './words';
import { encodeRequest, fakeTransport, githubOutboxTransport, parseResult, type FakeTransport } from './transport';
import type { MessageOptions } from './types';

const TODAY = '2026-11-16'; // a Monday, so 2026-11-18 is a Wednesday
const WEEKLY: Recurrence = { freq: 'weekly', interval: 1, byWeekday: [3], end: { type: 'never' } };
const OPTS: MessageOptions = { includeLocation: false, includePeople: true, personalMessage: '', senderName: 'Alex Sample', replyTo: 'alex@example.test', zoneLabel: 'Test Standard Time', today: TODAY };

let d: FinanceDB;
beforeEach(() => { d = fresh(); });

async function occ(id: number, key: string): Promise<Occurrence> {
  const rec = (await loadEvents(d)).find((e) => e.id === id)!;
  return occurrencesOf(rec, key, key).find((o) => o.key === key)!;
}
const edit = (o: Occurrence, over: Partial<EventFields>): EventFields => ({ ...pickFields(o), ...over });
const people = async () => ({
  dana: await addContact(d, 'Dana Test', { email: 'dana@example.test' }),
  lee: await addContact(d, 'Lee Sample', { email: 'lee@example.test' }),
  noMail: await addContact(d, 'Kit NoMail'),
});
async function soccer(over: Parameters<typeof extras>[0] = {}) {
  return addEvent(d, 'Soccer practice', '2026-11-04', { recurrence: WEEKLY, ...over }, 16 * 60 + 30); // Wednesdays 4:30 PM, one hour
}
const recipientsFor = async (offer: NoticeOffer, ids: number[]) => pickRecipients(classifyContacts(await d.contacts.toArray(), offer.involved), ids).picked;
async function approve(offer: NoticeOffer, ids: number[], transport: FakeTransport | null, options: Partial<MessageOptions> = {}) {
  const o = { ...OPTS, ...options };
  const prepared = await prepare(offer.subject, await recipientsFor(offer, ids), o, await loadRequests(d));
  return { prepared, result: await confirmAndSend({ subject: offer.subject, prepared, transport }, d) };
}
const noticeCount = async () => (await loadNoticeRows(d)).rows.length;

describe('1. saving never depends on notifications', () => {
  it('an offer that throws is swallowed, and the saved event is untouched', async () => {
    await people();
    const id = await addEvent(d, 'Dentist', '2026-11-20', {}, 9 * 60);
    const o = await occ(id, '2026-11-20');
    await saveEdit(o, edit(o, { title: 'Dentist (new office)' }), extras(), 'all', d);
    expect(await quietly(async () => { throw new Error('boom'); })).toBeNull();
    expect((await loadEvents(d)).find((e) => e.id === id)!.data.title).toBe('Dentist (new office)');
  });
  it('the editor calls the offer only after the save, wrapped so a failure cannot reach the save', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/modules/calendar/EventEditor.tsx', 'utf8');
    expect(src).toMatch(/quietly\(\(\) => offerAfterSave/);
    expect(src.indexOf('await applyLinks(id)')).toBeLessThan(src.indexOf('quietly(() => offerAfterSave'));
  });
  it('nothing in the notify folder runs on its own: no timer, no start-up call, no sync hook', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    for (const f of readdirSync('src/modules/calendar/notify').filter((x) => /\.tsx?$/.test(x) && !/\.test\./.test(x))) {
      const src = readFileSync(`src/modules/calendar/notify/${f}`, 'utf8');
      expect(src, f).not.toMatch(/setInterval|setTimeout|requestIdleCallback|addEventListener\('online'|setChangeListener/);
    }
  });
  it('Save, Undo and the page cannot send: the editor and the Calendar page never import anything that records an approval or hands a message over', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/modules/calendar/EventEditor.tsx', 'src/modules/calendar/CalendarPage.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/confirmAndSend|\bdeliver\b|sendApproved|retryRequest|refreshStatuses|getTransport|setTransport|githubOutboxTransport/);
    }
    const editor = readFileSync('src/modules/calendar/EventEditor.tsx', 'utf8');
    // the Undo path only OFFERS a correction when people were told
    expect(editor).toMatch(/toldAboutCancellation[\s\S]{0,400}offerAfterRestore/);
  });
  it('nothing in the notify folder logs, so recipient addresses never reach a console or a log', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    for (const f of readdirSync('src/modules/calendar/notify').filter((x) => /\.tsx?$/.test(x) && !/\.test\./.test(x))) {
      expect(readFileSync(`src/modules/calendar/notify/${f}`, 'utf8'), f).not.toMatch(/console\.|debugger/);
    }
  });
  it('the development-only sender switch is guarded so a production build cannot expose it', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/modules/calendar/notify/devSwitch.ts', 'utf8')).toContain("if (!import.meta.env.DEV || typeof window === 'undefined') return;");
  });
});

describe('2. Not now and Cancel send nothing', () => {
  it('Not now records one decline and never touches a transport', async () => {
    await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-18');
    const offer = (await offerAfterSave({ occ: o, scope: 'one', savedId: id, edited: edit(o, { startAt: msAt('2026-11-18', 17 * 60), endAt: msAt('2026-11-18', 18 * 60) }) }, d))!;
    const t = fakeTransport();
    await declineOffer(offer.subject, { today: TODAY }, d);
    const rows = (await loadNoticeRows(d)).rows;
    expect(rows.map((r) => r.data.t)).toEqual(['declined']);
    expect(t.calls).toBe(0);
    expect(await loadRequests(d)).toEqual([]);
  });
  it('building an offer and a preview writes nothing', async () => {
    await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-18');
    const offer = (await offerAfterSave({ occ: o, scope: 'one', savedId: id, edited: edit(o, { title: 'Soccer practice (field 2)' }) }, d))!;
    const before = await noticeCount();
    await prepare(offer.subject, await recipientsFor(offer, []), OPTS, []);
    expect(await noticeCount()).toBe(before);
    expect(before).toBe(0);
  });
});

describe('3. nobody is selected for you', () => {
  it('involved people are suggested, never picked', async () => {
    const p = await people();
    const id = await soccer({ contactIds: [p.dana, p.noMail] });
    const o = await occ(id, '2026-11-18');
    const offer = (await offerAfterSave({ occ: o, scope: 'all', savedId: id, edited: edit(o, { title: 'Soccer' }) }, d))!;
    expect(offer.involved).toEqual([p.dana, p.noMail]);
    expect((await recipientsFor(offer, [])).length).toBe(0);
    const prepared = await prepare(offer.subject, [], OPTS, []);
    expect(prepared.items).toEqual([]);
    expect(await confirmAndSend({ subject: offer.subject, prepared, transport: fakeTransport() }, d)).toEqual({ kind: 'nothing-new' });
  });
  it('a contact with no or a bad address is unavailable with a reason, and a shared address is used once', async () => {
    const dana = await addContact(d, 'Dana Test', { email: 'Dana@Example.test' });
    const twin = await addContact(d, 'Dana Twin', { email: ' dana@example.test ' });
    const bad = await addContact(d, 'Bad Address', { email: 'not-an-address' });
    const none = await addContact(d, 'No Address');
    const rows = classifyContacts(await d.contacts.toArray(), [dana]);
    const by = (id: number) => rows.find((r) => r.contactId === id)!;
    expect(by(dana).usable).toBe(true);
    expect(by(twin)).toMatchObject({ usable: false, reason: 'Same address as Dana Test.' });
    expect(by(bad)).toMatchObject({ usable: false, reason: 'The email address does not look right.' });
    expect(by(none)).toMatchObject({ usable: false, reason: 'No email address.' });
    expect(pickRecipients(rows, [twin, dana, bad]).picked.map((r) => r.contactId)).toEqual([dana]);
  });
  it('at most ten people at once', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push(await addContact(d, `Person ${String.fromCharCode(65 + i)}`, { email: `p${String.fromCharCode(97 + i)}@example.test` }));
    const rows = classifyContacts(await d.contacts.toArray(), []);
    const r = pickRecipients(rows, ids);
    expect(r.picked.length).toBe(MAX_RECIPIENTS);
    expect(r.overLimit).toBe(true);
  });
  it('with nobody who has an address, no offer is made at all', async () => {
    await addContact(d, 'Kit NoMail');
    const id = await addEvent(d, 'Dentist', '2026-11-20', {}, 9 * 60);
    const o = await occ(id, '2026-11-20');
    expect(await offerAfterSave({ occ: o, scope: 'all', savedId: id, edited: edit(o, { title: 'Dentist 2' }) }, d)).toBeNull();
    expect(hasEligible(classifyContacts(await d.contacts.toArray(), []))).toBe(false);
  });
});

describe('4. only meaningful changes prompt', () => {
  const base = async () => {
    await people();
    const id = await addEvent(d, 'Dentist', '2026-11-20', {}, 9 * 60, { location: 'Main St' });
    return { id, o: await occ(id, '2026-11-20') };
  };
  it('title, date, start time, end time, all-day, location, repeat and people each prompt', async () => {
    const { id, o } = await base();
    const m = (over: Partial<EventFields>) => offerAfterSave({ occ: o, scope: 'all', savedId: id, edited: edit(o, over) }, d);
    expect((await m({ title: 'Dentist visit' }))!.subject.changes).toEqual(['title']);
    expect((await m({ startDate: '2026-11-21', endDate: '2026-11-21', startAt: msAt('2026-11-21', 9 * 60), endAt: msAt('2026-11-21', 10 * 60) }))!.subject.changes).toContain('date');
    expect((await m({ startAt: msAt('2026-11-20', 10 * 60), endAt: msAt('2026-11-20', 11 * 60) }))!.subject.changes).toEqual(['time']);
    expect((await m({ endAt: msAt('2026-11-20', 10 * 60 + 30) }))!.subject.changes).toEqual(['time']);
    expect((await m({ allDay: true, startDate: '2026-11-20', endDate: '2026-11-20' }))!.subject.changes).toContain('allDay');
    expect((await m({ location: 'Second St' }))!.subject.changes).toEqual(['location']);
  });
  it('notes, priority and reminders alone do not prompt', async () => {
    const { id, o } = await base();
    const m = (over: Partial<EventFields>) => offerAfterSave({ occ: o, scope: 'all', savedId: id, edited: edit(o, over) }, d);
    expect(await m({ notes: 'gate code in the door', priority: 'high', reminders: [15, 60] })).toBeNull();
    expect(await m({})).toBeNull();
  });
  it('a changed repeat rule or changed people is meaningful; tags, calendar and project are not looked at', () => {
    const f: EventFields = { title: 'x', allDay: false, startDate: '2026-11-18', endDate: '2026-11-18', startAt: msAt('2026-11-18', 600), endAt: msAt('2026-11-18', 660), location: '', notes: '', priority: 'medium', reminders: [] };
    const same = { fields: f, recurrence: WEEKLY, people: [1, 2] };
    expect(detectChanges(same, { ...same, recurrence: { ...WEEKLY, byWeekday: [3, 5] } }, 'all')).toEqual(['recurrence']);
    expect(detectChanges(same, { ...same, people: [2, 1, 3] }, 'all')).toEqual(['people']);
    expect(detectChanges(same, { ...same, people: [2, 1] }, 'all')).toEqual([]);
    // one date: the series' own rule and people are not this date's to change
    expect(detectChanges(same, { ...same, recurrence: null, people: [] }, 'one')).toEqual([]);
  });
  it('a new event prompts; a non-repeating event becoming a repeating one is a change to the repeat', async () => {
    await people();
    const id = await addEvent(d, 'Book club', '2026-11-25', {}, 19 * 60);
    const created = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields((await occ(id, '2026-11-25'))) }, d))!;
    expect(created.subject).toMatchObject({ kind: 'created', scope: 'single' });
  });
});

describe('5. recurring events: every scope is described correctly', () => {
  const later = (o: Occurrence) => edit(o, { startAt: msAt(o.key, 17 * 60), endAt: msAt(o.key, 18 * 60) });
  const text = (offer: NoticeOffer, options: Partial<MessageOptions> = {}) => buildMessage(offer.subject, { ...OPTS, ...options }, 'Dana Test');

  it('this one date only', async () => {
    await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-18');
    const edited = later(o);
    await saveEdit(o, edited, extras({ recurrence: WEEKLY }), 'one', d);
    const offer = (await offerAfterSave({ occ: o, scope: 'one', savedId: id, edited }, d))!;
    expect(offer.subject).toMatchObject({ kind: 'updated', scope: 'one', affectedDate: '2026-11-18', eventIds: [id] });
    const m = text(offer);
    expect(m.subject).toBe('Updated: Soccer practice, Wed, Nov 18 only');
    expect(m.text).toContain('Soccer practice has changed for Wednesday, November 18 only. The other dates are unchanged.');
    expect(m.text).toContain('Time: now 5:00 PM to 6:00 PM (was 4:30 PM to 5:30 PM)');
    expect(m.text).toContain('When: Wednesday, November 18, 5:00 PM to 6:00 PM (Test Standard Time)');
    expect(m.text).not.toContain('Repeats:');
  });

  it('this and following: a new event id is made, and the notice names the date range and both ids', async () => {
    await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-18');
    const edited = later(o);
    const newId = await saveEdit(o, edited, extras({ recurrence: WEEKLY }), 'following', d);
    expect(newId).not.toBe(id);
    const offer = (await offerAfterSave({ occ: o, scope: 'following', savedId: newId, edited }, d))!;
    expect(offer.subject).toMatchObject({ scope: 'following', affectedDate: '2026-11-18', eventIds: [id, newId], factsEventId: newId });
    const m = text(offer);
    expect(m.subject).toBe('Updated: Soccer practice, from Wed, Nov 18');
    expect(m.text).toContain('Soccer practice changes from November 18 onward. Dates before November 18 are unchanged.');
    expect(m.text).toContain('Repeats: Every week on Wednesday, starting Wednesday, November 18');
    expect(m.text).toContain('Time: now 5:00 PM to 6:00 PM (was 4:30 PM to 5:30 PM)');
  });

  it('the whole series', async () => {
    await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-18');
    const edited = later(o);
    await saveEdit(o, edited, extras({ recurrence: WEEKLY }), 'all', d);
    const offer = (await offerAfterSave({ occ: o, scope: 'all', savedId: id, edited }, d))!;
    expect(offer.subject.scope).toBe('all');
    const m = text(offer);
    expect(m.text).toContain('Soccer practice has changed for the whole series (Every week on Wednesday).');
    expect(m.text).toContain('When: 5:00 PM to 6:00 PM (Test Standard Time)');
    expect(m.text).toContain('Repeats: Every week on Wednesday');
  });

  it('"this and following" on the very first date is the whole series, and says so', async () => {
    await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-04');
    const edited = later(o);
    const saved = await saveEdit(o, edited, extras({ recurrence: WEEKLY }), 'following', d);
    expect(saved).toBe(id);
    const offer = (await offerAfterSave({ occ: o, scope: 'following', savedId: saved, edited }, d))!;
    expect(offer.subject.scope).toBe('all');
  });

  it('a new repeating event says how it repeats and when it starts', async () => {
    await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-04');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    const m = text(offer);
    expect(m.subject).toBe('New: Soccer practice, Wed, Nov 4 (repeats)');
    expect(m.text).toContain('New repeating event: Soccer practice. Every week on Wednesday, starting Wednesday, November 4.');
    expect(m.text).toContain('Length: 1 hour');
  });

  it('the same wording is used whatever the event is called (it is computed from the real rule and dates)', async () => {
    await people();
    const id = await addEvent(d, 'Piano', '2026-11-04', { recurrence: { freq: 'weekly', interval: 2, byWeekday: [1, 3], end: { type: 'until', date: '2026-12-30' } } }, 15 * 60);
    const o = await occ(id, '2026-11-04');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    expect(text(offer).text).toContain('Every 2 weeks on Monday and Wednesday, until Wednesday, December 30');
  });
});

describe('6. cancelling describes the right scope', () => {
  const cancel = async (scope: Scope, key: string) => {
    await people();
    const id = await soccer();
    const o = await occ(id, key);
    const snap = (await snapshotEvent(id, d))!;
    await removeOccurrence(o, scope, d);
    const offer = (await offerAfterDelete({ occ: o, scope, snap }, d))!;
    return { offer, id, o, snap, m: buildMessage(offer.subject, OPTS, 'Dana Test') };
  };
  it('one date', async () => {
    const { m, offer } = await cancel('one', '2026-11-18');
    expect(offer.subject.scope).toBe('one');
    expect(m.subject).toBe('Cancelled: Soccer practice, Wed, Nov 18');
    expect(m.text).toContain('Cancelled: Soccer practice on Wednesday, November 18 only. The other dates are unchanged.');
  });
  it('this and following', async () => {
    const { m, offer } = await cancel('following', '2026-11-18');
    expect(offer.subject.scope).toBe('following');
    expect(m.subject).toBe('Cancelled: Soccer practice, from Wed, Nov 18');
    expect(m.text).toContain('Cancelled from November 18 onward: Soccer practice. Dates before November 18 are unchanged.');
  });
  it('the whole series, including "this and following" from the first date', async () => {
    const all = await cancel('all', '2026-11-18');
    expect(all.m.text).toContain('Cancelled: the whole series of Soccer practice (Every week on Wednesday).');
    expect(all.m.subject).toBe('Cancelled: Soccer practice (whole series)');
    d = fresh();
    const first = await cancel('following', '2026-11-04');
    expect(first.offer.subject.scope).toBe('all');
  });
  it('a single event', async () => {
    await people();
    const id = await addEvent(d, 'Dentist', '2026-11-20', {}, 9 * 60);
    const o = await occ(id, '2026-11-20');
    const snap = (await snapshotEvent(id, d))!;
    await removeOccurrence(o, 'all', d);
    const offer = (await offerAfterDelete({ occ: o, scope: 'all', snap }, d))!;
    expect(offer.subject.scope).toBe('single');
    expect(buildMessage(offer.subject, OPTS, 'Dana').text).toContain('Cancelled: Dentist on Friday, November 20.');
  });
  it('deleting works and the event is gone even when the offer is never used', async () => {
    const { id } = await cancel('all', '2026-11-18');
    expect((await loadEvents(d)).find((e) => e.id === id)).toBeUndefined();
  });
});

describe('7. what a message may and may not contain', () => {
  it('private notes, tags, amounts, other events and other recipients never appear; place and people only when allowed', async () => {
    const p = await people();
    const id = await addEvent(d, 'Tutoring', '2026-11-19', { contactIds: [p.dana, p.lee], tagIds: [77] }, 15 * 60, { location: 'Library room 4', notes: 'SECRETNOTE owes $4,500 account 8675309', priority: 'high' });
    await addEvent(d, 'Other private thing', '2026-11-19', {}, 9 * 60);
    const o = await occ(id, '2026-11-19');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    const without = buildMessage(offer.subject, { ...OPTS, includeLocation: false, includePeople: false }, 'Dana Test');
    const all = scanText(without);
    for (const bad of ['SECRETNOTE', '4,500', '8675309', 'Library', 'Other private', 'lee@example.test', 'dana@example.test', 'Lee Sample', 'high']) expect(all, bad).not.toContain(bad);
    expect(without.text).toContain('Hi Dana,');
    const withBoth = buildMessage(offer.subject, { ...OPTS, includeLocation: true, includePeople: true }, 'Dana Test');
    expect(withBoth.text).toContain('Where: Library room 4');
    expect(withBoth.text).toContain('Who: Dana Test, Lee Sample');
    expect(scanText(withBoth)).not.toContain('SECRETNOTE');
    expect(scanText(withBoth)).not.toContain('lee@example.test');
  });
  it('a changed place without the place switched on says only that it changed', async () => {
    await people();
    const id = await addEvent(d, 'Tutoring', '2026-11-19', {}, 15 * 60, { location: 'Library room 4' });
    const o = await occ(id, '2026-11-19');
    const edited = edit(o, { location: 'Cafe on Elm' });
    await saveEdit(o, edited, extras(), 'all', d);
    const offer = (await offerAfterSave({ occ: o, scope: 'all', savedId: id, edited }, d))!;
    const off = buildMessage(offer.subject, OPTS, 'Dana');
    expect(off.text).toContain('The place has changed.');
    expect(off.text).not.toMatch(/Library|Elm/);
    expect(buildMessage(offer.subject, { ...OPTS, includeLocation: true }, 'Dana').text).toContain('Place: now Cafe on Elm (was Library room 4)');
  });
  it('the personal note is tidied and limited, and the footer names the sender, not an address', () => {
    expect(tidyPersonal('  Hi\u0007 there \r\n\r\n see you!  ' + 'x'.repeat(900)).length).toBe(500);
    expect(tidyPersonal('a\u0000b')).toBe('ab');
  });
  it('the stored history holds the message and addresses used, and none of the event\'s private fields', async () => {
    const p = await people();
    const id = await addEvent(d, 'Tutoring', '2026-11-19', { contactIds: [p.dana] }, 15 * 60, { notes: 'SECRETNOTE 424242', priority: 'high' });
    const o = await occ(id, '2026-11-19');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    await approve(offer, [p.dana], null);
    const stored = scanText((await d.moduleRecords.where('[module+kind]').equals(['calendar', 'notice']).toArray()).map((r) => r.data));
    expect(stored).toContain('dana@example.test');
    expect(stored).not.toContain('SECRETNOTE');
    expect(stored).not.toContain('424242');
  });
});

describe('8. a message is sent at most once', () => {
  const setup = async () => {
    const p = await people();
    const id = await soccer({ contactIds: [p.dana] });
    const o = await occ(id, '2026-11-18');
    const edited = edit(o, { startAt: msAt('2026-11-18', 17 * 60), endAt: msAt('2026-11-18', 18 * 60) });
    await saveEdit(o, edited, extras({ recurrence: WEEKLY, contactIds: [p.dana] }), 'one', d);
    const offer = (await offerAfterSave({ occ: o, scope: 'one', savedId: id, edited }, d))!;
    return { p, id, offer };
  };
  it('pressing Send twice (even at the same moment) hands over one request', async () => {
    const { p, offer } = await setup();
    const t = fakeTransport('accept');
    const [a, b] = await Promise.all([approve(offer, [p.dana, p.lee], t), approve(offer, [p.dana, p.lee], t)]);
    expect(t.outbox.length).toBe(2); // two people, once each
    const kinds = [a.result.kind, b.result.kind].sort();
    expect(kinds).toEqual(['nothing-new', 'recorded']);
    expect((await loadRequests(d)).every((v) => v.state === 'accepted')).toBe(true);
    // a later reopened dialog finds both already done
    const again = await approve(offer, [p.dana], t);
    expect(again.result.kind).toBe('nothing-new');
    expect(t.outbox.length).toBe(2);
  });
  it('a second device (same history, another transport call) cannot add a copy: the id is the same file', async () => {
    const { p, offer } = await setup();
    const t = fakeTransport('queue');
    await approve(offer, [p.dana], t);
    const req = t.outbox[0];
    expect(await t.submit(req)).toEqual({ kind: 'duplicate' });
    expect(t.outbox.length).toBe(1);
  });
  it('the same person is not told twice about the same change even when the group differs', async () => {
    const { p, offer } = await setup();
    const t = fakeTransport('accept');
    await approve(offer, [p.dana], t);
    const second = await approve(offer, [p.dana, p.lee], t);
    expect(second.result).toMatchObject({ kind: 'recorded', skipped: 1 });
    expect(t.outbox.map((r) => r.to.address).sort()).toEqual(['dana@example.test', 'lee@example.test']);
  });
  it('a genuinely revised event is a new notification', async () => {
    const { p, id, offer } = await setup();
    const t = fakeTransport('accept');
    await approve(offer, [p.dana], t);
    const o2 = await occ(id, '2026-11-18');
    const edited2 = edit(o2, { startAt: msAt('2026-11-18', 18 * 60), endAt: msAt('2026-11-18', 19 * 60) });
    await saveEdit(o2, edited2, extras({ recurrence: WEEKLY }), 'one', d);
    const offer2 = (await offerAfterSave({ occ: o2, scope: 'one', savedId: id, edited: edited2 }, d))!;
    const r = await approve(offer2, [p.dana], t);
    expect(r.result.kind).toBe('recorded');
    expect(t.outbox.length).toBe(2);
  });
  it('a reload loses nothing: the approval is on record before and independent of delivery', async () => {
    const { p, offer } = await setup();
    const { result } = await approve(offer, [p.dana], null); // sending not connected
    expect(result).toMatchObject({ kind: 'recorded', delivered: false });
    const views = await loadRequests(d);
    expect(views.map((v) => v.state)).toEqual(['confirmed']);
    const again = await approve(offer, [p.dana], fakeTransport());
    expect(again.result.kind).toBe('nothing-new'); // already approved: the owner uses "Send now", not a second approval
  });
  it('the daily limit is enforced before anything is approved', async () => {
    const p = await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-18');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    // 30 approvals already today
    for (let i = 0; i < 30; i++) await d.moduleRecords.add({ module: 'calendar', kind: 'notice', data: { v: 1, deviceId: 'x', t: 'send', noticeKey: 'k' + i, noticeId: 'n' + i, eventIds: [1], factsEventId: 1, kind: 'created', scope: 'single', affectedDate: '', summary: '', expectedState: '', flags: { includeLocation: false, includePeople: false }, previewDigest: '', transport: null, recipients: [{ contactId: 1, name: 'A', email: `a${i}@example.test`, requestId: 'r' + i, attempt: 1, subject: 's', text: 't' }] }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    const { result } = await approve(offer, [p.dana], fakeTransport());
    expect(result).toEqual({ kind: 'daily-limit', left: 0 });
  });
});

describe('9. failed and unknown outcomes are shown as what they are', () => {
  const setup = async () => {
    const p = await people();
    const id = await addEvent(d, 'Recital', '2026-11-22', {}, 14 * 60);
    const o = await occ(id, '2026-11-22');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    return { p, id, offer };
  };
  it('a queued message stays queued (not "sent") until the sender reports; accepted only comes from a result', async () => {
    const { p, offer } = await setup();
    const t = fakeTransport('queue');
    await approve(offer, [p.dana], t);
    expect((await loadRequests(d))[0].state).toBe('queued');
    expect(await refreshStatuses(t, d)).toBe(0);
    expect((await loadRequests(d))[0].state).toBe('queued');
    t.settle(t.outbox[0].id, 'accepted');
    expect(await refreshStatuses(t, d)).toBe(1);
    expect((await loadRequests(d))[0].state).toBe('accepted');
  });
  it('a definite refusal is failed with a reason, and nothing retries by itself', async () => {
    const { p, offer } = await setup();
    const t = fakeTransport('reject');
    await approve(offer, [p.dana], t);
    const v = (await loadRequests(d))[0];
    expect(v).toMatchObject({ state: 'failed', reason: 'address-rejected' });
    expect(t.calls).toBe(1);
    await refreshStatuses(t, d); // a status check never resends
    expect(t.calls).toBe(1);
  });
  it('a lost reply is "unknown"; retrying is refused until the owner accepts a possible second copy', async () => {
    const { p, offer } = await setup();
    const t = fakeTransport('lost-reply');
    await approve(offer, [p.dana], t);
    const v = (await loadRequests(d))[0];
    expect(v).toMatchObject({ state: 'unknown', duplicateRisk: true });
    expect(await retryRequest({ requestId: v.requestId, transport: t }, d)).toBe('not-allowed');
    expect(t.outbox.length).toBe(1);
    // checking finds the request in the outbox: now known to be waiting
    await refreshStatuses(t, d);
    expect((await loadRequests(d))[0].state).toBe('queued');
  });
  it('an unknown outcome the outbox has never seen becomes a definite failure, which is then safe to retry', async () => {
    const { p, offer } = await setup();
    const t = fakeTransport('unreachable');
    await approve(offer, [p.dana], t);
    expect((await loadRequests(d))[0].state).toBe('unknown');
    await refreshStatuses(t, d);
    expect((await loadRequests(d))[0]).toMatchObject({ state: 'failed', reason: 'not-received' });
    t.mode = 'accept';
    const v = (await loadRequests(d))[0];
    expect(await retryRequest({ requestId: v.requestId, transport: t }, d)).toBe('started');
    const after = (await loadRequests(d))[0];
    expect(after).toMatchObject({ state: 'accepted', attempt: 2 });
    expect(t.outbox[0].id).toBe(`${v.requestId}.a2`);
  });
  it('a retry only happens on the owner\'s request, reuses the approved text exactly, and a second press does not double it', async () => {
    const { p, offer } = await setup();
    const t = fakeTransport('reject');
    await approve(offer, [p.dana], t);
    const v = (await loadRequests(d))[0];
    const first = { subject: v.subject, text: v.text };
    t.mode = 'accept';
    const [a, b] = await Promise.all([retryRequest({ requestId: v.requestId, transport: t }, d), retryRequest({ requestId: v.requestId, transport: t }, d)]);
    expect([a, b].sort()).toEqual(['changed', 'started']);
    expect(t.outbox.length).toBe(1);
    expect(t.outbox[0]).toMatchObject({ subject: first.subject, text: first.text });
  });
  it('an unknown outcome can be retried only after the owner accepts that it may send a second copy', async () => {
    const { p, offer } = await setup();
    const t = fakeTransport('lost-reply');
    await approve(offer, [p.dana], t);
    const v = (await loadRequests(d))[0];
    t.mode = 'accept';
    expect(await retryRequest({ requestId: v.requestId, transport: t, acceptDuplicateRisk: true }, d)).toBe('started');
    expect(t.outbox.length).toBe(2);
  });
  it('unreadable or unknown records are ignored, never counted as sent', async () => {
    await d.moduleRecords.add({ module: 'calendar', kind: 'notice', data: { v: 9, t: 'send', recipients: 'junk' }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    const r = readRows(await d.moduleRecords.toArray());
    expect(r.unreadable).toBe(1);
    expect(foldRequests(r.rows)).toEqual([]);
    expect(readNotice({ module: 'calendar', kind: 'notice', data: null } as never)).toBeNull();
  });
});

describe('9b. the words never claim more than is known', () => {
  const approvedThenSentLater = async (t: FakeTransport) => {
    const p = await people();
    const id = await addEvent(d, 'Recital', '2026-11-22', {}, 14 * 60);
    const o = await occ(id, '2026-11-22');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    await approve(offer, [p.dana], null); // approved while sending was not connected
    await sendApproved((await loadRequests(d))[0].requestId, t, d);
    return (await loadRequests(d))[0];
  };
  it('a message the TEST sender accepted is never described as really sent, even though it was approved with no sender', async () => {
    const v = await approvedThenSentLater(fakeTransport('accept'));
    expect(v.state).toBe('accepted');
    expect(statusLabel(v, true)).toBe('Accepted by test sender');
    expect(statusWords(v, true)).toContain('Nothing was really sent');
  });
  it('a live sender accepting a message is "accepted by the mail service" and says nothing about an inbox', () => {
    const live = { state: 'accepted' as const, transport: { id: 'github-outbox', label: 'x', live: true }, reason: undefined, duplicateRisk: false };
    expect(statusLabel(live, true)).toBe('Accepted by mail service');
    expect(statusWords(live, true)).toContain('cannot tell whether it reached an inbox');
  });
  it('approved with no sender connected says so plainly', () => {
    const v = { state: 'confirmed' as const, transport: null, reason: undefined, duplicateRisk: false };
    expect(statusLabel(v, false)).toBe('Approved, not sent');
    expect(statusWords(v, false)).toContain('nothing has been sent');
  });
  it('no screen text calls a message delivered, received or read, and only ever mentions an inbox to say Ledger cannot know', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['words.ts', 'records.ts', 'NoticeComposer.tsx', 'MessagesSection.tsx', 'NoticePrompt.tsx']) {
      const raw = readFileSync('src/modules/calendar/notify/' + f, 'utf8');
      const src = raw.split(/\r?\n/).filter((ln) => !ln.trim().startsWith('//') && !ln.trim().startsWith('*') && !ln.trim().startsWith('/*')).join(' ');
      expect(src, f).not.toMatch(/delivered|was read|has been read|was received/i);
      for (const m of src.matchAll(/inbox/gi)) expect(src.slice(Math.max(0, m.index! - 60), m.index!), f).toMatch(/cannot tell|never that/);
    }
  });
});

describe('10. a message cannot go out with stale content', () => {
  it('approved while sending was not connected, then the event changed: "Send now" sends nothing and says why', async () => {
    const p = await people();
    const id = await addEvent(d, 'Recital', '2026-11-22', {}, 14 * 60);
    const o = await occ(id, '2026-11-22');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    await approve(offer, [p.dana], null);
    const o2 = await occ(id, '2026-11-22');
    await saveEdit(o2, edit(o2, { startAt: msAt('2026-11-22', 15 * 60), endAt: msAt('2026-11-22', 16 * 60) }), extras(), 'all', d);
    const t = fakeTransport('accept');
    const v = (await loadRequests(d))[0];
    await sendApproved(v.requestId, t, d);
    expect(t.calls).toBe(0);
    expect((await loadRequests(d))[0]).toMatchObject({ state: 'failed', reason: 'stale' });
    // a stale message is never retried as it was
    expect(await retryRequest({ requestId: v.requestId, transport: t }, d)).toBe('not-allowed');
    expect(t.calls).toBe(0);
  });
  it('unchanged since approval: "Send now" sends it', async () => {
    const p = await people();
    const id = await addEvent(d, 'Recital', '2026-11-22', {}, 14 * 60);
    const o = await occ(id, '2026-11-22');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    await approve(offer, [p.dana], null);
    const t = fakeTransport('accept');
    await sendApproved((await loadRequests(d))[0].requestId, t, d);
    expect(t.outbox.length).toBe(1);
  });
  it('a change to a place the message does not mention does not make it stale; one it does mention does', async () => {
    const p = await people();
    const id = await addEvent(d, 'Recital', '2026-11-22', {}, 14 * 60, { location: 'Hall' });
    const o = await occ(id, '2026-11-22');
    const offer = (await offerAfterSave({ savedId: id, scope: 'all', edited: pickFields(o) }, d))!;
    await approve(offer, [p.dana], null);
    const o2 = await occ(id, '2026-11-22');
    await saveEdit(o2, edit(o2, { location: 'Gym', notes: 'bring a chair' }), extras(), 'all', d);
    const t = fakeTransport('accept');
    await sendApproved((await loadRequests(d))[0].requestId, t, d);
    expect(t.outbox.length).toBe(1);
  });
  it('a cancellation approved and then undone is stale and never goes out', async () => {
    const p = await people();
    const id = await addEvent(d, 'Recital', '2026-11-22', {}, 14 * 60);
    const o = await occ(id, '2026-11-22');
    const snap = (await snapshotEvent(id, d))!;
    await removeOccurrence(o, 'all', d);
    const offer = (await offerAfterDelete({ occ: o, scope: 'all', snap }, d))!;
    await approve(offer, [p.dana], null);
    await restoreEventData(id, snap, d);
    const t = fakeTransport('accept');
    await sendApproved((await loadRequests(d))[0].requestId, t, d);
    expect(t.calls).toBe(0);
    expect((await loadRequests(d))[0]).toMatchObject({ state: 'failed', reason: 'stale' });
  });
  it('for every scope, a freshly approved message is not stale on the unchanged event (no false alarms)', async () => {
    const p = await people();
    for (const scope of ['one', 'following', 'all'] as const) {
      d = fresh();
      const pp = { dana: await addContact(d, 'Dana Test', { email: 'dana@example.test' }) };
      void p;
      const id = await soccer({ contactIds: [pp.dana] });
      const o = await occ(id, '2026-11-18');
      const edited = edit(o, { startAt: msAt('2026-11-18', 17 * 60), endAt: msAt('2026-11-18', 18 * 60) });
      const savedId = await saveEdit(o, edited, extras({ recurrence: WEEKLY, contactIds: [pp.dana] }), scope, d);
      const offer = (await offerAfterSave({ occ: o, scope, savedId, edited }, d))!;
      const t = fakeTransport('accept');
      const { result } = await approve(offer, [pp.dana], t, { includeLocation: true });
      expect(result, scope).toMatchObject({ kind: 'recorded' });
      expect((await loadRequests(d))[0].state, scope).toBe('accepted');
    }
  });
});

describe('11. undoing a cancellation people were told about offers a correction, never sends it', () => {
  it('lists who was told, offers the correction, and sends nothing by itself', async () => {
    const p = await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-18');
    const snap = (await snapshotEvent(id, d))!;
    await removeOccurrence(o, 'one', d);
    const offer = (await offerAfterDelete({ occ: o, scope: 'one', snap }, d))!;
    const t = fakeTransport('accept');
    await approve(offer, [p.dana], t);
    expect(t.outbox.length).toBe(1);
    await restoreEventData(id, snap, d); // Undo
    const told = await toldAboutCancellation(id, 'one', '2026-11-18', d);
    expect(told.contactIds).toEqual([p.dana]);
    const fix = (await offerAfterRestore({ eventId: id, scope: 'one', affectedDate: '2026-11-18', told: told.contactIds }, d))!;
    expect(t.outbox.length).toBe(1); // nothing sent by Undo or by building the offer
    expect(buildMessage(fix.subject, OPTS, 'Dana').text).toContain('Correction: Soccer practice on Wednesday, November 18 is on again.');
    expect(fix.told).toEqual([p.dana]);
  });
  it('nobody told, nobody to correct', async () => {
    await people();
    const id = await soccer();
    expect((await toldAboutCancellation(id, 'one', '2026-11-18', d)).contactIds).toEqual([]);
  });
  it('"email about this event" offers the current details of one date or one event', async () => {
    await people();
    const id = await soccer();
    const o = await occ(id, '2026-11-18');
    const offer = (await offerForDetails({ occ: o }, d))!;
    const m = buildMessage(offer.subject, OPTS, 'Dana');
    expect(m.subject).toBe('Details: Soccer practice');
    expect(m.text).toContain('Here are the details for Soccer practice on Wednesday, November 18.');
    expect(m.text).toContain('Repeats: Every week on Wednesday');
  });
});

describe('12. notifications change nothing else', () => {
  it('approving, sending, retrying and checking leave every event, contact and Finance table exactly as they were', async () => {
    const p = await people();
    const id = await soccer({ contactIds: [p.dana] });
    const o = await occ(id, '2026-11-18');
    const offer = (await offerForDetails({ occ: o }, d))!;
    const snapshot = async () => JSON.stringify([
      (await d.moduleRecords.toArray()).filter((r) => r.kind !== 'notice'), await d.contacts.toArray(), await d.txns.toArray(), await d.accounts.toArray(), await d.settings.toArray(),
    ].map((x) => x));
    const before = await snapshot();
    const t = fakeTransport('reject');
    await approve(offer, [p.dana], t);
    t.mode = 'accept';
    await retryRequest({ requestId: (await loadRequests(d))[0].requestId, transport: t }, d);
    await refreshStatuses(t, d);
    await declineOffer(offer.subject, { today: TODAY }, d);
    expect(await snapshot()).toBe(before);
  });
  it('sender details are the only setting written, and only when they change', async () => {
    await saveNoticeSettings({ senderName: '  Alex   Sample ', replyTo: 'bad address' }, d);
    expect((await d.settings.get('calendarNotices'))!.value).toEqual({ senderName: 'Alex Sample', replyTo: '' });
  });
});

describe('13. the outbox request format and the real writer (no network is used)', () => {
  const req = () => ({ format: 'ledger-notice' as const, v: 1 as const, id: 'a'.repeat(64), requestId: 'a'.repeat(64), attempt: 1, noticeKind: 'created' as const, from: { name: 'Alex Sample', replyTo: null }, to: { name: 'Dana', address: 'dana@example.test' }, subject: 's', text: 't' });
  it('a request is canonical, so the same message is always the same file', () => {
    const a = encodeRequest(req());
    expect(a).toBe(encodeRequest({ ...req() }));
    expect(a.endsWith('\n')).toBe(true);
    expect(a.indexOf('"attempt"')).toBeLessThan(a.indexOf('"format"')); // keys are sorted
  });
  it('result files are read defensively', () => {
    expect(parseResult('{"v":1,"id":"x","state":"accepted"}')).toMatchObject({ state: 'accepted' });
    expect(parseResult('{"v":1,"id":"x","state":"failed","reason":"nonsense"}')).toMatchObject({ state: 'failed', reason: 'unknown' });
    expect(parseResult('not json')).toBeNull();
    expect(parseResult('{"v":2,"id":"x","state":"accepted"}')).toBeNull();
  });
  it('the GitHub writer puts the key only in the Authorization header, and a repeat is "duplicate"', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response('{}', { status }); }) as unknown as typeof fetch;
    const t = githubOutboxTransport({ owner: 'someone', repo: 'outbox-test', token: 'TOKEN-VALUE' }, f);
    expect(await t.submit(req())).toEqual({ kind: 'queued' });
    status = 422;
    expect(await t.submit(req())).toEqual({ kind: 'duplicate' });
    status = 401;
    expect(await t.submit(req())).toEqual({ kind: 'rejected', reason: 'unauthorized' });
    status = 503;
    expect(await t.submit(req())).toEqual({ kind: 'unknown' });
    for (const s of seen) {
      expect(s.url).not.toContain('TOKEN-VALUE');
      expect(String(s.init.body)).not.toContain('TOKEN-VALUE');
      expect((s.init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN-VALUE');
      expect(s.url).toBe(`https://api.github.com/repos/someone/outbox-test/contents/requests/${'a'.repeat(64)}.json`);
    }
    const dead = githubOutboxTransport({ owner: 'someone', repo: 'outbox-test', token: 't' }, (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch);
    expect(await dead.submit(req())).toEqual({ kind: 'unknown' });
    expect(() => githubOutboxTransport({ owner: '../x', repo: 'y', token: 't' })).toThrow();
  });
  it('the real app has no transport, so nothing can leave', async () => {
    const { getTransport } = await import('./transport');
    expect(getTransport()).toBeNull();
  });
});

describe('14. no after-save question until a sender is connected', () => {
  it('senderConnected follows the installed sender, and the editor gates every question on it', async () => {
    const { senderConnected } = await import('./offers');
    const { setTransport } = await import('./transport');
    expect(senderConnected()).toBe(false);
    setTransport(fakeTransport());
    expect(senderConnected()).toBe(true);
    setTransport(null);
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/modules/calendar/EventEditor.tsx', 'utf8');
    expect(src).toContain('senderConnected() ? await quietly(() => offerAfterSave');
    expect(src).toContain('snap && senderConnected()');
    expect(src).toContain('canEmail && senderConnected()');
    expect(src).toMatch(/if \(!senderConnected\(\)\) return null;/);
  });
});
