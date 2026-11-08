import { describe, expect, it } from 'vitest';
import { derivedId, type DerivedItem } from '../../core/dueProvider';
import type { RecurringLog, RecurringRule } from '../../types';
import { dropCovered } from '../calendar/markerCoordination';
import { ledgerDueItems } from '../ledger/dueProvider';
import { billsDueItems, coveringId } from './dueProvider';
import { createObligation, getObligation } from './data';
import { linkRule } from './scheduledLinkData';
import { financeSnapshot, fresh, monthly, ob, obRec } from './billsTestkit';
import type { ObligationData } from './model';

/**
 * B3.1 Calendar coordination. The same expected payment can be drawn by a Bills "Due" marker and by the Finance Scheduled marker of a rule the bill
 * links. Hiding the redundant one is a DISPLAY decision, made only from an explicit link, the same date and no unresolved disagreement, and only while
 * the Finance marker (which may be the owner's only way to approve the payment) is itself shown. Nothing is deleted, stored or re-identified.
 */
const TODAY = '2026-11-10';
const DUE = '2026-11-18';
const Q = { from: '2026-11-01', to: '2026-12-31', today: TODAY, overdueDays: 0 };
const RULE: RecurringRule = { id: 7, accountId: 1, payee: 'Example Power Co', amountCents: -12000, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-18', active: true };
const bill = (over: Partial<ObligationData> = {}) => obRec(1, { title: 'Example Power Co', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 12000, label: '' }], schedule: monthly(18, '2026-01'), trackingSince: '2026-01-01', scheduledRuleIds: [7], ...over });
const sched = (rules: RecurringRule[] = [RULE], log: RecurringLog[] = []) => ({ rules, log });
const item = (id: string, layer: string, status: 'open' | 'handled' = 'open', coveredBy?: string) => ({ layer, source: { id, status, ...(coveredBy ? { coveredBy } : {}) } });
const FIN_ID = derivedId('ledger', 'scheduled-7', DUE);

describe('B3.1 the display filter: a covered item is left out only while its covering item is shown', () => {
  it('drops the Bills marker when the Finance marker it points at is in the list, and keeps the Finance marker', () => {
    const items = [item(FIN_ID, 'finance'), item('bills:due-1-m2026-11:2026-11-18', 'bills', 'open', FIN_ID), item('tasks:x', 'tasks')];
    expect(dropCovered(items).map((i) => i.source.id)).toEqual([FIN_ID, 'tasks:x']);
  });

  it('keeps the Bills marker when the Finance marker is not shown (that layer is switched off, or Personal only): the payment never disappears from view', () => {
    const items = [item('bills:due-1-m2026-11:2026-11-18', 'bills', 'open', FIN_ID)];
    expect(dropCovered(items)).toEqual(items);
    expect(dropCovered([item('own:event', 'personal'), ...items]).length).toBe(2);
  });

  it('only an OPEN covering item counts, an item that is itself covered never covers another, and a cycle hides nothing', () => {
    const handledCover = [item(FIN_ID, 'finance', 'handled'), item('b', 'bills', 'open', FIN_ID)];
    expect(dropCovered(handledCover).length).toBe(2);
    const chain = [item('a', 'x', 'open', 'b'), item('b', 'y', 'open', 'c'), item('c', 'z')];
    expect(dropCovered(chain).map((i) => i.source.id)).toEqual(['a', 'c']); // b is covered by c; b therefore covers nothing, so a stays
    const loop = [item('a', 'x', 'open', 'b'), item('b', 'y', 'open', 'a')];
    expect(dropCovered(loop).length).toBe(2);
  });

  it('keeps order, never changes its input, and leaves items with no source (the user\'s own events) alone', () => {
    const items = [{ layer: 'personal' }, item(FIN_ID, 'finance'), item('b', 'bills', 'open', FIN_ID)] as { layer: string; source?: { id: string; status: string; coveredBy?: string } }[];
    const before = JSON.stringify(items);
    expect(dropCovered(items).map((i) => i.layer)).toEqual(['personal', 'finance']);
    expect(JSON.stringify(items)).toBe(before);
  });
});

