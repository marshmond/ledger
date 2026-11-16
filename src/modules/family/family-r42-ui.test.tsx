import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LENS_KEY, readLens, setLens, resetLensForTests, type Lens } from '../../core/peopleLens';
import { lensMatches, type HouseholdPerson } from '../../core/householdPeople';
import { ToastProvider } from '../../ui/Toast';
import { PeopleChips, PeopleFilterBar } from '../../ui/PeopleLens';
import { AgendaRow } from '../calendar/AgendaView';
import { Chip } from '../calendar/parts';
import { itemAccessibleName } from '../calendar/calendarModel';
import { VISIBILITY_KEY } from '../calendar/layerVisibility';
import { lensItems, withPeople, type CalItem } from '../calendar/useCalendarData';
import TaskRow from '../tasks/TaskRow';
import { blankTask } from '../tasks/model';
import { matches, NO_FILTER } from '../tasks/views';
import { TodayRow } from '../today/TodayRow';
import { whenOnDay } from './WeekPage';

/**
 * R4.2 screens: the shared person chips and filter, and how Calendar, Tasks and Today rows use them. Static markup (the same method as the Family tests);
 * the layouts were checked in a real browser. Invented names only.
 */
const sam: HouseholdPerson = { memberId: 1, contactId: 11, name: 'Sam Example', colorId: 'blue' };
const robin: HouseholdPerson = { memberId: 2, contactId: 12, name: 'Robin Example', colorId: null };
const alex: HouseholdPerson = { memberId: 3, contactId: 13, name: 'Alex Example', colorId: 'green' };
const jo: HouseholdPerson = { memberId: 4, contactId: 14, name: 'Jo Example', colorId: 'pink' };
const byContact = new Map([sam, robin, alex, jo].map((p) => [p.contactId, p]));

const calItem = (over: Partial<CalItem> = {}): CalItem => ({
  key: `k${Math.random()}`, title: 'Swim meet', layerId: 1, layerName: 'Personal', color: '#4a7bd0', derived: false, allDay: false, firstDay: '2026-11-11', lastDay: '2026-11-11',
  startMs: Date.parse('2026-11-11T10:00:00'), endMs: Date.parse('2026-11-11T11:00:00'), priority: 'medium', location: '', done: false, overdue: false, soon: false, recurring: false, ...over,
});
const derived = (module: string, over: Partial<CalItem> = {}): CalItem => calItem({ derived: true, allDay: true, source: { sourceModule: module, sourceLabel: 'Open', openSource: () => undefined, actions: undefined } as unknown as CalItem['source'], ...over });
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), has: (k: string) => m.has(k) }; };
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ToastProvider, null, el)));
/** What the wrapper alone draws (the toast area), so "draws nothing" can be checked exactly. */
const EMPTY = html(null);

let session: ReturnType<typeof mem>;
let local: ReturnType<typeof mem>;
beforeEach(() => { session = mem(); local = mem(); vi.stubGlobal('sessionStorage', session); vi.stubGlobal('localStorage', local); resetLensForTests(); });

