import { describe, expect, it } from 'vitest';
import {
  ALL_DATES_SUBJECT, ALL_SUBJECT, compareHistory, effectiveForDate, effectiveForEvent, effectiveForSimple, effectiveForTask, GRANT_KIND, DISPLAY_MODULE,
  memberDatesSubject, parseSubject, resolveGrants, subjectOf, type GrantRow,
} from './grants';

/** CS-1: the pure eligibility rules. Invented ids only. */
let next = 1000;
const g = (subject: string, decision: 'show' | 'hide', over: Record<string, unknown> = {}, id = next++): GrantRow => ({
  id, module: DISPLAY_MODULE, kind: GRANT_KIND, createdAt: 1, updatedAt: 1, deletedAt: null,
  data: { v: 1, subject, decision, supersedes: [], deviceId: 'dev', ...over },
});
const ev = (id: number) => subjectOf('event', id);

describe('private by default', () => {
  it('no records at all: nothing is shown, nothing is killed', () => {
    const idx = resolveGrants([]);
    expect(idx.killed).toBe(false);
    expect(effectiveForEvent(idx, 5, 9).show).toBe('hidden');
    expect(effectiveForTask(idx, 5).show).toBe('hidden');
    expect(effectiveForDate(idx, 1, 2).show).toBe('hidden');
    expect(effectiveForSimple(idx, 'visit', 3).show).toBe('hidden');
    expect(idx.recordIds).toEqual([]);
  });
  it('unrelated records of other modules are ignored', () => {
    const idx = resolveGrants([{ id: 1, module: 'tasks', kind: 'grant', data: { subject: ev(5), decision: 'show' } }, { id: 2, module: 'display', kind: 'other', data: { subject: ev(5), decision: 'show' } }]);
    expect(effectiveForEvent(idx, 5, 9).show).toBe('hidden');
    expect(idx.recordIds).toEqual([]);
  });
});

describe('explicit show, hide and Busy', () => {
  it('show', () => { expect(effectiveForEvent(resolveGrants([g(ev(5), 'show')]), 5, 9)).toMatchObject({ show: 'details', via: 'event' }); });
  it('Busy', () => { expect(effectiveForEvent(resolveGrants([g(ev(5), 'show', { level: 'busy' })]), 5, 9)).toMatchObject({ show: 'busy', via: 'event' }); });
  it('a new decision supersedes the old one; the old one is not edited or removed', () => {
    const a = g(ev(5), 'show', {}, 10);
    const b = g(ev(5), 'hide', { supersedes: [10] }, 11);
    const rows = [a, b];
    const idx = resolveGrants(rows);
    expect(effectiveForEvent(idx, 5, 9).show).toBe('hidden');
    expect(effectiveForEvent(idx, 5, 9).reason).toBe('revoked');
    expect(idx.get(ev(5)).count).toBe(2);
    const c = g(ev(5), 'show', { supersedes: [10, 11] }, 12);
    expect(effectiveForEvent(resolveGrants([a, b, c]), 5, 9).show).toBe('details');
  });
  it('the result does not depend on the order of the rows', () => {
    const a = g(ev(5), 'show', {}, 10);
    const b = g(ev(5), 'hide', { supersedes: [10] }, 11);
    expect(resolveGrants([b, a]).get(ev(5))).toEqual(resolveGrants([a, b]).get(ev(5)));
  });
});

