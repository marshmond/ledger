/**
 * D13.1: how Today is composed. PURE (no React, no database, no clock) apart from the small storage readers at the bottom.
 *
 * Today is no longer a grid of equally weighted half and full width cards. It is a fixed top (the Next up bar and the status band) followed
 * by two columns: a wide AGENDA column (Today, Reminders due, Overdue, Coming up, always in that order) and a narrow SUPPORTING column of
 * sections that can be moved up or down and hidden. Nothing is resized and nothing moves between columns, so the page always keeps its designed shape.
 *
 * The cards themselves are still the registered cards (ids, titles, providers and "hide when empty" rules are untouched); only where they are placed changed.
 * The five "attention" cards (Bills, Household finances, Home & Assets, Household services, Projects) share one visual group, "Household status",
 * which moves as one section; each card in it can still be hidden on its own.
 *
 * The earlier arrangement (`today.layout.v1`: every card with an order, half or full width, and a hidden flag) is NEVER changed or deleted by this file.
 * When it holds a customized layout and nothing newer has been saved, the new arrangement is DERIVED from it in memory (order and hidden cards carried over
 * where they fit; widths cannot be) and the page says so. Only an explicit change writes the new key (`today.layout.v2`).
 */
import { defaultLayout, resolveLayout, LAYOUT_KEY, type CardInfo, type LayoutEntry } from './layout';

/** The wide column. Always these, always in this order (a card that is not registered is simply absent). */
export const AGENDA_IDS = ['today.agenda', 'today.reminders', 'today.overdue', 'today.upcoming'] as const;

/** The cards drawn together as "Household status", in the order they appear inside it. */
export const STATUS_GROUP_IDS = ['bills.attention', 'household.attention', 'assets.attention', 'services.attention', 'projects.attention'] as const;
export const STATUS_UNIT = 'group:status';
export const STATUS_TITLE = 'Household status';

/** The designed order of the supporting column (anything else a module adds later follows, in registry order). */
export const DEFAULT_SIDE_ORDER = ['ledger.attention', 'ledger.cash', STATUS_UNIT] as const;

export const ARRANGEMENT_KEY = 'today.layout.v2';
/** Set when the owner dismisses the "your earlier layout was carried over" note. */
export const NOTICE_KEY = 'today.layoutNotice.v2';

export interface TodayArrangement {
  /** Supporting sections (unit ids), top to bottom. */
  side: string[];
  /** Cards (not units) the owner hid. */
  hidden: string[];
}

export type ArrangementCard = Pick<CardInfo, 'id' | 'priority'>;

export interface SideUnit {
  id: string;
  /** One card, or the members of the Household status group in their fixed order. */
  cardIds: string[];
  group: boolean;
}

const isAgenda = (id: string) => (AGENDA_IDS as readonly string[]).includes(id);
const isStatus = (id: string) => (STATUS_GROUP_IDS as readonly string[]).includes(id);

/** Every supporting section that exists for these registered cards, in the DESIGNED default order. */
export function sideUnits(cards: readonly ArrangementCard[]): SideUnit[] {
  const sorted = [...cards].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const have = new Set(cards.map((c) => c.id));
  const units = new Map<string, SideUnit>();
  const members = STATUS_GROUP_IDS.filter((id) => have.has(id));
  if (members.length > 0) units.set(STATUS_UNIT, { id: STATUS_UNIT, cardIds: [...members], group: true });
  for (const c of sorted) if (!isAgenda(c.id) && !isStatus(c.id)) units.set(c.id, { id: c.id, cardIds: [c.id], group: false });
  const out: SideUnit[] = [];
  for (const id of DEFAULT_SIDE_ORDER) { const u = units.get(id); if (u) { out.push(u); units.delete(id); } }
  for (const c of sorted) { const u = units.get(c.id); if (u) { out.push(u); units.delete(c.id); } }
  return out;
}

/** The agenda cards that are registered, in their fixed order. */
export const agendaIds = (cards: readonly ArrangementCard[]): string[] => AGENDA_IDS.filter((id) => cards.some((c) => c.id === id));

