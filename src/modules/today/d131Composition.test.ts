import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AGENDA_IDS, ARRANGEMENT_KEY, STATUS_GROUP_IDS, STATUS_UNIT, agendaIds, composeToday, copyArrangement, defaultArrangement, deriveFromLegacy, forgetArrangement, hideCard,
  isCustomLegacy, loadArrangement, moveUnit, readLegacy, sanitizeArrangement, saveArrangement, showCard, sideUnits, unitTitle,
} from './composition';
import { LAYOUT_KEY, defaultLayout, moveEntry, toggleEntryHidden, toggleEntrySize, type CardInfo } from './layout';

/**
 * D13.1. How Today is composed: a wide agenda column in a fixed order and a narrow supporting column that can be reordered and hidden. These guards are about
 * what the redesign must NOT do: lose a card, move a card between columns, change the earlier saved layout, or lose a hidden choice. Every id below is a real card id
 * (a test reads the card source files and checks the list against them); there is no personal data.
 */

const CARDS: CardInfo[] = [
  { id: 'today.agenda', defaultWidth: 'full', priority: 10 },
  { id: 'today.reminders', defaultWidth: 'half', priority: 15 },
  { id: 'today.overdue', defaultWidth: 'half', priority: 20 },
  { id: 'today.upcoming', defaultWidth: 'half', priority: 30 },
  { id: 'projects.attention', defaultWidth: 'half', priority: 35 },
  { id: 'bills.attention', defaultWidth: 'half', priority: 37 },
  { id: 'assets.attention', defaultWidth: 'half', priority: 38 },
  { id: 'household.attention', defaultWidth: 'half', priority: 38 },
  { id: 'services.attention', defaultWidth: 'half', priority: 39 },
  { id: 'ledger.attention', defaultWidth: 'half', priority: 40 },
  { id: 'ledger.cash', defaultWidth: 'half', priority: 50 },
];

/** A fake storage that records every write, so a test can prove which keys were (not) touched. */
function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    data, writes,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { writes.push(`set ${k}`); data.set(k, v); },
    removeItem: (k: string) => { writes.push(`remove ${k}`); data.delete(k); },
  };
}

const cardIdsIn = (c: ReturnType<typeof composeToday>) => [...c.agenda.map((x) => x.id), ...c.side.flatMap((u) => u.cards.map((x) => x.id))];

