import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { findOrCreateContact } from '../../core/contacts';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { spendingSnapshot } from '../../lib/spending';
import { dexieMeta, RemoteConflict, SyncEngine, snapshotOf, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createTransfer } from '../../lib/transfers';
import { createTxn } from '../../lib/txnCreate';
import { bulkSetTxnProject, loadProjectPieces, loadProjectSummary, setTxnProject } from '../../lib/txnProject';
import type { Txn } from '../../types';
import { asCommitment, checkStatusChange, creditChangeOrderDraft, validateCommitment, type CommitmentRecord } from './commitmentModel';
import {
  commitmentsWithVendor, createCommitment, createLine, createProject, getCommitment, getProject, loadCommitments, removeCommitment, removeLine,
  removeVendor, saveCommitment, setCommitmentStatus, transactionsOnCommitment, type CommitmentFields,
} from './data';
import { countBrokenTags, groupContracts, projectWarnings } from './financialView';
import { blankProject } from './model';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-commit-${n++}`); installTracking(d); return d; };
const $ = (x: number) => Math.round(x * 100);
const raw = (d: FinanceDB, id: number) => d.moduleRecords.get(id) as Promise<{ data: Record<string, unknown>; deletedAt?: number | null }>;

const fields = (over: Partial<CommitmentFields> = {}): CommitmentFields => ({
  title: 'Cabinet install', amountCents: $(10000), status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: '2026-11-02', notes: '', ...over,
});

async function setup() {
  const d = fresh();
  const p = await createProject(blankProject({ name: 'Kitchen', budgetCents: $(60000), status: 'active' }), d);
  const other = await createProject(blankProject({ name: 'Deck' }), d);
  const cab = await createLine(p, 'Cabinets', $(12000), d);
  const floor = await createLine(p, 'Flooring', $(4000), d);
  const otherLine = await createLine(other, 'Boards', $(500), d);
  const a = (await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
  const b = (await d.accounts.add({ name: 'Savings', kind: 'savings', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
  const add = (amount: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: a, date: '2026-11-03', amountCents: $(amount), payee: 'Acme', memo: '', status: 'cleared', categoryId: null, ...over }) as Promise<number>;
  const summary = async () => (await loadProjectSummary(d, p))!;
  return { d, p, other, cab, floor, otherLine, a, b, add, summary };
}

describe('quotes, acceptance, declined and cancelled', () => {
  it('a quote is shown but not counted; accepting it makes it count and stamps the date', async () => {
    const { d, p, summary } = await setup();
    const { id } = await createCommitment(p, fields({ status: 'quoted', acceptedDate: null }), d);
    let s = await summary();
    expect([s.agreedCents, s.leftToPayCents, s.expectedTotalCents, s.quotedCents]).toEqual([0, 0, 0, $(10000)]);
    expect((await getCommitment(id, d))!.data.acceptedDate).toBeNull();
    await setCommitmentStatus(id, 'accepted', d);
    s = await summary();
    expect([s.agreedCents, s.leftToPayCents, s.expectedTotalCents, s.quotedCents]).toEqual([$(10000), $(10000), $(10000), 0]);
    expect((await getCommitment(id, d))!.data.acceptedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('declined and cancelled are kept but never counted', async () => {
    const { d, p, summary } = await setup();
    const q = await createCommitment(p, fields({ title: 'Quote A', status: 'quoted', acceptedDate: null }), d);
    const x = await createCommitment(p, fields({ title: 'Quote B', amountCents: $(9000) }), d);
    await setCommitmentStatus(q.id, 'declined', d);
    await setCommitmentStatus(x.id, 'cancelled', d);
    const s = await summary();
    expect([s.agreedCents, s.leftToPayCents, s.quotedCents]).toEqual([0, 0, 0]);
    expect(await loadCommitments(p, d)).toHaveLength(2);
    const g = groupContracts(await loadCommitments(p, d), s);
    expect(g.closed).toHaveLength(2);
  });

  it('a cancelled agreement with money already paid keeps the payment visible and says so', async () => {
    const { d, p, add, summary } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    const t = await add(-3000);
    await setTxnProject(d, t, { projectId: p, commitmentId: id });
    await setCommitmentStatus(id, 'cancelled', d);
    const s = await summary();
    expect([s.paidCents, s.leftToPayCents, s.expectedTotalCents]).toEqual([$(3000), 0, $(3000)]);
    expect(s.flags.paidOnInactive).toEqual([id]);
    const w = projectWarnings(s, await loadCommitments(p, d));
    expect(w.map((x) => x.kind)).toContain('paidOnInactive');
    expect(w.find((x) => x.kind === 'paidOnInactive')!.text).toContain('$3,000.00');
    expect(groupContracts(await loadCommitments(p, d), s).closed[0].money?.paidCents).toBe($(3000));
  });

  it('an agreement can be reinstated after it was cancelled', async () => {
    const { d, p, summary } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    await setCommitmentStatus(id, 'cancelled', d);
    await setCommitmentStatus(id, 'accepted', d);
    expect((await summary()).agreedCents).toBe($(10000));
  });
});

describe('change orders', () => {
  it('positive and negative changes give the effective amount, never counting the parent twice', async () => {
    const { d, p, add, summary } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    await createCommitment(p, fields({ title: 'Stone counters', amountCents: $(1200), parentId: id }), d);
    await createCommitment(p, fields({ title: 'Skip the island', amountCents: -$(500), parentId: id }), d);
    await createCommitment(p, fields({ title: 'Maybe more', amountCents: $(900), parentId: id, status: 'quoted' }), d);
    const t = await add(-4000);
    await setTxnProject(d, t, { projectId: p, commitmentId: id });
    const s = await summary();
    expect(s.agreedCents).toBe($(10700));
    expect(s.leftToPayCents).toBe($(6700));
    expect(s.quotedCents).toBe($(900));
    expect(s.contracts).toHaveLength(1);
    expect(s.contracts[0]).toMatchObject({ originalCents: $(10000), changesCents: $(700), agreedCents: $(10700), paidCents: $(4000), leftCents: $(6700) });
  });

  it('a payment tagged to a change order counts toward the same agreement', async () => {
    const { d, p, add, summary } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    const co = await createCommitment(p, fields({ title: 'Extra', amountCents: $(1000), parentId: id }), d);
    const t = await add(-1000);
    await setTxnProject(d, t, { projectId: p, commitmentId: co.id });
    const s = await summary();
    expect(s.contracts[0].paidCents).toBe($(1000));
    expect(s.leftToPayCents).toBe($(10000));
  });

  it('a change keeps its link to the original and the history is preserved', async () => {
    const { d, p } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    const co = await createCommitment(p, fields({ title: 'Extra', amountCents: $(100), parentId: id }), d);
    expect((await getCommitment(co.id, d))!.data.parentId).toBe(id);
    expect((await getCommitment(id, d))!.data.amountCents).toBe($(10000)); // the original is not rewritten
    const g = groupContracts(await loadCommitments(p, d), null);
    expect(g.accepted[0].changes.map((c) => c.id)).toEqual([co.id]);
  });

  it('is refused when the change does not hold together', async () => {
    const { d, p, other } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    const co = await createCommitment(p, fields({ title: 'Extra', amountCents: $(100), parentId: id }), d);
    const foreign = await createCommitment(other, fields({ title: 'Fence' }), d);
    await expect(createCommitment(p, fields({ amountCents: $(5), parentId: 999999 }), d)).rejects.toThrow(/does not exist/);
    await expect(createCommitment(p, fields({ amountCents: $(5), parentId: foreign.id }), d)).rejects.toThrow(/does not exist in this project/);
    await expect(createCommitment(p, fields({ amountCents: $(5), parentId: co.id }), d)).rejects.toThrow(/original agreement/);
    await expect(createCommitment(p, fields({ amountCents: 0, parentId: id }), d)).rejects.toThrow(/needs an amount/);
    await expect(createCommitment(p, fields({ amountCents: -$(10101), parentId: id }), d)).rejects.toThrow(/below zero/);
    await expect(createCommitment(p, fields({ amountCents: -$(5) }), d)).rejects.toThrow(/above zero/);
  });

  it('cannot point at itself, make a loop, or turn an agreement that has changes into a change', async () => {
    const { d, p } = await setup();
    const a = await createCommitment(p, fields({ title: 'A' }), d);
    const b = await createCommitment(p, fields({ title: 'B', amountCents: $(50), parentId: a.id }), d);
    const gA = (await getCommitment(a.id, d))!;
    await expect(saveCommitment(a.id, fields({ title: 'A', parentId: a.id, amountCents: $(5) }), d)).rejects.toThrow(/itself/);
    await expect(saveCommitment(a.id, fields({ title: 'A', parentId: b.id, amountCents: $(5) }), d)).rejects.toThrow();
    // by the validator directly: a pointing at b while b points at a
    const all: CommitmentRecord[] = [gA, { ...(await getCommitment(b.id, d))! }];
    expect(validateCommitment({ title: 'A', amount: '5', status: 'quoted', parentId: b.id, budgetLineId: null, acceptedDate: '' }, { lineIds: [], all, editingId: a.id })).toMatch(/original agreement|point at each other|change orders of its own/);
  });

  it('a change cannot be accepted before the agreement, or if it would drop the total below zero', async () => {
    const { d, p } = await setup();
    const q = await createCommitment(p, fields({ status: 'quoted', acceptedDate: null }), d);
    await expect(createCommitment(p, fields({ title: 'x', amountCents: $(5), parentId: q.id }), d)).rejects.toThrow(/Accept the original/);
    const co = await createCommitment(p, fields({ title: 'x', amountCents: -$(9000), parentId: q.id, status: 'quoted', acceptedDate: null }), d);
    await expect(setCommitmentStatus(co.id, 'accepted', d)).rejects.toThrow(/Accept the original/);
    await setCommitmentStatus(q.id, 'accepted', d);
    const big = await createCommitment(p, fields({ title: 'y', amountCents: -$(2000), parentId: q.id }), d);
    expect(big.id).toBeGreaterThan(0);
    const all = await loadCommitments(p, d);
    expect(checkStatusChange((await getCommitment(co.id, d))!, 'accepted', all)).toMatch(/below zero/);
  });

  it('changes stop counting while their agreement is cancelled', async () => {
    const { d, p, summary } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    await createCommitment(p, fields({ title: 'Extra', amountCents: $(700), parentId: id }), d);
    await setCommitmentStatus(id, 'cancelled', d);
    expect((await summary()).agreedCents).toBe(0);
  });
});

describe('vendors and budget lines', () => {
  it('a line must belong to the same project and a vendor must be a real contact', async () => {
    const { d, p, otherLine, cab } = await setup();
    await expect(createCommitment(p, fields({ budgetLineId: otherLine }), d)).rejects.toThrow(/budget line/);
    await expect(createCommitment(p, fields({ vendorContactId: 424242 }), d)).rejects.toThrow(/vendor/);
    await expect(createCommitment(424242, fields(), d)).rejects.toThrow(/project/);
    const { id } = await createCommitment(p, fields({ budgetLineId: cab }), d);
    expect((await getCommitment(id, d))!.data.budgetLineId).toBe(cab);
  });

  it('the vendor is added to the project directory once, with no second copy of the contact', async () => {
    const { d, p } = await setup();
    const { id: contact } = await findOrCreateContact(d, { name: 'Acme Cabinets', phone: '555-0100' });
    const r1 = await createCommitment(p, fields({ vendorContactId: contact }), d);
    expect(r1.vendorAdded).toBe(true);
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([contact]);
    const r2 = await createCommitment(p, fields({ title: 'More', vendorContactId: contact }), d);
    expect(r2.vendorAdded).toBe(false);
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([contact]);
    expect((await d.contacts.toArray()).filter((c) => c.name === 'Acme Cabinets')).toHaveLength(1);
    expect(await commitmentsWithVendor(p, contact, d)).toBe(2);
    // taking the vendor off the project does not touch the commitments that name them
    await removeVendor(p, contact, d);
    expect((await getCommitment(r1.id, d))!.data.vendorContactId).toBe(contact);
  });

  it('a line with commitments filed under it cannot be removed', async () => {
    const { d, p, cab } = await setup();
    const { id } = await createCommitment(p, fields({ budgetLineId: cab }), d);
    await expect(removeLine(cab, d)).rejects.toThrow(/commitment/);
    await saveCommitment(id, fields({ budgetLineId: null }), d);
    await removeLine(cab, d);
  });

  it('a commitment is filed under its line in the budget breakdown, and a change follows it', async () => {
    const { d, p, cab, floor, add, summary } = await setup();
    const { id } = await createCommitment(p, fields({ budgetLineId: cab }), d);
    await createCommitment(p, fields({ title: 'Extra', amountCents: $(2500), parentId: id }), d);
    const f = await createCommitment(p, fields({ title: 'Floors', amountCents: $(3000), budgetLineId: floor }), d);
    const t = await add(-1000);
    await setTxnProject(d, t, { projectId: p, commitmentId: f.id });
    const s = await summary();
    const byName = Object.fromEntries(s.lines.map((l) => [l.name, l]));
    expect(byName.Cabinets).toMatchObject({ plannedCents: $(12000), agreedCents: $(12500), paidCents: 0, leftToPayCents: $(12500), expectedCents: $(12500), varianceCents: -$(500) });
    expect(byName.Flooring).toMatchObject({ plannedCents: $(4000), agreedCents: $(3000), paidCents: $(1000), leftToPayCents: $(2000), expectedCents: $(3000), varianceCents: $(1000) });
  });
});

describe('removing and keeping history', () => {
  it('removal is a soft delete, refused when money is tagged or changes exist', async () => {
    const { d, p, add } = await setup();
    const a = await createCommitment(p, fields({ title: 'A' }), d);
    const co = await createCommitment(p, fields({ title: 'A change', amountCents: $(5), parentId: a.id }), d);
    await expect(removeCommitment(a.id, d)).rejects.toThrow(/change order/);
    const t = await add(-10);
    await setTxnProject(d, t, { projectId: p, commitmentId: a.id });
    expect(await transactionsOnCommitment(a.id, d)).toBe(1);
    await removeCommitment(co.id, d);
    await expect(removeCommitment(a.id, d)).rejects.toThrow(/Cancel it instead/);
    await setTxnProject(d, t, null);
    await removeCommitment(a.id, d);
    expect(await getCommitment(a.id, d)).toBeUndefined();
    expect((await raw(d, a.id)).deletedAt).toBeTruthy(); // a marker, so the removal can sync
  });

  it('unknown fields survive edits and status changes, and bad stored values cannot crash a reader', async () => {
    const { d, p } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, futureThing: { a: 1 } } } as never);
    await saveCommitment(id, fields({ title: 'Renamed' }), d);
    await setCommitmentStatus(id, 'cancelled', d);
    expect((await raw(d, id)).data).toMatchObject({ title: 'Renamed', status: 'cancelled', futureThing: { a: 1 } });
    const bad = asCommitment({ id: 1, module: 'projects', kind: 'commitment', createdAt: 1, updatedAt: 1, data: { projectId: 'x', status: 'nonsense', amountCents: 'lots', parentId: null, title: 7, acceptedDate: '2026-02-30' } } as never);
    expect(bad.data).toMatchObject({ projectId: -1, status: 'quoted', amountCents: 0, title: 'Commitment', acceptedDate: null, vendorContactId: null, budgetLineId: null });
  });

  it('an orphaned change order is shown as an agreement of its own so it is never hidden', async () => {
    const { d, p } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    const co = await createCommitment(p, fields({ title: 'Extra', amountCents: $(5), parentId: id }), d);
    await d.moduleRecords.update(id, { deletedAt: Date.now() } as never);
    const g = groupContracts(await loadCommitments(p, d), null);
    expect([...g.accepted, ...g.pending, ...g.closed].map((r) => r.root.id)).toEqual([co.id]);
  });
});

describe('payments, reversals and credits through the commitment screens', () => {
  it('the worked example: $10,000 contract, $3,000 deposit, $1,000 reversal', async () => {
    const { d, p, add, summary } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    const dep = await add(-3000), back = await add(1000);
    await setTxnProject(d, dep, { projectId: p, commitmentId: id });
    await setTxnProject(d, back, { projectId: p, commitmentId: id, effect: 'reversal' });
    const s = await summary();
    expect([s.paidCents, s.leftToPayCents, s.contracts[0].paidCents, s.contracts[0].leftCents]).toEqual([$(2000), $(8000), $(2000), $(8000)]);
    // a reversal larger than the payments is refused
    const tooMuch = await add(2500);
    await expect(setTxnProject(d, tooMuch, { projectId: p, commitmentId: id, effect: 'reversal' })).rejects.toThrow(/more than/);
    expect((await d.txns.get(tooMuch))!.project).toBeUndefined();
  });

  it('a vendor credit leaves the contract looking owed again until a negative change order matches it, then reconciles', async () => {
    const { d, p, add, summary } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    const dep = await add(-3000), credit = await add(500);
    await setTxnProject(d, dep, { projectId: p, commitmentId: id });
    await setTxnProject(d, credit, { projectId: p, commitmentId: id, effect: 'credit' });
    let s = await summary();
    expect(s.flags.creditsNotReflected).toEqual([id]);
    expect(s.contracts[0]).toMatchObject({ creditsCents: $(500), creditGapCents: $(500), paidCents: $(2500), leftCents: $(7500) });
    const w = projectWarnings(s, await loadCommitments(p, d)).find((x) => x.kind === 'creditNotReflected')!;
    expect(w.creditGapCents).toBe($(500));
    expect(w.text).toContain('negative change order');
    // the offered draft is pre-filled but nothing is saved by offering it
    const draft = creditChangeOrderDraft((await getCommitment(id, d))!, w.creditGapCents!);
    expect(draft).toEqual({ title: 'Credit from vendor', amount: '-500.00', parentId: id });
    expect((await loadCommitments(p, d))).toHaveLength(1);
    // accepting that change order reconciles it
    await createCommitment(p, fields({ title: draft.title, amountCents: -$(500), parentId: id }), d);
    s = await summary();
    expect(s.flags.creditsNotReflected).toEqual([]);
    expect(s.contracts[0]).toMatchObject({ agreedCents: $(9500), paidCents: $(2500), leftCents: $(7000), creditGapCents: 0 });
    expect(projectWarnings(s, await loadCommitments(p, d)).map((x) => x.kind)).not.toContain('creditNotReflected');
  });

  it('overpayment is flagged on the contract and in the warnings', async () => {
    const { d, p, add, summary } = await setup();
    const { id } = await createCommitment(p, fields({ amountCents: $(1000) }), d);
    const t = await add(-1200);
    await setTxnProject(d, t, { projectId: p, commitmentId: id });
    const s = await summary();
    expect(s.contracts[0]).toMatchObject({ overpaidCents: $(200), leftCents: 0 });
    expect(projectWarnings(s, await loadCommitments(p, d)).find((x) => x.kind === 'overpaid')!.text).toContain('$200.00');
  });

  it('reversals larger than the payments (after a payment is deleted) show up as a warning, not a crash', async () => {
    const { d, p, add, summary } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    const dep = await add(-1000), back = await add(800);
    await setTxnProject(d, dep, { projectId: p, commitmentId: id });
    await setTxnProject(d, back, { projectId: p, commitmentId: id, effect: 'reversal' });
    await d.txns.delete(dep);
    const s = await summary();
    expect(s.flags.reversalsExceedPayments).toEqual([id]);
    expect(projectWarnings(s, await loadCommitments(p, d)).map((x) => x.kind)).toContain('reversalTooBig');
  });

  it('project-level refunds and reimbursements lower the cost without a contract', async () => {
    const { d, p, cab, add, summary } = await setup();
    const out = await add(-200), back = await add(50);
    await setTxnProject(d, out, { projectId: p, budgetLineId: cab });
    await setTxnProject(d, back, { projectId: p, budgetLineId: cab });
    const s = await summary();
    expect([s.paidCents, s.expectedTotalCents]).toEqual([$(150), $(150)]);
  });
});

describe('totals and warnings for the whole project', () => {
  it('the headline figures, the line breakdown and the unfiled row agree', async () => {
    const { d, p, cab, add, summary } = await setup();
    const a = await createCommitment(p, fields({ budgetLineId: cab, amountCents: $(14000) }), d);
    await createCommitment(p, fields({ title: 'Loose', amountCents: $(2000) }), d); // no line
    await createCommitment(p, fields({ title: 'Quote', amountCents: $(700), status: 'quoted', acceptedDate: null }), d);
    const t1 = await add(-5000), t2 = await add(-300);
    await setTxnProject(d, t1, { projectId: p, commitmentId: a.id });
    await setTxnProject(d, t2, { projectId: p }); // paid, no line, no contract
    const s = await summary();
    expect(s).toMatchObject({ budgetCents: $(60000), plannedTotalCents: $(16000), notYetPlannedCents: $(44000), agreedCents: $(16000), paidCents: $(5300), leftToPayCents: $(11000), expectedTotalCents: $(16300), leftInBudgetCents: $(43700), quotedCents: $(700) });
    const unfiled = s.lines.find((l) => l.lineId === null)!;
    expect(unfiled).toMatchObject({ agreedCents: $(2000), paidCents: $(300), leftToPayCents: $(2000), expectedCents: $(2300) });
    // the lines add up to the project figures
    expect(s.lines.reduce((x, l) => x + l.expectedCents, 0)).toBe(s.expectedTotalCents);
    expect(s.lines.reduce((x, l) => x + l.paidCents, 0)).toBe(s.paidCents);
    const w = projectWarnings(s, await loadCommitments(p, d));
    expect(w.map((x) => x.kind)).toEqual(['lineOver', 'unfiled']); // Cabinets planned 12,000 but 14,000 agreed
    expect(w[0].text).toContain('"Cabinets"');
  });

  it('budget overruns are reported for the project and for a line', async () => {
    const { d, p, cab, summary } = await setup();
    await createCommitment(p, fields({ amountCents: $(70000), budgetLineId: cab }), d);
    const s = await summary();
    expect(s.flags.overBudget).toBe(true);
    const kinds = projectWarnings(s, await loadCommitments(p, d)).map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['overBudget', 'lineOver']));
  });

  it('lines planned above the overall budget are called out', async () => {
    const { d, p } = await setup();
    await createLine(p, 'Big', $(50000), d);
    const s = (await loadProjectSummary(d, p))!;
    expect(projectWarnings(s, []).map((x) => x.kind)).toContain('linesOverBudget');
  });

  it('tags that point at a line or commitment that was removed are counted', async () => {
    expect(countBrokenTags([{ budgetLineId: 5 }, { commitmentId: 9 }, { budgetLineId: 1, commitmentId: 2 }, {}], [1], [2])).toBe(2);
    const { d, p, add } = await setup();
    const t = await add(-10);
    await setTxnProject(d, t, { projectId: p });
    await d.txns.update(t, { project: { projectId: p, budgetLineId: 12345 } });
    const s = (await loadProjectSummary(d, p))!;
    const pieces = await loadProjectPieces(d, p);
    const w = projectWarnings(s, [], { brokenTags: countBrokenTags(pieces, [], []) });
    expect(w.map((x) => x.kind)).toContain('brokenTags');
    expect(s.paidCents).toBe($(10)); // still counted as project spending
  });
});

describe('split transactions and transfers', () => {
  it('one split goes to the project and the other does not, and a split can carry its own budget line', async () => {
    const { d, p, cab, a, summary } = await setup();
    const id = await createTxn(d, {
      accountId: a, date: '2026-11-04', amountCents: -$(100), payee: 'Hardware',
      splits: [{ categoryId: 1, amountCents: -$(70), project: { projectId: p, budgetLineId: cab } }, { categoryId: 2, amountCents: -$(30) }],
    });
    expect((await summary()).paidCents).toBe($(70));
    expect((await summary()).lines.find((l) => l.name === 'Cabinets')!.paidCents).toBe($(70));
    expect((await loadProjectPieces(d, p)).map((x) => x.amountCents)).toEqual([-$(70)]);
    expect((await d.txns.get(id))!.amountCents).toBe(-$(100)); // the transaction itself is untouched
  });

  it('transfers and setup entries are never project spending', async () => {
    const { d, p, a, b } = await setup();
    const { fromTxnId } = await createTransfer(d, { fromAccountId: a, toAccountId: b, date: '2026-11-04', amountCents: $(100) });
    await expect(setTxnProject(d, fromTxnId, { projectId: p })).rejects.toThrow(/transfer/i);
    const r = await bulkSetTxnProject(d, [fromTxnId], { projectId: p });
    expect(r).toMatchObject({ updated: 0, skippedTransfers: 1 });
    expect((await loadProjectSummary(d, p))!.paidCents).toBe(0);
  });
});

describe('nothing else in Finance changes', () => {
  it('tagging and committing change no transaction amount, balance or report', async () => {
    const { d, p, a, add, cab } = await setup();
    const t1 = await add(-1234, { categoryId: 7 }), t2 = await add(-500, { categoryId: 8 });
    const cats = [{ id: 7, groupId: 1, name: 'Home', kind: 'expense' as const }, { id: 8, groupId: 1, name: 'Food', kind: 'expense' as const }];
    const sumFor = async () => (await d.txns.where('accountId').equals(a).toArray()).reduce((s, t) => s + t.amountCents, 0);
    const before = { total: await sumFor(), spend: spendingSnapshot(await d.txns.toArray(), cats, '2026-11') };
    const { id } = await createCommitment(p, fields({ budgetLineId: cab }), d);
    await setTxnProject(d, t1, { projectId: p, commitmentId: id });
    await setTxnProject(d, t2, { projectId: p, budgetLineId: cab });
    expect({ total: await sumFor(), spend: spendingSnapshot(await d.txns.toArray(), cats, '2026-11') }).toEqual(before);
  });

  it('editing or deleting a tagged transaction changes the project figures at once', async () => {
    const { d, p, add, summary } = await setup();
    const { id } = await createCommitment(p, fields(), d);
    const t = await add(-3000);
    await setTxnProject(d, t, { projectId: p, commitmentId: id });
    expect((await summary()).paidCents).toBe($(3000));
    await d.txns.update(t, { amountCents: -$(2000) });
    expect((await summary()).paidCents).toBe($(2000));
    await d.txns.delete(t);
    expect((await summary()).paidCents).toBe(0);
    expect((await summary()).leftToPayCents).toBe($(10000));
  });
});

describe('backup, restore and sync keep commitments', () => {
  async function build(d: FinanceDB) {
    const p = await createProject(blankProject({ name: 'Kitchen', budgetCents: $(60000) }), d);
    const { id: contact } = await findOrCreateContact(d, { name: 'Acme' });
    const a = await createCommitment(p, fields({ vendorContactId: contact }), d);
    const co = await createCommitment(p, fields({ title: 'Extra', amountCents: -$(100), parentId: a.id }), d);
    await d.moduleRecords.update(a.id, { data: { ...(await raw(d, a.id)).data, futureThing: 3 } } as never);
    return { p, a: a.id, co: co.id, contact };
  }

  it('export, restore and the sync snapshot carry commitments, change orders and unknown fields', async () => {
    const d = fresh();
    const { p, a, co, contact } = await build(d);
    const file = checkBackupText(JSON.stringify(await exportAll(d))).file;
    const target = fresh();
    await target.open();
    await importAll(target, file);
    const back = await loadCommitments(p, target);
    expect(back.map((c) => [c.id, c.data.parentId, c.data.amountCents, c.data.vendorContactId])).toEqual([[a, null, $(10000), contact], [co, a, -$(100), null]]);
    expect((await raw(target, a)).data.futureThing).toBe(3);
    const snap = await snapshotOf(d);
    expect(snap.tables.moduleRecords[String(a)]).toBeDefined();
    expect(snap.tables.moduleRecords[String(co)]).toBeDefined();
  });

  it('two devices edit different commitments and both edits survive', async () => {
    const remote = (() => {
      const r = {
        puts: 0, file: null as RemoteFile | null,
        async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
        async putFile(bytes: Uint8Array, sha: string | undefined) {
          if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
          r.puts++;
          r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
          return r.file.sha;
        },
      };
      return r satisfies RemoteStore;
    })();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`cm-meta-${n++}`), remote, 'a good passphrase') }; };
    const A = mk(), B = mk();
    const p = await createProject(blankProject({ name: 'Kitchen' }), A.d);
    const c1 = await createCommitment(p, fields({ title: 'First' }), A.d);
    const c2 = await createCommitment(p, fields({ title: 'Second', amountCents: $(200) }), A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await saveCommitment(c1.id, fields({ title: 'First, revised', amountCents: $(111) }), A.d);
    await setCommitmentStatus(c2.id, 'cancelled', B.d);
    await A.engine.sync();
    await B.engine.sync();
    await A.engine.sync();
    for (const x of [A, B]) {
      const list = await loadCommitments(p, x.d);
      expect(list.map((c) => [c.data.title, c.data.amountCents, c.data.status])).toEqual([['First, revised', $(111), 'accepted'], ['Second', $(200), 'cancelled']]);
    }
  });
});
