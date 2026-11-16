/**
 * R4.1 "Records": ONE read-only shape for the document REFERENCES the household modules already store (a label, an optional web link and an optional note on an asset, a
 * warranty, a service record, an arrangement, a visit or a bill). PURE (no React, no database, no clock). It is not a document store: Ledger keeps no files, makes no
 * second copy of a reference and writes nothing. Each module reads its OWN records and hands back `DocumentRef`s through `contributes.documentRefs` (registry.ts), so no
 * module imports another and the shell imports none. The record stays the single source of truth; the Records screen and Search only point at it.
 *
 * LINKS. A stored link is made actionable ONLY when `isSafeUrl` (lib/safeUrl.ts: absolute http or https) accepts it. Anything else is `review`: the reference is still listed,
 * but with no clickable address, and the owner is sent to the record. The stored text is never rewritten, and no link is ever fetched to see whether it still works.
 *
 * IDENTITY. `id` is `<owner id>#<position>`, so two references with the same label on different records (or twice on one record) are always different rows. The position
 * is the reference's place in its record's list, so an id lasts only until that list is edited.
 */
import { norm } from '../lib/search';
import { dayLabel } from './time';
import { isSafeUrl } from '../lib/safeUrl';

/** What a stored reference looks like in every module: `{ label, url?, note? }`. */
export interface RawDocRef { label: string; url?: string; note?: string }

/** `open` = a safe http(s) address to open; `label-only` = a name and note but no address (a paper copy, say); `review` = an address is stored but is not a safe one. */
export type DocLinkState = 'open' | 'label-only' | 'review';

export interface DocumentRef {
  /** Unique across the whole index: `<module>:<kind>:<record id>#<position>`. */
  id: string;
  moduleId: string;
  /** The module's name in words ("Home & Assets"). */
  sourceLabel: string;
  /** The reference's own name, as typed. */
  label: string;
  note: string;
  link: DocLinkState;
  /** The safe address to open. Present only when `link` is `open`; an unsafe or empty address is never carried. */
  href: string | null;
  /** The site name only (for telling two links apart); never the full address. */
  host: string;
  /** The household item or arrangement it belongs to ("Dishwasher", "Weekly cleaning", "Streamly"). */
  ownerName: string;
  /** What kind of record holds the reference ("Appliance", "Warranty", "Service record", "Arrangement", "Visit", "Bill", "Subscription"). */
  recordKind: string;
  /** The sub-record's own name when it is not the item itself ("Manufacturer warranty"). Empty when the item holds the reference. */
  recordName: string;
  /** A little more about where it sits ("Kitchen", "Mon 3 Nov 2026 · Sparkle Clean"). Never a sensitive field. */
  context: string;
  /** "Archived", "Ended", "Sold" and the like; empty for an ordinary record. */
  status: string;
  /** Full in-app address of the record that holds the reference (`/assets/4?warranty=7`). */
  recordPath: string;
  /** The button words for it ("View appliance"). */
  recordAction: string;
  /** An end date that explicitly belongs to this reference's own record (a warranty's end date). Never worked out, never taken from a label. */
  expires: { date: string; label: string } | null;
}

/** A place where the record structure says a document reference should exist and none is stored. Worded as "no document linked", never "missing document". */
export interface DocumentGap {
  id: string;
  moduleId: string;
  sourceLabel: string;
  ownerName: string;
  recordKind: string;
  recordName: string;
  context: string;
  message: string;
  recordPath: string;
  recordAction: string;
}

export interface DocumentRead { refs: DocumentRef[]; gaps: DocumentGap[] }

export interface DocumentReadContext { today: string }

/** What a module offers: a lazy, read-only reader. The module's code is downloaded only when the Records screen or Search first asks. */
export interface DocumentSource {
  /** The module's name in words, also the filter button ("Home & Assets"). */
  label: string;
  read(ctx: DocumentReadContext): Promise<DocumentRead>;
}

/** Everything a module adapter knows about the OWNER of one or more references; `makeRefs` turns a record's raw list into `DocumentRef`s. */
export interface RefOwner {
  moduleId: string;
  sourceLabel: string;
  /** `<kind>:<record id>`, the stable part of every id. */
  ownerKey: string;
  ownerName: string;
  recordKind: string;
  recordName?: string;
  context?: string;
  status?: string;
  recordPath: string;
  recordAction: string;
  expires?: { date: string; label: string } | null;
}

