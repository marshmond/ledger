/**
 * Ledger Home's arrangement (D12 refinement). PURE (no React, no database, no clock) apart from the two small storage readers at the bottom.
 *
 * Home is no longer a grid of twelve independent cards. It is a fixed top (the net-worth and month panel, Needs attention, Get started) followed by two columns of
 * SECTIONS: a wide analysis column and a narrow supporting column. The only customization is what the owner asked to keep first: moving a section up or down
 * inside its column. A section can also be hidden and shown again. Nothing is resized and no section moves between columns, so the page always keeps its designed shape.
 *
 * The earlier arrangement (`ledger.home.layout.v1`: twelve cards, each half or full width) is NEVER changed or deleted by this file. When it holds a customized
 * layout and nothing newer has been saved, the new arrangement is DERIVED from it in memory (order and hidden cards carried over where they fit; widths cannot be) and the
 * page says so. Only an explicit change writes the new key (`ledger.home.layout.v2`), and "Use my earlier arrangement again" simply removes that new key.
 */
import { DEFAULT_LAYOUT, LAYOUT_KEY, sanitizeLayout, type HomeCard } from './homeLayout';

export const SECTION_IDS = ['analysis', 'cashflow', 'breakdown', 'recent', 'checkin', 'comingup', 'goals'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The wide analysis column and the narrow supporting column. A section always belongs to the same column. */
export const PRIMARY_IDS: readonly SectionId[] = ['analysis', 'cashflow', 'breakdown'];
export const SIDE_IDS: readonly SectionId[] = ['recent', 'checkin', 'comingup', 'goals'];

export const SECTION_TITLE: Record<SectionId, string> = {
  analysis: 'Spending & budget', cashflow: 'Income vs spending', breakdown: 'What you own and owe', recent: 'Recent transactions', comingup: 'Coming up', checkin: 'Monthly check-in', goals: 'Goals',
};

export interface HomeSections {
  /** Visible sections in the wide column, top to bottom. */
  primary: SectionId[];
  /** Visible sections in the narrow column, top to bottom. */
  side: SectionId[];
  /** Hidden sections (either column). */
  hidden: SectionId[];
}

export const SECTIONS_KEY = 'ledger.home.layout.v2';
/** Set when the owner dismisses the "your earlier layout was carried over" note. */
export const NOTICE_KEY = 'ledger.home.layoutNotice.v2';

export const DEFAULT_SECTIONS: HomeSections = { primary: [...PRIMARY_IDS], side: [...SIDE_IDS], hidden: [] };
export const copySections = (s: HomeSections): HomeSections => ({ primary: [...s.primary], side: [...s.side], hidden: [...s.hidden] });

const isSection = (x: unknown): x is SectionId => typeof x === 'string' && (SECTION_IDS as readonly string[]).includes(x);
const columnOf = (id: SectionId): 'primary' | 'side' => ((PRIMARY_IDS as readonly string[]).includes(id) ? 'primary' : 'side');

/**
 * Keeps only known sections, each once, in the column it belongs to. A hidden section stays hidden; a known section that is in no list (for example one added by a
 * later version) is appended to the end of its own column so it is never lost. Anything unusable gives the default.
 */
export function sanitizeSections(raw: unknown): HomeSections {
  const r = raw as { primary?: unknown; side?: unknown; hidden?: unknown } | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.primary) || !Array.isArray(r.side) || !Array.isArray(r.hidden)) return copySections(DEFAULT_SECTIONS);
  const seen = new Set<SectionId>();
  const take = (list: unknown[], col?: 'primary' | 'side'): SectionId[] => {
    const out: SectionId[] = [];
    for (const id of list) {
      if (!isSection(id) || seen.has(id) || (col && columnOf(id) !== col)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };
  const hidden = take(r.hidden);
  const primary = take(r.primary, 'primary');
  const side = take(r.side, 'side');
  for (const id of SECTION_IDS) if (!seen.has(id)) (columnOf(id) === 'primary' ? primary : side).push(id);
  return { primary, side, hidden };
}

export function moveSection(s: HomeSections, id: SectionId, by: -1 | 1): HomeSections {
  const next = copySections(s);
  const list = columnOf(id) === 'primary' ? next.primary : next.side;
  const i = list.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return s;
  [list[i], list[j]] = [list[j], list[i]];
  return next;
}

export function hideSection(s: HomeSections, id: SectionId): HomeSections {
  if (s.hidden.includes(id)) return s;
  return { primary: s.primary.filter((x) => x !== id), side: s.side.filter((x) => x !== id), hidden: [...s.hidden, id] };
}

/** A shown section goes to the end of its own column. */
export function showSection(s: HomeSections, id: SectionId): HomeSections {
  if (!s.hidden.includes(id)) return s;
  const next = { primary: [...s.primary], side: [...s.side], hidden: s.hidden.filter((x) => x !== id) };
  (columnOf(id) === 'primary' ? next.primary : next.side).push(id);
  return next;
}

// ---- the earlier arrangement ----

/** Which new section shows what an earlier card showed. The net-worth, month, Needs attention and Get started cards are part of the fixed top now. */
const FROM_CARD: Record<string, SectionId | undefined> = {
  spending: 'analysis', budget: 'analysis', cashflow: 'cashflow', breakdown: 'breakdown', recent: 'recent', comingup: 'comingup', checkin: 'checkin', goals: 'goals',
};
export const FIXED_CARDS = ['networth', 'month', 'attention', 'start'] as const;

export interface Derived {
  sections: HomeSections;
  /** Earlier cards that were removed but are now always shown (they are part of the fixed top). */
  nowAlwaysShown: string[];
}

/**
 * The new arrangement implied by an earlier saved layout: sections follow the earlier cards' order, a section none of whose cards were on the page is hidden, and
 * widths (half or full) are dropped. Spending by category and Budget progress are one section now: it sits where the first of the two was, and is hidden only when both were removed.
 */
export function deriveFromLegacy(legacy: readonly HomeCard[]): Derived {
  const order: SectionId[] = [];
  for (const c of legacy) {
    const id = FROM_CARD[c.id];
    if (id && !order.includes(id)) order.push(id);
  }
  const col = (ids: readonly SectionId[]) => [...ids].filter((id) => order.includes(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const hidden = SECTION_IDS.filter((id) => !order.includes(id));
  const nowAlwaysShown = FIXED_CARDS.filter((id) => !legacy.some((c) => c.id === id));
  return { sections: { primary: col(PRIMARY_IDS), side: col(SIDE_IDS), hidden: [...hidden] }, nowAlwaysShown: [...nowAlwaysShown] };
}

type Reader = Pick<Storage, 'getItem'>;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The earlier layout when the owner customized it (it differs from the earlier default in order or width), else null. Never writes. */
export function readCustomLegacy(store?: Reader): HomeCard[] | null {
  try {
    const text = (store ?? localStorage).getItem(LAYOUT_KEY);
    if (text == null) return null;
    const legacy = sanitizeLayout(JSON.parse(text));
    const same = legacy.length === DEFAULT_LAYOUT.length && legacy.every((c, i) => c.id === DEFAULT_LAYOUT[i].id && c.size === DEFAULT_LAYOUT[i].size);
    return same ? null : legacy;
  } catch {
    return null;
  }
}

export interface LoadedSections {
  sections: HomeSections;
  /** 'saved': the new key; 'carried': derived from a customized earlier layout (not yet written); 'default': nothing saved. */
  source: 'saved' | 'carried' | 'default';
  nowAlwaysShown: string[];
}

export function loadSections(store?: Reader): LoadedSections {
  try {
    const text = (store ?? localStorage).getItem(SECTIONS_KEY);
    if (text != null) return { sections: sanitizeSections(JSON.parse(text)), source: 'saved', nowAlwaysShown: [] };
  } catch { /* an unreadable value falls through to the earlier layout or the default */ }
  const legacy = readCustomLegacy(store);
  if (legacy) {
    const d = deriveFromLegacy(legacy);
    return { sections: d.sections, source: 'carried', nowAlwaysShown: d.nowAlwaysShown };
  }
  return { sections: copySections(DEFAULT_SECTIONS), source: 'default', nowAlwaysShown: [] };
}

export function saveSections(s: HomeSections, store?: Pick<Storage, 'setItem'>): void {
  try { (store ?? localStorage).setItem(SECTIONS_KEY, JSON.stringify(s)); } catch { /* private window: the arrangement lasts until the page closes */ }
}

/** "Use my earlier arrangement again": forgets only the NEW setting. The earlier key is not touched. */
export function forgetSections(store?: Pick<Store, 'removeItem'>): void {
  try { (store ?? localStorage).removeItem(SECTIONS_KEY); } catch { /* nothing to forget */ }
}

