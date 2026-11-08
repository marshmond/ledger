import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import type { RecurringRule, Txn } from '../../types';
import { loadCycles } from './cycleData';
import { getObligation, loadObligations } from './data';
import { billSeedFromCandidate } from './discovery';
import { createFromSeed, decisionRow, loadDecisions, loadDiscovery, readDecision, recordDecision, rememberOnBill, removeDecision, snapOf } from './discoveryData';
import { financeSnapshot, fresh, monthly } from './billsTestkit';
import { blankObligation, MODULE } from './model';
import { newOp } from './cycleData';
import { applyUndo, isUndoRefused } from './undo';
import { MAX_PAYEE_HINTS } from './discoveryData';

/**
 * B3.1 discovery with a real database: the owner's choices, "make this a bill", "link to an existing bill". Invented data only.
 * Nothing here may create a bill, link a payment or touch Finance unless the test is exercising the explicit confirmation.
 */
const TODAY = '2026-11-20';
const shared = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const addAccount = async (d: FinanceDB) => (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
const seedMonthly = async (d: FinanceDB, payee: string, cents: number, day: number, months: string[]) => {
  const a = (await d.accounts.toArray())[0]?.id ?? (await addAccount(d));
  for (const m of months) await d.txns.add({ accountId: a, date: `${m}-${String(day).padStart(2, '0')}`, amountCents: -cents, payee, memo: '', status: 'cleared', categoryId: 7 } as Txn);
};
const M4 = ['2026-08', '2026-09', '2026-10', '2026-11'];
const addRule = async (d: FinanceDB, over: Partial<RecurringRule> = {}) => {
  const a = (await d.accounts.toArray())[0]?.id ?? (await addAccount(d));
  return (await d.recurring.add({ accountId: a, payee: 'Streamly Premium', amountCents: -1549, categoryId: 7, memo: '', frequency: 'monthly', startDate: '2026-01-12', active: true, ...over })) as number;
};
const seedFor = async (d: FinanceDB) => {
  const r = await loadDiscovery(TODAY, d);
  const c = r.suggestions[0];
  return { c, seed: billSeedFromCandidate(c), r };
};
const dataOf = (seed: Awaited<ReturnType<typeof seedFor>>['seed']) =>
  blankObligation({ title: seed.title, type: seed.type, amountKind: seed.amountKind, prices: [{ from: TODAY, cents: seed.amountCents, label: '' }], schedule: seed.schedule, trackingSince: TODAY, payeeHints: [seed.payeeHint], payment: { how: 'unknown', fundingAccountId: seed.fundingAccountId } }, TODAY);

describe('B3.1 discovery: looking writes nothing', () => {
  it('loading and reviewing suggestions repeatedly changes no table at all (no bill, no link, no Finance row)', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const before = `${await shared(d)}|${await financeSnapshot(d)}`;
    for (let i = 0; i < 3; i++) await loadDiscovery(TODAY, d);
    expect(`${await shared(d)}|${await financeSnapshot(d)}`).toBe(before);
    expect((await loadObligations(d)).length).toBe(0);
    expect((await loadCycles(d)).length).toBe(0);
  });

  it('finds the seeded monthly payments end to end, with their evidence', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const { c } = await seedFor(d);
    expect(c).toMatchObject({ payee: 'Streamly Premium', tier: 'strong', frequency: 'monthly', count: 4 });
    expect(c.occurrences.map((o) => o.date)).toEqual(['2026-08-12', '2026-09-12', '2026-10-12', '2026-11-12']);
  });
});

