import { groupModules } from '../core/moduleGroups';
import { routeQuickAdd, type Route, type RouteDef } from '../core/quickAddRoute';
import type { ModuleDef, QuickAddDef, QuickAddPreview } from '../core/registry';
import type { IconName } from '../ui/icons';

/**
 * D10: what the Add box SHOWS, as plain functions (no React, no database), so it can be tested without a browser.
 *
 * This file only arranges and labels things that already exist. It routes nothing, parses nothing and saves nothing: destinations come from each
 * module's own `contributes.quickAdd` (through `allQuickAdds`), the typed shortcut is still read by `routeQuickAdd`, and every destination's own `parse`,
 * `commit`, `Form` and `open` keep doing their work. The only things written down here are presentation choices: which three destinations get
 * the large cards, the one-line description on each card, an icon per destination, and the two specialised actions that open another Ledger screen.
 *
 * The groups are not stored anywhere and not listed here. A destination is grouped by the module that registered it, using the same grouping the
 * module switcher uses (`groupModules`), so a future module lands in its switcher group, or in "Other", and is never hidden.
 */

/** The destinations that get a large card, in this order, with the short line shown on the card. A design choice (no usage data), not a ranking. */
export const FEATURED: readonly { id: string; sub: string }[] = [
  { id: 'task', sub: 'A to-do, with a due date' },
  { id: 'event', sub: 'Goes on your calendar' },
  { id: 'transaction', sub: 'Money in or out' },
];

/** The two actions that open another Ledger screen. They create nothing in the box: they close it and navigate. */
export interface SpecialAction { id: 'trade' | 'paycheck'; label: string; path: string; icon: IconName }
export const SPECIAL_ACTIONS: readonly SpecialAction[] = [
  { id: 'trade', label: 'Log a trade', path: '/ledger/investments', icon: 'trend' },
  { id: 'paycheck', label: 'New paycheck scenario', path: '/ledger/paycheck', icon: 'calc' },
];

/** The icon of each known destination; a destination from a future module gets a plain plus. */
const DEST_ICON: Record<string, IconName> = {
  task: 'task', event: 'calendar', transaction: 'wallet', scheduled: 'repeat', project: 'folder', asset: 'box', service: 'gear',
  'household-service': 'wrench', 'bills-obligation': 'receipt', 'family-member': 'users', 'family-date': 'gift',
};
export const destIcon = (id: string): IconName => DEST_ICON[id] ?? 'plus';

const GROUP_ICON: Record<string, IconName> = { productivity: 'task', household: 'home', finances: 'chart' };

/** The chooser has always read Task, Event, Transaction, Scheduled payment first; destinations from other modules follow in module order. */
const ORDER = ['task', 'event', 'transaction', 'scheduled'];
export function orderDestinations<T extends { id: string }>(defs: readonly T[]): T[] {
  return [...defs].sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
}

export interface DestGroup<T> { key: string; label: string; icon: IconName; defs: T[] }
export interface Layout<T> {
  /** The large cards: only the featured destinations that are registered (a module that is off simply has no card). */
  featured: { def: T; sub: string }[];
  /** Every other destination, grouped by the module that registered it. Empty groups are left out. */
  groups: DestGroup<T>[];
}

