/**
 * Recording HOW a visit (or an arrangement as a whole) was paid (S3-B). The only place that writes payment fields.
 *
 * Rules:
 *  - ONE source per record: Finance transaction pieces, OR an amount paid outside Finance, OR nothing. They are never added together.
 *  - Changing the source never happens silently: if saving would remove the other source's content, the call is refused unless `confirmSwitch`
 *    is true, and the message names exactly what would be removed.
 *  - A payment is allowed on a completed, skipped or cancelled visit (a cancellation fee is a real payment) and NEVER changes the status.
 *  - Finance is only READ (to check that a newly picked transaction exists and is spending). Nothing is ever written to it.
 *  - A transaction piece linked on the arrangement as a whole is refused on that arrangement's visits, and the other way round, so one payment
 *    cannot be counted in both places. (The same piece on SEVERAL visits is allowed: one invoice can cover several visits; it is counted once.)
 *  - Unknown fields on the record are kept.
 */
import { db, type FinanceDB } from '../../db';
import { newRefsProblem } from '../../lib/txnLookup';
import { pieceKey, validateTxnRefs, type TxnRef } from '../../lib/txnRef';
import { formatCents } from '../../lib/money';
import { getArrangement, rows, tables, writeArrangement } from './data';
import { MODULE } from './model';
import { asVisit, UNSUPPORTED, VISIT_KIND, validatePayment, type PaymentSource } from './visitModel';
import { loadVisits } from './visits';

export interface PaymentChange {
  source: PaymentSource;
  /** Finance pieces (used when `source` is `finance`). */
  refs: TxnRef[];
  /** Whole cents paid outside Finance (used when `source` is `manual`). */
  manualCents: number | null;
  /** The owner ticked the box that names what the switch removes. */
  confirmSwitch?: boolean;
}

/** What saving `change` over what is stored would remove from the OTHER source, in plain words, or null. Pure. */
export function droppedBySwitch(current: { txnRefs: TxnRef[]; paidManualCents: number | null }, change: Pick<PaymentChange, 'source'>, money: (c: number) => string = formatCents): string | null {
  const refs = current.txnRefs.length ? `the link to ${current.txnRefs.length === 1 ? '1 Finance transaction' : `${current.txnRefs.length} Finance transactions`} (the transactions themselves are not touched)` : null;
  const manual = current.paidManualCents !== null ? `the amount paid outside Finance (${money(current.paidManualCents)})` : null;
  if (change.source === 'finance') return manual;
  if (change.source === 'manual') return refs;
  return [refs, manual].filter(Boolean).join(' and ') || null;
}

export function setVisitPayment(visitId: number, change: PaymentChange, expectUpdatedAt: number | null, d: FinanceDB = db): Promise<void> {
  return (async () => {
    const pre = await d.moduleRecords.get(visitId);
    if (!pre || pre.module !== MODULE || pre.kind !== VISIT_KIND) throw new Error('That visit no longer exists. Nothing was changed.');
    // Finance is read here, before the write transaction opens, so its tables never join it.
    if (change.source === 'finance') {
      const problem = await newRefsProblem(change.refs, asVisit(pre).data.txnRefs, d);
      if (problem) throw new Error(`${problem} Nothing was changed.`);
    }
    await d.transaction('rw', ...tables(d), async () => {
      const raw = await d.moduleRecords.get(visitId);
      if (!raw || raw.module !== MODULE || raw.kind !== VISIT_KIND || raw.deletedAt) throw new Error('That visit no longer exists. Nothing was changed.');
      const v = asVisit(raw);
      if (expectUpdatedAt !== null && v.updatedAt !== expectUpdatedAt) throw new Error('This visit was changed (maybe on another device) since you opened it. Close this, look again and redo your change. Nothing was changed.');
      if (v.data.status === UNSUPPORTED) throw new Error('This visit has an outcome this version does not understand. Choose its outcome first (Edit), then record the payment. Nothing was changed.');
      const refs = change.source === 'finance' ? change.refs : [];
      const cents = change.source === 'manual' ? change.manualCents : null;
      if (change.source === 'manual' && cents === null) throw new Error('Enter the amount paid outside Finance. Nothing was changed.');
      if (change.source === 'finance' && !refs.length) throw new Error('Link at least one Finance transaction, or choose another source. Nothing was changed.');
      const dropped = droppedBySwitch(v.data, change);
      if (dropped && !change.confirmSwitch) throw new Error(`Saving removes ${dropped}. Confirm to continue. Nothing was changed.`);
      const bad = validatePayment({ payment: change.source, txnRefs: refs, paidManualCents: cents });
      if (bad) throw new Error(`${bad} Nothing was changed.`);
      if (v.data.arrangementId !== null && refs.length) {
        const a = await getArrangement(v.data.arrangementId, d);
        const onArr = new Set((a?.data.txnRefs ?? []).map(pieceKey));
        if (refs.some((r) => onArr.has(pieceKey(r)))) throw new Error('One of those payments is already linked on the arrangement as a whole. Link a payment in one place only (remove it there first). Nothing was changed.');
      }
      const stored = raw.data as Record<string, unknown>;
      const { payment: _p, txnRefs: _t, paidManualCents: _m, ...rest } = stored;
      void _p; void _t; void _m;
      const data = change.source === 'none' ? rest : { ...rest, payment: change.source, txnRefs: refs, paidManualCents: cents };
      await rows(d).put({ id: visitId, module: MODULE, kind: VISIT_KIND, data });
    });
  })();
}

/** Sets the Finance pieces that belong to the arrangement as a whole (a retainer). Never divided among visits. */
export function setArrangementPayments(arrangementId: number, refs: TxnRef[], expectUpdatedAt: number | null, d: FinanceDB = db): Promise<void> {
  return (async () => {
    const pre = await getArrangement(arrangementId, d);
    if (!pre) throw new Error('That arrangement no longer exists. Nothing was changed.');
    const problem = await newRefsProblem(refs, pre.data.txnRefs, d);
    if (problem) throw new Error(`${problem} Nothing was changed.`);
    await d.transaction('rw', ...tables(d), async () => {
      const a = await getArrangement(arrangementId, d);
      if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
      if (expectUpdatedAt !== null && a.updatedAt !== expectUpdatedAt) throw new Error('This arrangement was changed (maybe on another device) since you opened it. Close this, look again and redo your change. Nothing was changed.');
      const bad = validateTxnRefs(refs);
      if (bad) throw new Error(`${bad} Nothing was changed.`);
      const onVisits = new Set((await loadVisits(d)).filter((v) => v.data.arrangementId === arrangementId).flatMap((v) => v.data.txnRefs.map(pieceKey)));
      if (refs.some((r) => onVisits.has(pieceKey(r)))) throw new Error('One of those payments is already linked on a visit of this arrangement. Link a payment in one place only (remove it from the visit first). Nothing was changed.');
      await writeArrangement(arrangementId, { ...a.data, txnRefs: refs }, d);
    });
  })();
}
