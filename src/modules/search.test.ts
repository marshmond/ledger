import { describe, expect, it } from 'vitest';
import type { ModuleRecord } from '../core/entities';
import type { SearchResult } from '../core/registry';
import { searchAll, type SearchData } from '../lib/search';
import { groupResults } from '../shell/searchGroups';
import { asEvent, type EventData } from './calendar/model';
import { occurrenceToOpen, searchEventsData } from './calendar/searchSource';
import { searchTasksData } from './tasks/searchSource';
import { asTask, type TaskData } from './tasks/model';
import { NO_FILTER, matches } from './tasks/views';

const TODAY = '2026-11-05';
const rec = (id: number, data: unknown) => ({ id, module: 'x', kind: 'x', createdAt: 1, updatedAt: 1, data }) as unknown as ModuleRecord;
const task = (id: number, d: Partial<TaskData>) => asTask(rec(id, { title: 't', ...d }));
const event = (id: number, d: Partial<EventData>) => asEvent(rec(id, { title: 'e', allDay: true, startDate: '2026-11-10', endDate: '2026-11-10', ...d }));

describe('searching tasks', () => {
  const tasks = [
    task(1, { title: 'Pay contractor', notes: 'Send the second invoice', dueDate: '2026-11-07' }),
    task(2, { title: 'Call dentist', checklist: [{ id: 1, text: 'ask about invoice', done: true }, { id: 2, text: 'book', done: false }] }),
    task(3, { title: 'Pay old invoice', status: 'done' }),
    task(4, { title: 'Water plants' }),
  ];
  it('finds by title, notes and checklist item', () => {
    const out = searchTasksData('invoice', tasks, [], []);
    expect(out.map((r) => r.id).sort()).toEqual(['task:1', 'task:2', 'task:3']);
    expect(out.find((r) => r.id === 'task:3')!.subtitle).toBe('Done');
    expect(out.find((r) => r.id === 'task:2')!.subtitle).toBe('No due date · 1/2 checked');
  });
  it('with an equally good match, open tasks come before done ones', () => {
    const pair = [task(1, { title: 'Pay rent', status: 'done' }), task(2, { title: 'Pay rent' })];
    expect(searchTasksData('pay rent', pair, [], []).map((r) => r.id)).toEqual(['task:2', 'task:1']);
  });
  it('every typed word must match, and a task opens at its own record', () => {
    expect(searchTasksData('pay invoice', tasks, [], []).map((r) => r.id)).toEqual(['task:1', 'task:3']); // task 1 has "invoice" in its notes
    expect(searchTasksData('contractor', tasks, [], [])[0]).toMatchObject({ kind: 'Task', path: '/tasks?task=1', subtitle: 'Due 2026-11-07' });
  });
  it('finds the Tasks page by name', () => {
    expect(searchTasksData('tasks', tasks, [], [])[0]).toMatchObject({ kind: 'Page', path: '/tasks' });
  });
  it('finds tags and contacts and opens Tasks filtered to them, counting open tasks', () => {
    const t = [task(1, { title: 'a', tagIds: [5], contactIds: [9] }), task(2, { title: 'b', tagIds: [5], status: 'done' })];
    const out = searchTasksData('reno', t, [{ id: 5, name: 'renovation' }], []);
    expect(out[0]).toMatchObject({ kind: 'Tag', title: '#renovation', subtitle: '1 open task', path: '/tasks?v=all&tag=5' });
    const c = searchTasksData('maria', t, [], [{ id: 9, name: 'Maria Test' }]);
    expect(c[0]).toMatchObject({ kind: 'Tasks for contact', title: 'Maria Test', path: '/tasks?v=all&contact=9' });
  });
  it('caps each kind of hit and ignores an empty query', () => {
    const many = Array.from({ length: 30 }, (_, i) => task(i + 1, { title: `Buy milk ${i}` }));
    expect(searchTasksData('milk', many, [], []).length).toBe(8);
    expect(searchTasksData('   ', many, [], [])).toEqual([]);
  });
  it('the contact filter keeps only that contact’s tasks', () => {
    const t = [task(1, { contactIds: [9] }), task(2, { contactIds: [3] }), task(3, {})];
    expect(t.filter((x) => matches(x, { ...NO_FILTER, contactId: 9 })).map((x) => x.id)).toEqual([1]);
    expect(t.filter((x) => matches(x, NO_FILTER))).toHaveLength(3);
    expect(t.filter((x) => matches(x, { ...NO_FILTER, contactId: '' }))).toHaveLength(3);
  });
});

