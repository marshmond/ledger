import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { makeTxnRef } from '../../lib/txnRef';
import type { RecurringRule, Split, Txn } from '../../types';
import { loadTasks } from '../tasks/data';
import { editFact, loadCycles, newOp, reconsiderRejection, recordFact, rejectSuggestion, removeFact } from './cycleData';
import { createObligation, getObligation, loadObligations } from './data';
import { attention, derive, loadBillsSnapshot } from './readModel';
import { periodsOf, type Period } from './periods';
import { financeSnapshot, fresh, monthly, ob } from './billsTestkit';
import { MODULE, type ObligationData } from './model';
import { loadSuggestions } from './suggestData';
import { acknowledgeRuleConflict, keepRuleOn, linkRule, loadLinkedRules, loadRuleChoices, unlinkRule } from './scheduledLinkData';
import { ruleLinkConflicts } from './scheduledLink';
import { applyUndo, isUndoRefused } from './undo';
import { lookupOfMap } from '../../lib/txnLookup';

/**
 * B3.1 with a real database (fake-indexeddb): rejection facts, read-only suggestions, and the Finance Scheduled link. Invented data only.
 * Today is 2026-11-20; the November bill (the 18th) is two days past due, the manual-pay window is 11 to 28 November.
 */
const TODAY = '2026-11-20';
const SLOT = 'm2026-11';
const OLD = '2026-01-01';

const mk = (d: FinanceDB, over: Partial<ObligationData> = {}) =>
  createObligation({ data: ob({ title: 'Example Power Co', providerNameSnapshot: 'Example Power Co', amountKind: 'fixed', prices: [{ from: OLD, cents: 12000, label: '' }], schedule: monthly(18, '2026-01'), trackingSince: OLD, ...over }, TODAY), provider: { name: 'Example Power Co' }, today: TODAY }, d);