const hostOf = (href: string) => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Turns one record's stored references into index rows. A reference with no name is skipped (the modules do not allow one); everything else is listed. Never throws. */
export function makeRefs(owner: RefOwner, raw: readonly RawDocRef[] | undefined | null): DocumentRef[] {
  const out: DocumentRef[] = [];
  (raw ?? []).forEach((r, i) => {
    const label = typeof r?.label === 'string' ? r.label.trim() : '';
    if (!label) return;
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    const safe = url !== '' && isSafeUrl(url);
    out.push({
      id: `${owner.moduleId}:${owner.ownerKey}#${i}`,
      moduleId: owner.moduleId,
      sourceLabel: owner.sourceLabel,
      label,
      note: typeof r.note === 'string' ? r.note.trim() : '',
      link: safe ? 'open' : url !== '' ? 'review' : 'label-only',
      href: safe ? url : null,
      host: safe ? hostOf(url) : '',
      ownerName: owner.ownerName,
      recordKind: owner.recordKind,
      recordName: owner.recordName ?? '',
      context: owner.context ?? '',
      status: owner.status ?? '',
      recordPath: owner.recordPath,
      recordAction: owner.recordAction,
      expires: owner.expires ?? null,
    });
  });
  return out;
}

// ---- finding and filtering (pure) ----

/** The words an in-page or Search query is matched against: what is shown on the row, and nothing else (no note, no address, no text inside a linked file). */
export const refSearchText = (r: DocumentRef) => norm([r.label, r.ownerName, r.recordKind, r.recordName, r.context, r.sourceLabel].filter(Boolean).join(' '));

/** True when every typed word appears. An empty query matches everything. */
export function refMatches(r: DocumentRef, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = refSearchText(r);
  return words.every((w) => hay.includes(w));
}

/** Days from `today` to `date` (negative = already past). Both 'YYYY-MM-DD'. */
export const daysBetween = (today: string, date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

/** The same 60 days Home & Assets uses for "expiring soon" on a warranty. */
export const EXPIRING_DAYS = 60;

export type ExpiryState = 'expired' | 'soon' | 'later';
export function expiryState(date: string, today: string): ExpiryState {
  const d = daysBetween(today, date);
  return d < 0 ? 'expired' : d <= EXPIRING_DAYS ? 'soon' : 'later';
}

export interface RefFilter {
  /** A module id, or 'all'. */
  source?: string;
  query?: string;
  /** Only references whose own record has an end date that has passed or is within `EXPIRING_DAYS`. */
  expiring?: boolean;
  /** Only references with a stored address that was not safe to open. */
  review?: boolean;
}

export function filterRefs(refs: readonly DocumentRef[], f: RefFilter, today: string): DocumentRef[] {
  return refs.filter((r) =>
    (!f.source || f.source === 'all' || r.moduleId === f.source) &&
    (!f.review || r.link === 'review') &&
    (!f.expiring || (r.expires !== null && expiryState(r.expires.date, today) !== 'later')) &&
    refMatches(r, f.query ?? ''));
}

/**
 * The default order: by source (the order the modules were read in), then by the item's name, then the record, then the reference's own name, then its position. Stable and
 * the same on every device. A reference with an upcoming or passed end date is NOT moved to the top (it is marked on its row instead), so the list does not jump around.
 */
export function sortRefs(refs: readonly DocumentRef[], sourceOrder: readonly string[]): DocumentRef[] {
  const rank = (m: string) => { const i = sourceOrder.indexOf(m); return i < 0 ? sourceOrder.length : i; };
  return [...refs].sort((a, b) =>
    rank(a.moduleId) - rank(b.moduleId) ||
    a.ownerName.localeCompare(b.ownerName) ||
    a.recordKind.localeCompare(b.recordKind) ||
    a.recordName.localeCompare(b.recordName) ||
    a.label.localeCompare(b.label) ||
    a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** The one line a Search result shows under the reference's name: where it belongs, the module and a date only when its record has one. No address, no note. */
export function refSearchLine(r: DocumentRef): string {
  const belongs = r.recordName ? `${r.ownerName} · ${r.recordKind}: ${r.recordName}` : `${r.ownerName} · ${r.recordKind}`;
  return [`Belongs to ${belongs}`, r.sourceLabel, r.expires ? `${r.expires.label} ${dayLabel(r.expires.date, { year: true })}` : ''].filter(Boolean).join(' · ');
}

/** The Records screen's address for one reference (Search opens it). Never carries a name, a label or an address, only the id. */
export const recordsPath = (refId?: string) => (refId ? `/records?ref=${encodeURIComponent(refId)}` : '/records');
