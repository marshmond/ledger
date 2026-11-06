/**
 * Warranty records (Home & Assets H4): one record per coverage on an asset (`module: 'assets'`, `kind: 'warranty'`), so an asset can have
 * several (manufacturer, extended, labour). They live in the shared `moduleRecords` table, so backup, restore and device sync already cover
 * them. Pure code only: reading, checking, and working out status.
 *
 * H1's simple fields (`warrantyEndDate`, `warrantyNote` on the asset) are NEVER rewritten. When an asset has no live warranty record they
 * are read as ONE implicit warranty; as soon as a live record exists, the records are shown instead and the implicit one is not (no duplicates).
 * Fields this reader does not know travel through every read and write.
 */
import type { ModuleRecord } from '../../core/entities';
import { finite, isDate, str, tidy, type AssetData, type AssetRef } from './model';
import { isSafeUrl } from './validate';

export const WARRANTY_KIND = 'warranty';
export const MAX_WARRANTIES = 20;
export const SOON_DAYS = 60;

/** Link / record-source ids look like `warranty:1234`, next to `asset:1234` and `service:1234`. */
export const warrantyRefId = (id: number) => `warranty:${id}`;
export const parseWarrantyRef = (id: string | number): number | null => {
  const m = /^warranty:(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
};

export interface WarrantyData {
  assetId: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  providerContactId: number | null;
  coverageNotes: string;
  claimInfo: string;
  refs: AssetRef[];
}
export interface WarrantyRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  data: WarrantyData;
}

const KEYS = new Set(['assetId', 'title', 'startDate', 'endDate', 'providerContactId', 'coverageNotes', 'claimInfo', 'refs']);
const extras = (d: object) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !KEYS.has(k) && v !== undefined)) as object;

/** Reads a stored record defensively. Never throws: a record from another device or version can never crash a screen. */
export function asWarranty(r: ModuleRecord): WarrantyRecord {
  const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
  const refs: AssetRef[] = Array.isArray(d.refs)
    ? d.refs.flatMap((x) => {
        const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
        return o && str(o.label).trim() ? [{ label: str(o.label), ...(str(o.url) ? { url: str(o.url) } : {}), ...(str(o.note) ? { note: str(o.note) } : {}) }] : [];
      })
    : [];
  return {
    id: r.id as number,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    data: {
      ...extras(d),
      assetId: finite(d.assetId) ? d.assetId : -1,
      title: str(d.title).trim() || 'Warranty',
      startDate: isDate(d.startDate) ? d.startDate : null,
      endDate: isDate(d.endDate) ? d.endDate : null,
      providerContactId: finite(d.providerContactId) ? d.providerContactId : null,
      coverageNotes: str(d.coverageNotes),
      claimInfo: str(d.claimInfo),
      refs,
    },
  };
}

export const blankWarranty = (assetId: number, over: Partial<WarrantyData> = {}): WarrantyData => ({
  assetId, title: '', startDate: null, endDate: null, providerContactId: null, coverageNotes: '', claimInfo: '', refs: [], ...over,
});

export function normalizeWarranty(d: WarrantyData): WarrantyData {
  return {
    ...d,
    title: tidy(d.title),
    startDate: d.startDate || null,
    endDate: d.endDate || null,
    coverageNotes: d.coverageNotes.trim(),
    claimInfo: d.claimInfo.trim(),
    refs: d.refs.map((r) => ({ label: tidy(r.label), ...(r.url?.trim() ? { url: r.url.trim() } : {}), ...(r.note?.trim() ? { note: r.note.trim() } : {}) })).filter((r) => r.label || r.url || r.note),
  };
}

export interface WarrantyContext {
  /** True when this live contact exists. */
  contactExists: (id: number) => boolean;
  /** The provider the record already had (editing): an unchanged provider that has since been removed is not an error. */
  keepContactId?: number | null;
}

