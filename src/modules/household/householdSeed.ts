/**
 * The invented household shared by the B5 database and screen tests (test-only: never imported by the app). Amounts are worked out by hand in the comments.
 */
import type { FinanceDB } from '../../db';
import { makeTxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { blankAsset } from '../assets/model';
import { createAsset } from '../assets/data';
import { blankService } from '../assets/service';
import { insertService } from '../assets/serviceData';
import { newOp, recordFact } from '../bills/cycleData';
import { applyServiceLink, previewServiceLink } from '../bills/crossLinks';
import { createObligation } from '../bills/data';
import { monthly, ob } from '../bills/billsTestkit';
import { createArrangement } from '../services/data';
import { blankArrangement } from '../services/model';
import { biweekly } from './householdTestkit';

export const TODAY = '2026-11-08';

/** Every row of every table, as text: the proof that an operation changed nothing. */
export async function digest(d: FinanceDB): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const t of d.tables) out[t.name] = await t.toArray();
  return JSON.stringify(out);
}

export interface Seed { acct: number; T1: Txn; T2: Txn; T3: Txn; T4: Txn; T5: Txn; T6: Txn; bill: { streamly: number; sparkle: number; power: number }; clean: number; home: number }
/**
 * The household used throughout (the same invented data as the browser acceptance):
 *   T1 $150.00 cleaning (linked from a Bills period, a Services arrangement AND a Home & Assets record), T2 and T3 Streamly $15.49 each, T4 power $62.00,
 *   T5 furnace $340.00 and T6 a $30.00 refund of it (Home & Assets), plus a typed $95.00 gutter cleaning (Home & Assets).
 *   Recorded spending by hand: 150.00 + 15.49 + 15.49 + 62.00 + 340.00 - 30.00 + 95.00 = $647.98.
 */
export async function seed(d: FinanceDB): Promise<Seed> {
  const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
  const add = async (date: string, amountCents: number, payee: string) => (await d.txns.get((await d.txns.add({ accountId: acct, date, amountCents, payee, memo: '', status: 'cleared', categoryId: null })) as number))!;
  const T1 = await add('2026-10-15', -15000, 'Sparkle Cleaning Co'), T2 = await add('2026-10-15', -1549, 'Streamly'), T3 = await add('2026-09-15', -1549, 'Streamly');
  const T4 = await add('2026-10-20', -6200, 'Example Power'), T5 = await add('2026-09-12', -34000, 'Evergreen Furnace'), T6 = await add('2026-09-20', 3000, 'Evergreen Furnace refund');
  const mk = async (over: Parameters<typeof ob>[0], provider: string) => (await createObligation({ data: ob({ need: 'flexible', trackingSince: '2026-01-01', ...over }, TODAY), provider: { name: provider }, today: TODAY }, d)).id;
  const streamly = await mk({ title: 'Streamly', type: 'subscription', prices: [{ from: '2026-01-01', cents: 1549, label: '' }], schedule: monthly(15, '2026-01') }, 'Streamly Inc');
  const power = await mk({ title: 'Example Power', type: 'utility', amountKind: 'variable', prices: [{ from: '2026-01-01', cents: 7000, label: '' }], schedule: monthly(20, '2026-01') }, 'Example Power Co');
  const sparkle = await mk({ title: 'Sparkle Cleaning', type: 'other', trackingSince: '2026-09-01', prices: [{ from: '2026-09-01', cents: 15000, label: '' }], schedule: monthly(15, '2026-09') }, 'Sparkle Cleaning Co');
  const link = (oid: number, slot: string, t: Txn) => recordFact({ obligationId: oid, slot, body: { fact: 'payment-link', ref: makeTxnRef(t) }, op: newOp(), today: TODAY }, d);
  await link(streamly, 'm2026-09', T3); await link(streamly, 'm2026-10', T2); await link(power, 'm2026-10', T4); await link(sparkle, 'm2026-10', T1);
  const clean = (await createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence: biweekly, expected: { basis: 'perVisit', cents: 7500 }, txnRefs: [makeTxnRef(T1)] }), provider: { name: 'Sparkle Cleaning Co' }, scheduleFirstVisit: true, today: TODAY }, d)).id;
  const pv = await previewServiceLink(sparkle, clean, 'linked', d);
  await applyServiceLink(sparkle, clean, 'linked', pv.token, TODAY, d);
  const home = await createAsset(blankAsset({ name: 'Family home', type: 'property' }), d);
  const svc = (over: Partial<ReturnType<typeof blankService>>) => insertService(blankService(home, over), d, TODAY);
  await svc({ title: 'Deep clean before listing', date: '2026-10-15', kind: 'maintenance', txnRefs: [makeTxnRef(T1)] });
  await svc({ title: 'Furnace repair', date: '2026-09-12', kind: 'repair', txnRefs: [makeTxnRef(T5), makeTxnRef(T6)] });
  await svc({ title: 'Gutter cleaning', date: '2026-10-05', kind: 'maintenance', costCents: 9500 });
  return { acct, T1, T2, T3, T4, T5, T6, bill: { streamly, sparkle, power }, clean, home };
}
