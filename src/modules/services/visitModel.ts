/**
 * Visit records (S2): the durable history of what happened. Module 'services', kind 'visit', in the shared `moduleRecords` table, so backup,
 * restore and device sync already cover them. A visit is written only after something happened (completed), was deliberately passed over
 * (skipped) or did not happen (cancelled). "Planned" is a Task, never a visit.
 *
 * The amount charged is INFORMATION ONLY. It is never money spent, never proof of payment, and never changes the status. Fields reserved for
 * the Finance phase (payment, txnRefs, paidManualCents, assetRecordId) are not read or shown here; they are carried through untouched as
 * unknown fields, so a later version can add them without a migration.
 *
 * NO account number, password, access code or bank detail is stored. Phone and email stay on the shared Contact.
 */
import type { ModuleRecord } from '../../core/entities';
import { MAX_TXN_REFS, readTxnRefs, validateTxnRefs, type TxnRef } from '../../lib/txnRef';
import { isDate, isSafeUrl, MODULE, str, tidy, type DocRef } from './model';

export const VISIT_KIND = 'visit';
export const visitRefId = (id: number) => `visit:${id}`;
export const parseVisitRef = (id: string | number): number | null => {
  const m = /^visit:(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
};
export const visitRef = (id: number) => ({ module: MODULE, id: visitRefId(id) });

export type PaymentSource = 'none' | 'finance' | 'manual';
/** Which source counts. References win if a record arrives with both (an older device, a hand edit), and it is flagged. */
export const paymentSourceOf = (d: Pick<VisitData, 'txnRefs' | 'paidManualCents'>): PaymentSource => (d.txnRefs.length ? 'finance' : d.paidManualCents !== null ? 'manual' : 'none');
export const hasPaymentConflict = (d: Pick<VisitData, 'txnRefs' | 'paidManualCents'>) => d.txnRefs.length > 0 && d.paidManualCents !== null;

export const VISIT_STATUSES = ['completed', 'skipped', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
/** What the reader reports for a stored status this version does not know (a newer version's, or a damaged value). The raw value is kept in `statusRaw`. */
export const UNSUPPORTED = 'unsupported' as const;
export const CANCELLED_BY = ['household', 'provider'] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];
export const CHARGE_KINDS = ['service', 'cancellationFee', 'other'] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];
export const CHARGE_KIND_LABEL: Record<ChargeKind, string> = { service: 'Charge for the service', cancellationFee: 'Cancellation fee', other: 'Other charge' };

export interface VisitData {
  /** The standing arrangement it belongs to, or null for a one-off job. */
  arrangementId: number | null;
  /** The provider AT THE TIME. Never rewritten when an arrangement later changes provider. */
  providerContactId: number | null;
  providerNameSnapshot: string;
  title: string;
  /** `unsupported` = the stored value is not one this version understands (see `statusRaw`). It is never service, never skipped, never cancelled. */
  status: VisitStatus | typeof UNSUPPORTED;
  /** Reader only, never stored: the exact raw value that was found when `status` is `unsupported`. */
  statusRaw?: unknown;
  cancelledBy: CancelledBy | null;
  /** The date the service happened (completed) or would have happened (skipped, cancelled). */
  date: string;
  endDate: string | null;
  notes: string;
  /** Whole cents the provider charged. Information only. */
  chargedCents: number | null;
  chargeKind: ChargeKind | null;
  /** The Task this was logged from, and the cadence date that Task stood for. Both are history: they are not editable. */
  taskId: number | null;
  occurrence: string | null;
  taskTitleSnapshot: string;
  refs: DocRef[];
  /** How the visit was PAID (S3). One source at a time. `none` is shown as "No payment recorded", never "Unpaid". A payment never changes `status`. */
  payment: PaymentSource;
  /** Finance transaction pieces (when `payment` is `finance`). The live Finance amount is authoritative; nothing here stores it. */
  txnRefs: TxnRef[];
  /** Whole cents paid outside Finance (cash and the like), when `payment` is `manual`. A typed assertion, not a verified transaction. */
  paidManualCents: number | null;
}
export interface VisitRecord { id: number; createdAt: number; updatedAt: number; data: VisitData }

