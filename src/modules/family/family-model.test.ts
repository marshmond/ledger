import { describe, expect, it } from 'vitest';
import type { ModuleRecord } from '../../core/entities';
import { nameKey } from '../../core/contacts';
import { summarizeBackup } from '../../lib/backupSummary';
import { SWATCHES } from '../calendar/model';
import { asMember, cleanFields, COLORS, duplicateGroups, memberSummary, monthDay, monthDayText, NOTE_MAX, sameNameContacts, toStored, validateFields, validMonthDay } from './model';

/** F1: the member model. Pure functions only. All names, dates and notes are invented. */
const row = (data: unknown, id = 1): ModuleRecord => ({ id, module: 'family', kind: 'member', data: data as never, createdAt: 1, updatedAt: 1, deletedAt: null });
const good = { contactId: 5, role: 'child', status: 'active' };

describe('validation', () => {
  it('accepts a complete, valid profile', () => {
    expect(validateFields({ role: 'child', status: 'active', birthMonthDay: '05-14', birthYear: 2016, color: COLORS[2].value, note: 'Likes soccer.' }, 2026)).toBeNull();
  });
  it('requires an allowed role and status', () => {
    expect(validateFields({ role: 'cousin' as never, status: 'active' }, 2026)).toMatch(/role/i);
    expect(validateFields({ role: 'parent', status: 'gone' as never }, 2026)).toMatch(/household/i);
    expect(validateFields({ status: 'active' }, 2026)).toMatch(/role/i);
  });
  it('checks the birthday format and that the day exists in that month', () => {
    for (const bad of ['5-14', '13-01', '00-10', '04-31', '02-30', '1405', '', 'ab-cd']) expect(validMonthDay(bad), bad).toBe(false);
    for (const ok of ['01-01', '04-30', '12-31', '02-29', '02-28']) expect(validMonthDay(ok), ok).toBe(true);
    expect(validateFields({ role: 'child', status: 'active', birthMonthDay: '04-31' }, 2026)).toMatch(/not a real date/);
  });
  it('February 29: valid on its own, and with a leap birth year; not with a non-leap year', () => {
    expect(validateFields({ role: 'child', status: 'active', birthMonthDay: '02-29' }, 2026)).toBeNull();
    expect(validateFields({ role: 'child', status: 'active', birthMonthDay: '02-29', birthYear: 2016 }, 2026)).toBeNull();
    expect(validateFields({ role: 'child', status: 'active', birthMonthDay: '02-29', birthYear: 2015 }, 2026)).toMatch(/leap year/);
    expect(validateFields({ role: 'child', status: 'active', birthMonthDay: '02-29', birthYear: 1900 }, 2026)).toMatch(/leap year/); // 1900 was not a leap year
    expect(validateFields({ role: 'child', status: 'active', birthMonthDay: '02-29', birthYear: 2000 }, 2026)).toBeNull();
  });
  it('the birth year is optional, whole, and between 1900 and this year', () => {
    expect(validateFields({ role: 'child', status: 'active' }, 2026)).toBeNull();
    for (const bad of [1899, 2027, 20.5, Number.NaN]) expect(validateFields({ role: 'child', status: 'active', birthYear: bad }, 2026), String(bad)).toMatch(/birth year/);
    expect(validateFields({ role: 'child', status: 'active', birthYear: 2026 }, 2026)).toBeNull();
  });
  it('only the approved colours, and a bounded note', () => {
    expect(validateFields({ role: 'child', status: 'active', color: '#123456' }, 2026)).toMatch(/color/);
    expect(validateFields({ role: 'child', status: 'active', note: 'x'.repeat(NOTE_MAX) }, 2026)).toBeNull();
    expect(validateFields({ role: 'child', status: 'active', note: 'x'.repeat(NOTE_MAX + 1) }, 2026)).toMatch(/at most/);
  });
  it('the approved colours are exactly the Calendar swatches, and every one has a name', () => {
    expect(COLORS.map((c) => c.value)).toEqual(SWATCHES);
    for (const c of COLORS) expect(c.name).toMatch(/\w/);
  });
  it('cleanFields stores a field only when it has a value, and trims the note', () => {
    expect(cleanFields({ role: 'parent', status: 'active', note: '   ' })).toEqual({ role: 'parent', status: 'active' });
    expect(cleanFields({ role: 'parent', status: 'active', note: '  hi  ', birthYear: 1980 })).toEqual({ role: 'parent', status: 'active', birthYear: 1980, note: 'hi' });
  });
  it('monthDay and monthDayText', () => {
    expect(monthDay(5, 4)).toBe('05-04');
    expect(monthDayText('05-14')).toBe('14 May');
    expect(monthDayText('13-40')).toBe('');
    expect(monthDayText(undefined)).toBe('');
  });
});

