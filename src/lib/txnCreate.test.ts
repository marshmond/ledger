import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { installTracking } from './sync/track';
import { createTxn } from './txnCreate';

/** Invented data. */
let n = 0;
async function setup() {
  const d = new FinanceDB(`test-createtxn-${n++}`);
  installTracking(d);
  const acct = (await d.accounts.add({ name: 'A', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
  return { d, acct };
}

describe('the one way to add a transaction', () => {
  it('adds a plain transaction with the same fields the forms used to write', async () => {
    const { d, acct } = await setup();
    const id = await createTxn(d, { accountId: acct, date: '2026-11-04', amountCents: -1250, payee: 'Cafe', categoryId: 3 });
    expect(await d.txns.get(id)).toMatchObject({ accountId: acct, date: '2026-11-04', amountCents: -1250, payee: 'Cafe', memo: '', status: 'pending', categoryId: 3 });
  });

  it('accepts splits that add up and clears the single category', async () => {
    const { d, acct } = await setup();
    const id = await createTxn(d, { accountId: acct, date: '2026-11-04', amountCents: -1000, categoryId: 9, splits: [{ categoryId: 1, amountCents: -600 }, { categoryId: 2, amountCents: -400 }] });
    const t = (await d.txns.get(id))!;
    expect(t.categoryId).toBeNull();
    expect(t.splits).toHaveLength(2);
  });

  it('refuses bad input and adds nothing', async () => {
    const { d, acct } = await setup();
    await expect(createTxn(d, { accountId: acct, date: '2026-11-04', amountCents: -10.5 })).rejects.toThrow(/whole number/);
    await expect(createTxn(d, { accountId: acct, date: '11/04/2026', amountCents: -10 })).rejects.toThrow(/date/);
    await expect(createTxn(d, { accountId: acct, date: '2026-11-04', amountCents: -1000, splits: [{ categoryId: 1, amountCents: -600 }, { categoryId: 2, amountCents: -300 }] })).rejects.toThrow(/Splits total/);
    await expect(createTxn(d, { accountId: 99999, date: '2026-11-04', amountCents: -10 })).rejects.toThrow(/Account not found/);
    await expect(createTxn(d, { accountId: acct, date: '2026-11-04', amountCents: -10, project: { projectId: 12345 } })).rejects.toThrow(/project/);
    expect(await d.txns.count()).toBe(0);
  });

  it('refuses money coming back on a contract with no reversal or credit choice', async () => {
    const { d, acct } = await setup();
    const project = (await d.moduleRecords.add({ module: 'projects', kind: 'project', data: { name: 'Fence' } } as never)) as number;
    const cm = (await d.moduleRecords.add({ module: 'projects', kind: 'commitment', data: { projectId: project, title: 'Fence', status: 'accepted', amountCents: 100 } } as never)) as number;
    await expect(createTxn(d, { accountId: acct, date: '2026-11-04', amountCents: 500, project: { projectId: project, commitmentId: cm } })).rejects.toThrow(/reversal/);
    const id = await createTxn(d, { accountId: acct, date: '2026-11-04', amountCents: 500, project: { projectId: project, commitmentId: cm, effect: 'credit' } });
    expect((await d.txns.get(id))!.project?.effect).toBe('credit');
  });

  it('can start a transaction already on a project', async () => {
    const { d, acct } = await setup();
    const project = (await d.moduleRecords.add({ module: 'projects', kind: 'project', data: { name: 'Fence' } } as never)) as number;
    const id = await createTxn(d, { accountId: acct, date: '2026-11-04', amountCents: -5000, project: { projectId: project } });
    expect((await d.txns.get(id))!.project).toEqual({ projectId: project });
  });
});