describe('B3.1 discovery: the owner\'s choices are stored as small records', () => {
  const input = async (d: FinanceDB, decision: 'not-recurring' | 'dismissed') => {
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const { c } = await seedFor(d);
    return { c, input: { key: c.key, decision, snap: snapOf(c), today: TODAY, op: newOp() } };
  };

  it('"not recurring" hides the suggestion, creates no bill, links no payment and changes no Finance row; the record holds no transaction or amount list', async () => {
    const d = fresh();
    const { c, input: i } = await input(d, 'not-recurring');
    const fin = await financeSnapshot(d);
    const r = await recordDecision(i, d);
    expect(r.reused).toBe(false);
    expect(await financeSnapshot(d)).toBe(fin);
    expect((await loadObligations(d)).length).toBe(0);
    expect((await loadCycles(d)).length).toBe(0);
    const after = await loadDiscovery(TODAY, d);
    expect(after.suggestions).toEqual([]);
    expect(after.hidden.map((x) => [x.key, x.state])).toEqual([[c.key, 'not-recurring']]);
    const row = (await d.moduleRecords.get(r.id))!;
    expect(row).toMatchObject({ module: MODULE, kind: 'discovery', data: { key: 'p:streamly premium', decision: 'not-recurring', on: TODAY, snap: { f: 'monthly', n: 4, last: '2026-11-12', cents: 1549 } } });
    expect(JSON.stringify(row.data)).not.toMatch(/txnId|occurrences|payee"/);
  });

  it('a repeated press records once; "dismiss for now" and "not recurring" are different choices', async () => {
    const d = fresh();
    const { input: i } = await input(d, 'dismissed');
    const a = await recordDecision(i, d);
    const b = await recordDecision(i, d);
    expect(b.reused).toBe(true);
    expect(b.id).toBe(a.id);
    expect((await loadDecisions(d))).toHaveLength(1);
    const c2 = await recordDecision({ ...i, decision: 'not-recurring', op: newOp() }, d);
    expect(c2.id).not.toBe(a.id);
    expect((await loadDecisions(d)).map((x) => x.decision).sort()).toEqual(['dismissed', 'not-recurring']);
  });

  it('"look at this again" brings the suggestion back (the record stays as history), guarded and undoable', async () => {
    const d = fresh();
    const { c, input: i } = await input(d, 'not-recurring');
    const r = await recordDecision(i, d);
    expect((await loadDiscovery(TODAY, d)).suggestions).toEqual([]);
    const row = (await decisionRow(r.id, d))!;
    expect(await err(removeDecision(r.id, row.updatedAt - 1, d))).toMatch(/changed \(maybe on another device\)/);
    const back = await removeDecision(r.id, row.updatedAt, d);
    expect((await loadDiscovery(TODAY, d)).suggestions.map((x) => x.key)).toEqual([c.key]);
    expect((await d.moduleRecords.get(r.id))!.deletedAt).not.toBeNull();
    await applyUndo(back.undo, d);
    expect((await loadDiscovery(TODAY, d)).suggestions).toEqual([]);
    expect(await err(removeDecision(999999, 1, d))).toMatch(/no longer be changed/);
  });

  it('a materially new pattern resurfaces: more payments after "not recurring" bring it back', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, ['2026-09', '2026-10', '2026-11']);
    const first = (await loadDiscovery(TODAY, d)).suggestions[0];
    await recordDecision({ key: first.key, decision: 'not-recurring', snap: snapOf(first), today: TODAY, op: newOp() }, d);
    expect((await loadDiscovery(TODAY, d)).suggestions).toEqual([]);
    await seedMonthly(d, 'Streamly Premium', 1549, 12, ['2026-12', '2027-01', '2027-02']);
    const later = await loadDiscovery('2027-02-20', d);
    expect(later.suggestions).toHaveLength(1);
    expect(later.suggestions[0].count).toBe(6);
  });

  it('damaged choice records are ignored, never rewritten, and hide nothing; unknown fields survive', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    await d.moduleRecords.add({ id: 920001, module: MODULE, kind: 'discovery', data: { key: 'p:streamly premium', decision: 'invented', on: TODAY }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.moduleRecords.add({ id: 920002, module: MODULE, kind: 'discovery', data: { key: 5, decision: 'dismissed' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const raw = JSON.stringify([await d.moduleRecords.get(920001), await d.moduleRecords.get(920002)]);
    expect(readDecision((await d.moduleRecords.get(920001))!)).toBeNull();
    expect((await loadDiscovery(TODAY, d)).suggestions).toHaveLength(1);
    expect(JSON.stringify([await d.moduleRecords.get(920001), await d.moduleRecords.get(920002)])).toBe(raw);
    await d.moduleRecords.add({ id: 920003, module: MODULE, kind: 'discovery', data: { key: 'p:streamly premium', decision: 'dismissed', on: TODAY, snap: { n: 4, last: '2026-11-12', cents: 1549 }, futureField: { keep: [1] } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const row = (await decisionRow(920003, d))!;
    const out = await removeDecision(920003, row.updatedAt, d);
    await applyUndo(out.undo, d);
    expect((await d.moduleRecords.get(920003))!.data).toMatchObject({ futureField: { keep: [1] } });
  });

  it('an injected failure while recording a choice leaves nothing behind', async () => {
    const d = fresh();
    const { input: i } = await input(d, 'dismissed');
    const before = await shared(d);
    d.moduleRecords.hook('creating', (_k, obj) => { if ((obj as { kind?: string }).kind === 'discovery') throw new Error('injected failure'); });
    expect(await err(recordDecision(i, d))).toMatch(/injected failure/);
    expect(await shared(d)).toBe(before);
    expect(await err(recordDecision({ ...i, key: 'streamly', op: newOp() }, d))).toBeTruthy();
    expect(await err(recordDecision({ ...i, decision: 'tracked', obligationId: null, op: newOp() }, d))).toBeTruthy();
  });
});

describe('B3.1 "Create a bill from this suggestion": explicit, atomic, and carrying no payments', () => {
  it('creates the bill the owner confirmed and a "tracked" record, together; the bill starts with no payment links and Finance is untouched', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const { c, seed } = await seedFor(d);
    const fin = await financeSnapshot(d);
    const out = await createFromSeed({ data: dataOf(seed), provider: { name: seed.providerName }, today: TODAY, from: { key: c.key, snap: snapOf(c), op: newOp() } }, d);
    expect(out.reused).toBe(false);
    const bill = (await getObligation(out.id, d))!;
    expect(bill.data).toMatchObject({ title: 'Streamly Premium', amountKind: 'fixed', payeeHints: ['streamly premium'], scheduledRuleIds: [] });
    expect((await loadCycles(d)).length).toBe(0); // no payment link, no fact: history is linked separately, by the owner
    expect(await financeSnapshot(d)).toBe(fin);
    const after = await loadDiscovery(TODAY, d);
    expect(after.suggestions).toEqual([]);
    expect(after.tracked.map((x) => [x.key, x.existing!.id])).toEqual([[c.key, out.id]]);
  });

  it('a repeated press with the same operation reuses the first bill: one bill, one record', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const { c, seed } = await seedFor(d);
    const from = { key: c.key, snap: snapOf(c), op: newOp() };
    const a = await createFromSeed({ data: dataOf(seed), provider: { name: seed.providerName }, today: TODAY, from }, d);
    const b = await createFromSeed({ data: dataOf(seed), provider: { name: seed.providerName }, today: TODAY, from }, d);
    expect(b.reused).toBe(true);
    expect(b.id).toBe(a.id);
    expect((await loadObligations(d))).toHaveLength(1);
    expect((await loadDecisions(d))).toHaveLength(1);
  });

  it('an existing provider Contact is reused, never doubled', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const { seed } = await seedFor(d);
    await createFromSeed({ data: dataOf(seed), provider: { name: 'streamly premium' }, today: TODAY }, d);
    await createFromSeed({ data: { ...dataOf(seed), title: 'Streamly again' }, provider: { name: 'Streamly Premium' }, today: TODAY }, d);
    expect((await d.contacts.toArray()).filter((x) => !x.deletedAt)).toHaveLength(1);
  });

  it('with a Finance Scheduled rule: the bill is created WITH the link, in one step, and the rule is untouched', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const ruleId = await addRule(d);
    const { c, seed } = await seedFor(d);
    expect(seed.ruleId).toBe(ruleId);
    const fin = await financeSnapshot(d);
    const out = await createFromSeed({ data: dataOf(seed), provider: { name: seed.providerName }, today: TODAY, from: { key: c.key, snap: snapOf(c), op: newOp() }, ruleId }, d);
    expect((await getObligation(out.id, d))!.data.scheduledRuleIds).toEqual([ruleId]);
    expect(await financeSnapshot(d)).toBe(fin);
  });

  it('a rule that cannot be linked (income, held by another bill, deleted) stops the WHOLE creation: no bill, no record, no new Contact', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const { c, seed } = await seedFor(d);
    const holder = await createFromSeed({ data: { ...dataOf(seed), title: 'Holder' }, today: TODAY, ruleId: await addRule(d) }, d);
    const heldRule = (await getObligation(holder.id, d))!.data.scheduledRuleIds[0];
    const income = await addRule(d, { amountCents: 5000, payee: 'Paycheck' });
    const before = await shared(d);
    const go = (ruleId: number) => err(createFromSeed({ data: dataOf(seed), provider: { name: 'A Brand New Provider' }, today: TODAY, from: { key: c.key, snap: snapOf(c), op: newOp() }, ruleId }, d));
    expect(await go(heldRule)).toMatch(/already linked to "Holder"/);
    expect(await go(income)).toMatch(/scheduled income/);
    expect(await go(31337)).toMatch(/not on this device, or it was deleted/);
    expect(await shared(d)).toBe(before);
  });

  it('an injected failure while writing the "tracked" record rolls back the bill and the Contact too', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const { c, seed } = await seedFor(d);
    const before = await shared(d);
    d.moduleRecords.hook('creating', (_k, obj) => { if ((obj as { kind?: string }).kind === 'discovery') throw new Error('injected failure'); });
    expect(await err(createFromSeed({ data: dataOf(seed), provider: { name: 'Streamly Premium' }, today: TODAY, from: { key: c.key, snap: snapOf(c), op: newOp() } }, d))).toMatch(/injected failure/);
    expect(await shared(d)).toBe(before);
    expect((await loadObligations(d)).length).toBe(0);
  });

  it('Undo takes the whole addition back (the Contact is kept) and is refused if the bill changed since', async () => {
    const d = fresh();
    await seedMonthly(d, 'Streamly Premium', 1549, 12, M4);
    const { c, seed } = await seedFor(d);
    const out = await createFromSeed({ data: dataOf(seed), provider: { name: 'Streamly Premium' }, today: TODAY, from: { key: c.key, snap: snapOf(c), op: newOp() } }, d);
    await applyUndo(out.undo, d);
    expect((await loadObligations(d)).length).toBe(0);
    expect((await loadDiscovery(TODAY, d)).suggestions).toHaveLength(1);
    const again = await createFromSeed({ data: dataOf(seed), provider: { name: 'Streamly Premium' }, today: TODAY, from: { key: c.key, snap: snapOf(c), op: newOp() } }, d);
    const row = (await d.moduleRecords.get(again.id))!;
    await d.moduleRecords.update(again.id, { data: { ...(row.data as object), notes: 'edited' } });
    let refused = false;
    try { await applyUndo(again.undo, d); } catch (e) { refused = isUndoRefused(e); }
    expect(refused).toBe(true);
  });
});