describe('who a row is for: names in text, color as decoration', () => {
  it('every person is listed by name (none is picked as "the" person); the dot is hidden from assistive technology', () => {
    const out = html(createElement(PeopleChips, { people: [robin, sam] }));
    expect(out).toContain('Robin Example');
    expect(out).toContain('Sam Example');
    expect(out).toMatch(/ui-mdot ui-mdot--none/); // no color: neutral gray, never a stored color
    expect(out).toContain('data-mc="blue"');
    expect(out.match(/class="ui-mdot[^"]*"[^>]*aria-hidden="true"/g)).toHaveLength(2);
  });

  it('too many people become "+N" and the hidden names are still in the tooltip and the spoken text', () => {
    const out = html(createElement(PeopleChips, { people: [alex, jo, robin, sam], max: 2 }));
    expect(out).toContain('Alex Example');
    expect(out).toContain('Jo Example');
    expect(out).toContain('+2');
    expect(out).toContain('Also: Robin Example and Sam Example');
    expect(out).toContain('more: Robin Example and Sam Example');
  });

  it('the compact dots variant (a crowded Calendar cell) always carries the names as text and a tooltip', () => {
    const out = html(createElement(PeopleChips, { people: [sam, alex, jo], variant: 'dots', max: 2 }));
    expect(out).toContain('title="For Sam Example, Alex Example and Jo Example"'.replace('Sam Example, Alex Example', 'Sam Example, Alex Example'));
    expect(out).toContain('For Sam Example, Alex Example and Jo Example</span>');
    expect(out).toContain('+1');
  });

  it('nobody named: nothing is drawn', () => {
    expect(html(createElement(PeopleChips, { people: [] }))).toBe(EMPTY);
  });
});

const lens = (over: Partial<Lens> = {}): Lens => ({ people: [sam, robin], byContact, selected: [], active: false, chosen: [], matches: () => true, toggle: () => undefined, clear: () => undefined, set: () => undefined, ...over });

describe('the person filter', () => {
  it('is hidden for a household of one (nothing to choose between) and before the people have loaded', () => {
    expect(html(createElement(PeopleFilterBar, { lens: lens({ people: [sam] }) }))).toBe(EMPTY);
    expect(html(createElement(PeopleFilterBar, { lens: lens({ people: undefined }) }))).toBe(EMPTY);
  });

  it('offers Everyone and each person as toggle buttons, Everyone pressed by default; names are text', () => {
    const out = html(createElement(PeopleFilterBar, { lens: lens() }));
    expect(out).toMatch(/aria-pressed="true"[^>]*>Everyone/);
    expect(out).toMatch(/aria-pressed="false"[^>]*><span[^>]*><\/span>Sam Example/);
    expect(out).toContain('Robin Example');
    expect(out).not.toContain('Showing');
  });

  it('says plainly what is chosen, what the filter covers on this screen, and how to go back', () => {
    const out = html(createElement(PeopleFilterBar, { lens: lens({ selected: [11, 12], active: true, chosen: [sam, robin] }), note: 'Money is not filtered.' }));
    expect(out).toContain('Showing Sam Example and Robin Example.');
    expect(out).toContain('Money is not filtered.');
    expect(out).toContain('Show everyone');
    expect(out).toContain('role="status"');
  });

  it('the choice lives in this tab\'s session only: not the database, not the Calendar\'s saved layer switches; default is Everyone; damage means Everyone', () => {
    expect(readLens()).toEqual([]);
    setLens([11, 12, 11]);
    expect(readLens()).toEqual([11, 12]);
    expect(session.has(LENS_KEY)).toBe(true);
    expect(local.has(LENS_KEY)).toBe(false);
    expect(local.has(VISIBILITY_KEY)).toBe(false); // the Calendar's overlay preference is untouched
    setLens([]);
    expect(session.has(LENS_KEY)).toBe(false);
    session.setItem(LENS_KEY, '{not json');
    expect(readLens()).toEqual([]);
    session.setItem(LENS_KEY, '["a", 2]');
    expect(readLens()).toEqual([]);
  });

  it('keeps working when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    expect(readLens()).toEqual([]);
    expect(() => setLens([11])).not.toThrow();
    setLens([]);
  });
});

describe('Calendar rows and the person filter', () => {
  it('a shared event is one row naming both people; chips and accessible names carry the names', () => {
    const [it1] = withPeople([calItem({ contactIds: [11, 12] })], byContact);
    expect(it1.people!.map((p) => p.name)).toEqual(['Robin Example', 'Sam Example']);
    expect(itemAccessibleName(it1)).toMatch(/for Robin Example and Sam Example$/);
    const row = html(createElement(AgendaRow, { item: it1, onOpen: () => undefined }));
    expect(row).toContain('Robin Example');
    expect(row).toContain('Sam Example');
    const chip = html(createElement(Chip, { item: it1, onOpen: () => undefined }));
    expect(chip).toContain('aria-hidden="true"'); // the dots; the button's own label already names the people
    expect(chip).toContain('aria-label="Swim meet');
    expect(chip).toContain('for Robin Example and Sam Example');
  });

  it('the event keeps its Calendar color and category: the person color is an extra, never a repaint', () => {
    const [it1] = withPeople([calItem({ contactIds: [11], color: '#c0562f' })], byContact);
    const chip = html(createElement(Chip, { item: it1, onOpen: () => undefined }));
    expect(chip).toContain('--chip:#c0562f');
    expect(chip).toContain('Personal'); // the layer name stays in the tooltip
  });

  it('an event naming nobody, or only a non-member, has no people and no chip', () => {
    const items = withPeople([calItem({ contactIds: [] }), calItem({ contactIds: [999] }), calItem({})], byContact);
    expect(items.every((i) => i.people === undefined)).toBe(true);
    expect(html(createElement(AgendaRow, { item: items[0], onOpen: () => undefined }))).not.toContain('ui-mchip');
  });

  it('a household that has not loaded yet changes nothing', () => {
    const a = [calItem({ contactIds: [11] })];
    expect(withPeople(a, new Map())).toBe(a);
  });

  it('Everyone keeps everything; choosing people keeps only events, Tasks and family dates that name them, once each', () => {
    const shared = calItem({ title: 'Shared', contactIds: [11, 12] });
    const mine = calItem({ title: 'Sam only', contactIds: [11] });
    const other = calItem({ title: 'Alex only', contactIds: [13] });
    const unassigned = calItem({ title: 'Nobody' });
    const task = derived('tasks', { title: 'Sam task', contactIds: [11] });
    const taskNobody = derived('tasks', { title: 'Task nobody' });
    const family = derived('family', { title: "Sam's birthday", contactIds: [11] });
    const finance = derived('ledger', { title: 'Due: Mortgage' });
    const bills = derived('bills', { title: 'Due: Power', contactIds: [11] }); // a source that never names people is not filtered by a name it should not carry
    const all = [shared, mine, other, unassigned, task, taskNobody, family, finance, bills];
    expect(lensItems(all, [], false)).toBe(all);
    expect(lensItems(all, [11, 12], false).map((i) => i.title)).toEqual(['Shared', 'Sam only', 'Sam task', "Sam's birthday"]);
    expect(lensItems(all, [11], true).map((i) => i.title)).toEqual(['Shared', 'Sam only', 'Sam task', "Sam's birthday", 'Due: Mortgage', 'Due: Power']); // Today: money items stay
    expect(lensItems(all, [13], false).map((i) => i.title)).toEqual(['Alex only']);
    expect(lensItems(all, [999], false)).toEqual([]);
    for (const i of all) expect(lensMatches(i.contactIds, [])).toBe(true);
  });
});

