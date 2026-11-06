/**
 * Service records (Home & Assets H2): one durable record per piece of work done on an asset (`module: 'assets'`, `kind: 'service'`).
 * They live in the shared `moduleRecords` table, so backup, restore and device sync already cover them. Pure code only: reading and checking.
 *
 * Money is whole cents. `costCents: null` means "not recorded" and is NOT the same as 0. The cost is informational; it feeds nothing
 * (a Finance link is an alternative, H3). Fields this reader does not know (for example H3's `txnRefs`) travel through every read and write.
 */
import type { ModuleRecord } from '../../core/entities';
import { parseAmountToCents } from '../../lib/money';
import { finite, isDate, str, tidy, type AssetRef } from './model';
import { isSafeUrl } from './validate';
import { readTxnRefs, validateTxnRefs, type TxnRef } from './txnRef';

export const SERVICE_KIND = 'service';
export const SERVICE_KINDS = ['maintenance', 'repair', 'inspection', 'improvement', 'replacement', 'other'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = {
  maintenance: 'Maintenance', repair: 'Repair', inspection: 'Inspection', improvement: 'Improvement', replacement: 'Replacement', other: 'Other',
};

/** Link / record-source ids look like `service:1234`, next to `asset:1234`. */
export const serviceRefId = (id: number) => `service:${id}`;
export const parseServiceRef = (id: string | number): number | null => {
  const m = /^service:(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
};

export interface ServiceData {
  assetId: number;
  /** The day the work happened, 'YYYY-MM-DD' (local, no time zone). Never in the future. */
  date: string;
  kind: ServiceKind;
  title: string;
  notes: string;
  providerContactId: number | null;
  /** Whole cents >= 0, or null when not recorded. */
  costCents: number | null;
  /** H3: Finance transaction pieces that paid for it. Either these or `costCents`, never both (references win). */
  txnRefs: TxnRef[];
  /** The Task this was saved from, when there was one. One service record per task. */
  taskId: number | null;
  /** The task's title when the record was saved, so the origin stays readable if the task is renamed or deleted. */
  taskTitleSnapshot: string;
  /** The Project this work was recorded from (H3). Information only; it adds no money anywhere. */
  projectId: number | null;
  refs: AssetRef[];
}
export interface ServiceRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  data: ServiceData;
}

const SERVICE_KEYS = new Set(['assetId', 'date', 'kind', 'title', 'notes', 'providerContactId', 'costCents', 'txnRefs', 'taskId', 'taskTitleSnapshot', 'projectId', 'refs']);
const extras = (d: object) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !SERVICE_KEYS.has(k) && v !== undefined)) as object;
const idOrNull = (v: unknown): number | null => (finite(v) ? v : null);

/** Reads a stored record defensively. Never throws: a record from another device or version can never crash a screen. */
export function asService(r: ModuleRecord): ServiceRecord {
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
      date: isDate(d.date) ? d.date : '',
      kind: SERVICE_KINDS.includes(d.kind as ServiceKind) ? (d.kind as ServiceKind) : 'other',
      title: str(d.title).trim() || 'Service',
      notes: str(d.notes),
      providerContactId: idOrNull(d.providerContactId),
      costCents: finite(d.costCents) && d.costCents >= 0 ? Math.round(d.costCents) : null,
      txnRefs: readTxnRefs(d.txnRefs),
      taskId: idOrNull(d.taskId),
      taskTitleSnapshot: str(d.taskTitleSnapshot),
      projectId: idOrNull(d.projectId),
      refs,
    },
  };
}

export const blankService = (assetId: number, over: Partial<ServiceData> = {}): ServiceData => ({
  assetId, date: '', kind: 'maintenance', title: '', notes: '', providerContactId: null, costCents: null, txnRefs: [], taskId: null, taskTitleSnapshot: '', projectId: null, refs: [], ...over,
});

/** Tidies what was typed: collapsed title, trimmed notes, whole-cent cost, blank document rows dropped. */
export function normalizeService(d: ServiceData): ServiceData {
  return {
    ...d,
    title: tidy(d.title),
    notes: d.notes.trim(),
    taskTitleSnapshot: tidy(d.taskTitleSnapshot),
    costCents: d.costCents === null ? null : Math.round(d.costCents),
    refs: d.refs.map((r) => ({ label: tidy(r.label), ...(r.url?.trim() ? { url: r.url.trim() } : {}), ...(r.note?.trim() ? { note: r.note.trim() } : {}) })).filter((r) => r.label || r.url || r.note),
  };
}

export interface ServiceContext {
  /** Today's local date, 'YYYY-MM-DD'. */
  today: string;
  /** True when this live contact exists. */
  contactExists: (id: number) => boolean;
  /** The provider the record already had (editing): an unchanged provider that has since been removed is not an error. */
  keepContactId?: number | null;
}

/** The plain-words problem with a service record, or null. The asset itself is checked by the data layer (it needs the database). */
export function validateService(d: ServiceData, ctx: ServiceContext): string | null {
  if (!finite(d.assetId) || d.assetId < 0) return 'Pick the asset this was done on.';
  if (!tidy(d.title)) return 'Say what was done.';
  if (d.title.length > 160) return 'That description is too long (160 characters at most).';
  if (!isDate(d.date)) return 'Pick the date the work was done.';
  if (d.date > ctx.today) return 'Service history records work already done, so the date cannot be in the future. For something upcoming, add maintenance (a task) instead.';
  if (!SERVICE_KINDS.includes(d.kind)) return 'Pick what kind of work it was.';
  if (d.notes.length > 5000) return 'The notes are too long.';
  if (d.costCents !== null && (!Number.isFinite(d.costCents) || d.costCents < 0)) return 'The cost cannot be negative.';
  if (d.costCents !== null && d.costCents > 100_000_000_00) return 'That cost is too large.';
  if (d.providerContactId !== null && d.providerContactId !== ctx.keepContactId && !ctx.contactExists(d.providerContactId)) return 'That contact no longer exists. Pick another or clear it.';
  if (d.costCents !== null && d.txnRefs.length) return 'A cost is either typed or taken from Finance, not both. Choose one.';
  const refProblem = validateTxnRefs(d.txnRefs);
  if (refProblem) return refProblem;
  if (d.taskTitleSnapshot.length > 300) return 'The task title is too long.';
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

/** Cost text to cents: '' is "not recorded" (null); otherwise the amount, or undefined when it is not a usable amount (negative included). */
export function costFromText(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const c = parseAmountToCents(text);
  return c === null || c < 0 ? undefined : c;
}