const account = async (d: FinanceDB) => (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
const addTxn = async (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}): Promise<Txn> => {
  const a = (await d.accounts.toArray())[0]?.id ?? (await account(d));
  const t: Txn = { accountId: a, date: '2026-11-18', amountCents, payee: 'Example Power Co', memo: '', status: 'pending', categoryId: 5, ...over };
  return { ...t, id: (await d.txns.add(t)) as number };
};
const addRule = async (d: FinanceDB, over: Partial<RecurringRule> = {}) => {
  const a = (await d.accounts.toArray())[0]?.id ?? (await account(d));
  return (await d.recurring.add({ accountId: a, payee: 'Example Power Co', amountCents: -12000, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-18', active: true, ...over })) as number;
};
const period = async (d: FinanceDB, id: number, slot = SLOT, today = TODAY): Promise<Period> => {
  const o = (await getObligation(id, d))!;
  const snap = await loadBillsSnapshot(d);
  return periodsOf(o, snap.cycles, today, { from: '2026-01-01', to: '2027-12-31' }, { allRecorded: true, lookup: lookupOfMap(snap.financeTxns) }).find((p) => p.slot === slot)!;
};
const suggest = async (d: FinanceDB, id: number, slot = SLOT, today = TODAY) => loadSuggestions((await getObligation(id, d))!, await period(d, id, slot, today), today, d);
const shared = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
const everything = async (d: FinanceDB) => `${await shared(d)}|${await financeSnapshot(d)}`;
const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const reject = (d: FinanceDB, obligationId: number, t: Txn, o: { slot?: string; split?: number; op?: string } = {}) =>
  rejectSuggestion({ obligationId, slot: o.slot ?? SLOT, ref: makeTxnRef(t, o.split), op: o.op ?? newOp() }, d);

describe('B3.1 "Not this payment": a rejection fact for ONE period', () => {
  it('writes exactly one cycle record holding the reference; counts nothing; changes no Finance record, Task or status', async () => {
    const d = fresh();
    const { id } = await mk(d, { reminders: { payTask: true, leadDays: 3 } });
    const t = await addTxn(d, -12000);
    const tasksBefore = JSON.stringify(await loadTasks(d));
    const before = await everything(d);
    const periodBefore = await period(d, id);
    const r = await reject(d, id, t);
    expect(r.reused).toBe(false);
    const row = (await d.moduleRecords.get(r.id))!;
    expect(row).toMatchObject({ module: MODULE, kind: 'cycle', data: { obligationId: id, slot: SLOT, fact: 'suggestion-reject', ref: { txnId: t.id } } });
    expect(Object.keys((row.data as { ref: object }).ref).sort()).toEqual(['snapshot', 'txnId']); // a reference, never money
    expect(JSON.stringify(await loadTasks(d))).toBe(tasksBefore); // no reminder Task made or changed
    expect(await financeSnapshot(d)).toBe(before.split('|')[1]); // Finance byte-identical, including the transaction's status
    const after = await period(d, id);
    expect(after.amounts).toEqual(periodBefore.amounts);
    expect(after.label).toBe(periodBefore.label);
    expect(after.declared).toBe(false);
    expect(after.skipped).toBe(false);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).total).toBe(attention(derive({ ...(await loadBillsSnapshot(d)), cycles: [] }, TODAY)).total);
  });

  it('a repeated press (same operation) writes once; rejecting the same piece again, for the same period, reuses the record; another period is separate', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const op = newOp();
    const a = await reject(d, id, t, { op });
    const b = await reject(d, id, t, { op });
    const c = await reject(d, id, t);
    expect([b.reused, c.reused]).toEqual([true, true]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect((await loadCycles(d)).filter((x) => x.body?.fact === 'suggestion-reject')).toHaveLength(1);
    const other = await reject(d, id, t, { slot: 'm2026-12' });
    expect(other.id).not.toBe(a.id);
  });

  it('its scope is the period: rejecting November hides it in November only, and the rejected list says so', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const nov = await addTxn(d, -12000, { date: '2026-11-18' });
    const dec = await addTxn(d, -12000, { date: '2026-12-18' });
    expect((await suggest(d, id)).suggestions.map((s) => s.txn.id)).toEqual([nov.id]);
    await reject(d, id, nov);
    const afterNov = await suggest(d, id);
    expect(afterNov.suggestions).toEqual([]);
    expect(afterNov.rejected).toHaveLength(1);
    const decSuggest = await suggest(d, id, 'm2026-12', '2026-12-20');
    expect(decSuggest.suggestions.map((s) => s.txn.id)).toEqual([dec.id]);
    expect(decSuggest.rejected).toEqual([]);
  });

  it('survives a reload (it is a stored fact), and "look at it again" brings the suggestion back while the record stays as history', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const r = await reject(d, id, t);
    expect((await suggest(d, id)).suggestions).toEqual([]); // a fresh read of the database
    const row = (await d.moduleRecords.get(r.id))!;
    await reconsiderRejection(r.id, row.updatedAt, d);
    expect((await suggest(d, id)).suggestions.map((s) => s.txn.id)).toEqual([t.id]);
    const kept = (await d.moduleRecords.get(r.id))!;
    expect(kept.deletedAt).not.toBeNull(); // soft deleted: still there, auditable
    expect(kept.data).toMatchObject({ fact: 'suggestion-reject', ref: { txnId: t.id } });
  });

  it('reconsidering is guarded: refused when the record changed since it was opened, and Undo restores the rejection (or is refused if something changed)', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const r = await reject(d, id, t);
    const stale = (await d.moduleRecords.get(r.id))!.updatedAt - 1;
    expect(await err(reconsiderRejection(r.id, stale, d))).toMatch(/changed \(maybe on another device\)/);
    expect((await d.moduleRecords.get(r.id))!.deletedAt).toBeNull();
    const gone = await reconsiderRejection(r.id, (await d.moduleRecords.get(r.id))!.updatedAt, d);
    await applyUndo(gone.undo, d);
    expect((await suggest(d, id)).suggestions).toEqual([]); // rejected again
    const again = await reconsiderRejection(r.id, (await d.moduleRecords.get(r.id))!.updatedAt, d);
    await d.moduleRecords.update(r.id, { data: { ...((await d.moduleRecords.get(r.id))!.data as object), edited: true } }); // something else touched it
    let refused = false;
    try { await applyUndo(again.undo, d); } catch (e) { refused = isUndoRefused(e); }
    expect(refused).toBe(true);
  });

  it('Undo of the rejection itself removes it, and a changed record refuses the Undo without writing', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const r = await reject(d, id, t);
    await applyUndo(r.undo, d);
    expect((await suggest(d, id)).suggestions.map((s) => s.txn.id)).toEqual([t.id]);
    const r2 = await reject(d, id, t, { slot: 'm2026-12' });
    await d.moduleRecords.update(r2.id, { data: { ...((await d.moduleRecords.get(r2.id))!.data as object), edited: true } });
    const snap = await shared(d);
    let refused = false;
    try { await applyUndo(r2.undo, d); } catch (e) { refused = isUndoRefused(e); }
    expect(refused).toBe(true);
    expect(await shared(d)).toBe(snap);
  });

  it('a rejection cannot be edited, is refused for a bill or reference that does not exist, and a damaged one rejects nothing', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const r = await reject(d, id, t);
    const row = (await d.moduleRecords.get(r.id))!;
    expect(await err(editFact(r.id, { fact: 'suggestion-reject', ref: makeTxnRef(t) }, row.updatedAt, TODAY, d))).toMatch(/rejection cannot be edited/);
    expect(await err(reject(d, 99999, t))).toMatch(/no longer exists/);
    expect(await err(rejectSuggestion({ obligationId: id, slot: 'not-a-slot', ref: makeTxnRef(t), op: newOp() }, d))).toMatch(/not a billing period/);
    expect(await err(rejectSuggestion({ obligationId: id, slot: SLOT, ref: { txnId: 1.5 } as never, op: newOp() }, d))).toBeTruthy();
    await d.moduleRecords.add({ id: 910001, module: MODULE, kind: 'cycle', data: { obligationId: id, slot: SLOT, fact: 'suggestion-reject', ref: { nonsense: true } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const read = (await loadCycles(d)).find((c) => c.id === 910001)!;
    expect(read.body).toBeNull(); // unreadable: kept exactly, rejects nothing
    expect((await suggest(d, id)).rejected).toHaveLength(1);
  });

  it('unknown fields on a rejection survive being set aside and brought back', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    await d.moduleRecords.add({ id: 910002, module: MODULE, kind: 'cycle', data: { obligationId: id, slot: SLOT, fact: 'suggestion-reject', ref: makeTxnRef(t), futureField: { deep: [1, 2] } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const out = await reconsiderRejection(910002, (await d.moduleRecords.get(910002))!.updatedAt, d);
    await applyUndo(out.undo, d);
    expect((await d.moduleRecords.get(910002))!.data).toMatchObject({ fact: 'suggestion-reject', futureField: { deep: [1, 2] } });
  });

  it('an injected failure while rejecting leaves no partial record', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const before = await shared(d);
    d.moduleRecords.hook('creating', (_k, obj) => { if ((obj as { data?: { fact?: string } }).data?.fact === 'suggestion-reject') throw new Error('injected failure'); });
    expect(await err(reject(d, id, t))).toMatch(/injected failure/);
    expect(await shared(d)).toBe(before);
  });
});

describe('B3.1 suggestions: viewing writes nothing, and confirming is the existing B3 link, once', () => {
  it('loading suggestions repeatedly changes no table (Finance, links, contacts, records)', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await addTxn(d, -12000);
    await addTxn(d, 12000, { date: '2026-11-25' });
    const before = await everything(d);
    for (let i = 0; i < 3; i++) await suggest(d, id);
    expect(await everything(d)).toBe(before);
  });

  it('a Finance transaction near the due date is suggested with its evidence; an exact payee and amount is strong', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000, { date: '2026-11-17' });
    await addTxn(d, -5000, { payee: 'Corner Grocery' });
    const r = await suggest(d, id);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ tier: 'strong', needsReview: false });
    expect(r.suggestions[0].txn.id).toBe(t.id);
  });

  it('confirming goes through recordFact (the B3 validation), writes ONE link, and the suggestion is then gone for that period', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const s = (await suggest(d, id)).suggestions[0];
    const before = await financeSnapshot(d);
    await recordFact({ obligationId: id, slot: SLOT, body: { fact: 'payment-link', ref: s.ref }, op: newOp(), today: TODAY }, d);
    expect((await loadCycles(d)).filter((c) => c.body?.fact === 'payment-link')).toHaveLength(1);
    expect(await financeSnapshot(d)).toBe(before);
    expect((await suggest(d, id)).suggestions).toEqual([]);
    expect(t.id).toBe(s.txn.id);
  });

  it('a suggestion that goes stale before it is confirmed is refused by the existing write checks and writes nothing', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const s = (await suggest(d, id)).suggestions[0];
    await d.txns.delete(t.id!); // deleted in Finance while the owner was reading
    const before = await shared(d);
    expect(await err(recordFact({ obligationId: id, slot: SLOT, body: { fact: 'payment-link', ref: s.ref }, op: newOp(), today: TODAY }, d))).toMatch(/no longer exists/);
    expect(await shared(d)).toBe(before);
    const parts: Split[] = [{ amountCents: -7000, categoryId: 5 }, { amountCents: -5000, categoryId: 6 }];
    const split = await addTxn(d, -12000, { splits: parts, payee: 'Example Power Co' });
    const v = await mk(d, { title: 'Example Power Co extra', amountKind: 'variable', prices: [] });
    const sp = (await suggest(d, v.id)).suggestions.find((x) => x.part?.index === 0)!;
    await d.txns.update(split.id!, { splits: [parts[1], parts[0]] }); // reordered in Finance
    const b2 = await shared(d);
    expect(await err(recordFact({ obligationId: v.id, slot: SLOT, body: { fact: 'payment-link', ref: sp.ref }, op: newOp(), today: TODAY }, d))).toMatch(/has changed|Pick it again/);
    expect(await shared(d)).toBe(b2);
  });

  it('a payment posted from the linked Scheduled rule is strong evidence, but only the posted log counts: a passed date with nothing posted suggests nothing', async () => {
    const d = fresh();
    const ruleId = await addRule(d);
    const { id } = await mk(d, { scheduledRuleIds: [ruleId] });
    expect((await suggest(d, id)).suggestions).toEqual([]);
    expect((await suggest(d, id)).none).not.toMatch(/paid/i);
    const t = await addTxn(d, -12000, { payee: 'Some Label', recurringId: ruleId });
    await d.recurringLog.add({ ruleId, date: '2026-11-18', action: 'posted', txnId: t.id });
    const r = await suggest(d, id);
    expect(r.suggestions[0]).toMatchObject({ tier: 'strong', fromRule: { ruleId, scheduledDate: '2026-11-18' } });
  });

  it('a payment another module already uses (a Household Services visit referencing it) is shown separately, not recommended', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    await d.moduleRecords.add({ module: 'services', kind: 'visit', data: { title: 'Example visit', txnRefs: [makeTxnRef(t)] }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const r = await suggest(d, id);
    expect(r.suggestions).toEqual([]);
    expect(r.elsewhere[0].elsewhere.modules).toEqual(['Household Services']);
  });

  it('a payment linked to another bill is shown as shared; the same payment can legitimately feed two bills, and nothing is divided', async () => {
    const d = fresh();
    const a = await mk(d);
    const b = await mk(d, { title: 'Example Gas Co', providerNameSnapshot: 'Example Gas Co', prices: [{ from: OLD, cents: 4000, label: '' }] });
    const t = await addTxn(d, -12000);
    await recordFact({ obligationId: b.id, slot: SLOT, body: { fact: 'payment-link', ref: makeTxnRef(t) }, op: newOp(), today: TODAY }, d);
    const r = await suggest(d, a.id);
    expect(r.suggestions).toEqual([]);
    expect(r.elsewhere[0].elsewhere.bills[0].title).toBe('Example Gas Co');
    expect(r.elsewhere[0].needsReview).toBe(true);
  });
});

