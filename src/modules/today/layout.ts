/**
 * Which cards Today shows, in what order and width. Saved on THIS device only (browser storage), like Ledger Home's layout.
 * Cards come from the module registry, so a card a module adds later appears by itself, and a card that disappears is ignored.
 */
export type CardSize = 'half' | 'full';
export interface LayoutEntry {
  id: string;
  size: CardSize;
  hidden: boolean;
}
/** What a registered card says about itself; enough to build the default layout. */
export interface CardInfo {
  id: string;
  defaultWidth: CardSize;
  priority: number;
}

export const LAYOUT_KEY = 'today.layout.v1';
export const HIDE_AMOUNTS_KEY = 'today.hideAmounts.v1';

/** The layout with nothing saved: every card, in priority order, at its default width. */
export function defaultLayout(cards: CardInfo[]): LayoutEntry[] {
  return [...cards].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map((c) => ({ id: c.id, size: c.defaultWidth, hidden: false }));
}

/**
 * Merges what was saved with the cards that exist now: saved order and choices win; unknown ids are dropped; cards that were never
 * saved (a new module) are added at the end at their default width. Bad data falls back to the default.
 */
export function resolveLayout(saved: unknown, cards: CardInfo[]): LayoutEntry[] {
  if (!Array.isArray(saved)) return defaultLayout(cards);
  const known = new Map(cards.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: LayoutEntry[] = [];
  for (const item of saved) {
    const r = item as { id?: unknown; size?: unknown; hidden?: unknown };
    if (typeof r?.id !== 'string' || seen.has(r.id) || !known.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, size: r.size === 'full' || r.size === 'half' ? r.size : known.get(r.id)!.defaultWidth, hidden: r.hidden === true });
  }
  for (const e of defaultLayout(cards)) if (!seen.has(e.id)) out.push(e);
  return out;
}

export function loadLayout(cards: CardInfo[], store: Pick<Storage, 'getItem'> = localStorage): LayoutEntry[] {
  try {
    const text = store.getItem(LAYOUT_KEY);
    return text == null ? defaultLayout(cards) : resolveLayout(JSON.parse(text), cards);
  } catch {
    return defaultLayout(cards);
  }
}
export function saveLayout(layout: LayoutEntry[], store: Pick<Storage, 'setItem'> = localStorage): void {
  try { store.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* private window: the layout lasts until the page closes */ }
}
export function resetLayout(store: Pick<Storage, 'removeItem'> = localStorage): void {
  try { store.removeItem(LAYOUT_KEY); } catch { /* nothing saved to remove */ }
}

export function moveEntry(layout: LayoutEntry[], id: string, by: -1 | 1): LayoutEntry[] {
  const i = layout.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const next = [...layout];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
export const toggleEntrySize = (layout: LayoutEntry[], id: string): LayoutEntry[] => layout.map((c) => (c.id === id ? { ...c, size: c.size === 'full' ? 'half' : 'full' } : c));
export const toggleEntryHidden = (layout: LayoutEntry[], id: string): LayoutEntry[] => layout.map((c) => (c.id === id ? { ...c, hidden: !c.hidden } : c));

export function loadHideAmounts(store: Pick<Storage, 'getItem'> = localStorage): boolean {
  try { return store.getItem(HIDE_AMOUNTS_KEY) === '1'; } catch { return false; }
}
export function saveHideAmounts(on: boolean, store: Pick<Storage, 'setItem'> = localStorage): void {
  try { store.setItem(HIDE_AMOUNTS_KEY, on ? '1' : '0'); } catch { /* private window: lasts until the page closes */ }
}
