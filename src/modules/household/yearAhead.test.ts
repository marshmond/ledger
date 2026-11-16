import { describe, expect, it } from 'vitest';
import { addDays, addMonths } from '../../lib/dates';
import { providerNamed } from '../../core/contactTestkit';
import { blankAsset } from '../assets/model';
import { createAsset } from '../assets/data';
import { commitmentWindow } from '../bills/commitments';
import { createObligation } from '../bills/data';
import { devices, monthly, ob, obRec } from '../bills/billsTestkit';
import { derive } from '../bills/readModel';
import { scheduleStateOf } from '../services/expectedCharges';
import { arrangement } from './householdTestkit';
import { createProject, createCommitment } from '../projects/data';
import { blankProject } from '../projects/model';
import { TODAY, digest, seed } from './householdSeed';
import { loadHouseholdOverview } from './overview';
import { assetRows, composeYearAhead, financeRows, periodsOf, projectRows, SOURCE_LABEL, type FinancePart, type Part, type YearAheadParts } from './yearAhead';
import { loadYearAhead } from './yearAheadData';
import type { FinanceDB } from '../../db';

/**
 * R3.1 Year Ahead on real (fake) databases and on hand-built inputs. Everything is invented. Money is whole cents; Finance outflows are negative.
 * Seed (see householdSeed): Streamly $15.49 monthly (known), Example Power ~$70.00 monthly (estimated), Sparkle Cleaning $150.00 monthly linked to the
 * House cleaning arrangement ($75.00 a visit every other Friday), so the pair is related but NOT provably one charge.
 */
const fin = (over: Partial<FinancePart> = {}): FinancePart => ({ rules: [], handled: new Set(), cashAccountIds: new Set([1]), loans: [], taxes: [], forecastEnd: '2027-11-01', includeTaxes: true, ...over });
const ok = <T,>(value: T): Part<T> => ({ ok: true, value });

async function addRule(d: FinanceDB, payee: string, amountCents: number, frequency: string, startDate: string, over: Record<string, unknown> = {}) {
  const accountId = (await d.accounts.toCollection().first())!.id as number;
  return (await d.recurring.add({ accountId, payee, amountCents, categoryId: null, memo: '', frequency, startDate, active: true, ...over } as never)) as number;
}
async function mkBill(d: FinanceDB, title: string, over: Parameters<typeof ob>[0], provider: string) {
  return (await createObligation({ data: ob({ title, need: 'flexible', trackingSince: '2026-01-01', ...over }, TODAY), provider: await providerNamed(d, provider), today: TODAY }, d)).id;
}

