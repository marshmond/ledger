/**
 * Shared helpers for the household (B5) tests ONLY: never imported by the app. Every name, provider and amount is invented. Records are built directly
 * (no database) so a test states exactly what each module holds; the database helpers re-use the Bills test kit (real two-device SyncEngine, Finance snapshot).
 *
 * Money in tests: Finance outflows are NEGATIVE cents (`txn(1, -15000)` is a $150.00 payment); a refund is a positive piece.
 */
import type { Txn } from '../../types';
import { makeTxnRef, type TxnLookup, type TxnRef } from '../../lib/txnRef';
import { blankAsset, type AssetRecord } from '../assets/model';
import { blankService, type ServiceRecord } from '../assets/service';
import { blankArrangement, type ArrangementRecord, type Cadence } from '../services/model';
import { blankVisit, type VisitRecord } from '../services/visitModel';
import { fact } from '../bills/billsTestkit';
import type { CycleRecord, FactBody } from '../bills/cycleModel';

export const rec = <T,>(id: number, data: T) => ({ id, createdAt: id, updatedAt: id, data });
export const asset = (id: number, over: Parameters<typeof blankAsset>[0] = {}): AssetRecord => rec(id, blankAsset({ name: `Asset ${id}`, ...over }));
export const work = (id: number, assetId: number, over: Partial<ServiceRecord['data']> = {}): ServiceRecord => rec(id, blankService(assetId, { title: `Work ${id}`, date: '2026-03-10', ...over }));
export const arrangement = (id: number, over: Partial<ArrangementRecord['data']> = {}): ArrangementRecord => rec(id, blankArrangement({ title: `Arrangement ${id}`, ...over }));
export const visit = (id: number, over: Partial<VisitRecord['data']> = {}): VisitRecord => rec(id, blankVisit({ title: `Visit ${id}`, date: '2026-03-10', status: 'completed', providerContactId: 1, providerNameSnapshot: 'Pat Pools', arrangementId: 1, ...over }));
export const txn = (id: number, amountCents: number, over: Partial<Txn> = {}): Txn => ({ id, accountId: 1, date: '2026-03-10', amountCents, payee: `Payee ${id}`, memo: '', status: 'cleared', categoryId: 5, ...over } as Txn);
/** A split part of an outflow of `outflowCents` dollars-in-cents (stored negative). */
export const split = (outflowCents: number, categoryId = 5) => ({ amountCents: -outflowCents, categoryId });
export const lk = (...ts: Txn[]): TxnLookup => { const m = new Map(ts.map((t) => [t.id as number, t])); return (id) => m.get(id); };
export const R = (t: Txn, i?: number): TxnRef => makeTxnRef(t, i);

const never = { type: 'never' } as const;
/** Every Friday, starting Friday 6 November 2026. */
export const weekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 1, byWeekday: [5], end: never }, anchorDate: '2026-11-06' };
/** Every other Friday, starting Friday 6 November 2026. */
export const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5], end: never }, anchorDate: '2026-11-06' };

// ---- Bills facts (a payment link, a typed payment) ----
let fid = 1000;
export const nextFactId = () => fid++;
export const billLink = (obligationId: number, slot: string, t: Txn, splitIndex?: number): CycleRecord => fact(obligationId, slot, { fact: 'payment-link', ref: makeTxnRef(t, splitIndex) }, fid++);
export const billFact = (obligationId: number, slot: string, body: FactBody): CycleRecord => fact(obligationId, slot, body, fid++);