describe('Tasks rows and the person filter', () => {
  const task = (id: number, contactIds: number[]) => ({ id, createdAt: 1, updatedAt: 1, data: blankTask({ title: `Task ${id}`, contactIds, dueDate: '2026-11-12' }) });
  const row = (people: HouseholdPerson[]) => html(createElement('ul', null, createElement(TaskRow, { task: task(1, people.map((p) => p.contactId)), people, lists: [], tags: [], today: '2026-11-10', selecting: false, selected: false, onSelect: () => undefined, onOpen: () => undefined, onToggle: () => undefined })));

  it('shows everyone a Task names; none when it names nobody', () => {
    expect(row([sam, robin])).toContain('Sam Example');
    expect(row([sam, robin])).toContain('Robin Example');
    expect(row([])).not.toContain('ui-mchip');
  });

  it('the filter is the Task\'s own People and nothing else: its title, notes and creator never decide', () => {
    const t = { ...task(1, []), data: { ...task(1, []).data, title: 'Sam Example dentist', notes: 'for Sam Example' } };
    const named = task(2, [11]);
    expect([t, named].filter((x) => lensMatches(x.data.contactIds, [11])).map((x) => x.id)).toEqual([2]);
    expect(matches(named as never, NO_FILTER)).toBe(true); // the existing filters are unchanged
  });
});

describe('Today rows', () => {
  it('a person-associated item shows the same chips; a money row (no people) does not', () => {
    const [shared] = withPeople([calItem({ contactIds: [11, 13] })], byContact);
    const out = html(createElement('ul', null, createElement(TodayRow, { item: shared, hideAmounts: false })));
    expect(out).toContain('Alex Example');
    expect(out).toContain('Sam Example');
    const money = html(createElement('ul', null, createElement(TodayRow, { item: derived('ledger', { title: 'Due: Mortgage' }), hideAmounts: false })));
    expect(money).not.toContain('ui-mchip');
  });
});

describe('the Family week\'s time column', () => {
  const base = { kind: 'event' as const, allDay: false, startTime: '16:30', endTime: '17:30', firstDay: '2026-11-11', lastDay: '2026-11-11' };
  it('a time range, a single time, all day, and a Task with no time', () => {
    expect(whenOnDay(base, '2026-11-11')).toMatch(/4:30.*5:30/);
    expect(whenOnDay({ ...base, endTime: null }, '2026-11-11')).toMatch(/4:30/);
    expect(whenOnDay({ ...base, allDay: true, startTime: null, endTime: null }, '2026-11-11')).toBe('All day');
    expect(whenOnDay({ ...base, kind: 'task', allDay: true, startTime: null, endTime: null }, '2026-11-11')).toBe('No time set');
  });
  it('a multi-day item says it starts, continues and ends', () => {
    const trip = { ...base, allDay: true, startTime: null, endTime: null, lastDay: '2026-11-13' };
    expect(whenOnDay(trip, '2026-11-11')).toMatch(/^Starts, to /);
    expect(whenOnDay(trip, '2026-11-12')).toBe('Continues');
    expect(whenOnDay(trip, '2026-11-13')).toBe('Ends');
  });
});