const KNOWN = new Set(['arrangementId', 'providerContactId', 'providerNameSnapshot', 'title', 'status', 'cancelledBy', 'date', 'endDate', 'notes', 'chargedCents', 'chargeKind', 'taskId', 'occurrence', 'taskTitleSnapshot', 'refs', 'payment', 'txnRefs', 'paidManualCents']);
const extras = (d: object) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !KNOWN.has(k) && v !== undefined)) as object;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Reads a stored record defensively. Never throws. A status this version does not know (or a missing or malformed one) is read as
 * `unsupported` with the raw value in `statusRaw`: it is never counted as completed, skipped or cancelled, it is shown as needing review,
 * and an ordinary edit writes the raw value back unchanged. Fields this reader does not know are kept.
 */
export function asVisit(r: ModuleRecord): VisitRecord {
  const d = (r.data ?? {}) as Partial<VisitData> & Record<string, unknown>;
  const known = VISIT_STATUSES.includes(d.status as VisitStatus);
  const status: VisitData['status'] = known ? (d.status as VisitStatus) : UNSUPPORTED;
  const refs = readTxnRefs(d.txnRefs);
  const manual = ((m) => (m !== null && m >= 0 && Number.isInteger(m) ? m : null))(num(d.paidManualCents));
  const charged = num(d.chargedCents);
  const kind = CHARGE_KINDS.includes(d.chargeKind as ChargeKind) ? (d.chargeKind as ChargeKind) : null;
  return {
    id: r.id as number, createdAt: r.createdAt, updatedAt: r.updatedAt,
    data: {
      ...extras(d),
      arrangementId: num(d.arrangementId),
      providerContactId: num(d.providerContactId),
      providerNameSnapshot: str(d.providerNameSnapshot),
      title: str(d.title, '(no title)'),
      status,
      ...(known ? {} : { statusRaw: d.status }),
      cancelledBy: status === 'cancelled' && CANCELLED_BY.includes(d.cancelledBy as CancelledBy) ? (d.cancelledBy as CancelledBy) : null,
      date: isDate(d.date) ? d.date : '',
      endDate: isDate(d.endDate) ? d.endDate : null,
      notes: str(d.notes),
      chargedCents: charged !== null && charged >= 0 ? Math.round(charged) : null,
      chargeKind: charged !== null && charged >= 0 ? kind : null,
      taskId: num(d.taskId),
      occurrence: isDate(d.occurrence) ? d.occurrence : null,
      taskTitleSnapshot: str(d.taskTitleSnapshot),
      payment: refs.length ? 'finance' : manual !== null ? 'manual' : 'none',
      txnRefs: refs,
      paidManualCents: manual,
      refs: Array.isArray(d.refs) ? d.refs.filter((x) => x && typeof x.label === 'string').map((x) => ({ label: x.label, ...(typeof x.url === 'string' && x.url ? { url: x.url } : {}), ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}) })) : [],
    },
  };
}

export const blankVisit = (over: Partial<VisitData> = {}): VisitData => ({
  arrangementId: null, providerContactId: null, providerNameSnapshot: '', title: '', status: 'completed', cancelledBy: null, date: '', endDate: null, notes: '',
  chargedCents: null, chargeKind: null, taskId: null, occurrence: null, taskTitleSnapshot: '', refs: [], payment: 'none', txnRefs: [], paidManualCents: null, ...over,
});

/** Cleans a record before saving: trimmed text, whole cents. Does not decide whether it is valid. */
export function normalizeVisit(d: VisitData): VisitData {
  return {
    ...d,
    title: tidy(d.title), providerNameSnapshot: tidy(d.providerNameSnapshot), taskTitleSnapshot: tidy(d.taskTitleSnapshot), notes: d.notes.trim(),
    chargedCents: typeof d.chargedCents === 'number' && Number.isFinite(d.chargedCents) ? Math.round(d.chargedCents) : d.chargedCents,
    payment: paymentSourceOf(d),
    refs: d.refs.map((r) => ({ label: tidy(r.label), ...(r.url?.trim() ? { url: r.url.trim() } : {}), ...(r.note?.trim() ? { note: r.note.trim() } : {}) })),
  };
}