describe('searching events', () => {
  const events = [
    event(1, { title: 'Dentist', location: 'Elm Street clinic', notes: 'bring forms' }),
    event(2, { title: 'Team lunch', startDate: '2026-11-20', endDate: '2026-11-20' }),
    event(3, { title: 'Old retired', retired: { module: 'ledger', recordId: 'scheduled:1', note: 'moved' } }),
  ];
  it('finds by title, location and notes, and skips retired events', () => {
    expect(searchEventsData('elm', events, TODAY).map((r) => r.id)).toEqual(['event:1']);
    expect(searchEventsData('forms', events, TODAY).map((r) => r.id)).toEqual(['event:1']);
    expect(searchEventsData('retired', events, TODAY)).toEqual([]);
  });
  it('opens the event itself: its date in the Agenda and the id and day that name the occurrence', () => {
    const r = searchEventsData('dentist', events, TODAY)[0];
    expect(r).toMatchObject({ kind: 'Event', subtitle: expect.stringContaining('Elm Street clinic') });
    expect(r.path).toBe(`/calendar?v=agenda&d=2026-11-10&open=${encodeURIComponent('e:1:2026-11-10')}`);
  });
  it('a repeating event opens its next occurrence, not the first one long ago', () => {
    const weekly = event(7, { title: 'Standup', startDate: '2026-01-05', endDate: '2026-01-05', recurrence: { freq: 'weekly', interval: 1, byWeekday: [1], end: { type: 'never' } } as never });
    const occ = occurrenceToOpen(weekly, TODAY);
    expect(occ && occ.firstDay >= TODAY).toBe(true);
  });
  it('finds the Calendar page by name', () => {
    expect(searchEventsData('calendar', events, TODAY)[0]).toMatchObject({ kind: 'Page', path: '/calendar' });
  });
});

describe('searching scheduled items', () => {
  const data: SearchData = {
    accounts: [{ id: 1, name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' }],
    invAccounts: [], securities: [], holdings: [], loans: [], scenarios: [], txns: [],
    rules: [
      { id: 7, accountId: 1, payee: 'City Power Co', amountCents: -8500, categoryId: null, memo: 'electric', frequency: 'monthly', startDate: '2026-01-01', active: true },
      { id: 8, accountId: 1, payee: 'Gym', amountCents: -3000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-01-01', active: false },
    ],
  };
  it('finds a scheduled item by payee or memo and opens its edit form', () => {
    const h = searchAll('power', data);
    expect(h[0]).toMatchObject({ kind: 'scheduled', title: 'City Power Co', to: '/scheduled?rule=7' });
    expect(searchAll('electric', data)[0].title).toBe('City Power Co');
  });
  it('says when one is paused', () => {
    expect(searchAll('gym', data).find((x) => x.kind === 'scheduled')!.subtitle).toContain('(paused)');
  });
  it('older callers that pass no scheduled items still work', () => {
    const { rules: _unused, ...old } = data;
    void _unused;
    expect(searchAll('power', old)).toEqual([]);
  });
});

describe('grouping results by module', () => {
  const r = (id: string, score: number): SearchResult => ({ id, title: id, kind: 'k', score });
  it('puts the module with the best hit first, best first inside a group, and drops empty groups', () => {
    const g = groupResults([
      { moduleId: 'ledger', name: 'Ledger', results: [r('a', 10), r('b', 40)] },
      { moduleId: 'calendar', name: 'Calendar', results: [] },
      { moduleId: 'tasks', name: 'Tasks', results: [r('c', 50)] },
    ]);
    expect(g.map((x) => x.moduleId)).toEqual(['tasks', 'ledger']);
    expect(g[1].results.map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('ties keep the order the modules were asked in', () => {
    const g = groupResults([
      { moduleId: 'today', name: 'Today', results: [r('x', 20)] },
      { moduleId: 'ledger', name: 'Ledger', results: [r('y', 20)] },
    ]);
    expect(g.map((x) => x.moduleId)).toEqual(['today', 'ledger']);
  });
});
