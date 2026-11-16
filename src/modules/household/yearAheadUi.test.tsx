import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { maskMoney } from '../../ui/TxnRefs';
import { devices } from '../bills/billsTestkit';
import { createProject, createCommitment } from '../projects/data';
import { blankProject } from '../projects/model';
import { TODAY, seed } from './householdSeed';
import { Attention, Months, Summary, Undated } from './YearAheadPage';
import { householdSearchSource } from './searchSource';
import { loadYearAhead } from './yearAheadData';

/** R3.1 screen markup (static): certainty keeps its words, nothing is a bare total, and Hide Amounts shows no digit of money anywhere. */
const shown = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hidden = () => '$••••';
const id = (t: string) => t;
const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function ya() {
  const { A } = devices();
  await seed(A.d);
  const pid = await createProject(blankProject({ name: 'Porch rebuild', status: 'active' }), A.d);
  await createCommitment(pid, { title: 'Carpenter $2,500.00 deposit', amountCents: 250000, status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: null, notes: '' }, A.d);
  return loadYearAhead(TODAY, A.d);
}
const page = (y: Awaited<ReturnType<typeof ya>>, money: (c: number) => string, text: (t: string) => string) => [
  renderToStaticMarkup(h(Summary, { ya: y, money })),
  renderToStaticMarkup(h(Attention, { items: y.attention, text })),
  renderToStaticMarkup(h(Undated, { rows: y.undated, money, text, today: y.today })),
  renderToStaticMarkup(h(Months, { ya: y, money, text })),
].join('\n');

describe('R3.1 Year Ahead screen', () => {
  it('keeps the groups apart, labels certainty in words, and never shows a combined grand total', async () => {
    const y = await ya();
    const html = page(y, shown, id);
    const t = strip(html);
    for (const g of ['Bills and services', 'Finance-only payments', 'Project payments', 'Important dates']) expect(t).toContain(g);
    expect(t).toContain('Plans, not payments');
    for (const w of ['Known', 'Estimated', 'Amount not known', 'Date not specified']) expect(t).toContain(w);
    expect(t).not.toMatch(/You will spend|Total for the year|Grand total/i);
    expect((html.match(/hh-tile ya-tile/g) ?? []).length).toBe(4);
    expect(t).toContain(shown(y.figures.billsServices.totals.known.cents));
    expect(t).toContain(shown(y.figures.projects.leftCents));
  });
  it('Hide Amounts removes every digit of money, including an amount typed into a record title', async () => {
    const y = await ya();
    const t = strip(page(y, hidden, maskMoney));
    expect(t).not.toMatch(/\$\s?\d/);
    expect(t).toContain('$••••');
    expect(t).not.toContain('2,500'); // ids-ok: a money string, never an id
  });
  it('is only links and reading: no form control writes anything', async () => {
    const html = page(await ya(), shown, id);
    expect(html).not.toMatch(/<form|<input|<textarea|type="submit"/);
  });
});

describe('R3.1 Search', () => {
  const find = (q: string) => householdSearchSource.search(q, 10) as { id: string; path: string }[];
  it('finds Year ahead and Household finances as pages, and still keeps "household finances" to its own page', () => {
    expect(find('year ahead').map((r) => r.path)).toEqual(['/household/year-ahead']);
    expect(find('twelve months').map((r) => r.path)).toEqual(['/household/year-ahead']);
    expect(find('household finances').map((r) => r.path)).toEqual(['/household']);
    expect(find('bills')).toEqual([]);
  });
});
