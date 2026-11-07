import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { buildIcs } from '../calendar/ics';
import { dueInstances } from '../../lib/schedule';
import type { Loan, RecurringRule } from '../../types';
import { ledgerDueItems } from './dueProvider';

/**
 * B3.0B: the Finance Calendar layer honors Hide Amounts (found in B2 browser acceptance: "Example Rent $1,200.00" was shown with Hide Amounts on).
 * Nothing about scheduling, ids or dates changes, and the .ics file keeps its existing text (documented as a separate, deliberate export).
 */
let n = 0;
const fresh = () => new FinanceDB(`test-ledger-hide-${n++}`);
const TODAY = '2026-11-04';
const Q = { from: '2026-11-01', to: '2026-12-31', today: TODAY, overdueDays: 0 };
const MONEY = /\$\s?\d/;

async function seed(d: FinanceDB) {
  const accountId = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
  const rent = (await d.recurring.add({ accountId, payee: 'Example Rent', amountCents: -120000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-11-15', active: true } as RecurringRule)) as number;
  const pay = (await d.recurring.add({ accountId, payee: 'Example Pay', amountCents: 300000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-11-20', active: true } as RecurringRule)) as number;
  const loan = (await d.loans.add({ name: 'Test mortgage', kind: 'mortgage', setup: 'current', balanceCents: 20000000, asOfDate: '2026-10-01', nextPaymentDate: '2026-11-10', remainingMonths: 300, annualRatePct: 6, extraMode: 'shorten' } as Loan)) as number;
  return { accountId, rent, pay, loan };
}
const strings = (it: Awaited<ReturnType<typeof ledgerDueItems>>[number]) => [it.title, it.detail ?? '', it.sourceLabel ?? '', String(it.sourceRecordId), it.id];

describe('Finance Calendar layer and Hide Amounts', () => {
  it('with Hide Amounts OFF the titles are exactly what they were (payee and amount)', async () => {
    const d = fresh();
    const { rent } = await seed(d);
    const got = await ledgerDueItems(d, Q, false);
    expect(got.find((i) => i.sourceRecordId === `scheduled:${rent}` && i.date === '2026-11-15')!.title).toBe('Example Rent $1,200.00');
    expect(got.some((i) => i.title.includes('Test mortgage payment $'))).toBe(true);
    expect(got.every((i) => i.icsTitle === undefined && i.icsDetail === undefined)).toBe(true); // nothing extra is added when nothing is hidden
  });

  it('with Hide Amounts ON no title, detail or other string of any Finance item carries a money figure, and the useful words stay', async () => {
    const d = fresh();
    const { rent, pay } = await seed(d);
    const got = await ledgerDueItems(d, Q, true);
    for (const it of got) for (const s of strings(it)) expect(s, `${it.id}: ${s}`).not.toMatch(MONEY);
    const r = got.find((i) => i.sourceRecordId === `scheduled:${rent}` && i.date === '2026-11-15')!;
    expect(r.title).toBe('Example Rent');
    expect(r.detail).toBe('Scheduled payment to approve.');
    expect(got.find((i) => i.sourceRecordId === `scheduled:${pay}`)!.title).toBe('Example Pay');
    const loan = got.find((i) => i.title.startsWith('Test mortgage payment'))!;
    expect(loan.title).toBe('Test mortgage payment $••••'); // the usual masked figure; the words stay
    expect(loan.detail).toBe('Loan payment due.');
  });

  it('hiding amounts changes only the words: the same items, dates, ids, priorities, sources and export ids', async () => {
    const d = fresh();
    await seed(d);
    const shown = await ledgerDueItems(d, Q, false);
    const hidden = await ledgerDueItems(d, Q, true);
    const key = (i: (typeof shown)[number]) => JSON.stringify({ id: i.id, date: i.date, p: i.priority, s: i.status, r: i.sourceRecordId, u: i.icsUid, a: i.icsAlarmMinutes, e: i.endDate, all: i.allDay, m: i.sourceModule });
    expect(hidden.map(key)).toEqual(shown.map(key));
    expect(hidden.length).toBeGreaterThan(3);
  });

  it('toggling Hide Amounts back and forth returns the original text (nothing is stored or remembered)', async () => {
    const d = fresh();
    await seed(d);
    const a = (await ledgerDueItems(d, Q, false)).map((i) => i.title);
    await ledgerDueItems(d, Q, true);
    expect((await ledgerDueItems(d, Q, false)).map((i) => i.title)).toEqual(a);
  });

  it('does not change the scheduled payment, any balance, any transaction or any Finance row', async () => {
    const d = fresh();
    await seed(d);
    const snap = async () => JSON.stringify({ rec: await d.recurring.toArray(), log: await d.recurringLog.toArray(), txns: await d.txns.toArray(), acc: await d.accounts.toArray(), loans: await d.loans.toArray(), mod: await d.moduleRecords.toArray() });
    const before = await snap();
    await ledgerDueItems(d, Q, true);
    await ledgerDueItems(d, Q, false);
    expect(await snap()).toBe(before);
    const due = await dueInstances(d, TODAY, 60);
    expect(due.every((x) => x.rule.amountCents === -120000 || x.rule.amountCents === 300000)).toBe(true);
  });

  it('the calendar file is a separate, deliberate export: it keeps the full text even when the screen text is hidden (documented, not changed)', async () => {
    const d = fresh();
    const { rent } = await seed(d);
    const hidden = (await ledgerDueItems(d, Q, true)).filter((i) => i.sourceRecordId === `scheduled:${rent}`);
    const shown = (await ledgerDueItems(d, Q, false)).filter((i) => i.sourceRecordId === `scheduled:${rent}`);
    const fileOf = (items: typeof hidden) => buildIcs({ name: 'Test', events: [], derived: items, nowIso: '2026-11-04T12:00:00.000Z' });
    expect(fileOf(hidden)).toBe(fileOf(shown));
    expect(fileOf(hidden)).toContain('SUMMARY:Example Rent $1\\,200.00');
    // and the file is the same for the other kinds of Finance item
    const allHidden = await ledgerDueItems(d, Q, true);
    const allShown = await ledgerDueItems(d, Q, false);
    expect(fileOf(allHidden as typeof hidden)).toBe(fileOf(allShown as typeof hidden));
  });
});
