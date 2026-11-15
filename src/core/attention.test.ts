import { describe, expect, it } from 'vitest';
import {
  PREVIEW_COUNT, SOON_DAYS, acceptableAttention, attentionProblem, compareRanked, containsMoney, daysFrom, dedupeAttention, isInternalHref, previewAttention, rankAttention, tierOf, whenWords,
  type AttentionItem,
} from './attention';

/** Invented items only. */
const TODAY = '2026-11-10';
let n = 0;
const item = (over: Partial<AttentionItem> = {}): AttentionItem => {
  n++;
  return { id: `bills:x${n}`, moduleId: 'bills', recordId: null, condition: null, kind: 'review', date: null, title: `Thing ${n}`, reason: 'Needs a look.', href: '#/bills', provenance: 'test', ...over };
};

describe('tiers: explainable urgency, never invented', () => {
  it('overdue and broken are tier 1', () => {
    expect(tierOf({ kind: 'overdue', date: null }, TODAY)).toBe(1);
    expect(tierOf({ kind: 'broken', date: '2027-01-01' }, TODAY)).toBe(1);
  });
  it('a serious source severity is tier 1 even with no date (never demoted for having no deadline)', () => {
    expect(tierOf({ kind: 'review', severity: 'serious', date: null }, TODAY)).toBe(1);
  });
  it('a deadline that has passed is tier 1', () => {
    expect(tierOf({ kind: 'deadline', date: '2026-11-09' }, TODAY)).toBe(1);
  });
  it('a deadline from today through seven days ahead is tier 2 (both ends included)', () => {
    expect(SOON_DAYS).toBe(7);
    expect(tierOf({ kind: 'deadline', date: '2026-11-10' }, TODAY)).toBe(2);
    expect(tierOf({ kind: 'deadline', date: '2026-11-17' }, TODAY)).toBe(2);
    expect(tierOf({ kind: 'deadline', date: '2026-11-18' }, TODAY)).toBe(3);
  });
  it('a deadline with no date, or an unreadable date, is tier 3: urgency is never guessed from missing information', () => {
    expect(tierOf({ kind: 'deadline', date: null }, TODAY)).toBe(3);
    expect(tierOf({ kind: 'deadline', date: 'soon' }, TODAY)).toBe(3);
    expect(tierOf({ kind: 'deadline', date: '2026-02-31' }, TODAY)).toBe(3);
  });
  it('a date on a review item never raises it (only deadlines use their date)', () => {
    expect(tierOf({ kind: 'review', date: '2026-11-11' }, TODAY)).toBe(3);
    expect(tierOf({ kind: 'review', date: '2020-01-01' }, TODAY)).toBe(3);
  });
  it('informational items are tier 4', () => {
    expect(tierOf({ kind: 'info', date: '2026-11-10' }, TODAY)).toBe(4);
  });
  it('works across a month and year boundary', () => {
    expect(daysFrom('2027-01-02', '2026-12-31')).toBe(2);
    expect(tierOf({ kind: 'deadline', date: '2027-01-03' }, '2026-12-31')).toBe(2);
    expect(tierOf({ kind: 'deadline', date: '2027-01-08' }, '2026-12-31')).toBe(3);
  });
});

