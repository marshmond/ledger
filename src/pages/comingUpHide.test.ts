import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCalendar, toIcs } from '../lib/calendar';
import { comingUpTitle } from './ComingUp';

/** Home's "Coming up" card honors Hide Amounts for what it SHOWS. Dates, payees, ids and links are untouched, and the downloaded calendar file keeps its text. */
const events = buildCalendar({
  today: '2026-11-07', horizonDays: 90, vests: [], milestones: [], estimated: null, rmds: [], yearEndYears: [],
  scheduled: [{ id: '7', date: '2026-11-20', payee: 'Example Rent', amountCents: -120000 }],
  loans: [{ id: '3', date: '2026-11-10', name: 'Test mortgage', paymentCents: 182345 }],
  fmt: (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
});

describe('Home "Coming up" and Hide Amounts', () => {
  it('Hide Amounts OFF: the titles are exactly what they were', () => {
    expect(events.map((e) => comingUpTitle(e.title, false))).toEqual(events.map((e) => e.title));
    expect(events.map((e) => e.title)).toEqual(['Test mortgage payment $1,823.45', 'Example Rent $1,200.00']);
  });

  it('Hide Amounts ON: no figure in any shown title; payee and words stay', () => {
    const shown = events.map((e) => comingUpTitle(e.title, true));
    expect(shown).toEqual(['Test mortgage payment $••••', 'Example Rent $••••']);
    for (const t of shown) expect(t).not.toMatch(/\$\s?\d/);
  });

  it('toggling back and forth is a pure function of the switch: nothing is remembered or changed', () => {
    const before = JSON.stringify(events);
    const seq = [true, false, true, false].map((h) => comingUpTitle(events[1].title, h));
    expect(seq).toEqual(['Example Rent $••••', 'Example Rent $1,200.00', 'Example Rent $••••', 'Example Rent $1,200.00']);
    expect(JSON.stringify(events)).toBe(before);
  });

  it('dates, kinds, ids and links are not touched, and the downloaded file keeps the full text', () => {
    expect(events.map((e) => [e.id, e.date, e.kind, e.to])).toEqual([['loan-3-2026-11-10', '2026-11-10', 'loan', '/debt'], ['bill-7-2026-11-20', '2026-11-20', 'bill', '/scheduled']]);
    expect(toIcs(events, '2026-11-07T00:00:00.000Z')).toContain('Example Rent $1\\,200.00');
    const src = readFileSync(new URL('./ComingUp.tsx', import.meta.url), 'utf8');
    expect(src).toContain('toIcs(all,'); // the download is built from the raw events, never from the masked titles
    expect(src).not.toMatch(/moduleRecords|txns\.(put|add|update)|recurring\.(put|add|update)/); // read only
  });
});