describe('supersedes decides, never a timestamp (a wrong device clock cannot fake "newer")', () => {
  it('an old show with a LATER timestamp does not beat a hide that superseded it', () => {
    const show = { ...g(ev(5), 'show', {}, 10), createdAt: 9_999_999_999_999, updatedAt: 9_999_999_999_999 };
    const hide = { ...g(ev(5), 'hide', { supersedes: [10] }, 11), createdAt: 1, updatedAt: 1 };
    expect(effectiveForEvent(resolveGrants([show, hide]), 5, 9).show).toBe('hidden');
  });
  it('a hide with an OLD timestamp still beats a show that does not supersede it (concurrent: hide wins)', () => {
    const hide = { ...g(ev(5), 'hide', {}, 10), createdAt: 1, updatedAt: 1 };
    const show = { ...g(ev(5), 'show', {}, 11), createdAt: 9_999_999_999_999, updatedAt: 9_999_999_999_999 };
    const s = resolveGrants([hide, show]).get(ev(5));
    expect(s.state).toBe('hide');
    expect(s.conflict).toBe(true);
    expect(s.reason).toBe('conflict');
  });
});

describe('concurrent decisions', () => {
  it('hide and show that both supersede the same record: hidden, and flagged for the owner to choose again', () => {
    const base = g(ev(5), 'show', {}, 10);
    const hide = g(ev(5), 'hide', { supersedes: [10] }, 11);
    const show = g(ev(5), 'show', { supersedes: [10] }, 12);
    const s = resolveGrants([base, hide, show]).get(ev(5));
    expect(s).toMatchObject({ state: 'hide', conflict: true });
    expect(s.headIds).toEqual([11, 12]);
    // the owner's new decision supersedes both heads and settles it
    const settle = g(ev(5), 'show', { supersedes: [10, 11, 12] }, 13);
    expect(resolveGrants([base, hide, show, settle]).get(ev(5))).toMatchObject({ state: 'show', conflict: false, headIds: [13] });
  });
  it('two shows at different levels: the narrowest (Busy) wins', () => {
    const s = resolveGrants([g(ev(5), 'show', { level: 'details' }, 10), g(ev(5), 'show', { level: 'busy' }, 11)]).get(ev(5));
    expect(s).toMatchObject({ state: 'show', level: 'busy', conflict: true });
  });
  it('two shows naming different people: only the people both agree on', () => {
    const s = resolveGrants([g(subjectOf('visit', 3), 'show', { label: 'Cleaner', people: [1, 2] }, 10), g(subjectOf('visit', 3), 'show', { label: 'Cleaner', people: [2, 3] }, 11)]).get(subjectOf('visit', 3));
    expect(s.people).toEqual([2]);
  });
});

describe('unknown or malformed decisions fail closed', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['an unknown version', { v: 2 }],
    ['no version', { v: undefined }],
    ['an unknown decision word', { decision: 'maybe' }],
    ['an unknown level', { level: 'secret' }],
    ['a supersedes list that is not a list of numbers', { supersedes: 'x' }],
    ['a label that is not text', { label: 5 }],
    ['people that are not numbers', { people: ['a'] }],
  ];
  for (const [name, over] of cases) {
    it(name, () => {
      const idx = resolveGrants([g(ev(5), 'show', over, 10)]);
      expect(effectiveForEvent(idx, 5, 9).show).toBe('hidden');
      expect(idx.get(ev(5)).reason).toBe('unreadable');
      expect(idx.conflicts.map((c) => c.subject)).toContain(ev(5));
    });
  }
  it('an unreadable record that is the latest head hides the subject even if an older record said show', () => {
    const idx = resolveGrants([g(ev(5), 'show', {}, 10), g(ev(5), 'show', { v: 99, supersedes: [10] }, 11)]);
    expect(effectiveForEvent(idx, 5, 9).show).toBe('hidden');
  });
  it('a record with no readable data is counted in the history, decides nothing and shows nothing', () => {
    const idx = resolveGrants([{ id: 7, module: DISPLAY_MODULE, kind: GRANT_KIND, data: 'oops' }, { id: 8, module: DISPLAY_MODULE, kind: GRANT_KIND, data: { subject: 'event:abc', decision: 'show' } }]);
    expect(idx.recordIds).toEqual([7, 8]);
    expect(idx.unattributable).toEqual([7, 8]);
    expect(idx.subjects).toEqual([]);
  });
  it('a record a sync marked deleted is treated as unreadable (hidden), never as "no decision", and still counts in the history', () => {
    const rows = [{ ...g(ev(5), 'show', {}, 10), deletedAt: 5 }];
    const idx = resolveGrants(rows);
    expect(idx.get(ev(5))).toMatchObject({ state: 'hide', reason: 'deleted' });
    expect(idx.recordIds).toEqual([10]);
  });
  it('a loop of decisions that supersede each other hides the subject', () => {
    const idx = resolveGrants([g(ev(5), 'show', { supersedes: [11] }, 10), g(ev(5), 'show', { supersedes: [10] }, 11)]);
    expect(idx.get(ev(5))).toMatchObject({ state: 'hide', reason: 'cycle' });
  });
  it('a decision cannot supersede another subject\'s record', () => {
    const idx = resolveGrants([g(ev(5), 'hide', {}, 10), g(ev(6), 'show', { supersedes: [10] }, 11)]);
    expect(effectiveForEvent(idx, 5, 9).show).toBe('hidden');
    expect(effectiveForEvent(idx, 6, 9).show).toBe('details');
  });
  it('an unknown subject word is ignored', () => {
    expect(parseSubject('everything')).toBeNull();
    expect(parseSubject('event:1.5')).toBeNull();
    expect(parseSubject('event:-1')).toBeNull();
    expect(parseSubject('event:99999999999999999999')).toBeNull();
    expect(parseSubject(ALL_SUBJECT)).toEqual({ kind: 'all', id: null });
    expect(parseSubject(ALL_DATES_SUBJECT)).toEqual({ kind: 'dates', id: null });
  });
});