describe('ranking: deterministic whatever order the modules answered in', () => {
  const set = () => [
    item({ id: 'projects:p1', moduleId: 'projects', kind: 'overdue', date: '2026-11-01' }),
    item({ id: 'assets:a1', moduleId: 'assets', kind: 'overdue', date: '2026-10-20' }),
    item({ id: 'ledger:alert:backup:', moduleId: 'ledger', severity: 'serious', date: null }),
    item({ id: 'bills:due-1', kind: 'deadline', date: '2026-11-12' }),
    item({ id: 'bills:due-2', kind: 'deadline', date: '2026-11-11' }),
    item({ id: 'services:r1', moduleId: 'services', kind: 'deadline', date: '2026-11-25' }),
    item({ id: 'household:h1', moduleId: 'household', kind: 'review' }),
    item({ id: 'assets:a2', moduleId: 'assets', kind: 'review', date: '2026-10-01' }),
  ];
  const ids = (xs: ReturnType<typeof rankAttention>) => xs.map((x) => x.id);

  it('orders by tier, then date (earliest first, none last), then module, then id', () => {
    expect(ids(rankAttention(set(), TODAY))).toEqual([
      'assets:a1', 'projects:p1', 'ledger:alert:backup:', // tier 1: dated ones oldest first, then the undated serious one
      'bills:due-2', 'bills:due-1', // tier 2 by date
      'assets:a2', 'services:r1', 'household:h1', // tier 3: dated first (by date), then undated
    ]);
  });
  it('gives the same order for every permutation of the input', () => {
    const want = ids(rankAttention(set(), TODAY));
    const base = set();
    for (let k = 0; k < 24; k++) {
      const shuffled = [...base].sort((a, b) => ((a.id.charCodeAt(2) * (k + 3) + a.id.length * k) % 11) - ((b.id.charCodeAt(2) * (k + 3) + b.id.length * k) % 11));
      expect(ids(rankAttention(shuffled, TODAY))).toEqual(want);
    }
    expect(ids(rankAttention([...base].reverse(), TODAY))).toEqual(want);
  });
  it('breaks a full tie by module id then item id, character by character', () => {
    const a = item({ id: 'assets:b', moduleId: 'assets', date: '2026-11-01', kind: 'overdue' });
    const b = item({ id: 'assets:a', moduleId: 'assets', date: '2026-11-01', kind: 'overdue' });
    const c = item({ id: 'bills:a', moduleId: 'bills', date: '2026-11-01', kind: 'overdue' });
    expect(rankAttention([c, a, b], TODAY).map((x) => x.id)).toEqual(['assets:a', 'assets:b', 'bills:a']);
  });
  it('is a pure function: the input is not changed and the same call gives the same answer', () => {
    const input = set();
    const copy = JSON.stringify(input);
    const first = JSON.stringify(rankAttention(input, TODAY));
    expect(JSON.stringify(input)).toBe(copy);
    expect(JSON.stringify(rankAttention(input, TODAY))).toBe(first);
  });
  it('compareRanked is consistent (antisymmetric) on every pair', () => {
    const r = rankAttention(set(), TODAY);
    for (const a of r) for (const b of r) expect(Math.sign(compareRanked(a, b)) + Math.sign(compareRanked(b, a))).toBe(0);
  });
  it('items with a missing or unreadable date sort last in their tier and never throw', () => {
    const r = rankAttention([item({ id: 'bills:n', kind: 'review', date: null }), item({ id: 'bills:bad', kind: 'review', date: 'not-a-date' }), item({ id: 'bills:d', kind: 'review', date: '2026-01-01' })], TODAY);
    expect(r[0].id).toBe('bills:d');
    expect(r.map((x) => x.tier)).toEqual([3, 3, 3]);
  });
  it('an empty list ranks to an empty list', () => {
    expect(rankAttention([], TODAY)).toEqual([]);
  });
});