export const defaultArrangement = (cards: readonly ArrangementCard[]): TodayArrangement => ({ side: sideUnits(cards).map((u) => u.id), hidden: [] });
export const copyArrangement = (a: TodayArrangement): TodayArrangement => ({ side: [...a.side], hidden: [...a.hidden] });

/**
 * Keeps only sections and cards that exist now, each once. A section that exists but is in no saved list (for example a card a later version adds) is
 * appended in its designed place so it is never lost. Anything unusable gives the default.
 */
export function sanitizeArrangement(raw: unknown, cards: readonly ArrangementCard[]): TodayArrangement {
  const r = raw as { side?: unknown; hidden?: unknown } | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.side) || !Array.isArray(r.hidden)) return defaultArrangement(cards);
  const units = sideUnits(cards);
  const known = new Set(units.map((u) => u.id));
  const side: string[] = [];
  for (const id of r.side) if (typeof id === 'string' && known.has(id) && !side.includes(id)) side.push(id);
  for (const u of units) if (!side.includes(u.id)) side.push(u.id);
  const cardIds = new Set(cards.map((c) => c.id));
  const hidden: string[] = [];
  for (const id of r.hidden) if (typeof id === 'string' && cardIds.has(id) && !hidden.includes(id)) hidden.push(id);
  return { side, hidden };
}

/**
 * Moves a supporting section up or down. The agenda column has nothing to move. `skip` names sections that are not in the visible list right now (on a phone,
 * Cash outlook is shown in the agenda column), so one step moves past the next section that IS visible instead of swapping with an invisible one.
 */
export function moveUnit(a: TodayArrangement, unitId: string, by: -1 | 1, skip: readonly string[] = []): TodayArrangement {
  const i = a.side.indexOf(unitId);
  if (i < 0) return a;
  let j = i + by;
  while (j >= 0 && j < a.side.length && skip.includes(a.side[j])) j += by;
  if (j < 0 || j >= a.side.length) return a;
  const next = copyArrangement(a);
  [next.side[i], next.side[j]] = [next.side[j], next.side[i]];
  return next;
}

export const hideCard = (a: TodayArrangement, id: string): TodayArrangement => (a.hidden.includes(id) ? a : { side: [...a.side], hidden: [...a.hidden, id] });
export const showCard = (a: TodayArrangement, id: string): TodayArrangement => ({ side: [...a.side], hidden: a.hidden.filter((x) => x !== id) });

// ---- the earlier arrangement ----

/** True when the earlier saved layout differs from the earlier default in order, width or a hidden card. */
export function isCustomLegacy(legacy: readonly LayoutEntry[], cards: readonly CardInfo[]): boolean {
  const base = defaultLayout([...cards]);
  if (legacy.length !== base.length) return true;
  return legacy.some((e, i) => e.id !== base[i].id || e.size !== base[i].size || e.hidden !== base[i].hidden);
}

/**
 * The arrangement implied by an earlier saved layout: sections follow the earlier cards' order (a group sits where its first card was), every card that was
 * hidden stays hidden, and widths (half or full) are dropped because the columns now decide them.
 */