/** The plain-words problem with a warranty, or null. The asset itself is checked by the data layer (it needs the database). */
export function validateWarranty(d: WarrantyData, ctx: WarrantyContext): string | null {
  if (!finite(d.assetId) || d.assetId < 0) return 'Pick the asset this covers.';
  if (!tidy(d.title)) return 'Give the warranty a name, such as "Manufacturer warranty".';
  if (d.title.length > 120) return 'That name is too long (120 characters at most).';
  if (d.startDate !== null && !isDate(d.startDate)) return 'The start date is not a real date.';
  if (d.endDate !== null && !isDate(d.endDate)) return 'The end date is not a real date.';
  if (d.startDate && d.endDate && d.endDate < d.startDate) return 'The end date is before the start date.';
  if (d.providerContactId !== null && d.providerContactId !== ctx.keepContactId && !ctx.contactExists(d.providerContactId)) return 'That contact no longer exists. Pick another or clear it.';
  if (d.coverageNotes.length > 2000 || d.claimInfo.length > 2000) return 'A note is too long (2,000 characters at most).';
  if (d.refs.length > 20) return 'That is too many documents (20 at most).';
  for (const r of d.refs) {
    if (!tidy(r.label)) return 'Give each document a label.';
    if (r.label.length > 80 || (r.note?.length ?? 0) > 200) return 'A document label or note is too long.';
    if (r.url !== undefined && r.url !== '') {
      if (r.url.length > 500) return 'A link is too long.';
      if (!isSafeUrl(r.url)) return 'Links must start with http:// or https://.';
    }
  }
  return null;
}

// ---- status ----

export type WarrantyStatus = 'active' | 'soon' | 'expired' | 'none';
export const WARRANTY_STATUS_LABEL: Record<WarrantyStatus, string> = { active: 'Active', soon: 'Expiring soon', expired: 'Expired', none: 'No expiration recorded' };

const dayDiff = (to: string, from: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

/**
 * Where a warranty stands today. The end date is the LAST covered day: on that day it is still covered (and "soon"); the day after it is expired.
 * "Soon" means within SOON_DAYS days (60) including the end day itself. No end date means no status can be worked out.
 */
export function warrantyStatus(endDate: string | null, today: string): WarrantyStatus {
  if (!endDate) return 'none';
  if (endDate < today) return 'expired';
  return dayDiff(endDate, today) <= SOON_DAYS ? 'soon' : 'active';
}

// ---- implicit (H1) warranty ----

/** What the screens show: a stored record, or the one implicit warranty read from the asset's H1 fields (it has no id of its own). */
export interface EffectiveWarranty {
  /** Stored record id, or null for the implicit one. */
  id: number | null;
  implicit: boolean;
  assetId: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  providerContactId: number | null;
  coverageNotes: string;
  claimInfo: string;
  refs: AssetRef[];
}

export const IMPLICIT_TITLE = 'Warranty';

/**
 * The warranties to show for an asset. `explicit` must be the LIVE records for this asset. If there are any, they are the answer.
 * Otherwise the asset's H1 date / note (if either is set) read as one implicit warranty. Nothing is written.
 */
export function effectiveWarranties(assetId: number, a: Pick<AssetData, 'warrantyEndDate' | 'warrantyNote'>, explicit: WarrantyRecord[]): EffectiveWarranty[] {
  const mine = explicit.filter((w) => w.data.assetId === assetId);
  if (mine.length) {
    return [...mine]
      .sort((x, y) => (x.data.endDate ?? '9999-99-99').localeCompare(y.data.endDate ?? '9999-99-99') || x.id - y.id)
      .map((w) => ({ id: w.id, implicit: false, ...w.data }));
  }
  if (a.warrantyEndDate || a.warrantyNote.trim()) {
    return [{ id: null, implicit: true, assetId, title: IMPLICIT_TITLE, startDate: null, endDate: a.warrantyEndDate, providerContactId: null, coverageNotes: a.warrantyNote, claimInfo: '', refs: [] }];
  }
  return [];
}

/** Warranty records grouped by asset id (live records only, as given). */
export function groupByAsset(ws: WarrantyRecord[]): Map<number, WarrantyRecord[]> {
  const m = new Map<number, WarrantyRecord[]>();
  for (const w of ws) m.set(w.data.assetId, [...(m.get(w.data.assetId) ?? []), w]);
  return m;
}

/**
 * The small badge on lists and the asset page. Only for assets In use. Looks at every effective warranty that has an end date: the nearest
 * one that has not ended wins ("Warranty ends ..."); if all have ended, the latest end is shown ("Warranty ended ..."). No end date: no badge.
 */
export function warrantyBadge(a: AssetData, effective: EffectiveWarranty[], today: string): { label: string; tone: 'ok' | 'soon' | 'past' } | null {
  if (a.status !== 'active') return null;
  const ends = effective.map((w) => w.endDate).filter((x): x is string => !!x).sort();
  if (!ends.length) return null;
  const upcoming = ends.find((e) => e >= today);
  if (upcoming) return { label: `Warranty ends ${upcoming}`, tone: warrantyStatus(upcoming, today) === 'soon' ? 'soon' : 'ok' };
  return { label: `Warranty ended ${ends[ends.length - 1]}`, tone: 'past' };
}