describe('identity and duplicates (the rules in the header of core/attention.ts)', () => {
  it('the same id reported twice is one item', () => {
    const r = dedupeAttention([item({ id: 'assets:task:5:overdue', moduleId: 'assets' }), item({ id: 'assets:task:5:overdue', moduleId: 'assets' })], TODAY);
    expect(r).toHaveLength(1);
  });
  it('two views of ONE source condition (same condition key) are shown once, the more urgent kept, and the other module is named', () => {
    const projectsView = item({ id: 'projects:t:12', moduleId: 'projects', condition: 'task:12:overdue', kind: 'review' });
    const assetsView = item({ id: 'assets:task:12:overdue', moduleId: 'assets', condition: 'task:12:overdue', kind: 'overdue', date: '2026-11-01' });
    const r = rankAttention([projectsView, assetsView], TODAY);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'assets:task:12:overdue', tier: 1, alsoFrom: ['projects'] });
  });
  it('the order the two views arrive in does not change which is kept', () => {
    const a = item({ id: 'assets:x', moduleId: 'assets', condition: 'c:1', kind: 'review' });
    const b = item({ id: 'bills:x', moduleId: 'bills', condition: 'c:1', kind: 'review' });
    expect(rankAttention([a, b], TODAY)[0].id).toBe('assets:x');
    expect(rankAttention([b, a], TODAY)[0].id).toBe('assets:x');
  });
  it('separate unresolved actions on the same record stay separate (different conditions)', () => {
    const notLogged = item({ id: 'services:task:7:unlogged', moduleId: 'services', recordId: 'task:7', condition: 'task:7:visit-unlogged' });
    const notSaved = item({ id: 'assets:task:7:unsaved', moduleId: 'assets', recordId: 'task:7', condition: 'task:7:unsaved-history' });
    const overdueAfter = item({ id: 'assets:task:7:overdue', moduleId: 'assets', recordId: 'task:7', condition: 'task:7:overdue', kind: 'overdue', date: '2026-11-01' });
    expect(rankAttention([notLogged, notSaved, overdueAfter], TODAY)).toHaveLength(3);
  });
  it('a renewal and a notice deadline on the same day are two items', () => {
    const a = item({ id: 'services:arrangement:3:renewal', moduleId: 'services', recordId: 'arrangement:3', kind: 'deadline', date: '2026-11-20' });
    const b = item({ id: 'services:arrangement:3:notice', moduleId: 'services', recordId: 'arrangement:3', kind: 'deadline', date: '2026-11-20' });
    expect(rankAttention([a, b], TODAY)).toHaveLength(2);
  });
  it('identical or near-identical TITLES are never merged (wording is not identity)', () => {
    const a = item({ id: 'bills:a', title: 'Streamly: due in 3 days', reason: 'Due soon.' });
    const b = item({ id: 'bills:b', title: 'Streamly: due in 3 days', reason: 'Due soon.' });
    const c = item({ id: 'assets:c', moduleId: 'assets', title: 'streamly: due in 3 days', reason: 'Due soon.' });
    expect(rankAttention([a, b, c], TODAY)).toHaveLength(3);
  });
  it('items with no condition are never merged with each other', () => {
    expect(rankAttention([item({ id: 'bills:a', condition: null }), item({ id: 'bills:b', condition: null })], TODAY)).toHaveLength(2);
  });
});