/** Arranges the registered destinations. Every destination appears exactly once: as a card or in one group. */
export function layoutDestinations<T extends { id: string; moduleId?: string }>(defs: readonly T[], mods: readonly ModuleDef[]): Layout<T> {
  const featured: Layout<T>['featured'] = [];
  for (const f of FEATURED) {
    const def = defs.find((d) => d.id === f.id);
    if (def) featured.push({ def, sub: f.sub });
  }
  const isFeatured = new Set(featured.map((f) => f.def.id));
  const groupOf = new Map<string, { key: string; label: string }>();
  for (const g of groupModules(mods)) for (const m of g.modules) groupOf.set(m.id, { key: g.key, label: g.label ?? 'Other' });
  const groups: DestGroup<T>[] = [];
  const bucket = (key: string, label: string) => {
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label, icon: GROUP_ICON[key] ?? 'plus', defs: [] }));
    return g;
  };
  for (const def of defs) {
    if (isFeatured.has(def.id)) continue;
    const at = (def.moduleId && groupOf.get(def.moduleId)) || { key: 'other', label: 'Other' };
    bucket(at.key, at.label).defs.push(def);
  }
  // Group order follows the switcher's order (Productivity, Household, Finances), "Other" last.
  const rank = groupModules(mods).map((g) => g.key);
  groups.sort((a, b) => (rank.indexOf(a.key) + 1 || 99) - (rank.indexOf(b.key) + 1 || 99));
  return { featured, groups };
}

/** What kind of control the destination needs. `text` is typed and previewed; the others show a form or open another screen. */
export type DestKind = 'text' | 'form' | 'open' | 'none';
export function destKind(d: Pick<QuickAddDef, 'parse' | 'Form' | 'open'> | null): DestKind {
  if (!d) return 'none';
  return d.parse ? 'text' : d.Form ? 'form' : d.open ? 'open' : 'none';
}

/** The text field is shown while nothing is chosen and for a typed destination; a form or another screen hides it (as before D10). */
export const showsInput = (d: Pick<QuickAddDef, 'parse'> | null): boolean => !d || !!d.parse;

/** The line under the command field. */
export type FeedbackKind = 'choose' | 'ask' | 'type' | 'preview' | 'nothing' | 'panel';
export function feedbackKind(input: { dest: Pick<QuickAddDef, 'parse'> | null; text: string; body: string; preview: QuickAddPreview | null }): FeedbackKind {
  const { dest, text, body, preview } = input;
  if (!dest) return text.trim() === '' ? 'choose' : 'ask';
  if (!dest.parse) return 'panel';
  if (body.trim() === '') return 'type';
  return preview ? 'preview' : 'nothing';
}

/** The one primary button in the footer. A destination that is a form (a transaction) has its own Save, so the footer offers nothing there. */
export interface Primary { kind: 'submit' | 'open' | 'none'; label: string; disabled: boolean }
export function primaryAction(input: { dest: Pick<QuickAddDef, 'label' | 'parse' | 'Form' | 'open' | 'openCopy'> | null; preview: QuickAddPreview | null; busy: boolean }): Primary {
  const { dest, preview, busy } = input;
  if (!dest) return { kind: 'submit', label: 'Add', disabled: true };
  if (dest.parse) return { kind: 'submit', label: busy ? 'Adding…' : `Add ${dest.label.toLowerCase()}`, disabled: !preview || busy };
  if (dest.open) return { kind: 'open', label: dest.openCopy?.button ?? 'Open the form', disabled: false };
  return { kind: 'none', label: '', disabled: true };
}

/** "t task · e event · $ transaction": the shortcuts of the featured destinations (the other shortcuts are shown on their own buttons). */
export function shortcutHint(layout: Layout<{ prefix: string; label: string }>): string {
  return layout.featured.map(({ def }) => `${def.prefix} ${def.label.toLowerCase()}`).join(' · ');
}

/**
 * Which destination is chosen, and what is the text without its shortcut. A typed shortcut (read by `routeQuickAdd`, the one router) wins over a button choice;
 * otherwise the choice made with a card or chip (or by `openAddBox({ dest })`) applies. Nothing is guessed: with neither, the destination is null.
 */
export function resolveDestination<T extends RouteDef>(defs: readonly T[], text: string, choice: string | null): { dest: T | null; body: string; routed: Route<T> } {
  const routed = routeQuickAdd(text, defs);
  return { dest: routed.def ?? defs.find((d) => d.id === choice) ?? null, body: routed.def ? routed.rest : text, routed };
}