describe('D13.1 card inventory: nothing disappears', () => {
  it('the eleven registered cards are exactly the ones the composition places, each once', () => {
    const files = ['../today/cards.tsx', '../ledger/todayCards.tsx', '../bills/todayCards.tsx', '../assets/todayCards.tsx', '../household/todayCards.tsx', '../projects/todayCards.tsx', '../services/todayCards.tsx'];
    const ids = files.flatMap((f) => [...readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(/\bid: '([a-z]+\.[a-z]+)'/g)].map((m) => m[1]));
    expect([...ids].sort()).toEqual(CARDS.map((c) => c.id).sort());
    const placed = cardIdsIn(composeToday(CARDS, defaultArrangement(CARDS)));
    expect([...placed].sort()).toEqual([...ids].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('the agenda column is always Today, Reminders due, Overdue, Coming up, in that order, whatever is saved', () => {
    expect(agendaIds(CARDS)).toEqual(['today.agenda', 'today.reminders', 'today.overdue', 'today.upcoming']);
    expect(AGENDA_IDS).toEqual(['today.agenda', 'today.reminders', 'today.overdue', 'today.upcoming']);
    const weird = { side: ['ledger.cash', 'today.overdue', STATUS_UNIT, 'ledger.attention'], hidden: ['today.reminders'] };
    const c = composeToday(CARDS, sanitizeArrangement(weird, CARDS));
    expect(c.agenda.map((x) => x.id)).toEqual(['today.agenda', 'today.reminders', 'today.overdue', 'today.upcoming']);
    expect(c.agenda.find((x) => x.id === 'today.reminders')?.hidden).toBe(true);
    expect(c.side.map((u) => u.id)).toEqual(['ledger.cash', STATUS_UNIT, 'ledger.attention']); // an agenda id in the side list is ignored
  });

  it('a card that is not registered is simply absent, and the five attention cards form one group that follows the ones that exist', () => {
    const fewer = CARDS.filter((c) => c.id !== 'bills.attention' && c.id !== 'projects.attention');
    const units = sideUnits(fewer);
    const group = units.find((u) => u.group)!;
    expect(group.cardIds).toEqual(['household.attention', 'assets.attention', 'services.attention']);
    expect(agendaIds(fewer.filter((c) => c.id !== 'today.reminders'))).toEqual(['today.agenda', 'today.overdue', 'today.upcoming']);
    expect(sideUnits(fewer.filter((c) => !STATUS_GROUP_IDS.includes(c.id as never))).some((u) => u.group)).toBe(false);
  });

  it('a card a later module adds appears by itself at the end of the supporting column', () => {
    const more: CardInfo[] = [...CARDS, { id: 'garden.attention', defaultWidth: 'half', priority: 45 }];
    expect(defaultArrangement(more).side).toEqual(['ledger.attention', 'ledger.cash', STATUS_UNIT, 'garden.attention']);
    // and an arrangement saved before the card existed still gets it
    const saved = sanitizeArrangement({ side: ['ledger.cash', STATUS_UNIT, 'ledger.attention'], hidden: [] }, more);
    expect(saved.side).toEqual(['ledger.cash', STATUS_UNIT, 'ledger.attention', 'garden.attention']);
  });
});

describe('D13.1 the designed default', () => {
  it('Needs attention, Cash outlook, then the Household status group; nothing hidden', () => {
    const a = defaultArrangement(CARDS);
    expect(a).toEqual({ side: ['ledger.attention', 'ledger.cash', STATUS_UNIT], hidden: [] });
    const status = composeToday(CARDS, a).side.find((u) => u.group)!;
    expect(status.cards.map((c) => c.id)).toEqual(['bills.attention', 'household.attention', 'assets.attention', 'services.attention', 'projects.attention']);
    expect(unitTitle(status, (id) => id)).toBe('Household status');
    expect(unitTitle(composeToday(CARDS, a).side[0], (id) => `T:${id}`)).toBe('T:ledger.attention');
  });

  it('a fresh profile (nothing saved) receives the default and writes nothing', () => {
    const s = fakeStore();
    const l = loadArrangement(CARDS, s);
    expect(l.source).toBe('default');
    expect(l.arrangement).toEqual(defaultArrangement(CARDS));
    expect(s.writes).toEqual([]);
  });
});

describe('D13.1 reordering and hiding (supporting column only)', () => {
  const a0 = defaultArrangement(CARDS);
  it('moves a section one step, never off either end, without changing the input', () => {
    const before = copyArrangement(a0);
    expect(moveUnit(a0, 'ledger.cash', -1).side).toEqual(['ledger.cash', 'ledger.attention', STATUS_UNIT]);
    expect(moveUnit(a0, STATUS_UNIT, -1).side).toEqual(['ledger.attention', STATUS_UNIT, 'ledger.cash']);
    expect(moveUnit(a0, 'ledger.attention', -1)).toBe(a0);
    expect(moveUnit(a0, STATUS_UNIT, 1)).toBe(a0);
    expect(moveUnit(a0, 'today.overdue', -1)).toBe(a0); // the agenda has nothing to move
    expect(a0).toEqual(before);
  });
  it('hiding a card keeps it in its place; showing it brings it back; hiding a group member leaves the group', () => {
    const h = hideCard(hideCard(a0, 'bills.attention'), 'ledger.cash');
    expect(h.hidden).toEqual(['bills.attention', 'ledger.cash']);
    expect(h.side).toEqual(a0.side);
    expect(hideCard(h, 'bills.attention')).toBe(h);
    const c = composeToday(CARDS, h);
    expect(c.side.find((u) => u.group)!.cards.find((x) => x.id === 'bills.attention')!.hidden).toBe(true);
    expect(c.side.find((u) => u.group)!.cards.find((x) => x.id === 'household.attention')!.hidden).toBe(false);
    expect(showCard(h, 'bills.attention').hidden).toEqual(['ledger.cash']);
    expect(cardIdsIn(c).length).toBe(CARDS.length); // hidden cards stay in the composition (Edit layout shows them)
  });
  it('bad saved data is repaired, not trusted', () => {
    expect(sanitizeArrangement(null, CARDS)).toEqual(defaultArrangement(CARDS));
    expect(sanitizeArrangement('text', CARDS)).toEqual(defaultArrangement(CARDS));
    expect(sanitizeArrangement({ side: 'x', hidden: [] }, CARDS)).toEqual(defaultArrangement(CARDS));
    const odd = sanitizeArrangement({ side: [STATUS_UNIT, STATUS_UNIT, 7, 'nope', 'ledger.cash'], hidden: ['ledger.cash', 'ledger.cash', 'nope', 3] }, CARDS);
    expect(odd).toEqual({ side: [STATUS_UNIT, 'ledger.cash', 'ledger.attention'], hidden: ['ledger.cash'] });
  });
});

describe('D13.1 saved layouts: the earlier one is never changed, and is carried over', () => {
  /** A customized earlier layout: Cash outlook first, Bills hidden, Needs attention wide, Coming up narrow. */
  const customLegacy = () => {
    let l = defaultLayout(CARDS);
    for (let i = 0; i < 7; i++) l = moveEntry(l, 'ledger.cash', -1);
    l = toggleEntryHidden(l, 'bills.attention');
    l = toggleEntrySize(l, 'ledger.attention');
    return l;
  };

  it('an untouched earlier layout gives the designed default (nothing to carry over)', () => {
    const s = fakeStore({ [LAYOUT_KEY]: JSON.stringify(defaultLayout(CARDS)) });
    expect(isCustomLegacy(defaultLayout(CARDS), CARDS)).toBe(false);
    expect(loadArrangement(CARDS, s)).toEqual({ arrangement: defaultArrangement(CARDS), source: 'default' });
  });

  it('a customized earlier layout is derived: order of the sections and hidden cards carry over, widths are dropped', () => {
    const legacy = customLegacy();
    expect(isCustomLegacy(legacy, CARDS)).toBe(true);
    const s = fakeStore({ [LAYOUT_KEY]: JSON.stringify(legacy) });
    const l = loadArrangement(CARDS, s);
    expect(l.source).toBe('derived');
    expect(l.arrangement.hidden).toEqual(['bills.attention']);
    // Cash outlook was moved up before the attention cards, so it comes first among the sections; the group sits where its first card (Projects) was
    expect(l.arrangement.side[0]).toBe('ledger.cash');
    expect([...l.arrangement.side].sort()).toEqual([...defaultArrangement(CARDS).side].sort());
    expect(Object.keys(l.arrangement).sort()).toEqual(['hidden', 'side']); // no width in the new arrangement
    expect(s.writes).toEqual([]); // deriving writes nothing at all
  });

  it('a size-only difference still counts as customized (the owner is told widths no longer apply)', () => {
    expect(isCustomLegacy(toggleEntrySize(defaultLayout(CARDS), 'today.overdue'), CARDS)).toBe(true);
  });

  it('saving writes ONLY the new key; the earlier key is byte-for-byte unchanged', () => {
    const legacyText = JSON.stringify(customLegacy());
    const s = fakeStore({ [LAYOUT_KEY]: legacyText });
    saveArrangement(hideCard(deriveFromLegacy(customLegacy(), CARDS), 'ledger.cash'), s);
    expect(s.writes).toEqual([`set ${ARRANGEMENT_KEY}`]);
    expect(s.data.get(LAYOUT_KEY)).toBe(legacyText);
    const l = loadArrangement(CARDS, s);
    expect(l.source).toBe('saved');
    expect(l.arrangement.hidden).toContain('ledger.cash');
  });

  it('Reset to default writes the designed default under the new key and leaves the earlier layout alone', () => {
    const legacyText = JSON.stringify(customLegacy());
    const s = fakeStore({ [LAYOUT_KEY]: legacyText });
    saveArrangement(copyArrangement(defaultArrangement(CARDS)), s);
    expect(loadArrangement(CARDS, s)).toEqual({ arrangement: defaultArrangement(CARDS), source: 'saved' });
    expect(s.data.get(LAYOUT_KEY)).toBe(legacyText);
    expect(s.writes.every((w) => !w.includes(LAYOUT_KEY))).toBe(true);
  });

  it('"Use my earlier layout again" removes only the new key and the earlier layout is carried over again', () => {
    const legacyText = JSON.stringify(customLegacy());
    const s = fakeStore({ [LAYOUT_KEY]: legacyText });
    saveArrangement(defaultArrangement(CARDS), s);
    forgetArrangement(s);
    expect(s.writes).toEqual([`set ${ARRANGEMENT_KEY}`, `remove ${ARRANGEMENT_KEY}`]);
    expect(loadArrangement(CARDS, s).source).toBe('derived');
    expect(readLegacy(CARDS, s)).toEqual(customLegacy());
  });

  it('reload: what was saved is what comes back, in order', () => {
    const s = fakeStore();
    const a = hideCard(moveUnit(defaultArrangement(CARDS), STATUS_UNIT, -1), 'services.attention');
    saveArrangement(a, s);
    const again = loadArrangement(CARDS, fakeStore(Object.fromEntries(s.data)));
    expect(again).toEqual({ arrangement: a, source: 'saved' });
    expect(again.arrangement.side).toEqual(['ledger.attention', STATUS_UNIT, 'ledger.cash']);
  });

  it('unreadable storage falls back safely', () => {
    expect(loadArrangement(CARDS, { getItem: () => { throw new Error('blocked'); } }).source).toBe('default');
    expect(loadArrangement(CARDS, fakeStore({ [ARRANGEMENT_KEY]: '{not json', [LAYOUT_KEY]: 'also bad' })).source).toBe('default');
  });

  it('the composition module has no database, clock or network code', () => {
    const src = readFileSync(new URL('./composition.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bdb\b|Dexie|fetch\(|Date\.now|new Date|todayISO|setInterval|setTimeout/);
  });
});