describe('precedence: an event\'s own decision beats its calendar', () => {
  const cal = (id: number, level?: 'busy') => g(subjectOf('calendar', id), 'show', level ? { level } : {});
  it('a shared calendar shows its events, with no per-event decision', () => {
    expect(effectiveForEvent(resolveGrants([cal(9)]), 5, 9)).toMatchObject({ show: 'details', via: 'calendar' });
    expect(effectiveForEvent(resolveGrants([cal(9, 'busy')]), 5, 9)).toMatchObject({ show: 'busy', via: 'calendar' });
  });
  it('a per-event hide overrides a shared calendar', () => {
    expect(effectiveForEvent(resolveGrants([cal(9), g(ev(5), 'hide')]), 5, 9)).toMatchObject({ show: 'hidden', via: 'event' });
  });
  it('a per-event show works on a calendar that is not shared, and event-level Busy overrides a calendar that shows details', () => {
    expect(effectiveForEvent(resolveGrants([g(ev(5), 'show')]), 5, 9).show).toBe('details');
    expect(effectiveForEvent(resolveGrants([cal(9), g(ev(5), 'show', { level: 'busy' })]), 5, 9).show).toBe('busy');
  });
  it('an event on a calendar that cannot be shared (derived) never inherits, even if a grant for that calendar exists', () => {
    expect(effectiveForEvent(resolveGrants([cal(9)]), 5, 9, false).show).toBe('hidden');
  });
  it('a conflicting event-level decision hides it even though its calendar is shared (the own decision wins, and it is hidden)', () => {
    const idx = resolveGrants([cal(9), g(ev(5), 'show', {}, 10), g(ev(5), 'hide', {}, 11)]);
    expect(effectiveForEvent(idx, 5, 9)).toMatchObject({ show: 'hidden', conflict: true });
  });
  it('a newly created event (no decision) on a shared calendar is eligible; switching the calendar off hides it again, but an event with its own show stays', () => {
    const on = g(subjectOf('calendar', 9), 'show', {}, 20);
    const off = g(subjectOf('calendar', 9), 'hide', { supersedes: [20] }, 21);
    const idx = resolveGrants([on, off, g(ev(6), 'show', {}, 22)]);
    expect(effectiveForEvent(idx, 5, 9).show).toBe('hidden');
    expect(effectiveForEvent(idx, 6, 9).show).toBe('details');
  });
});

