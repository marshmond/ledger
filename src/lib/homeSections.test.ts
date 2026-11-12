import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_KEY } from './homeLayout';
import {
  DEFAULT_SECTIONS, NOTICE_KEY, PRIMARY_IDS, SECTIONS_KEY, SECTION_IDS, SECTION_TITLE, SIDE_IDS, deriveFromLegacy, forgetSections, hideSection, loadSections, moveSection, readCustomLegacy, sanitizeSections, saveSections, showSection,
  type HomeSections,
} from './homeSections';

/**
 * D12 refinement: Ledger Home's arrangement. The earlier layout key is only ever READ; the new key is written by an explicit change; a customized earlier layout is carried
 * over in memory and never lost. A small in-memory store stands in for the browser's storage, so a test can also prove what was NOT written.
 */
function store(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    data, writes,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { writes.push(`set ${k}`); data.set(k, v); },
    removeItem: (k: string) => { writes.push(`remove ${k}`); data.delete(k); },
  };
}
const legacy = (cards: [string, 'half' | 'full'][]) => JSON.stringify(cards.map(([id, size]) => ({ id, size })));

describe('the sections', () => {
  it('seven sections in two columns: three analysis sections and four supporting ones, each with a title', () => {
    expect([...SECTION_IDS]).toEqual(['analysis', 'cashflow', 'breakdown', 'recent', 'checkin', 'comingup', 'goals']);
    expect([...PRIMARY_IDS, ...SIDE_IDS]).toEqual([...SECTION_IDS]);
    for (const id of SECTION_IDS) expect(SECTION_TITLE[id].length).toBeGreaterThan(2);
    expect(DEFAULT_SECTIONS).toEqual({ primary: ['analysis', 'cashflow', 'breakdown'], side: ['recent', 'checkin', 'comingup', 'goals'], hidden: [] });
  });

  it('sanitize keeps known sections once each in their own column, keeps hidden ones hidden, appends any that are missing, and falls back to the default for junk', () => {
    expect(sanitizeSections({ primary: ['cashflow', 'recent', 'cashflow', 'nope'], side: ['goals', 'analysis'], hidden: ['breakdown'] })).toEqual({
      primary: ['cashflow', 'analysis'], side: ['goals', 'recent', 'checkin', 'comingup'], hidden: ['breakdown'],
    });
    for (const junk of [null, undefined, 5, 'x', [], { primary: 'a' }, { primary: [], side: [] }]) expect(sanitizeSections(junk)).toEqual(DEFAULT_SECTIONS);
  });

  it('a section can be moved up or down inside its own column only, and stays put at the ends', () => {
    const a = moveSection(DEFAULT_SECTIONS, 'cashflow', -1);
    expect(a.primary).toEqual(['cashflow', 'analysis', 'breakdown']);
    expect(a.side).toEqual(DEFAULT_SECTIONS.side);
    expect(moveSection(a, 'cashflow', -1)).toBe(a);
    expect(moveSection(DEFAULT_SECTIONS, 'goals', 1)).toBe(DEFAULT_SECTIONS);
    expect(moveSection(DEFAULT_SECTIONS, 'recent', 1).side).toEqual(['checkin', 'recent', 'comingup', 'goals']);
    expect(DEFAULT_SECTIONS.primary).toEqual(['analysis', 'cashflow', 'breakdown']); // the default is never mutated
  });

  it('hiding removes a section from its column; showing puts it at the end of the same column', () => {
    const h = hideSection(DEFAULT_SECTIONS, 'comingup');
    expect(h.side).toEqual(['recent', 'checkin', 'goals']);
    expect(h.hidden).toEqual(['comingup']);
    expect(hideSection(h, 'comingup')).toBe(h);
    const s = showSection(h, 'comingup');
    expect(s.side).toEqual(['recent', 'checkin', 'goals', 'comingup']);
    expect(s.hidden).toEqual([]);
    expect(showSection(s, 'comingup')).toBe(s);
    expect(showSection(hideSection(DEFAULT_SECTIONS, 'analysis'), 'analysis').primary).toEqual(['cashflow', 'breakdown', 'analysis']);
  });
});