describe('B3.1 Finance Scheduled link (real database)', () => {
  it('links one existing spending rule: only the bill changes, the rule and every Finance table are byte-identical, and the bill shows it', async () => {
    const d = fresh();
    const ruleId = await addRule(d);
    const { id } = await mk(d);
    const fin = await financeSnapshot(d);
    const ob0 = (await getObligation(id, d))!;
    await linkRule({ obligationId: id, ruleId, expect: ob0.updatedAt, today: TODAY }, d);
    expect(await financeSnapshot(d)).toBe(fin);
    const o = (await getObligation(id, d))!;
    expect(o.data.scheduledRuleIds).toEqual([ruleId]);
    expect(o.data.lifecycle.at(-1)!.kind).toBe('linked a Finance scheduled payment');
    const { views } = await loadLinkedRules(o, TODAY, d);
    expect(views[0].rule!.payee).toBe('Example Power Co');
    expect(views[0].next).toBe('2026-12-18');
    expect(views[0].notes).toEqual([]);
    expect((await loadCycles(d)).length).toBe(0); // no payment, no billing-period fact
  });

  it('refuses income, a transfer, a missing rule, a rule another bill holds, an ended bill and a loan bill, each writing nothing', async () => {
    const d = fresh();
    const income = await addRule(d, { amountCents: 300000, payee: 'Paycheck' });
    const accts = await d.accounts.toArray();
    const transfer = await addRule(d, { transferAccountId: accts[0].id, payee: 'To Savings' });
    const good = await addRule(d);
    const holder = await mk(d, { title: 'Holder bill', providerNameSnapshot: 'Holder' });
    await linkRule({ obligationId: holder.id, ruleId: good, expect: null, today: TODAY }, d);
    const { id } = await mk(d, { title: 'Other bill', providerNameSnapshot: 'Other' });
    const ended = await mk(d, { title: 'Ended bill', status: 'ended', endedOn: '2026-10-01', endReason: 'cancelled' });
    const loan = await mk(d, { title: 'Loan bill', type: 'loan' });
    const before = await everything(d);
    const go = (obligationId: number, ruleId: number) => err(linkRule({ obligationId, ruleId, expect: null, today: TODAY }, d));
    expect(await go(id, income)).toMatch(/scheduled income/);
    expect(await go(id, transfer)).toMatch(/between your own accounts/);
    expect(await go(id, 424242)).toMatch(/not on this device, or it was deleted/);
    expect(await go(id, good)).toMatch(/already linked to "Holder bill"/);
    expect(await go(ended.id, await addRule(d, { payee: 'Fresh' }))).toMatch(/ended bill cannot be linked/);
    expect(await go(loan.id, await addRule(d, { payee: 'Fresh 2' }))).toMatch(/Loans page/);
    const after = await everything(d);
    expect(after.split('|')[0]).toBe(before.split('|')[0]); // nothing in Bills changed (the extra rules added above are the test's own Finance rows)
  });

  it('a stale form is refused; a double submit links once and the repeat is visibly refused', async () => {
    const d = fresh();
    const ruleId = await addRule(d);
    const { id } = await mk(d);
    const o = (await getObligation(id, d))!;
    expect(await err(linkRule({ obligationId: id, ruleId, expect: o.updatedAt - 1, today: TODAY }, d))).toMatch(/changed \(maybe on another device\)/);
    await linkRule({ obligationId: id, ruleId, expect: o.updatedAt, today: TODAY }, d);
    expect(await err(linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d))).toMatch(/already linked to this bill/);
    expect((await getObligation(id, d))!.data.scheduledRuleIds).toEqual([ruleId]);
  });

  it('unlink and relink work; the rule is never touched and no substitute rule is made; Undo is guarded', async () => {
    const d = fresh();
    const ruleId = await addRule(d);
    const { id } = await mk(d);
    const fin = await financeSnapshot(d);
    const l = await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    const u = await unlinkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    expect((await getObligation(id, d))!.data.scheduledRuleIds).toEqual([]);
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    expect((await getObligation(id, d))!.data.scheduledRuleIds).toEqual([ruleId]);
    expect(await financeSnapshot(d)).toBe(fin);
    expect(await d.recurring.count()).toBe(1);
    let refused = false;
    try { await applyUndo(u.undo, d); } catch (e) { refused = isUndoRefused(e); }
    expect(refused).toBe(true); // the bill changed since that unlink
    void l;
    expect(await err(unlinkRule({ obligationId: id, ruleId: 999, expect: null, today: TODAY }, d))).toMatch(/not linked to this bill/);
  });

  it('a rule deleted or switched off after linking keeps the bill: the pointer is "missing" or "inactive", the payment status never changes, nothing is substituted', async () => {
    const d = fresh();
    const ruleId = await addRule(d);
    const { id } = await mk(d);
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    const t = await addTxn(d, -12000);
    await recordFact({ obligationId: id, slot: SLOT, body: { fact: 'payment-link', ref: makeTxnRef(t) }, op: newOp(), today: TODAY }, d);
    const label0 = (await period(d, id)).label;
    await d.recurring.update(ruleId, { active: false });
    const off = await loadLinkedRules((await getObligation(id, d))!, TODAY, d);
    expect(off.views[0].notes.map((n) => n.kind)).toEqual(['inactive']);
    await d.recurring.delete(ruleId);
    const gone = await loadLinkedRules((await getObligation(id, d))!, TODAY, d);
    expect(gone.views[0].rule).toBeUndefined();
    expect(gone.views[0].notes.map((n) => n.kind)).toEqual(['missing']);
    expect(await d.recurring.count()).toBe(0); // never recreated
    expect((await getObligation(id, d))!.data.scheduledRuleIds).toEqual([ruleId]); // the pointer stays, honestly marked
    expect((await period(d, id)).label).toBe(label0);
  });

  it('the rule choices list spending rules with the reason each cannot be linked, and only COUNT income and transfers', async () => {
    const d = fresh();
    const free = await addRule(d, { payee: 'Free rule' });
    const taken = await addRule(d, { payee: 'Taken rule' });
    await addRule(d, { payee: 'Paycheck', amountCents: 50000 });
    const holder = await mk(d, { title: 'Holder' });
    await linkRule({ obligationId: holder.id, ruleId: taken, expect: null, today: TODAY }, d);
    const { id } = await mk(d, { title: 'Mine' });
    const choices = await loadRuleChoices((await getObligation(id, d))!, TODAY, d);
    expect(choices.notBills).toBe(1);
    expect(choices.spending.map((c) => [c.rule.id, c.check.problem === null])).toEqual([[free, true], [taken, false]]);
  });

  it('two devices linked one rule to two bills: both pointers are kept, the conflict is reported, and "keep it on this one" is an explicit, guarded repair', async () => {
    const d = fresh();
    const ruleId = await addRule(d);
    const a = await mk(d, { title: 'Bill A', providerNameSnapshot: 'A' });
    const b = await mk(d, { title: 'Bill B', providerNameSnapshot: 'B' });
    for (const x of [a, b]) { // what two offline devices would each have written
      const o = (await getObligation(x.id, d))!;
      await d.moduleRecords.update(x.id, { data: { ...(o.data as object), scheduledRuleIds: [ruleId] }, updatedAt: Date.now() + x.id % 7 });
    }
    const obligations = await loadObligations(d);
    const conflicts = ruleLinkConflicts(obligations);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].holders.map((h) => h.id).sort()).toEqual([a.id, b.id].sort());
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).total).toBeGreaterThanOrEqual(0);
    const expect2 = Object.fromEntries(obligations.map((o) => [o.id, o.updatedAt]));
    expect(await err(keepRuleOn({ ruleId, keepId: a.id, expect: { ...expect2, [b.id]: expect2[b.id] - 1 }, today: TODAY }, d))).toMatch(/changed \(maybe on another device\)/);
    expect(ruleLinkConflicts(await loadObligations(d))).toHaveLength(1); // the refused repair changed nothing
    const fin = await financeSnapshot(d);
    const r = await keepRuleOn({ ruleId, keepId: a.id, expect: expect2, today: TODAY }, d);
    expect((await getObligation(a.id, d))!.data.scheduledRuleIds).toEqual([ruleId]);
    expect((await getObligation(b.id, d))!.data.scheduledRuleIds).toEqual([]);
    expect(await financeSnapshot(d)).toBe(fin);
    expect(ruleLinkConflicts(await loadObligations(d))).toEqual([]);
    await applyUndo(r.undo, d);
    expect(ruleLinkConflicts(await loadObligations(d))).toHaveLength(1);
    expect(await err(keepRuleOn({ ruleId, keepId: 777, expect: {}, today: TODAY }, d))).toMatch(/no longer holds/);
  });

  it('"leave as is" is remembered for exactly that set of bills, and a new holder makes it a new problem', async () => {
    const d = fresh();
    const ruleId = await addRule(d);
    const a = await mk(d, { title: 'Bill A', providerNameSnapshot: 'A' });
    const b = await mk(d, { title: 'Bill B', providerNameSnapshot: 'B' });
    for (const x of [a, b]) { const o = (await getObligation(x.id, d))!; await d.moduleRecords.update(x.id, { data: { ...(o.data as object), scheduledRuleIds: [ruleId] } }); }
    await acknowledgeRuleConflict(ruleId, d);
    expect(ruleLinkConflicts(await loadObligations(d))[0].acknowledged).toBe(true);
    const c = await mk(d, { title: 'Bill C', providerNameSnapshot: 'C' });
    const oc = (await getObligation(c.id, d))!;
    await d.moduleRecords.update(c.id, { data: { ...(oc.data as object), scheduledRuleIds: [ruleId] } });
    expect(ruleLinkConflicts(await loadObligations(d))[0].acknowledged).toBe(false);
  });

  it('an injected failure while linking leaves the bill exactly as it was', async () => {
    const d = fresh();
    const ruleId = await addRule(d);
    const { id } = await mk(d);
    const before = await shared(d);
    d.moduleRecords.hook('updating', () => { throw new Error('injected failure'); });
    expect(await err(linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d))).toMatch(/injected failure/);
    expect(await shared(d)).toBe(before);
  });

  it('removing a payment link or a fact through the existing writers is unaffected by rejections (no new effect on Tasks)', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const lnk = await recordFact({ obligationId: id, slot: SLOT, body: { fact: 'payment-link', ref: makeTxnRef(t) }, op: newOp(), today: TODAY }, d);
    await reject(d, id, await addTxn(d, -999, { date: '2026-11-19' }));
    await removeFact(lnk.id, (await d.moduleRecords.get(lnk.id))!.updatedAt, TODAY, d);
    expect((await period(d, id)).amounts.paid).toBe(0);
  });
});
