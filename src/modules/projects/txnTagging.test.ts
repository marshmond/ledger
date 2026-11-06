import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createTxn, editTxn } from '../../lib/txnCreate';
import { bulkSetTxnProject, checkTxnProjects, loadProjectChoices, loadProjectSummary, setTxnProject } from '../../lib/txnProject';
import { asksAboutRefund, buildRef, describeRef, EMPTY_TAG, impliedLine, pickableContracts, tagFromRef, type TagState } from '../../lib/txnProjectTag';
import { installTracking } from '../../lib/sync/track';
import { createTransfer } from '../../lib/transfers';
import type { Txn } from '../../types';
import { createCommitment, createLine, createProject, setCommitmentStatus, archiveProject, type CommitmentFields } from './data';
import { blankProject } from './model';

/** Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-tagging-${n++}`); installTracking(d); return d; };
const $ = (x: number) => Math.round(x * 100);
const tag = (over: Partial<TagState>): TagState => ({ ...EMPTY_TAG, ...over });
const fields = (over: Partial<CommitmentFields> = {}): CommitmentFields => ({
  title: 'Cabinet install', amountCents: $(10000), status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: '2026-11-02', notes: '', ...over,
});

async function setup() {
  const d = fresh();
  const p = await createProject(blankProject({ name: 'Kitchen', budgetCents: $(60000) }), d);
  const bare = await createProject(blankProject({ name: 'Garden' }), d);
  const cab = await createLine(p, 'Cabinets', $(12000), d);
  const floor = await createLine(p, 'Flooring', $(4000), d);
  const gl = await createLine(bare, 'Plants', $(300), d);
  const withLine = (await createCommitment(p, fields({ title: 'Cabinets job', budgetLineId: cab }), d)).id;
  const noLine = (await createCommitment(p, fields({ title: 'Painter', amountCents: $(2000) }), d)).id;
  const quote = (await createCommitment(p, fields({ title: 'Tile quote', status: 'quoted', acceptedDate: null }), d)).id;
  const a = (await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
  const b = (await d.accounts.add({ name: 'Savings', kind: 'savings', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
  const add = (amount: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: a, date: '2026-11-03', amountCents: $(amount), payee: 'Acme', memo: '', status: 'cleared', categoryId: null, ...over }) as Promise<number>;
  return { d, p, bare, cab, floor, gl, withLine, noLine, quote, a, b, add };
}

describe('what the Project box offers', () => {
  it('lists each project with only its own lines and contracts (no change orders)', async () => {
    const { d, p, bare, cab, floor, gl, withLine, noLine, quote } = await setup();
    await createCommitment(p, fields({ title: 'Extra', amountCents: $(5), parentId: withLine }), d);
    const choices = await loadProjectChoices(d);
    const kitchen = choices.find((c) => c.id === p)!;
    expect(kitchen.lines.map((l) => l.id)).toEqual([cab, floor]);
    expect(kitchen.contracts.map((c) => [c.id, c.status])).toEqual([[withLine, 'accepted'], [noLine, 'accepted'], [quote, 'quoted']]);
    expect(choices.find((c) => c.id === bare)!.lines.map((l) => l.id)).toEqual([gl]);
    expect(choices.find((c) => c.id === bare)!.contracts).toEqual([]);
  });

  it('offers accepted contracts, plus one that is already chosen; archived projects are marked', async () => {
    const { d, p, withLine, quote } = await setup();
    const kitchen = (await loadProjectChoices(d)).find((c) => c.id === p)!;
    expect(pickableContracts(kitchen, '').map((c) => c.id)).toEqual([withLine, expect.any(Number)]);
    expect(pickableContracts(kitchen, String(quote)).map((c) => c.id)).toContain(quote);
    await archiveProject(p, d);
    expect((await loadProjectChoices(d)).find((c) => c.id === p)!.archived).toBe(true);
  });

  it('a contract with a budget line implies it', async () => {
    const { d, p, cab, withLine, noLine } = await setup();
    const kitchen = (await loadProjectChoices(d)).find((c) => c.id === p)!;
    expect(impliedLine(kitchen, String(withLine))).toEqual({ id: cab, name: 'Cabinets' });
    expect(impliedLine(kitchen, String(noLine))).toBeUndefined();
    expect(impliedLine(kitchen, '')).toBeUndefined();
  });
});

describe('turning the Project box into a reference', () => {
  it('no project means no reference', async () => {
    const { d } = await setup();
    expect(buildRef(EMPTY_TAG, await loadProjectChoices(d), false)).toEqual({});
  });

  it('a payment to a contract uses the contract\'s line and does not store it twice', async () => {
    const { d, p, floor, withLine, noLine } = await setup();
    const choices = await loadProjectChoices(d);
    expect(buildRef(tag({ projectId: String(p), commitmentId: String(withLine), lineId: String(floor) }), choices, false).ref).toEqual({ projectId: p, commitmentId: withLine });
    // a contract with no line of its own can take the line chosen
    expect(buildRef(tag({ projectId: String(p), commitmentId: String(noLine), lineId: String(floor) }), choices, false).ref).toEqual({ projectId: p, commitmentId: noLine, budgetLineId: floor });
    expect(buildRef(tag({ projectId: String(p), lineId: String(floor) }), choices, false).ref).toEqual({ projectId: p, budgetLineId: floor });
  });

  it('refuses a line or contract from somewhere else, or a project that is gone', async () => {
    const { d, p, bare, gl, withLine } = await setup();
    const choices = await loadProjectChoices(d);
    expect(buildRef(tag({ projectId: String(p), lineId: String(gl) }), choices, false).error).toMatch(/budget line/);
    expect(buildRef(tag({ projectId: String(bare), commitmentId: String(withLine) }), choices, false).error).toMatch(/commitment/);
    expect(buildRef(tag({ projectId: '999999' }), choices, false).error).toMatch(/no longer exists/);
  });

  it('money coming back on a project with contracts asks if it belongs to one, and will not guess', async () => {
    const { d, p, bare, withLine } = await setup();
    const choices = await loadProjectChoices(d);
    const kitchen = choices.find((c) => c.id === p)!;
    expect(asksAboutRefund(kitchen, EMPTY_TAG)).toBe(true);
    expect(asksAboutRefund(choices.find((c) => c.id === bare), EMPTY_TAG)).toBe(false);
    expect(buildRef(tag({ projectId: String(p) }), choices, true).error).toMatch(/about a contract or is a general refund/);
    expect(buildRef(tag({ projectId: String(p), refundKind: 'project' }), choices, true).ref).toEqual({ projectId: p });
    expect(buildRef(tag({ projectId: String(p), refundKind: 'contract' }), choices, true).error).toMatch(/Choose the contract/);
    // a project with no contracts has nothing to ask
    expect(buildRef(tag({ projectId: String(bare) }), choices, true).ref).toEqual({ projectId: bare });
    // choosing the general refund drops a contract that was picked before
    expect(buildRef(tag({ projectId: String(p), refundKind: 'project', commitmentId: String(withLine) }), choices, true).ref).toEqual({ projectId: p });
  });

  it('money coming back on a contract has to be a reversal or a credit', async () => {
    const { d, p, withLine } = await setup();
    const choices = await loadProjectChoices(d);
    const base = { projectId: String(p), commitmentId: String(withLine), refundKind: 'contract' as const };
    expect(buildRef(tag(base), choices, true).error).toMatch(/reversal.*credit/);
    expect(buildRef(tag({ ...base, effect: 'credit' }), choices, true).ref).toEqual({ projectId: p, commitmentId: withLine, effect: 'credit' });
    // a payment never carries one
    expect(buildRef(tag({ ...base, effect: 'credit' }), choices, false).ref).toEqual({ projectId: p, commitmentId: withLine });
  });

  it('a split row has no refund questions and only keeps a contract it already had', async () => {
    const { d, p, cab } = await setup();
    const choices = await loadProjectChoices(d);
    expect(buildRef(tag({ projectId: String(p), lineId: String(cab) }), choices, true, { compact: true }).ref).toEqual({ projectId: p, budgetLineId: cab });
  });

  it('round-trips a stored reference and describes it in words', async () => {
    const { d, p, floor, withLine } = await setup();
    const choices = await loadProjectChoices(d);
    for (const ref of [{ projectId: p }, { projectId: p, budgetLineId: floor }, { projectId: p, commitmentId: withLine, effect: 'reversal' as const }]) {
      expect(buildRef(tagFromRef(ref), choices, ref.effect !== undefined).ref).toEqual(ref);
    }
    expect(describeRef({ projectId: p, budgetLineId: floor }, choices)).toBe('Kitchen › Flooring');
    expect(describeRef({ projectId: p, commitmentId: withLine, effect: 'credit' }, choices)).toBe('Kitchen › Cabinets job (credit)');
    expect(describeRef(undefined, choices)).toBe('');
    expect(describeRef({ projectId: 999 }, choices)).toMatch(/no longer exists/);
  });
});

describe('creating and editing transactions with a project', () => {
  it('a new transaction can be created already tagged, and its figures show at once', async () => {
    const { d, p, a, withLine } = await setup();
    const id = await createTxn(d, { accountId: a, date: '2026-11-04', amountCents: -$(250), payee: 'Acme', project: { projectId: p, commitmentId: withLine } });
    expect((await d.txns.get(id))!.project).toEqual({ projectId: p, commitmentId: withLine });
    expect((await loadProjectSummary(d, p))!.paidCents).toBe($(250));
  });

  it('removing or changing a tag works, and the figures follow', async () => {
    const { d, p, a, cab, floor } = await setup();
    const id = await createTxn(d, { accountId: a, date: '2026-11-04', amountCents: -$(250), project: { projectId: p, budgetLineId: cab } });
    await editTxn(d, id, { project: { projectId: p, budgetLineId: floor } });
    let s = (await loadProjectSummary(d, p))!;
    expect(s.lines.find((l) => l.name === 'Flooring')!.paidCents).toBe($(250));
    await editTxn(d, id, { project: undefined });
    s = (await loadProjectSummary(d, p))!;
    expect(s.paidCents).toBe(0);
    expect('project' in (await d.txns.get(id))!).toBe(false);
  });

  it('editing the amount to money coming back on a contract is refused until it says reversal or credit', async () => {
    const { d, p, a, withLine } = await setup();
    const dep = await createTxn(d, { accountId: a, date: '2026-11-04', amountCents: -$(900), project: { projectId: p, commitmentId: withLine } });
    const id = await createTxn(d, { accountId: a, date: '2026-11-04', amountCents: -$(100), project: { projectId: p, commitmentId: withLine } });
    await expect(editTxn(d, id, { amountCents: $(100) })).rejects.toThrow(/reversal.*credit/);
    expect((await d.txns.get(id))!.amountCents).toBe(-$(100)); // nothing changed
    await editTxn(d, id, { amountCents: $(100), project: { projectId: p, commitmentId: withLine, effect: 'reversal' } });
    expect((await loadProjectSummary(d, p))!.paidCents).toBe($(800));
    // making a reversal bigger than what was paid is refused, and a reversal does not count against itself
    await expect(editTxn(d, id, { amountCents: $(901) })).rejects.toThrow(/more than/);
    await editTxn(d, id, { amountCents: $(900) });
    expect(dep).toBeGreaterThan(0);
  });

  it('an edit that touches no project field is never held up by an old tag', async () => {
    const { d, p, a, withLine } = await setup();
    const id = await createTxn(d, { accountId: a, date: '2026-11-04', amountCents: -$(10), project: { projectId: p, commitmentId: withLine } });
    await d.txns.update(id, { project: { projectId: p, commitmentId: 424242 } }); // a tag that went stale
    await editTxn(d, id, { memo: 'a note', date: '2026-11-05' });
    expect((await d.txns.get(id))!.memo).toBe('a note');
  });

  it('split references are checked and kept on edit', async () => {
    const { d, p, a, cab } = await setup();
    await expect(createTxn(d, { accountId: a, date: '2026-11-04', amountCents: -$(10), splits: [{ categoryId: 1, amountCents: -$(5), project: { projectId: p, budgetLineId: 424242 } }, { categoryId: 2, amountCents: -$(5) }] })).rejects.toThrow(/budget line/);
    const id = await createTxn(d, { accountId: a, date: '2026-11-04', amountCents: -$(10), splits: [{ categoryId: 1, amountCents: -$(6), project: { projectId: p, budgetLineId: cab } }, { categoryId: 2, amountCents: -$(4) }] });
    const t = (await d.txns.get(id))!;
    await editTxn(d, id, { memo: 'x', splits: t.splits });
    expect((await d.txns.get(id))!.splits![0].project).toEqual({ projectId: p, budgetLineId: cab });
    await expect(checkTxnProjects(d, { amountCents: -$(10), splits: [{ categoryId: 1, amountCents: -$(10), project: { projectId: 999999 } }] })).rejects.toThrow(/project/);
  });

  it('converting a tagged transaction to a transfer drops the tag (transfers are never project spending)', async () => {
    const { d, p, a, b } = await setup();
    const { fromTxnId } = await createTransfer(d, { fromAccountId: a, toAccountId: b, date: '2026-11-04', amountCents: $(5) });
    await expect(editTxn(d, fromTxnId, { memo: 'moved' })).resolves.toBeUndefined();
    await expect(setTxnProject(d, fromTxnId, { projectId: p })).rejects.toThrow(/transfer/i);
  });
});

describe('bulk association says what it did and why it left things alone', () => {
  it('tags what it safely can and reports every other one with a reason', async () => {
    const { d, p, bare, cab, a, b, withLine, add } = await setup();
    const ok1 = await add(-10), ok2 = await add(-20);
    const { fromTxnId } = await createTransfer(d, { fromAccountId: a, toAccountId: b, date: '2026-11-04', amountCents: $(100) });
    const split = await add(-10, { splits: [{ categoryId: 1, amountCents: -$(6) }, { categoryId: 2, amountCents: -$(4) }] });
    const elsewhere = await add(-30, { project: { projectId: bare } });
    const refund = await add(15);
    const r = await bulkSetTxnProject(d, [ok1, ok2, fromTxnId, split, elsewhere, refund], { projectId: p, budgetLineId: cab });
    expect(r.updated).toBe(2);
    expect(r.skipped!.map((s) => [s.txnId, s.reason]).sort()).toEqual([
      [fromTxnId, 'transfer'], [split, 'split'], [elsewhere, 'alreadyTagged'], [refund, 'ambiguousRefund'],
    ].sort());
    expect(r).toMatchObject({ skippedTransfers: 1, splitsSkipped: 1, alreadyTagged: 1, ambiguousRefunds: 1 });
    expect((await d.txns.get(elsewhere))!.project).toEqual({ projectId: bare }); // not silently overwritten
    expect((await d.txns.get(split))!.project).toBeUndefined();
    expect(withLine).toBeGreaterThan(0);
  });

  it('replaces an existing tag only when asked to', async () => {
    const { d, p, bare, cab, add } = await setup();
    const t = await add(-30, { project: { projectId: bare } });
    const r = await bulkSetTxnProject(d, [t], { projectId: p, budgetLineId: cab }, { replace: true });
    expect(r.updated).toBe(1);
    expect((await d.txns.get(t))!.project).toEqual({ projectId: p, budgetLineId: cab });
    // tagging with the same thing again is not a conflict
    expect((await bulkSetTxnProject(d, [t], { projectId: p, budgetLineId: cab })).updated).toBe(1);
  });

  it('money coming back is skipped when it is ambiguous, and tagged as a general refund when that is said', async () => {
    const { d, p, add } = await setup();
    const back = await add(40);
    const first = await bulkSetTxnProject(d, [back], { projectId: p });
    expect(first.updated).toBe(0);
    expect(first.ambiguousRefunds).toBe(1);
    const second = await bulkSetTxnProject(d, [back], { projectId: p }, { refundsAreProjectLevel: true });
    expect(second.updated).toBe(1);
    expect((await loadProjectSummary(d, p))!.paidCents).toBe(-$(40));
  });

  it('money coming back on a contract in bulk needs a choice, and one larger than the payments is refused', async () => {
    const { d, p, add, withLine } = await setup();
    const dep = await add(-100), back = await add(60), huge = await add(500);
    await setTxnProject(d, dep, { projectId: p, commitmentId: withLine });
    const needs = await bulkSetTxnProject(d, [back], { projectId: p, commitmentId: withLine });
    expect(needs).toMatchObject({ updated: 0, needsChoice: 1 });
    const big = await bulkSetTxnProject(d, [huge], { projectId: p, commitmentId: withLine, effect: 'credit' });
    expect(big).toMatchObject({ updated: 0, exceedsPayments: 1 });
    expect(big.skipped).toEqual([{ txnId: huge, reason: 'exceedsPayments' }]);
  });

  it('a project with no contracts takes money coming back without asking', async () => {
    const { d, bare, add } = await setup();
    const back = await add(5);
    expect((await bulkSetTxnProject(d, [back], { projectId: bare })).updated).toBe(1);
  });

  it('clearing removes the tag and does not need any option', async () => {
    const { d, p, add } = await setup();
    const t = await add(-5, { project: { projectId: p } });
    expect((await bulkSetTxnProject(d, [t], null)).updated).toBe(1);
    expect((await d.txns.get(t))!.project).toBeUndefined();
  });

  it('a tag on a cancelled contract can still be seen and chosen again, and a quote cannot be paid by accident', async () => {
    const { d, p, withLine, quote } = await setup();
    await setCommitmentStatus(withLine, 'cancelled', d);
    const kitchen = (await loadProjectChoices(d)).find((c) => c.id === p)!;
    expect(pickableContracts(kitchen, '').map((c) => c.id)).not.toContain(withLine);
    expect(pickableContracts(kitchen, String(withLine)).map((c) => c.id)).toContain(withLine);
    expect(pickableContracts(kitchen, '').map((c) => c.id)).not.toContain(quote);
  });
});