describe('the earlier layout (twelve cards, half or full)', () => {
  it('a layout that equals the earlier default is not "customized": nothing is carried over and no note is needed', () => {
    const st = store({ [LAYOUT_KEY]: JSON.stringify(DEFAULT_LAYOUT) });
    expect(readCustomLegacy(st)).toBeNull();
    expect(loadSections(st)).toMatchObject({ source: 'default', sections: DEFAULT_SECTIONS });
    expect(readCustomLegacy(store())).toBeNull();
    expect(readCustomLegacy(store({ [LAYOUT_KEY]: 'not json' }))).toBeNull();
  });

  it('order and removed cards carry over; widths are dropped; Spending by category and Budget progress become one section that sits where the first of them was', () => {
    const d = deriveFromLegacy([{ id: 'goals', size: 'full' }, { id: 'networth', size: 'half' }, { id: 'recent', size: 'half' }, { id: 'budget', size: 'full' }, { id: 'cashflow', size: 'half' }, { id: 'spending', size: 'half' }]);
    expect(d.sections.side).toEqual(['goals', 'recent']);
    expect(d.sections.primary).toEqual(['analysis', 'cashflow']);
    expect(d.sections.hidden.sort()).toEqual(['breakdown', 'checkin', 'comingup']);
    expect(d.nowAlwaysShown.sort()).toEqual(['attention', 'month', 'start']);
    // analysis came first through "budget" (index 3) before "cashflow" (index 4)
    expect(d.sections.primary[0]).toBe('analysis');
  });

  it('the analysis section is hidden only when BOTH of its earlier cards were removed', () => {
    expect(deriveFromLegacy([{ id: 'spending', size: 'half' }, { id: 'goals', size: 'half' }]).sections.hidden).not.toContain('analysis');
    expect(deriveFromLegacy([{ id: 'budget', size: 'half' }]).sections.hidden).not.toContain('analysis');
    expect(deriveFromLegacy([{ id: 'goals', size: 'half' }]).sections.hidden).toContain('analysis');
  });

  it('loading with only a customized earlier layout derives the new arrangement IN MEMORY: nothing is written and the earlier key is untouched', () => {
    const raw = legacy([['recent', 'half'], ['goals', 'full'], ['spending', 'half']]);
    const st = store({ [LAYOUT_KEY]: raw });
    const l = loadSections(st);
    expect(l.source).toBe('carried');
    expect(l.sections.side).toEqual(['recent', 'goals']);
    expect(l.nowAlwaysShown.length).toBeGreaterThan(0);
    expect(st.writes).toEqual([]);
    expect(st.data.get(LAYOUT_KEY)).toBe(raw);
  });

  it('an explicit change writes only the NEW key; the earlier key stays exactly as it was, and later loads read the new key', () => {
    const raw = legacy([['goals', 'full'], ['recent', 'half']]);
    const st = store({ [LAYOUT_KEY]: raw });
    const next: HomeSections = moveSection(loadSections(st).sections, 'recent', 1);
    saveSections(next, st);
    expect(st.writes).toEqual([`set ${SECTIONS_KEY}`]);
    expect(st.data.get(LAYOUT_KEY)).toBe(raw);
    expect(loadSections(st)).toMatchObject({ source: 'saved', sections: next });
  });

  it('"Use my earlier arrangement again" forgets only the new key, so the carried-over arrangement returns and nothing is lost', () => {
    const raw = legacy([['goals', 'full'], ['recent', 'half']]);
    const st = store({ [LAYOUT_KEY]: raw });
    saveSections(DEFAULT_SECTIONS, st);
    expect(loadSections(st).source).toBe('saved');
    forgetSections(st);
    expect(st.writes).toEqual([`set ${SECTIONS_KEY}`, `remove ${SECTIONS_KEY}`]);
    expect(st.data.get(LAYOUT_KEY)).toBe(raw);
    expect(loadSections(st).source).toBe('carried');
  });

  it('a fresh profile gets the default; an unreadable new value falls back to the earlier layout or the default, never an error', () => {
    expect(loadSections(store())).toMatchObject({ source: 'default', sections: DEFAULT_SECTIONS });
    expect(loadSections(store({ [SECTIONS_KEY]: '{bad' })).source).toBe('default');
    expect(loadSections(store({ [SECTIONS_KEY]: '{bad', [LAYOUT_KEY]: legacy([['goals', 'full']]) })).source).toBe('carried');
    expect(loadSections({ getItem: () => { throw new Error('blocked'); } }).source).toBe('default');
  });

  it('the one-time note has its own key, separate from both layouts', () => {
    expect(NOTICE_KEY).toBe('ledger.home.layoutNotice.v2');
    expect(new Set([NOTICE_KEY, SECTIONS_KEY, LAYOUT_KEY]).size).toBe(3);
    expect(LAYOUT_KEY).toBe('ledger.home.layout.v1');
  });
});