describe('the compact list: exactly five, and the true count of the rest', () => {
  const many = (k: number) => Array.from({ length: k }, (_, i) => item({ id: `bills:m${String(i).padStart(2, '0')}`, kind: 'overdue', date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
  it('shows five of seven, and says seven', () => {
    const p = previewAttention(rankAttention(many(7), TODAY));
    expect(PREVIEW_COUNT).toBe(5);
    expect(p).toMatchObject({ total: 7, remaining: 2 });
    expect(p.shown).toHaveLength(5);
    expect(p.shown.map((x) => x.id)).toEqual(['bills:m00', 'bills:m01', 'bills:m02', 'bills:m03', 'bills:m04']);
  });
  it('exactly five means no "See all"', () => {
    expect(previewAttention(rankAttention(many(5), TODAY))).toMatchObject({ total: 5, remaining: 0 });
  });
  it('fewer than five shows them all; none shows nothing', () => {
    expect(previewAttention(rankAttention(many(3), TODAY))).toMatchObject({ total: 3, remaining: 0 });
    expect(previewAttention([])).toEqual({ shown: [], total: 0, remaining: 0 });
  });
  it('the count after de-duplication is the count shown, never the raw count', () => {
    const dup = [...many(6), item({ id: 'bills:m00' })];
    expect(previewAttention(rankAttention(dup, TODAY))).toMatchObject({ total: 6, remaining: 1 });
  });
});

describe('words', () => {
  const r = (over: Partial<AttentionItem>) => rankAttention([item({ id: 'bills:w', ...over })], TODAY)[0];
  it('says how late, how soon, or that it needs review', () => {
    expect(whenWords(r({ kind: 'overdue', date: '2026-11-07' }), TODAY)).toBe('3 days overdue');
    expect(whenWords(r({ kind: 'deadline', date: '2026-11-09' }), TODAY)).toBe('1 day overdue');
    expect(whenWords(r({ kind: 'deadline', date: '2026-11-10' }), TODAY)).toBe('Due today');
    expect(whenWords(r({ kind: 'deadline', date: '2026-11-11' }), TODAY)).toBe('Due tomorrow');
    expect(whenWords(r({ kind: 'deadline', date: '2026-11-15' }), TODAY)).toBe('Due in 5 days');
    expect(whenWords(r({ kind: 'deadline', date: '2026-12-20' }), TODAY)).toBe('Due in 40 days'); // dated but not soon: it says when, not just "review"
    expect(whenWords(r({ kind: 'deadline', date: null }), TODAY)).toBe('Needs review');
    expect(whenWords(r({ kind: 'review' }), TODAY)).toBe('Needs review');
    expect(whenWords(r({ kind: 'review', date: '2026-11-20' }), TODAY)).toBe('Needs review'); // a date on a review item does not make it a deadline
    expect(whenWords(r({ kind: 'overdue', date: null }), TODAY)).toBe('Overdue');
    expect(whenWords(r({ kind: 'review', severity: 'serious' }), TODAY)).toBe('Urgent');
  });
});

describe('what may be shown: no amounts, only links inside Ledger', () => {
  it('recognizes money', () => {
    for (const s of ['$12', '$1,234.56', '12.50', '€5', '£3', '1,000.00', 'USD 5']) expect(containsMoney(s), s).toBe(true);
  });
  it('lets dates, counts and ordinary numbers through', () => {
    for (const s of ['2026-11-10', '3 days overdue', '12 payments', 'Over budget: Groceries', 'Gym 24/7', 'Mon 3:30']) expect(containsMoney(s), s).toBe(false);
  });
  it('links must be Ledger hash addresses', () => {
    for (const h of ['#/assets', '#/assets/4', '#/assets/4?warranty=9', '#/bills/o/12', '#/today/needs', '#/ledger/budget']) expect(isInternalHref(h), h).toBe(true);
    for (const h of ['', '#', '/assets', 'https://example.com', 'javascript:alert(1)', '//evil.test', '#/', '#/ ']) expect(isInternalHref(h), h).toBe(false);
  });
  it('rejects an item that is not namespaced, shows an amount, or has a bad date or link', () => {
    const ok = item({ id: 'bills:ok' });
    expect(attentionProblem('bills', ok)).toBeNull();
    expect(attentionProblem('assets', ok)).toBe('wrong module');
    expect(attentionProblem('bills', item({ id: 'x:1' }))).toBe('id is not namespaced');
    expect(attentionProblem('bills', item({ id: 'bills:' }))).toBe('id is not namespaced');
    expect(attentionProblem('bills', item({ id: 'bills:a', date: '11/10/2026' }))).toBe('bad date');
    expect(attentionProblem('bills', item({ id: 'bills:a', title: ' ' }))).toBe('empty title or reason');
    expect(attentionProblem('bills', item({ id: 'bills:a', href: 'https://example.com' }))).toBe('bad link');
    expect(attentionProblem('bills', item({ id: 'bills:a', reason: 'Owes $15.49' }))).toBe('shows an amount');
    expect(attentionProblem('bills', item({ id: 'bills:a', count: 0 }))).toBe('bad count');
  });
  it('drops (and reports) a bad item instead of showing it', () => {
    const said: string[] = [];
    const kept = acceptableAttention('bills', [item({ id: 'bills:ok' }), item({ id: 'bills:bad', reason: 'Owes $9.99' })], (m) => said.push(m));
    expect(kept.map((i) => i.id)).toEqual(['bills:ok']);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('bills:bad');
  });
});
