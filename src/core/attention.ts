/**
 * R1.1 "Needs you": ONE read-only, ranked, explainable list of what needs the household's attention. PURE (no React, no database, no clock).
 *
 * This file defines the contract and the rules. It owns NO calculation: every module keeps deciding for itself what is overdue, broken or worth a
 * look, and hands over what it already works out as `AttentionItem`s (through `contributes.attention`, see registry.ts). Nothing here is stored,
 * synced or backed up, and nothing here changes a record. An item disappears when the condition behind it is resolved, because it is read again.
 *
 * RANKING (documented here, shown to the person as words, pinned by tests):
 *   Tier 1  Overdue, broken or urgent: kind `overdue` or `broken`; an item whose source marked it `serious` (for example a Ledger "warn" alert, a
 *           disagreeing billing record), even with no date; a deadline whose date has already passed.
 *   Tier 2  Actionable with a deadline from today through seven days ahead (`kind: 'deadline'` with a date in that window).
 *   Tier 3  Everything else that is unresolved and needs a look: `review`, and a `deadline` that is more than seven days away or has no date.
 *   Tier 4  Informational (`kind: 'info'`). No module emits these today: an informational item is left out unless it truly needs action.
 *   Within a tier: the relevant date (earliest first; no date last), then module id, then item id, compared character by character, so the order
 *   is the same on every device and in every language. A missing date is NEVER invented, and urgency is never guessed from missing information.
 *
 * IDENTITY (documented here, pinned by tests):
 *   - `id` is namespaced `<moduleId>:<...>` and stable (built from record ids and condition names, never from wording), so it is the list key.
 *   - Two items with the same `id` are one item (the same source reporting it twice).
 *   - Two items with the same non-null `condition` are two views of ONE unresolved source condition and are shown once (the more urgent one is kept
 *     and `alsoFrom` names the other modules). `condition` is a canonical name for the condition itself, for example `task:12:overdue`.
 *   - Everything else stays separate, including two different unresolved actions on the same record (a finished visit not logged AND the same
 *     record's completed task not saved to asset history) and a renewal and a notice deadline on the same day.
 *   - Wording, titles and reasons are NEVER compared. Similar text is not a duplicate.
 *
 * PRIVACY: titles and reasons are plain words, counts, dates and the household's own record names. Never an amount: `containsMoney` is checked on every
 * item, and an item that fails validation is dropped rather than shown.
 */
import type { ComponentType, ReactNode } from 'react';

/** What kind of unresolved thing this is, as the source module knows it. Urgency is derived from this plus the date (see `tierOf`). */
export type AttentionKind = 'overdue' | 'broken' | 'deadline' | 'review' | 'info';

export interface AttentionItem {
  /** `<moduleId>:<stable parts>`. The list key. Never built from titles or wording. */
  id: string;
  moduleId: string;
  /** The record this is about in its own module, for example `task:12`, `arrangement:3`, or null when it is about several records. */
  recordId: string | null;
  /** Canonical name of the underlying condition, shared by modules that report the same one (`task:12:overdue`). null when only one module can raise it. */
  condition: string | null;
  kind: AttentionKind;
  /** Set only when the SOURCE module already treats this as serious (a Ledger "warn" alert; a disagreeing billing record). Never invented here. */
  severity?: 'serious';
  /** The source's own severity word, for the explanation ("warn", "disagree"). */
  sourceSeverity?: string;
  /** The relevant date (YYYY-MM-DD) when the source knows one: the due, end, renewal or target date. */
  date: string | null;
  /** Short and specific. A record's own name or a plain phrase. No amounts. */
  title: string;
  /** One plain-English sentence on why this needs attention. No amounts. */
  reason: string;
  /** Where to act: a hash address inside Ledger (`#/assets/4`). */
  href: string;
  /** Which existing reader produced this, in plain words (shown in the explanation). */
  provenance: string;
  /** For an item that stands for several records of one kind ("3 payments need a second look"). */
  count?: number;
}