describe('the global switch', () => {
  it('overrides every ordinary decision, then can be turned off by a later decision (nothing is deleted)', () => {
    const all = [g(ev(5), 'show', {}, 10), g(subjectOf('task', 1), 'show', {}, 11), g(subjectOf('visit', 3), 'show', { label: 'Cleaner' }, 12), g(ALL_DATES_SUBJECT, 'show', {}, 13)];
    const kill = g(ALL_SUBJECT, 'hide', {}, 14);
    const idx = resolveGrants([...all, kill]);
    expect(idx.killed).toBe(true);
    expect(effectiveForEvent(idx, 5, 9)).toMatchObject({ show: 'hidden', via: 'kill' });
    expect(effectiveForTask(idx, 1).show).toBe('hidden');
    expect(effectiveForSimple(idx, 'visit', 3).show).toBe('hidden');
    expect(effectiveForDate(idx, null, 1).show).toBe('hidden');
    const resume = g(ALL_SUBJECT, 'show', { supersedes: [14] }, 15);
    const back = resolveGrants([...all, kill, resume]);
    expect(back.killed).toBe(false);
    expect(effectiveForEvent(back, 5, 9).show).toBe('details');
  });
  it('an unreadable global record is treated as ON (fail closed)', () => {
    expect(resolveGrants([g(ALL_SUBJECT, 'show', { v: 7 })]).killed).toBe(true);
  });
  it('a kill and a resume from two devices at once: hidden', () => {
    const idx = resolveGrants([g(ALL_SUBJECT, 'hide', {}, 10), g(ALL_SUBJECT, 'show', {}, 11)]);
    expect(idx.killed).toBe(true);
  });
});

describe('visits and reminders need the owner\'s own label', () => {
  it('shown only with a label; an empty or over-long one is hidden', () => {
    expect(effectiveForSimple(resolveGrants([g(subjectOf('visit', 3), 'show', { label: '  Cleaner  ' })]), 'visit', 3)).toMatchObject({ show: 'details', label: 'Cleaner' });
    expect(effectiveForSimple(resolveGrants([g(subjectOf('visit', 3), 'show', {})]), 'visit', 3)).toMatchObject({ show: 'hidden', reason: 'label-missing' });
    expect(effectiveForSimple(resolveGrants([g(subjectOf('reminder', 3), 'show', { label: 'x'.repeat(81) })]), 'reminder', 3).show).toBe('hidden');
  });
});

describe('family dates: item, member, household', () => {
  it('the most specific decision wins', () => {
    const idx = resolveGrants([g(ALL_DATES_SUBJECT, 'show', {}, 10), g(memberDatesSubject(2), 'hide', {}, 11), g(subjectOf('date', 7), 'show', {}, 12)]);
    expect(effectiveForDate(idx, null, 2).show).toBe('hidden'); // member 2's birthday: hidden by the member decision
    expect(effectiveForDate(idx, null, 3).show).toBe('details'); // another member: household-wide
    expect(effectiveForDate(idx, 7, 2).show).toBe('details'); // the date's own show beats the member's hide
    expect(effectiveForDate(idx, 8, 2).show).toBe('hidden'); // another date of the same member
  });
});

describe('the privacy-decision history', () => {
  it('lists every record, readable or not, in order', () => {
    const idx = resolveGrants([g(ev(5), 'show', { v: 9 }, 30), g(ev(6), 'show', {}, 10), { id: 20, module: DISPLAY_MODULE, kind: GRANT_KIND, data: null }]);
    expect(idx.recordIds).toEqual([10, 20, 30]);
  });
  it('compareHistory finds what a restore removed and what is new', () => {
    expect(compareHistory(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({ missing: ['a'], added: ['d'], same: false });
    expect(compareHistory(['a'], ['a'])).toEqual({ missing: [], added: [], same: true });
  });
});
