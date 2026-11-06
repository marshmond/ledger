/**
 * Home & Assets records. They live in the shared `moduleRecords` table (module 'assets', kind 'asset'), one record per asset, so backup,
 * restore and device sync already cover them. A child points at its parent (`parentId`); a parent never stores a list of children.
 *
 * Money is whole cents; dates are 'YYYY-MM-DD' with no time zone. Fields this reader does not know are carried through untouched.
 * SENSITIVE fields (serialNumber, plate, address) must never reach a list row, a link label, a search result line or a toast: build every
 * outward string with `publicLabel` / `breadcrumb` (data.ts), which cannot read them.
 */
import type { ModuleRecord } from '../../core/entities';

export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
/** A real calendar date written YYYY-MM-DD (so 2026-02-30 is not one). */
export const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const extras = (d: object, known: Set<string>) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !known.has(k) && v !== undefined)) as object;

export const MODULE = 'assets';
/** Link / record-source ids look like `asset:1234`, so later kinds (`service:`, `warranty:`) can never clash. */
export const assetRefId = (id: number) => `asset:${id}`;
export const parseAssetRef = (id: string | number): number | null => {
  const m = /^asset:(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
};

export const ASSET_TYPES = ['property', 'area', 'system', 'appliance', 'vehicle', 'other'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const TYPE_LABEL: Record<AssetType, string> = { property: 'Property', area: 'Area', system: 'System', appliance: 'Appliance or equipment', vehicle: 'Vehicle', other: 'Other' };

export const ASSET_STATUSES = ['active', 'stored', 'sold', 'disposed', 'replaced'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const STATUS_LABEL: Record<AssetStatus, string> = { active: 'In use', stored: 'Stored', sold: 'Sold', disposed: 'Disposed of', replaced: 'Replaced' };
/** Statuses that mean it has left the household's everyday use ("Past"). */
export const PAST_STATUSES: AssetStatus[] = ['sold', 'disposed', 'replaced'];

/** Kinds of record (in later phases) that point at an asset with `assetId`. Deletion and the sync rule both read this list. */
export const ASSET_DEPENDENT_KINDS = ['service', 'warranty'] as const;

export const CONTACT_ROLE_HINTS = ['installer', 'contractor', 'service', 'warranty', 'seller'];

export interface AssetContact { contactId: number; role: string }
export interface AssetSpec { label: string; value: string }
export interface AssetRef { label: string; url?: string; note?: string }

export interface AssetData {
  name: string;
  type: AssetType;
  parentId: number | null;
  status: AssetStatus;
  statusDate: string | null;
  statusNote: string;
  /** Only meaningful when status is 'replaced'. */
  replacedById: number | null;
  archived: boolean;
  notes: string;
  manufacturer: string;
  model: string;
  /** SENSITIVE. A VIN for a vehicle. */
  serialNumber: string;
  purchaseDate: string | null;
  installDate: string | null;
  /** Whole cents, >= 0. Informational in H1: it feeds nothing. */
  purchaseCents: number | null;
  warrantyEndDate: string | null;
  warrantyNote: string;
  contacts: AssetContact[];
  specs: AssetSpec[];
  refs: AssetRef[];
  /** SENSITIVE. Property only. */
  address: string;
  /** SENSITIVE. Vehicle only. */
  plate: string;
}
export interface AssetRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  data: AssetData;
}

const ASSET_KEYS = new Set([
  'name', 'type', 'parentId', 'status', 'statusDate', 'statusNote', 'replacedById', 'archived', 'notes', 'manufacturer', 'model', 'serialNumber',
  'purchaseDate', 'installDate', 'purchaseCents', 'warrantyEndDate', 'warrantyNote', 'contacts', 'specs', 'refs', 'address', 'plate',
]);
// Reserved for later phases (ledgerPropertyId, txnRefs, purchaseTxnRef): not in ASSET_KEYS, so they travel as unknown fields.

const list = <T,>(v: unknown, pick: (x: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v) ? v.flatMap((x) => { const r = x && typeof x === 'object' ? pick(x as Record<string, unknown>) : null; return r ? [r] : []; }) : [];
const id = (v: unknown): number | null => (finite(v) ? v : null);

/** Reads a stored record defensively, so a record from another device or version can never crash a screen. Never throws. */
export function asAsset(r: ModuleRecord): AssetRecord {
  const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
  const status = ASSET_STATUSES.includes(d.status as AssetStatus) ? (d.status as AssetStatus) : 'active';
  return {
    id: r.id as number,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    data: {
      ...extras(d, ASSET_KEYS),
      name: str(d.name).trim() || 'Unnamed asset',
      type: ASSET_TYPES.includes(d.type as AssetType) ? (d.type as AssetType) : 'other',
      parentId: id(d.parentId),
      status,
      statusDate: isDate(d.statusDate) ? d.statusDate : null,
      statusNote: str(d.statusNote),
      replacedById: status === 'replaced' ? id(d.replacedById) : null,
      archived: d.archived === true,
      notes: str(d.notes),
      manufacturer: str(d.manufacturer),
      model: str(d.model),
      serialNumber: str(d.serialNumber),
      purchaseDate: isDate(d.purchaseDate) ? d.purchaseDate : null,
      installDate: isDate(d.installDate) ? d.installDate : null,
      purchaseCents: finite(d.purchaseCents) && d.purchaseCents >= 0 ? Math.round(d.purchaseCents) : null,
      warrantyEndDate: isDate(d.warrantyEndDate) ? d.warrantyEndDate : null,
      warrantyNote: str(d.warrantyNote),
      contacts: list(d.contacts, (x) => (finite(x.contactId) ? { contactId: x.contactId, role: str(x.role).trim() } : null)),
      specs: list(d.specs, (x) => (str(x.label).trim() || str(x.value).trim() ? { label: str(x.label), value: str(x.value) } : null)),
      refs: list(d.refs, (x) => (str(x.label).trim() ? { label: str(x.label), ...(str(x.url) ? { url: str(x.url) } : {}), ...(str(x.note) ? { note: str(x.note) } : {}) } : null)),
      address: str(d.address),
      plate: str(d.plate),
    },
  };
}

export const blankAsset = (over: Partial<AssetData> = {}): AssetData => ({
  name: '', type: 'other', parentId: null, status: 'active', statusDate: null, statusNote: '', replacedById: null, archived: false, notes: '',
  manufacturer: '', model: '', serialNumber: '', purchaseDate: null, installDate: null, purchaseCents: null, warrantyEndDate: null, warrantyNote: '',
  contacts: [], specs: [], refs: [], address: '', plate: '', ...over,
});

/** Whitespace collapsed, trimmed. */
export const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');
/** Names compare ignoring case, accents and extra spaces. */
export const nameKey = (s: string) => tidy(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
