import { describe, expect, it } from 'vitest';
import type { FinanceDB } from '../../db';
import { makeTxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { createObligation, getObligation } from './data';
import { newOp, recordFact } from './cycleData';
import { acknowledgeEvidence, applyLifecycle, previewLifecycle } from './lifecycleData';
import { priceNotice } from './priceEvidence';
import { derive, loadBillsSnapshot } from './readModel';
import { financeSnapshot, fresh, monthly, ob } from './billsTestkit';
import type { ObligationData } from './model';

/**
 * B4 section 4: a latest payment that differs from the expected price is a REASON TO LOOK. Ledger never rewrites the expected price, never records a price step by itself,
 * never assumes the difference is permanent, a contract change, or more than tax, a fee, a credit or a proration. Invented data only.
 */
const TODAY = '2026-11-20';
const mk = (over: Partial<ObligationData> = {}): ObligationData => ob({ title: 'Streamly Premium', providerNameSnapshot: 'Streamly', type: 'subscription', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 1499, label: '' }], schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', payment: { how: 'auto', fundingAccountId: null }, ...over }, TODAY);

async function world(over: Partial<ObligationData> = {}) {
  const d = fresh('b4price');
  const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
  const id = (await createObligation({ data: mk(over), provider: { name: 'Streamly' }, today: TODAY }, d)).id;
  return { d, acct, id };
}
const pay = async (d: FinanceDB, acct: number, id: number, slot: string, date: string, cents: number) => {
  const t: Txn = { accountId: acct, date, amountCents: -cents, payee: 'Streamly Premium', memo: '', status: 'cleared', categoryId: 5 };
  const tid = (await d.txns.add(t)) as number;
  await recordFact({ obligationId: id, slot, body: { fact: 'payment-link', ref: makeTxnRef({ ...t, id: tid }) }, op: newOp(), today: TODAY }, d);
};
const notice = async (d: FinanceDB, id: number) => { const x = derive(await loadBillsSnapshot(d), TODAY); return priceNotice(x.snap.obligations.find((o) => o.id === id)!, x.recorded.get(id) ?? [], TODAY); };

describe('B4 a payment that differs from the expected price', () => {
  it('raises a notice with the evidence, and changes NOTHING: not the expected price, not a price step, not Finance', async () => {
    const { d, acct, id } = await world();
    await pay(d, acct, id, 'm2026-10', '2026-10-12', 1499);
    await pay(d, acct, id, 'm2026-11', '2026-11-12', 1799);
    const before = JSON.stringify(await d.moduleRecords.toArray()), fin = await financeSnapshot(d);
    const n = await notice(d, id);
    expect(n).toMatchObject({ slot: 'm2026-11', paidCents: 1799, expectedCents: 1499, differenceCents: 300, matchedBefore: 1, acknowledged: false });
    expect(JSON.stringify(await d.moduleRecords.toArray())).toBe(before);
    expect(await financeSnapshot(d)).toBe(fin);
    const o = (await getObligation(id, d))!;
    expect(o.data.lc).toBeUndefined(); // no lifecycle record: no price step was made
    expect(o.data.prices).toEqual([{ from: '2026-01-01', cents: 1499, label: '' }]); // the expected price is untouched
  });

  it('no notice when the payment matches the expected price, when a bill was recorded (that is what is owed), when a credit explains it, or when the amount varies', async () => {
    const a = await world();
    await pay(a.d, a.acct, a.id, 'm2026-11', '2026-11-12', 1499);
    expect(await notice(a.d, a.id)).toBeNull();
    const b = await world();
    await recordFact({ obligationId: b.id, slot: 'm2026-11', body: { fact: 'invoice', invoicedCents: 1799, invoiceDate: null, dueDate: null, invoiceNumber: '', nominal: null }, op: newOp(), today: TODAY }, b.d);
    await pay(b.d, b.acct, b.id, 'm2026-11', '2026-11-12', 1799);
    expect(await notice(b.d, b.id)).toBeNull();
    const c = await world();
    await recordFact({ obligationId: c.id, slot: 'm2026-11', body: { fact: 'credit', cents: 300, note: 'goodwill' }, op: newOp(), today: TODAY }, c.d);
    await pay(c.d, c.acct, c.id, 'm2026-11', '2026-11-12', 1199);
    expect(await notice(c.d, c.id)).toBeNull();
    const v = await world({ amountKind: 'variable' });
    await pay(v.d, v.acct, v.id, 'm2026-11', '2026-11-12', 1799);
    expect(await notice(v.d, v.id)).toBeNull();
  });

  it('a provider charging DURING a trial despite the expected zero price is noticed the same way (expected zero, paid more), and still nothing is changed', async () => {
    const { d, acct, id } = await world();
    const a = { type: 'trial', startsOn: '2026-11-01', endsOn: '2026-12-01', paymentOnFile: 'yes', conversion: 'auto', convertsToCents: 1499, cadence: 'monthly', mustCancel: false, noticeBy: null, note: '', makePrices: true } as const;
    const p = await previewLifecycle(id, a, TODAY, (c) => `$${c / 100}`, d);
    expect(p.problem).toBeNull();
    await applyLifecycle(id, a, p.token, TODAY, d);
    await pay(d, acct, id, 'm2026-11', '2026-11-12', 1499);
    const n = await notice(d, id);
    expect(n).toMatchObject({ slot: 'm2026-11', paidCents: 1499, expectedCents: 0, differenceCents: 1499 });
    expect((await getObligation(id, d))!.data.lc!.priceRows.find((r) => r.label === 'free trial')?.cents).toBe(0); // the zero price was not rewritten
  });

  it('a lower payment is a partial payment, not a price notice (the partly-paid review already covers it)', async () => {
    const { d, acct, id } = await world();
    await pay(d, acct, id, 'm2026-11', '2026-11-12', 999);
    expect(await notice(d, id)).toBeNull();
  });

  it('only the owner can act on it: "Leave as is" quiets that exact payment and a different payment raises it again; recording the price (their choice) clears it and leaves the paid period alone', async () => {
    const { d, acct, id } = await world();
    await pay(d, acct, id, 'm2026-11', '2026-11-12', 1799);
    const n = (await notice(d, id))!;
    await acknowledgeEvidence(id, n.key, TODAY, d);
    expect((await notice(d, id))?.acknowledged).toBe(true);
    // a further payment linked to the same period changes the evidence (a different paid total), so it is raised again
    await pay(d, acct, id, 'm2026-11', '2026-11-19', 200);
    expect((await notice(d, id))?.acknowledged).toBe(false);
    // the owner records a price step themselves (a normal, previewed action)
    const a = { type: 'price', from: '2026-11-01', until: null, cents: 1999, status: 'fixed', label: '', source: 'finance', note: '' } as const;
    const p = await previewLifecycle(id, a, TODAY, (c) => `$${c / 100}`, d);
    expect(p.problem).toBeNull();
    await applyLifecycle(id, a, p.token, TODAY, d);
    expect(await notice(d, id)).toBeNull();
  });
});