export function deriveFromLegacy(legacy: readonly LayoutEntry[], cards: readonly ArrangementCard[]): TodayArrangement {
  const units = sideUnits(cards);
  const first = (u: SideUnit) => Math.min(...u.cardIds.map((id) => { const i = legacy.findIndex((e) => e.id === id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; }));
  const ordered = [...units].sort((a, b) => first(a) - first(b));
  const cardIds = new Set(cards.map((c) => c.id));
  return { side: ordered.map((u) => u.id), hidden: legacy.filter((e) => e.hidden && cardIds.has(e.id)).map((e) => e.id) };
}

// ---- what to draw ----

export interface PlacedCard {
  id: string;
  hidden: boolean;
  /** True for a card drawn in the agenda column only on a phone (see PHONE_PROMOTED). */
  promoted?: boolean;
}
export interface PlacedUnit { id: string; group: boolean; cards: PlacedCard[] }
export interface Composition {
  agenda: PlacedCard[];
  side: PlacedUnit[];
}

/**
 * D13.1 final mobile correction. On a PHONE the approved D3.1 order is Overdue, Cash outlook, Coming up, Needs attention, Household status, so Cash outlook is drawn
 * once, in the agenda column right after Overdue, instead of in the supporting column. On a computer and a tablet nothing moves. The card is the same registered card
 * (same provider, Hide amounts and "hide when empty" behavior); it is rendered in ONE place at a time, so the reading order and the Tab order are the visual order.
 * The saved arrangement is not changed: the position the owner gave Cash outlook in the side column still applies everywhere else, and Hide still applies on a phone.
 */
export const PHONE_PROMOTED = { id: 'ledger.cash', after: 'today.overdue' } as const;

/** Everything Today draws below the status band, in order. Hidden cards are marked, not removed (Edit layout shows them so they can be brought back). */
export function composeToday(cards: readonly ArrangementCard[], a: TodayArrangement, opts: { phone?: boolean } = {}): Composition {
  const hidden = new Set(a.hidden);
  const units = new Map(sideUnits(cards).map((u) => [u.id, u]));
  const promote = !!opts.phone && cards.some((c) => c.id === PHONE_PROMOTED.id);
  const side: PlacedUnit[] = [];
  for (const id of a.side) {
    if (promote && id === PHONE_PROMOTED.id) continue;
    const u = units.get(id);
    if (u) side.push({ id: u.id, group: u.group, cards: u.cardIds.map((c) => ({ id: c, hidden: hidden.has(c) })) });
  }
  const agenda: PlacedCard[] = agendaIds(cards).map((id) => ({ id, hidden: hidden.has(id) }));
  if (promote) {
    const at = agenda.findIndex((c) => c.id === PHONE_PROMOTED.after);
    const upcoming = agenda.findIndex((c) => c.id === 'today.upcoming');
    const index = at >= 0 ? at + 1 : upcoming >= 0 ? upcoming : agenda.length;
    agenda.splice(index, 0, { id: PHONE_PROMOTED.id, hidden: hidden.has(PHONE_PROMOTED.id), promoted: true });
  }
  return { agenda, side };
}

/** The title Edit layout shows for a section. */
export const unitTitle = (u: PlacedUnit, titleOf: (cardId: string) => string): string => (u.group ? STATUS_TITLE : titleOf(u.cards[0].id));

// ---- storage ----

export type ArrangementSource = 'default' | 'saved' | 'derived';
export interface LoadedArrangement {
  arrangement: TodayArrangement;
  source: ArrangementSource;
}

type ReadStore = Pick<Storage, 'getItem'>;

/** What is saved now: the new key if present; else the earlier layout carried over (when it was customized); else the designed default. */
export function loadArrangement(cards: readonly CardInfo[], store: ReadStore = localStorage): LoadedArrangement {
  try {
    const text = store.getItem(ARRANGEMENT_KEY);
    if (text != null) return { arrangement: sanitizeArrangement(JSON.parse(text), cards), source: 'saved' };
  } catch { /* unreadable: fall through to the earlier layout, then the default */ }
  const legacy = readLegacy(cards, store);
  if (legacy && isCustomLegacy(legacy, cards)) return { arrangement: deriveFromLegacy(legacy, cards), source: 'derived' };
  return { arrangement: defaultArrangement(cards), source: 'default' };
}

/** The earlier layout as the page would have read it (null when nothing usable was saved). Read only. */
export function readLegacy(cards: readonly CardInfo[], store: ReadStore = localStorage): LayoutEntry[] | null {
  try {
    const text = store.getItem(LAYOUT_KEY);
    return text == null ? null : resolveLayout(JSON.parse(text), [...cards]);
  } catch { return null; }
}

export function saveArrangement(a: TodayArrangement, store: Pick<Storage, 'setItem'> = localStorage): void {
  try { store.setItem(ARRANGEMENT_KEY, JSON.stringify(a)); } catch { /* private window: the arrangement lasts until the page closes */ }
}
/** Removes ONLY the new key, so the earlier layout (if any) is carried over again. */
export function forgetArrangement(store: Pick<Storage, 'removeItem'> = localStorage): void {
  try { store.removeItem(ARRANGEMENT_KEY); } catch { /* nothing saved to remove */ }
}