/**
 * A plain-words problem with the record, or null when it can be saved. Strict: runs on every save.
 * `today` is the local date; a completed visit cannot be in the future, but a skipped or cancelled one can describe a future date.
 */
export function validateVisit(d: VisitData, today: string): string | null {
  if (!tidy(d.title)) return 'Enter what was done (for example "Lawn mowing").';
  if (tidy(d.title).length > 120) return 'The title is too long.';
  if (!VISIT_STATUSES.includes(d.status as VisitStatus)) return 'Pick whether it was completed, skipped or cancelled.';
  if (d.providerNameSnapshot.length > 120) return 'The provider name is too long.';
  if (!isDate(d.date)) return 'Pick a real date.';
  if (d.endDate !== null && !isDate(d.endDate)) return 'The end date is not a real date.';
  if (d.endDate !== null && d.endDate < d.date) return 'The end date is before the date.';
  if (d.status === 'completed' && d.date > today) return 'A completed visit cannot be dated in the future. Use Skip or Cancel for a visit that did not happen, or pick today or an earlier day.';
  if (d.status === 'cancelled' && !CANCELLED_BY.includes(d.cancelledBy as CancelledBy)) return 'Say who cancelled it: you or the provider.';
  if (d.status !== 'cancelled' && d.cancelledBy !== null) return 'Only a cancelled visit can say who cancelled it.';
  if (d.chargedCents !== null) {
    if (typeof d.chargedCents !== 'number' || !Number.isFinite(d.chargedCents) || !Number.isInteger(d.chargedCents)) return 'The amount charged must be a whole number of cents.';
    if (d.chargedCents < 0) return 'The amount charged cannot be negative.';
    if (d.chargedCents > 1e11) return 'The amount charged is too large.';
    if (!d.chargeKind || !CHARGE_KINDS.includes(d.chargeKind)) return 'Say what the charge is for.';
    if (d.status === 'cancelled' && d.chargeKind === 'service') return 'A cancelled visit cannot be charged as service. Choose "Cancellation fee" or "Other charge".';
  } else if (d.chargeKind !== null) return 'Enter the amount charged, or clear what it is for.';
  if (d.refs.length > 20) return 'At most 20 document links.';
  for (const r of d.refs) {
    if (!tidy(r.label)) return 'Give each document link a name.';
    if (r.label.length > 120 || (r.note?.length ?? 0) > 500) return 'A document link name or note is too long.';
    if (r.url && !isSafeUrl(r.url)) return 'Links must start with http:// or https://.';
  }
  if (d.notes.length > 4000) return 'The notes are too long.';
  const pay = validatePayment(d);
  if (pay) return pay;
  return null;
}

/** The payment part of a visit: one source, whole non-negative cents, valid references. */
export function validatePayment(d: Pick<VisitData, 'payment' | 'txnRefs' | 'paidManualCents'>): string | null {
  if (d.paidManualCents !== null) {
    if (typeof d.paidManualCents !== 'number' || !Number.isInteger(d.paidManualCents)) return 'The amount paid must be a whole number of cents.';
    if (d.paidManualCents < 0) return 'The amount paid cannot be negative.';
    if (d.paidManualCents > 1e11) return 'The amount paid is too large.';
  }
  if (d.txnRefs.length > MAX_TXN_REFS) return `At most ${MAX_TXN_REFS} linked transactions.`;
  if (d.txnRefs.length && d.paidManualCents !== null) return 'A visit is paid through Finance or outside Finance, not both. Choose one.';
  return validateTxnRefs(d.txnRefs);
}

// ---- plain-words labels (pure) ----

export function statusWords(d: Pick<VisitData, 'status' | 'cancelledBy'>): string {
  if (d.status === 'completed') return 'Completed';
  if (d.status === 'skipped') return 'Skipped';
  if (d.status === UNSUPPORTED) return 'Needs review: unsupported status';
  return d.cancelledBy === 'provider' ? 'Cancelled by provider' : d.cancelledBy === 'household' ? 'Cancelled by household' : 'Cancelled';
}
/** What a charge on this visit is, in words that cannot be mistaken for payment or for service delivered. */
export function chargeWords(d: Pick<VisitData, 'status' | 'chargedCents' | 'chargeKind'>, money: (c: number) => string): string | null {
  if (d.chargedCents === null) return null;
  const amount = money(d.chargedCents);
  if (d.chargeKind === 'cancellationFee') return `Cancellation fee charged ${amount}`;
  if (d.chargeKind === 'other') return `Other charge ${amount}`;
  return `Charged ${amount}`;
}