describe('B3.1 "Link to an existing bill": the owner names the bill; Ledger remembers the payee only if they agree', () => {
  const setup = async () => {
    const d = fresh();
    await seedMonthly(d, 'STREAMLY*PREMIUM', 1549, 12, M4);
    const bill = await createFromSeed({ data: blankObligation({ title: 'My video thing', type: 'subscription', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 1549, label: '' }], schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01' }, TODAY), today: TODAY }, d);
    const c = (await loadDiscovery(TODAY, d)).suggestions[0];
    return { d, bill, c };
  };

  it('with consent the payee words are added to the bill and the choice is recorded; the suggestion stops; nothing else changes', async () => {
    const { d, bill, c } = await setup();
    const fin = await financeSnapshot(d);
    const o = (await getObligation(bill.id, d))!;
    const r = await rememberOnBill({ obligationId: bill.id, expect: o.updatedAt, from: { key: c.key, snap: snapOf(c), op: newOp() }, hint: 'streamly premium', today: TODAY }, d);
    expect(r.reused).toBe(false);
    const after = (await getObligation(bill.id, d))!;
    expect(after.data.payeeHints).toEqual(['streamly premium']);
    expect(after.data.lifecycle.at(-1)!.kind).toMatch(/remember a payee/);
    expect(await financeSnapshot(d)).toBe(fin);
    expect((await loadCycles(d)).length).toBe(0);
    expect((await loadDiscovery(TODAY, d)).tracked.map((x) => x.existing!.id)).toEqual([bill.id]);
  });

  it('without consent only the choice is recorded and the bill is not edited', async () => {
    const { d, bill, c } = await setup();
    const o = (await getObligation(bill.id, d))!;
    await rememberOnBill({ obligationId: bill.id, expect: o.updatedAt, from: { key: c.key, snap: snapOf(c), op: newOp() }, hint: null, today: TODAY }, d);
    expect((await getObligation(bill.id, d))!.updatedAt).toBe(o.updatedAt);
    expect((await loadDecisions(d)).map((x) => [x.decision, x.obligationId])).toEqual([['tracked', bill.id]]);
  });

  it('a stale form and a repeated press are refused or reused; too many remembered payees are refused; a missing bill is refused', async () => {
    const { d, bill, c } = await setup();
    const o = (await getObligation(bill.id, d))!;
    const from = { key: c.key, snap: snapOf(c), op: newOp() };
    expect(await err(rememberOnBill({ obligationId: bill.id, expect: o.updatedAt - 1, from, hint: 'x', today: TODAY }, d))).toMatch(/changed \(maybe on another device\)/);
    await rememberOnBill({ obligationId: bill.id, expect: o.updatedAt, from, hint: 'streamly premium', today: TODAY }, d);
    const again = await rememberOnBill({ obligationId: bill.id, expect: null, from, hint: 'streamly premium', today: TODAY }, d);
    expect(again.reused).toBe(true);
    expect((await getObligation(bill.id, d))!.data.payeeHints).toEqual(['streamly premium']);
    const full = await getObligation(bill.id, d);
    await d.moduleRecords.update(bill.id, { data: { ...(full!.data as object), payeeHints: Array.from({ length: MAX_PAYEE_HINTS }, (_, i) => `word${i}`) } });
    expect(await err(rememberOnBill({ obligationId: bill.id, expect: null, from: { ...from, op: newOp() }, hint: 'one more', today: TODAY }, d))).toMatch(/at most/);
    expect(await err(rememberOnBill({ obligationId: 99999, expect: null, from: { ...from, op: newOp() }, hint: null, today: TODAY }, d))).toMatch(/no longer exists/);
  });
});