export type AttentionTier = 1 | 2 | 3 | 4;
export const TIER_WORDS: Record<AttentionTier, string> = { 1: 'Overdue or urgent', 2: 'Due within 7 days', 3: 'Needs review', 4: 'For information' };
/** The window for tier 2, both ends included (today through today + 7). */
export const SOON_DAYS = 7;
/** How many items Today shows before "See all". */
export const PREVIEW_COUNT = 5;

export interface RankedAttention extends AttentionItem {
  tier: AttentionTier;
  /** Other modules that reported the same condition (see IDENTITY above). */
  alsoFrom: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysFrom = (to: string, from: string) => dayNumber(to) - dayNumber(from);
/** A real calendar date: `2026-02-31` is not (it would silently roll into March), so it must survive a round trip. */
const validDate = (d: string | null): d is string => {
  if (d === null || !ISO.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
};

/** Which tier an item belongs to today. See the header. Pure and total: an unknown or missing date never throws and never raises urgency. */
export function tierOf(item: Pick<AttentionItem, 'kind' | 'severity' | 'date'>, today: string): AttentionTier {
  if (item.kind === 'overdue' || item.kind === 'broken' || item.severity === 'serious') return 1;
  if (item.kind === 'info') return 4;
  if (item.kind === 'deadline' && validDate(item.date)) {
    const d = daysFrom(item.date, today);
    if (d < 0) return 1;
    if (d <= SOON_DAYS) return 2;
  }
  return 3;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Deterministic order: tier, then date (earliest first, none last), then module id, then item id. Input order never matters. */
export function compareRanked(a: RankedAttention, b: RankedAttention): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const da = validDate(a.date) ? a.date : null;
  const db = validDate(b.date) ? b.date : null;
  if (da !== db) return da === null ? 1 : db === null ? -1 : cmp(da, db);
  return cmp(a.moduleId, b.moduleId) || cmp(a.id, b.id);
}

/**
 * Removes duplicates by the identity rules in the header: same `id`, or same non-null `condition`. The kept item is the one in the lowest tier (most
 * urgent); a tie goes to the lower module id, then the lower item id. Titles and reasons are never looked at.
 */
export function dedupeAttention(items: readonly AttentionItem[], today: string): RankedAttention[] {
  const ranked: RankedAttention[] = items.map((i) => ({ ...i, tier: tierOf(i, today), alsoFrom: [] }));
  const pick = (group: RankedAttention[]): RankedAttention => group.reduce((best, x) => (tierFirst(x, best) < 0 ? x : best));
  // pass 1: same id
  const byId = new Map<string, RankedAttention[]>();
  for (const r of ranked) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  const once = [...byId.values()].map(pick);
  // pass 2: same condition (items with no condition are never merged)
  const out: RankedAttention[] = [];
  const byCondition = new Map<string, RankedAttention[]>();
  for (const r of once) {
    if (r.condition === null) out.push(r);
    else byCondition.set(r.condition, [...(byCondition.get(r.condition) ?? []), r]);
  }
  for (const group of byCondition.values()) {
    const keep = pick(group);
    const others = [...new Set(group.filter((g) => g !== keep).map((g) => g.moduleId).filter((m) => m !== keep.moduleId))].sort(cmp);
    out.push({ ...keep, alsoFrom: others });
  }
  return out;
}
/** Lower is better: tier, then module id, then item id. */
const tierFirst = (a: RankedAttention, b: RankedAttention) => (a.tier - b.tier) || cmp(a.moduleId, b.moduleId) || cmp(a.id, b.id);

/** The whole pipeline: de-duplicate, then order. The only function the screens call. */
export function rankAttention(items: readonly AttentionItem[], today: string): RankedAttention[] {
  return dedupeAttention(items, today).sort(compareRanked);
}

export interface AttentionPreview { shown: RankedAttention[]; total: number; remaining: number }
/** The first `limit` items and the true count of the rest ("See all (N)" uses `total`). */
export function previewAttention(ranked: readonly RankedAttention[], limit = PREVIEW_COUNT): AttentionPreview {
  return { shown: ranked.slice(0, limit), total: ranked.length, remaining: Math.max(0, ranked.length - limit) };
}

// ---- words ----

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The tier as the person reads it, with the date where one is known: "Overdue", "Due today", "Due in 3 days", "Needs review". */
export function whenWords(item: Pick<RankedAttention, 'tier' | 'kind' | 'date'>, today: string): string {
  const d = validDate(item.date) ? daysFrom(item.date, today) : null;
  if (item.tier === 1) return d !== null && d < 0 && (item.kind === 'overdue' || item.kind === 'deadline') ? `${plural(-d, 'day')} overdue` : item.kind === 'overdue' ? 'Overdue' : 'Urgent';
  if (item.tier === 2 && d !== null) return d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
  if (item.tier === 4) return 'For information';
  // a dated deadline that is still more than a week away says so, instead of the generic "Needs review"
  if (item.kind === 'deadline' && d !== null && d > SOON_DAYS) return `Due in ${d} days`;
  return 'Needs review';
}

// ---- safety ----

/** True when the text carries an amount of money: a currency symbol, or a figure with two decimals. */
export const containsMoney = (text: string): boolean => /[$€£¥]|\bUSD\b|\d[\d,]*\.\d{2}\b/i.test(text);

/** Hash addresses Needs you may link to: inside Ledger, never an external address. */
export const isInternalHref = (href: string): boolean => /^#\/[a-z][a-z0-9-]*(?:[/?#].*)?$/.test(href);

/** Why an item is not acceptable, or null when it is. Used when items arrive from a module and in the tests of every adapter. */
export function attentionProblem(moduleId: string, i: AttentionItem): string | null {
  if (i.moduleId !== moduleId) return 'wrong module';
  if (!i.id.startsWith(`${moduleId}:`) || i.id.length <= moduleId.length + 1) return 'id is not namespaced';
  if (i.date !== null && !validDate(i.date)) return 'bad date';
  if (!i.title.trim() || !i.reason.trim()) return 'empty title or reason';
  if (!isInternalHref(i.href)) return 'bad link';
  if (containsMoney(i.title) || containsMoney(i.reason)) return 'shows an amount';
  if (i.count !== undefined && !(Number.isInteger(i.count) && i.count > 0)) return 'bad count';
  return null;
}
/** Keeps only acceptable items (a bad one is dropped, never shown, and reported to the console so it can be fixed). */
export function acceptableAttention(moduleId: string, items: readonly AttentionItem[], report: (msg: string) => void = (m) => console.error(m)): AttentionItem[] {
  return items.filter((i) => {
    const p = attentionProblem(moduleId, i);
    if (p) report(`Needs you: dropped "${i.id}" from ${moduleId} (${p}).`);
    return !p;
  });
}

export { plural as attentionPlural };

// ---- the registry contribution ----

/** What one source reports on one render. `ready` is false until its first read finishes; `failed` means the read threw (the rest of the list still shows). */
export interface AttentionRead { items: AttentionItem[]; ready: boolean; failed?: boolean }
/**
 * What a module offers through `contributes.attention` (see registry.ts and docs/module-hooks.md). READ ONLY.
 * `useItems` is a React hook so a source whose logic already lives in a hook (Ledger's alerts) is used as it is, without a second copy of its
 * rules. Every other module builds it with `liveAttention(read)` (liveAttention.ts) from a plain async reader that calls its existing loader.
 * The registry is fixed at start-up, so the hooks run in the same order on every render.
 */
export interface AttentionSource {
  useItems(today: string): AttentionRead;
  /**
   * Optional. Wraps the screen that shows "Needs you", for a source whose reader needs state shared with something else on that screen (Ledger shares ONE copy of its alert
   * hook with its own Today card). The wrapped children must be the same element on every render, so only consumers re-render. See `AttentionProviders`.
   */
  Provider?: ComponentType<{ today: string; children: ReactNode }>;
}
