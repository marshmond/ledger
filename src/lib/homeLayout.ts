/** Which cards the Home page shows, in what order and width. Saved per device (browser storage), not synced. */

export type CardSize = 'half' | 'full';
export interface HomeCard {
  id: string;
  size: CardSize;
}

export const CARD_IDS = ['start', 'networth', 'attention', 'month', 'spending', 'budget', 'cashflow', 'breakdown', 'recent', 'comingup', 'checkin', 'goals'] as const;

export const DEFAULT_LAYOUT: HomeCard[] = [
  { id: 'start', size: 'full' },
  { id: 'networth', size: 'half' },
  { id: 'attention', size: 'half' },
  { id: 'month', size: 'half' },
  { id: 'spending', size: 'half' },
  { id: 'budget', size: 'half' },
  { id: 'cashflow', size: 'half' },
  { id: 'breakdown', size: 'half' },
  { id: 'recent', size: 'half' },
  { id: 'comingup', size: 'half' },
  { id: 'checkin', size: 'half' },
  { id: 'goals', size: 'half' },
];

export const LAYOUT_KEY = 'ledger.home.layout.v1';

/** Keeps only known cards, once each, with a valid size. Anything unusable falls back to the default layout. */
export function sanitizeLayout(raw: unknown): HomeCard[] {
  if (!Array.isArray(raw)) return DEFAULT_LAYOUT.map((c) => ({ ...c }));
  const seen = new Set<string>();
  const out: HomeCard[] = [];
  for (const item of raw) {
    const id = (item as { id?: unknown })?.id;
    if (typeof id !== 'string' || seen.has(id) || !(CARD_IDS as readonly string[]).includes(id)) continue;
    seen.add(id);
    out.push({ id, size: (item as { size?: unknown }).size === 'full' ? 'full' : 'half' });
  }
  return out;
}

export function loadLayout(): HomeCard[] {
  try {
    const text = localStorage.getItem(LAYOUT_KEY);
    return text == null ? DEFAULT_LAYOUT.map((c) => ({ ...c })) : sanitizeLayout(JSON.parse(text));
  } catch {
    return DEFAULT_LAYOUT.map((c) => ({ ...c }));
  }
}

export function saveLayout(layout: HomeCard[]): void {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* private window: the layout lasts until the page closes */ }
}

/** Moves a card one place earlier (-1) or later (+1). Returns a new list. */
export function moveCard(layout: HomeCard[], id: string, by: -1 | 1): HomeCard[] {
  const i = layout.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const next = [...layout];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function removeCard(layout: HomeCard[], id: string): HomeCard[] {
  return layout.filter((c) => c.id !== id);
}

/** Adds a card at the end (once). */
export function addCard(layout: HomeCard[], id: string, size: CardSize = 'half'): HomeCard[] {
  if (layout.some((c) => c.id === id) || !(CARD_IDS as readonly string[]).includes(id)) return layout;
  return [...layout, { id, size }];
}

export function toggleSize(layout: HomeCard[], id: string): HomeCard[] {
  return layout.map((c) => (c.id === id ? { ...c, size: c.size === 'full' ? 'half' : 'full' } : c));
}