describe('defensive reading', () => {
  it('reads a good row, and carries nothing it invented', () => {
    const m = asMember(row({ ...good, birthMonthDay: '05-14', birthYear: 2016, color: COLORS[0].value, note: 'n' }), 2026);
    expect(m.problems).toEqual([]);
    expect(m.data).toEqual({ contactId: 5, role: 'child', status: 'active', birthMonthDay: '05-14', birthYear: 2016, color: COLORS[0].value, note: 'n' });
  });
  it('a damaged REQUIRED field makes the row "needs review" (data null) and never throws', () => {
    for (const bad of [null, 'text', 7, [], {}, { ...good, contactId: 'x' }, { ...good, contactId: 1.5 }, { ...good, role: 'sibling' }, { ...good, status: 'archived' }]) {
      const m = asMember(row(bad), 2026);
      expect(m.data, JSON.stringify(bad)).toBeNull();
      expect(m.problems.length).toBeGreaterThan(0);
    }
  });
  it('a damaged OPTIONAL field is left out of the view and named, while the row stays usable', () => {
    const m = asMember(row({ ...good, birthMonthDay: '99-99', birthYear: 'abc', color: 'red', note: 42 }), 2026);
    expect(m.data).toEqual({ contactId: 5, role: 'child', status: 'active' });
    expect(m.problems).toHaveLength(4);
    expect(m.raw).toMatchObject({ birthMonthDay: '99-99', birthYear: 'abc', color: 'red', note: 42 }); // the stored values are untouched
  });
  it('problem text never contains the note', () => {
    const m = asMember(row({ ...good, color: 'red', note: 'SECRET-NOTE-TEXT' }), 2026);
    expect(JSON.stringify(m.problems)).not.toContain('SECRET');
  });
  it('toStored keeps fields this version does not know, and takes the contact from the row, not the form', () => {
    const raw = { ...good, futureField: { nested: [1, 2] }, color: 'red' };
    const stored = toStored(raw, 5, { role: 'parent', status: 'active', birthYear: 1980 });
    expect(stored).toEqual({ futureField: { nested: [1, 2] }, contactId: 5, role: 'parent', status: 'active', birthYear: 1980 });
  });
});

describe('duplicate and same-name helpers', () => {
  const mk = (id: number, contactId: number, status: 'active' | 'past') => asMember(row({ contactId, role: 'child', status }, id), 2026);
  it('two ACTIVE members on one contact are a group; a past one, other contacts and unreadable rows are not', () => {
    const g = duplicateGroups([mk(1, 5, 'active'), mk(2, 5, 'active'), mk(3, 6, 'active'), mk(4, 7, 'active'), mk(5, 7, 'past'), asMember(row({ junk: true }, 6), 2026)]);
    expect(g.map((x) => x.map((m) => m.id))).toEqual([[1, 2]]);
  });
  it('marking one of the pair past clears the warning (nothing deleted)', () => {
    expect(duplicateGroups([mk(1, 5, 'active'), mk(2, 5, 'past')])).toEqual([]);
  });
  it('sameNameContacts ignores case, accents and extra spaces, and never matches an empty name', () => {
    const cs = [{ name: 'José  Rivera' }, { name: 'jose rivera' }, { name: 'Ana' }];
    expect(sameNameContacts(cs, ' JOSE RIVERA ', nameKey)).toHaveLength(2);
    expect(sameNameContacts(cs, '   ', nameKey)).toEqual([]);
  });
  it('the summary text carries role and status but never a note', () => {
    expect(memberSummary('Sam', { role: 'child', status: 'past' })).toBe('Sam, child (past member)');
  });
});

describe('backup summary', () => {
  it('names Family members under their own heading', () => {
    const s = summarizeBackup({ moduleRecords: [{ module: 'family', kind: 'member' }, { module: 'family', kind: 'member' }, { module: 'family', kind: 'future' }] } as never);
    const g = s.find((x) => x.id === 'family')!;
    expect(g.label).toBe('Family');
    expect(g.items).toEqual([{ label: 'Family members', n: 2 }, { label: 'family records (future)', n: 1 }]);
  });
});