describe('B3.1 when a Bills marker is "covered": only from an explicit, current, agreeing relationship', () => {
  it('a linked live spending rule, offered on the SAME date, with nothing unresolved, covers the marker (the id Finance gives its own marker)', () => {
    expect(coveringId(bill(), DUE, sched(), TODAY)).toBe(FIN_ID);
  });

  it('never from titles or amounts: a rule the bill does not link covers nothing, however alike', () => {
    expect(coveringId(bill({ scheduledRuleIds: [] }), DUE, sched(), TODAY)).toBeNull();
    expect(coveringId(bill({ scheduledRuleIds: [8] }), DUE, sched(), TODAY)).toBeNull();
  });

  it('different dates are two different things: a payment-action date of the 16th does not cover a due date of the 18th', () => {
    expect(coveringId(bill(), DUE, sched([{ ...RULE, startDate: '2026-01-16' }]), TODAY)).toBeNull();
    expect(coveringId(bill(), '2026-11-16', sched([{ ...RULE, startDate: '2026-01-16' }]), TODAY)).toBe(derivedId('ledger', 'scheduled-7', '2026-11-16'));
  });

  it('different schedules (quarterly bill, monthly rule) are an unresolved disagreement: nothing is hidden', () => {
    expect(coveringId(bill({ schedule: monthly(18, '2026-01', 3) }), '2026-01-18', sched(), TODAY)).toBeNull();
  });

  it('an unresolved amount disagreement keeps both markers; an explained one (a later price already in the rule) does not', () => {
    expect(coveringId(bill(), DUE, sched([{ ...RULE, amountCents: -11500 }]), TODAY)).toBeNull();
    const intro = bill({ prices: [{ from: '2026-01-01', cents: 9000, label: 'introductory' }, { from: '2027-01-01', cents: 12000, label: '' }] });
    expect(coveringId(intro, DUE, sched(), TODAY)).toBe(FIN_ID);
  });

  it('an inactive, ended, income or transfer rule, a missing rule, and a bill that ended cover nothing', () => {
    expect(coveringId(bill(), DUE, sched([{ ...RULE, active: false }]), TODAY)).toBeNull();
    expect(coveringId(bill(), DUE, sched([{ ...RULE, endDate: '2026-06-01' }]), TODAY)).toBeNull();
    expect(coveringId(bill(), DUE, sched([{ ...RULE, amountCents: 12000 }]), TODAY)).toBeNull();
    expect(coveringId(bill(), DUE, sched([{ ...RULE, transferAccountId: 9 }]), TODAY)).toBeNull();
    expect(coveringId(bill(), DUE, sched([]), TODAY)).toBeNull();
    expect(coveringId(bill(), DUE, null, TODAY)).toBeNull();
    expect(coveringId(bill({ status: 'ended', endedOn: '2026-10-01', endReason: 'cancelled' }), DUE, sched(), TODAY)).toBeNull();
  });

  it('once the Scheduled item for that date is approved or skipped in Finance its marker is gone, so nothing covers the Bills marker', () => {
    expect(coveringId(bill(), DUE, sched([RULE], [{ id: 1, ruleId: 7, date: DUE, action: 'posted', txnId: 5 }]), TODAY)).toBeNull();
    expect(coveringId(bill(), DUE, sched([RULE], [{ id: 2, ruleId: 7, date: DUE, action: 'skipped' }]), TODAY)).toBeNull();
    expect(coveringId(bill(), DUE, sched([RULE], [{ id: 3, ruleId: 7, date: '2026-10-18', action: 'posted', txnId: 4 }]), TODAY)).toBe(FIN_ID); // another date's log
  });
});

