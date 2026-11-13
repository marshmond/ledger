import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinesChart } from './charts';
import { PRICE_KIND_WORD, deltaWords, missingMonths, priceKind, signedWords } from './analysisPresentation';
import { NumField } from './fields';

/**
 * D17 analysis, Invest and debt pages. The six pages were recomposed (hero, figures band, kind-of-figure tags, labeled rows); every value, assumption, date and action is the
 * one the page already had. These tests check the wording helpers, the opt-in chart options (and that the default chart is unchanged), and, by reading the source, that
 * the presentation layer does no storage access or money maths and that the stylesheet follows the rules. Layout and look are checked in a real browser, not here.
 */
const read = (f: string) => readFileSync(f, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('D17 wording helpers', () => {
  it('deltaWords says which way a month moved, with the exact amount and a percent when there is a base', () => {
    expect(deltaWords(112000, 100000)).toBe('up $120.00 (+12%)');
    expect(deltaWords(97000, 100000)).toBe('down $30.00 (−3%)');
    expect(deltaWords(50000, 50000)).toBe('same');
    expect(deltaWords(238200, 0)).toBe('up $2,382.00');
  });

  it('signedWords puts the sign in the text', () => {
    expect(signedWords(51000)).toBe('+$510.00');
    expect(signedWords(-1200)).toBe('−$12.00');
    expect(signedWords(0)).toBe('$0.00');
  });

  it('missingMonths lists only the months between the first and last saved point that have none', () => {
    expect(missingMonths(['2026-04-01', '2026-05-01', '2026-06-01', '2026-08-01', '2026-09-01', '2026-11-13'])).toEqual(['2026-07', '2026-10']);
    expect(missingMonths(['2026-04-01', '2026-04-20'])).toEqual([]);
    expect(missingMonths(['2026-04-01'])).toEqual([]);
    expect(missingMonths([])).toEqual([]);
    expect(missingMonths(['2025-11-01', '2026-02-01'])).toEqual(['2025-12', '2026-01']);
  });

  it('priceKind never shows a missing price as zero or as current', () => {
    expect(priceKind({ priceCents: null, priceSource: null })).toBe('none');
    expect(priceKind({ priceCents: 24850, priceSource: 'manual' })).toBe('manual');
    expect(priceKind({ priceCents: 24850, priceSource: 'api' })).toBe('service');
    expect(PRICE_KIND_WORD.none).toBe('No price');
    expect(Object.values(PRICE_KIND_WORD).join(' ')).not.toMatch(/current|latest|live/i);
  });
});

describe('D17 chart options (opt-in; the default chart is unchanged)', () => {
  const xLabels = ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'];
  const series = [{ label: 'End of month', color: 'var(--s1)', values: [3052082, 2525187, 1932831, -1405936, -3005607] }];
  const base = { title: 'Balance', xLabels, series };

  it('draws below zero only when asked, with the exact values in the spoken summary', () => {
    const plain = html(createElement(LinesChart, base));
    const neg = html(createElement(LinesChart, { ...base, allowNegative: true, precise: true }));
    const axisNeg = /<text[^>]*text-anchor="end"[^>]*>-\$\d/;
    expect(plain).not.toMatch(axisNeg); // no negative axis labels by default (the chart starts at zero, as before)
    expect(neg).toMatch(axisNeg); // negative axis labels when allowed
    expect(neg).toContain('ends -$30,056.07');
    expect(plain).not.toContain('ends ');
  });

  it('labels the months along the bottom only when asked, and keeps the 12 px label size in fit mode', () => {
    const yearOnly = html(createElement(LinesChart, base));
    const months = html(createElement(LinesChart, { ...base, fit: true, axis: 'month' }));
    expect(yearOnly).not.toContain('>Dec<');
    expect(months).toContain('>Dec<');
    expect(months).toContain('Nov ’26');
    expect(months).toContain('font-size="12"');
    expect(yearOnly).toContain('font-size="11"');
  });

  it('keeps the table alternative: every month in month mode, the same rows as before otherwise', () => {
    const months = html(createElement(LinesChart, { ...base, fit: true, axis: 'month' }));
    expect(months.match(/<tr>/g)?.length).toBe(1 + xLabels.length); // header + every month
    const plain = html(createElement(LinesChart, base));
    expect(plain.match(/<tr>/g)?.length).toBe(1 + 2); // header + first + last (every 12th), as before
  });

  it('NumField can carry a spoken name for a cell with no visible label, and a labeled one is unchanged', () => {
    expect(html(createElement(NumField, { value: 5, onChange: () => {}, ariaLabel: 'Rate % for Demo Card' }))).toContain('aria-label="Rate % for Demo Card"');
    const labeled = html(createElement(NumField, { label: 'New rate %', value: 5, onChange: () => {}, ariaLabel: 'ignored' }));
    expect(labeled).not.toContain('aria-label');
    expect(labeled).toContain('New rate %');
  });
});

describe('D17 source guards', () => {
  const pages = ['ForecastPage', 'ReportsPage', 'NetWorthPage', 'InvestmentsPage', 'PayoffPage', 'DebtPage', 'FlowPanel', 'LoanCard', 'TradePanels'].map((n) => `src/pages/${n}.tsx`);

  it('the presentation helper does no storage access, reads no clock and imports no engine', () => {
    const src = code(read('src/pages/analysisPresentation.ts'));
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|\bdb\b|Date\.now|new Date|todayISO/);
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['../lib/money']);
  });

  it('none of the six pages was given the Hide amounts switch (its scope was not changed)', () => {
    for (const f of pages) expect(read(f), f).not.toMatch(/hideAmounts|loadHideAmounts/);
  });

  it('the pages do not import a charting library or a new engine', () => {
    for (const f of pages) {
      const imports = [...read(f).matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      expect(imports.filter((i) => /d3|chart\.js|recharts|plotly|visx|nivo/i.test(i)), f).toEqual([]);
    }
    expect(read('package.json')).not.toMatch(/"(d3|recharts|chart\.js|plotly\.js|@visx\/[a-z-]+)"/);
  });

  it('the stylesheet uses tokens: no hex color, no priority override', () => {
    const css = code(read('src/pages/analysis.css'));
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important/);
  });

  it('gain and loss are not colored by their sign on the Investments pages', () => {
    for (const f of ['src/pages/InvestmentsPage.tsx', 'src/pages/TradePanels.tsx']) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/gl < 0 \? 'neg'|cls\(s\.gainCents\)|gainCents < 0 \? 'neg'/);
    }
  });
});
