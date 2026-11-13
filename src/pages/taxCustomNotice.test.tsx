import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { TAX_2026, TAX_2027 } from '../data/taxYears';
import { resolveTables } from '../lib/income';
import { CustomTableNotice, customTableDifferences } from './TaxProvenance';
import type { TaxSettings } from '../types';

const settings = (text?: string): TaxSettings => ({ year: 2027, itemizedDeductionCents: 0, otherIncomeCents: 0, federalCreditsCents: 0, maDependents: 0, maCreditsCents: 0, tablesOverride: text });
const render = (diffs: string[]) => renderToStaticMarkup(createElement(CustomTableNotice, { year: 2027, differences: diffs, onEdit: () => {} }));

describe('outdated saved 2027 table notice', () => {
  it('built-in 2027 table: no differences, nothing shown', () => {
    const r = resolveTables(2027, settings());
    expect(r.source).toBe('built-in');
    expect(customTableDifferences(r.tables!, TAX_2027)).toEqual([]);
    expect(render([])).toBe('');
  });
  it('a 2027 table copied from 2026 is flagged by standard deduction, wage base, brackets and 401(k)', () => {
    const text = JSON.stringify({ ...TAX_2026, year: 2027 });
    const r = resolveTables(2027, settings(text));
    expect(r.source).toBe('custom'); // precedence unchanged
    const d = customTableDifferences(r.tables!, TAX_2027);
    expect(d).toEqual(['joint standard deduction', 'Social Security wage base', 'federal brackets', '401(k) limit']);
    const html = render(d);
    expect(html).toContain('instead of the published built-in figures');
    expect(html).toContain('Social Security wage base');
    expect(html).toContain('Reset to built-in');
  });
  it('a custom table that matches the published values on the checked fields shows no notice', () => {
    const text = JSON.stringify({ ...TAX_2027, notes: ['mine'], ma: { ...TAX_2027.ma, withholdingRate: 0.04 } });
    expect(customTableDifferences(resolveTables(2027, settings(text)).tables!, TAX_2027)).toEqual([]);
  });
  it('a deliberately customized table is used as saved, and the built-in table is untouched', () => {
    const text = JSON.stringify({ ...TAX_2027, ssWageBase: 19000000 });
    const r = resolveTables(2027, settings(text));
    expect(r.tables?.ssWageBase).toBe(19000000);
    expect(customTableDifferences(r.tables!, TAX_2027)).toEqual(['Social Security wage base']);
    expect(TAX_2027.ssWageBase).toBe(19230000);
    // reset = clearing the saved text: back to the built-in table
    expect(resolveTables(2027, settings(undefined)).tables).toBe(TAX_2027);
  });
  it('the page shows the notice only for 2027 with a saved table, and the notice never writes anything', () => {
    const page = readFileSync('src/pages/IncomePage.tsx', 'utf8');
    expect(page).toMatch(/year === 2027 && model\.tableSource === 'custom'/);
    const notice = readFileSync('src/pages/TaxProvenance.tsx', 'utf8');
    expect(notice).not.toMatch(/setSettings|tablesOverride|db\./);
  });
});