describe('B3.1 the real providers together (real database)', () => {
  const setup = async (over: Partial<ObligationData> = {}, rule: Partial<RecurringRule> = {}) => {
    const d = fresh();
    const a = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const ruleId = (await d.recurring.add({ ...RULE, id: undefined, accountId: a, ...rule } as never)) as number;
    const { id } = await createObligation({ data: ob({ title: 'Example Power Co', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 12000, label: '' }], schedule: monthly(18, '2026-01'), trackingSince: '2026-01-01', payment: { how: 'manual', fundingAccountId: null }, ...over }, TODAY), today: TODAY }, d);
    return { d, id, ruleId };
  };
  const dueItem = (xs: DerivedItem[], slot = 'm2026-11') => xs.find((i) => i.id.includes(`due-`) && i.id.includes(slot));

  it('an unlinked bill and a Scheduled rule both show their own markers, exactly as before B3.1', async () => {
    const { d } = await setup();
    const bills = await billsDueItems(d, Q);
    const fin = await ledgerDueItems(d, Q, false);
    expect(dueItem(bills)!.coveredBy).toBeUndefined();
    expect(fin.some((i) => i.date === DUE && i.status === 'open')).toBe(true);
  });

  it('linked: the Bills marker is marked covered by the Finance marker, and that Finance approval marker is present, open, and keeps its own id and phone-calendar id', async () => {
    const { d, id, ruleId } = await setup();
    const unlinked = dueItem(await billsDueItems(d, Q))!;
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    const bills = await billsDueItems(d, Q);
    const fin = await ledgerDueItems(d, Q, false);
    const b = dueItem(bills)!;
    const f = fin.find((i) => i.sourceRecordId === `scheduled:${ruleId}` && i.date === DUE)!;
    expect(b.coveredBy).toBe(f.id);
    expect(f.status).toBe('open'); // the approval route is there
    expect(f.icsUid).toBe(`bill-${ruleId}-${DUE}@ledger.local`);
    expect(b.id).toBe(unlinked.id); // identity unchanged by linking
    expect(b.icsUid).toBe(unlinked.icsUid);
    expect(b.title).toBe(unlinked.title);
    // and the whole display step keeps the Finance marker and drops the Bills one
    const shown = dropCovered([...fin, ...bills].map((x) => ({ source: x })));
    expect(shown.some((x) => x.source.id === f.id)).toBe(true);
    expect(shown.some((x) => x.source.id === b.id)).toBe(false);
    // with the Finance layer not shown, the Bills marker stays
    expect(dropCovered(bills.map((x) => ({ source: x }))).some((x) => x.source.id === b.id)).toBe(true);
  });

  it('a payment-action date different from the due date, or different schedules, keep BOTH markers', async () => {
    const { d, id, ruleId } = await setup({}, { startDate: '2026-01-16' });
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    const bills = await billsDueItems(d, Q);
    const fin = await ledgerDueItems(d, Q, false);
    const shown = dropCovered([...fin, ...bills].map((x) => ({ source: x })));
    expect(shown.some((x) => x.source.id === dueItem(bills)!.id)).toBe(true);
    expect(shown.filter((x) => x.source.sourceModule === 'ledger').length).toBeGreaterThan(0);
  });

  it('an unresolved drift (different amounts) keeps both markers, and fixing the rule in Finance lets the Bills one step aside', async () => {
    const { d, id, ruleId } = await setup({}, { amountCents: -11500 });
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    expect(dueItem(await billsDueItems(d, Q))!.coveredBy).toBeUndefined();
    await d.recurring.update(ruleId, { amountCents: -12000 });
    expect(dueItem(await billsDueItems(d, Q))!.coveredBy).toBe(derivedId('ledger', `scheduled-${ruleId}`, DUE));
  });

  it('approving the Finance item (an ordinary Finance action) makes its marker vanish, and the Bills marker then returns: a posting is not proof of payment', async () => {
    const { d, id, ruleId } = await setup();
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    await d.recurringLog.add({ ruleId, date: DUE, action: 'posted', txnId: 12345 });
    const bills = await billsDueItems(d, Q);
    const fin = await ledgerDueItems(d, Q, false);
    expect(fin.some((i) => i.sourceRecordId === `scheduled:${ruleId}` && i.date === DUE)).toBe(false);
    const b = dueItem(bills)!;
    expect(b).toBeTruthy();
    expect(b.coveredBy).toBeUndefined();
  });

  it('contract-deadline markers are never covered, and a pay reminder Task on another date does not change the decision', async () => {
    const { d, id, ruleId } = await setup({ terms: { renewalDate: DUE, noticeByDate: '2026-11-20' }, reminders: { payTask: true, leadDays: 3 } });
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    const bills = await billsDueItems(d, Q);
    const deadlines = bills.filter((i) => /renewal|notice/.test(i.id));
    expect(deadlines.length).toBeGreaterThan(0);
    expect(deadlines.every((i) => i.coveredBy === undefined)).toBe(true);
    expect(bills.filter((i) => i.id.includes('due-') && i.date === DUE).every((i) => i.coveredBy === derivedId('ledger', `scheduled-${ruleId}`, DUE))).toBe(true);
  });

  it('changes no record anywhere: no Calendar event, no stored occurrence, no Task, and Finance and the bill are byte-identical', async () => {
    const { d, id, ruleId } = await setup();
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    const shared = async () => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.dueItems.toArray()]);
    const before = `${await shared()}|${await financeSnapshot(d)}`;
    for (let i = 0; i < 3; i++) { await billsDueItems(d, Q); await ledgerDueItems(d, Q, false); }
    expect(`${await shared()}|${await financeSnapshot(d)}`).toBe(before);
    expect(await d.dueItems.count()).toBe(0);
    expect((await getObligation(id, d))!.data.scheduledRuleIds).toEqual([ruleId]);
  });

  it('a rule deleted or switched off after linking stops covering at once (the Bills marker is shown on its own)', async () => {
    const { d, id, ruleId } = await setup();
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    await d.recurring.update(ruleId, { active: false });
    expect(dueItem(await billsDueItems(d, Q))!.coveredBy).toBeUndefined();
    await d.recurring.delete(ruleId);
    expect(dueItem(await billsDueItems(d, Q))!.coveredBy).toBeUndefined();
  });

  it('Hide Amounts: the Bills marker never carries an amount, and covering needs no figure', async () => {
    const { d, id, ruleId } = await setup();
    await linkRule({ obligationId: id, ruleId, expect: null, today: TODAY }, d);
    for (const i of await billsDueItems(d, Q)) expect(`${i.title} ${i.detail ?? ''}`).not.toMatch(/\$\d/);
  });
});

describe('B3.1 the module does not hold other layers\' state', () => {
  it('FinanceDB is only read by the provider (a source check that the provider has no write call)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/modules/bills/dueProvider.ts', 'utf8');
    expect(/\.(put|add|update|delete|bulkAdd|bulkPut|clear|modify)\(|repo\(|\.remove\(/.test(src)).toBe(false);
  });
});