/** Completed visits only count as service delivered. */
export const isService = (v: VisitRecord) => v.data.status === 'completed';

/** Newest first. Visits with an unreadable date go last. */
export const byDateDesc = (a: VisitRecord, b: VisitRecord) => (b.data.date || '').localeCompare(a.data.date || '') || b.createdAt - a.createdAt || b.id - a.id;

export interface VisitStats { completed: number; skipped: number; cancelled: number; cancelledWithFee: number; /** Visits whose stored status this version does not understand: counted nowhere else. */ needsReview: number; /** The newest COMPLETED visit only. Skipped and cancelled visits never count. */ lastServiced: string | null }
export function visitStats(visits: VisitRecord[]): VisitStats {
  const done = visits.filter(isService).map((v) => v.data.date).filter(Boolean).sort();
  return {
    completed: visits.filter(isService).length,
    skipped: visits.filter((v) => v.data.status === 'skipped').length,
    cancelled: visits.filter((v) => v.data.status === 'cancelled').length,
    cancelledWithFee: visits.filter((v) => v.data.status === 'cancelled' && v.data.chargedCents !== null).length,
    needsReview: visits.filter((v) => v.data.status === UNSUPPORTED).length,
    lastServiced: done.length ? done[done.length - 1] : null,
  };
}

// ---- duplicates (pure, deterministic) ----

export interface DuplicateGroup { key: string; reason: 'task' | 'occurrence' | 'same-day' | 'lookalike'; visits: VisitRecord[] }

/**
 * Visit records that probably describe the same event. Read-only; nothing is merged or removed.
 *  - same originating Task id (the strongest sign: two devices logged the same Task offline);
 *  - same arrangement and same cadence date ("occurrence") and status, from different Tasks;
 *  - same arrangement, same date and status, logged by hand with no Task.
 * One-off visits (no Task, no arrangement) with the same provider, title, date and outcome are grouped as a weak `lookalike`: they may be two real
 * visits (a cleaner can come twice in a day), so it is a notice only, is not counted on Today, and nothing ever blocked either of them.
 * Each visit is in at most one group (the strongest reason wins). Order is by key, then visit id.
 */
export function duplicateGroups(visits: VisitRecord[]): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  const claimed = new Set<number>();
  const add = (key: string, reason: DuplicateGroup['reason'], list: VisitRecord[]) => {
    const fresh = list.filter((v) => !claimed.has(v.id));
    if (fresh.length < 2) return;
    fresh.forEach((v) => claimed.add(v.id));
    groups.set(key, { key, reason, visits: [...fresh].sort((a, b) => a.id - b.id) });
  };
  const bucket = (keyOf: (v: VisitRecord) => string | null) => {
    const m = new Map<string, VisitRecord[]>();
    for (const v of visits) { const k = keyOf(v); if (k) m.set(k, [...(m.get(k) ?? []), v]); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  for (const [k, l] of bucket((v) => (v.data.taskId !== null ? `task:${v.data.taskId}` : null))) add(k, 'task', l);
  for (const [k, l] of bucket((v) => (v.data.arrangementId !== null && v.data.occurrence && v.data.taskId !== null ? `occ:${v.data.arrangementId}:${v.data.occurrence}:${v.data.status}` : null))) add(k, 'occurrence', l);
  for (const [k, l] of bucket((v) => (v.data.arrangementId !== null && v.data.taskId === null && v.data.date ? `day:${v.data.arrangementId}:${v.data.date}:${v.data.status}` : null))) add(k, 'same-day', l);
  for (const [k, l] of bucket((v) => (v.data.arrangementId === null && v.data.taskId === null && v.data.date && v.data.status !== UNSUPPORTED ? `look:${v.data.providerContactId ?? v.data.providerNameSnapshot.toLowerCase()}:${v.data.title.toLowerCase()}:${v.data.date}:${v.data.status}` : null))) add(k, 'lookalike', l);
  return [...groups.values()];
}