describe('R3.1 the window', () => {
  it('is twelve contiguous periods from today, ending on the same last day Bills uses', () => {
    for (const today of ['2026-11-16', '2028-02-29', '2026-01-31', '2026-12-31']) {
      const ps = periodsOf(today);
      expect(ps).toHaveLength(12);
      expect(ps[0].from).toBe(today);
      expect(ps[11].to).toBe(commitmentWindow(today).to);
      for (let i = 1; i < 12; i++) expect(ps[i].from).toBe(addDays(ps[i - 1].to, 1)); // no gap and no overlap
    }
  });
  it('handles month-end and leap-year starts the way the existing date utilities do', () => {
    expect(commitmentWindow('2028-02-29').to).toBe(addDays(addMonths('2028-02-29', 12), -1)); // 2029-02-27
    expect(periodsOf('2026-01-31').map((p) => p.from).slice(0, 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
});

describe('R3.1 bills and services reconcile with Household Finances', () => {
  it('the group figures are B5\'s own twelve-month figures, and the listed bill dates add up to Bills\' own commitments', async () => {
    const { A } = devices();
    await seed(A.d);
    const ya = await loadYearAhead(TODAY, A.d);
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    expect(ya.figures.billsServices.complete).toBe(true);
    expect(ya.figures.billsServices.totals).toEqual(o.commitments.twelve.totals);
    const billRows = ya.rows.filter((r) => r.source === 'bills' && r.financial);
    const sum = (c: 'known' | 'estimated') => billRows.filter((r) => r.certainty === c).reduce((n, r) => n + (r.cents ?? 0), 0);
    expect(sum('known')).toBe(o.commitments.twelve.bills.known.cents);
    expect(sum('estimated')).toBe(o.commitments.twelve.bills.estimated.cents);
    expect(ya.from).toBe(o.commitments.twelve.from);
    expect(ya.to).toBe(o.commitments.twelve.to);
  });

  it('a bill and a service that are only RELATED stay listed twice, both flagged as a possible overlap, and an attention item names them', async () => {
    const { A } = devices();
    const s = await seed(A.d);
    const ya = await loadYearAhead(TODAY, A.d);
    const sparkle = ya.rows.filter((r) => r.id.startsWith(`bill:${s.bill.sparkle}:`));
    const visits = ya.rows.filter((r) => r.id.startsWith(`visit:${s.clean}:`));
    expect(sparkle.length).toBeGreaterThan(0);
    expect(visits.length).toBeGreaterThan(0);
    expect([...sparkle, ...visits].every((r) => r.overlap !== null && !r.folded)).toBe(true);
    expect(ya.attention.some((a) => a.kind === 'overlap' && a.title.includes('Sparkle Cleaning'))).toBe(true);
    expect(ya.possibleOverlaps).toBeGreaterThan(0);
  });

  it('keeps known, estimated and unknown apart: an unknown amount is a count and a "not known" row, never zero', async () => {
    const { A } = devices();
    await seed(A.d);
    await mkBill(A.d, 'Mystery Water', { type: 'utility', amountKind: 'unknown', prices: [], schedule: monthly(5, '2026-01') }, 'Mystery Water Co');
    const ya = await loadYearAhead(TODAY, A.d);
    const mystery = ya.rows.filter((r) => r.title === 'Mystery Water');
    expect(mystery.length).toBeGreaterThan(0);
    expect(mystery.every((r) => r.cents === null && r.certainty === 'unknown')).toBe(true);
    expect(ya.figures.billsServices.totals.unknown.count).toBeGreaterThanOrEqual(mystery.length);
    expect(ya.attention.some((a) => a.kind === 'unknown' && a.title === 'Mystery Water')).toBe(true);
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    expect(ya.figures.billsServices.totals).toEqual(o.commitments.twelve.totals);
  });

  it('a renewal date is a date, not a second payment: it carries no amount and joins no figure', async () => {
    const { A } = devices();
    await seed(A.d);
    await mkBill(A.d, 'Annual Insurance', { type: 'insurance', prices: [{ from: '2026-01-01', cents: 120000, label: '' }], schedule: monthly(10, '2027-03', 12), terms: { renewalDate: '2027-03-10' } as never }, 'Shield Insurance');
    const ya = await loadYearAhead(TODAY, A.d);
    const pay = ya.rows.filter((r) => r.title === 'Annual Insurance' && r.financial);
    expect(pay).toHaveLength(1);
    expect(pay[0].irregular).toBe(true);
    for (const r of ya.rows.filter((x) => !x.financial)) { expect(r.cents).toBeNull(); expect(r.certainty).toBeNull(); }
  });
});

describe('R3.1 Finance-only items', () => {
  it('lists a standalone scheduled payment once per date, keeps it out of the bills figure, and says whether the Forecast contains it', async () => {
    const { A } = devices();
    await seed(A.d);
    await addRule(A.d, 'Orchard Property Tax', -120000, 'quarterly', '2027-02-01');
    const ya = await loadYearAhead(TODAY, A.d);
    const rows = ya.rows.filter((r) => r.title === 'Orchard Property Tax');
    expect(rows.length).toBe(4);
    expect(rows.every((r) => r.source === 'finance' && r.cents === 120000 && r.certainty === 'known' && r.overlap === null && r.href.startsWith('#/ledger/scheduled?rule='))).toBe(true);
    expect(ya.figures.finance.totals.known.cents).toBe(480000);
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    expect(ya.figures.billsServices.totals).toEqual(o.commitments.twelve.totals); // a Finance item never changes the bills figure
    expect(rows[0].forecast).toBe('in');
  });

  it('counts a rule that a bill points at once, as the bill, and ignores transfers and income', async () => {
    const { A } = devices();
    await seed(A.d);
    const r = await addRule(A.d, 'Gym Club', -4500, 'monthly', '2026-12-01');
    await mkBill(A.d, 'Gym membership', { type: 'subscription', prices: [{ from: '2026-01-01', cents: 4500, label: '' }], schedule: monthly(1, '2026-01'), scheduledRuleIds: [r] }, 'Gym Club Inc');
    await addRule(A.d, 'Move to savings', -50000, 'monthly', '2026-12-01', { transferAccountId: 2 });
    await addRule(A.d, 'Employer pay', 300000, 'monthly', '2026-12-01');
    const ya = await loadYearAhead(TODAY, A.d);
    expect(ya.rows.filter((x) => x.source === 'finance')).toHaveLength(0);
    expect(ya.linkedScheduled).toBe(1);
    const gym = ya.rows.filter((x) => x.title === 'Gym membership');
    expect(gym.length).toBeGreaterThan(0);
    expect(gym.every((x) => x.forecast === 'in')).toBe(true); // the Forecast already holds it, through the linked rule
  });

  it('lists a rule that resembles a bill as a POSSIBLE OVERLAP and leaves it out of the Finance-only figure', async () => {
    const { A } = devices();
    await seed(A.d);
    await addRule(A.d, 'Streamly', -1549, 'monthly', '2026-12-15'); // not linked to the Streamly bill
    const ya = await loadYearAhead(TODAY, A.d);
    const dup = ya.rows.filter((r) => r.source === 'finance');
    expect(dup.length).toBeGreaterThan(0);
    expect(dup.every((r) => r.overlap !== null && r.overlap.includes('Streamly'))).toBe(true);
    expect(ya.figures.finance.totals.known.cents).toBe(0);
    expect(ya.attention.some((a) => a.kind === 'overlap' && a.reason.includes('not added'))).toBe(true);
  });

  it('takes loans and taxes only from the Forecast\'s own items, skips refunds and anything outside the window', () => {
    const f = fin({ loans: [{ date: '2026-12-01', label: 'Car loan payment', cents: 42000 }, { date: '2028-01-01', label: 'Car loan payment', cents: 42000 }], taxes: [{ date: '2027-04-15', label: 'Federal tax due at filing', cents: -310000 }, { date: '2027-03-15', label: 'Expected federal refund', cents: 90000 }], forecastEnd: '2027-06-01' });
    const { rows } = financeRows(f, '2026-11-16', [], []);
    expect(rows.map((r) => [r.kind, r.cents, r.certainty, r.forecast])).toEqual([['loan', 42000, 'estimated', 'in'], ['tax', 310000, 'estimated', 'in']]);
    expect(financeRows({ ...f, includeTaxes: false }, '2026-11-16', [], []).rows.find((r) => r.kind === 'tax')!.forecast).toBe('not');
  });
});

describe('R3.1 projects', () => {
  it('shows only the agreed amount still to pay, undated, and never the budget, a quote or what was paid', async () => {
    const { A } = devices();
    const s = await seed(A.d);
    const pid = await createProject(blankProject({ name: 'Kitchen refit', status: 'active', budgetCents: 5000000, targetDate: '2027-05-01' }), A.d);
    const { id: cid } = await createCommitment(pid, { title: 'Cabinet contract', amountCents: 1000000, status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: '2026-10-01', notes: '' }, A.d);
    await createCommitment(pid, { title: 'Alternative quote', amountCents: 900000, status: 'quoted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: null, notes: '' }, A.d);
    await A.d.txns.add({ accountId: s.acct, date: '2026-10-20', amountCents: -250000, payee: 'Cabinet Makers', memo: '', status: 'cleared', categoryId: null, project: { projectId: pid, commitmentId: cid } } as never);
    const ya = await loadYearAhead(TODAY, A.d);
    expect(ya.undated).toHaveLength(1);
    expect(ya.undated[0]).toMatchObject({ source: 'projects', date: null, cents: 750000, certainty: 'known', href: `#/projects/${pid}` });
    expect(ya.undated[0].note).toContain('2027-05-01');
    expect(ya.figures.projects).toMatchObject({ leftCents: 750000, count: 1 });
    expect(ya.rows.some((r) => r.source === 'projects')).toBe(false); // no date, so no month
    expect(ya.attention.some((a) => a.kind === 'undated')).toBe(true);
    const done = await createProject(blankProject({ name: 'Old job', status: 'completed' }), A.d);
    await createCommitment(done, { title: 'Done', amountCents: 100000, status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: null, notes: '' }, A.d);
    expect((await loadYearAhead(TODAY, A.d)).undated).toHaveLength(1); // a finished project adds nothing
  });
  it('an overpaid or fully paid agreement is not an outstanding commitment', () => {
    expect(projectRows({ items: [{ projectId: 1, projectName: 'A', commitmentId: 2, title: 'T', agreedCents: 100, paidCents: 100, leftCents: 0, targetDate: null }] })).toEqual([]);
  });
});

describe('R3.1 Home & Assets stays informational', () => {
  it('a warranty end date and a maintenance task are dated rows with no amount and no figure', async () => {
    const { A } = devices();
    await seed(A.d);
    await createAsset(blankAsset({ name: 'Dishwasher', warrantyEndDate: '2027-02-01' }), A.d);
    const ya = await loadYearAhead(TODAY, A.d);
    const w = ya.rows.find((r) => r.kind === 'warranty');
    expect(w).toMatchObject({ source: 'assets', financial: false, cents: null, certainty: null, date: '2027-02-01' });
    expect(w!.href).toMatch(/^#\/assets\/\d+$/);
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    expect(ya.figures.billsServices.totals).toEqual(o.commitments.twelve.totals);
    expect(ya.deadlineCount).toBeGreaterThan(0);
  });
  it('keeps only the in-window dates', () => {
    const rows = assetRows({ warranties: [{ key: '1', assetId: 1, assetName: 'A', title: 'W', date: '2026-10-01', warrantyId: 1 }, { key: '2', assetId: 1, assetName: 'A', title: 'W2', date: '2027-12-01', warrantyId: 2 }, { key: '3', assetId: 1, assetName: 'A', title: 'W3', date: '2027-03-01', warrantyId: 3 }], maintenance: [{ taskId: 9, title: 'Service boiler', date: '2027-01-05', assetId: 1, assetName: 'A' }], overdueMaintenance: 0 }, '2026-11-16');
    expect(rows.map((r) => r.id)).toEqual(['warranty:3', 'maintenance:9']);
    expect(rows.every((r) => r.cents === null && !r.financial)).toBe(true);
  });
});

describe('R3.1 one source failing, links, and read-only', () => {
  it('a failed source says the review is incomplete and removes ITS figure, while the other sections still work', async () => {
    const { A } = devices();
    await seed(A.d);
    const good = await loadYearAhead(TODAY, A.d);
    const parts = { bills: ok({ obligations: [], derived: null as never, serviceLinks: new Map() }), services: ok({ arrangements: [], state: new Map() }), finance: ok(fin()), projects: ok({ items: [] }), assets: ok({ warranties: [], maintenance: [], overdueMaintenance: 0 }) } satisfies YearAheadParts;
    const failed = composeYearAhead(TODAY, { ...parts, bills: { ok: false, error: 'boom' }, finance: { ok: false, error: 'nope' } });
    expect(failed.incomplete).toBe(true);
    expect(failed.sources.filter((s) => !s.ok).map((s) => s.id)).toEqual(['bills', 'finance']);
    expect(failed.figures.billsServices.complete).toBe(false);
    expect(failed.figures.finance.complete).toBe(false);
    expect(failed.commitments).toBeNull();
    expect(failed.periods.every((p) => p.billsServices === null && p.finance === null)).toBe(true);
    expect(failed.attention.filter((a) => a.kind === 'source').map((a) => a.title)).toEqual([`${SOURCE_LABEL.bills} could not be read`, `${SOURCE_LABEL.finance} could not be read`]);
    expect(good.incomplete).toBe(false);
  });

  it('every row has a unique id and a link into the module that owns it, and loading changes nothing', async () => {
    const { A } = devices();
    await seed(A.d);
    await addRule(A.d, 'Orchard Property Tax', -120000, 'quarterly', '2027-02-01');
    await createAsset(blankAsset({ name: 'Dishwasher', warrantyEndDate: '2027-02-01' }), A.d);
    const before = await digest(A.d);
    const ya = await loadYearAhead(TODAY, A.d);
    expect(await digest(A.d)).toBe(before); // read only
    const all = [...ya.rows, ...ya.undated];
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    const pattern: Record<string, RegExp> = { bills: /^#\/bills\/o\/\d+$/, services: /^#\/services\/(a|v)\/\d+$/, finance: /^#\/ledger\/(scheduled\?rule=\d+|debt|taxplan)$/, projects: /^#\/projects\/\d+$/, assets: /^#\/assets\/\d+$/ };
    for (const r of all) expect(r.href, `${r.id} -> ${r.href}`).toMatch(pattern[r.source]);
    for (const p of ya.periods) for (const r of p.rows) { expect(r.date! >= p.from && r.date! <= p.to).toBe(true); }
    expect(ya.periods.reduce((n, p) => n + p.rows.length, 0)).toBe(ya.rows.length);
  });
});

describe('R3.1 a linked bill and service that are provably one charge', () => {
  const T = '2026-11-08';
  const bill = (cents: number) => obRec(1, { title: 'Cleaning service', trackingSince: '2026-11-01', schedule: monthly(18, '2026-11'), prices: [{ from: '2026-11-01', cents, label: '' }] }, '2026-11-01');
  const monthlyVisits = arrangement(1, { title: 'Cleaning visits', cadence: { mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: { type: 'never' } }, anchorDate: '2026-11-18' }, expected: { basis: 'perVisit', cents: 24000 } });
  const parts = (cents: number): YearAheadParts => {
    const derived = derive({ obligations: [bill(cents)], cycles: [], tasks: [], financeTxns: new Map() }, T);
    return { bills: ok({ obligations: [bill(cents)], derived, serviceLinks: new Map([[1, [1]]]) }), services: ok({ arrangements: [monthlyVisits], state: new Map([[1, scheduleStateOf([])]]) }), finance: ok(fin()), projects: ok({ items: [] }), assets: ok({ warranties: [], maintenance: [], overdueMaintenance: 0 }) };
  };
  it('equal totals: the visits are listed, labelled and NOT added, so the charge counts once', () => {
    const ya = composeYearAhead(T, parts(24000));
    const visits = ya.rows.filter((r) => r.source === 'services' && r.financial);
    expect(visits.length).toBe(12);
    expect(visits.every((r) => r.folded && r.overlap === null)).toBe(true);
    expect(ya.figures.billsServices.totals.known.cents + ya.figures.billsServices.totals.estimated.cents).toBe(24000 * 12);
    expect(ya.possibleOverlaps).toBe(0);
    expect(ya.periods.reduce((n, p) => n + (p.billsServices?.known.cents ?? 0) + (p.billsServices?.estimated.cents ?? 0), 0)).toBe(24000 * 12);
  });
  it('different totals: nothing is folded, both are listed and the overlap is stated rather than reconciled', () => {
    const ya = composeYearAhead(T, parts(30000));
    expect(ya.rows.filter((r) => r.source === 'services' && r.financial).every((r) => !r.folded && r.overlap !== null)).toBe(true);
    expect(ya.possibleOverlaps).toBe(1);
    expect(ya.attention.some((a) => a.kind === 'overlap')).toBe(true);
  });
});
