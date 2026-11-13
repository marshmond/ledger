import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { FanChart } from './charts';
import { Fields, Kind, Lines, PlanChecks, PlanFigs, PlanHero } from './PlanParts';
import { MoneyField, NumField, PercentField } from './fields';

/**
 * D18 Financial planning pages. The ten pages were recomposed (headline panel, kind-of-figure tags, grouped inputs, results next to the inputs that change them). Every value,
 * assumption, saved scenario and action is the one the page already had. These tests check the small shared pieces, the opt-in chart option, and (by reading the source) that the
 * presentation layer does no storage access or money maths and that the pages did not start touching engines. Layout and look were checked in a real browser, not here.
 */
const read = (f: string) => readFileSync(f, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const PAGES = ['Income', 'Paycheck', 'TaxPlan', 'Giving', 'Afford', 'Projection', 'Retirement', 'Roth', 'Goals', 'Protection'].map((n) => `src/pages/${n}Page.tsx`);

describe('D18 shared pieces', () => {
  it('Kind says what a figure is in words', () => {
    expect(html(createElement(Kind, { k: 'estimate', children: 'Estimate' }))).toContain('>Estimate<');
    expect(html(createElement(Kind, { k: 'unknown', children: 'Not known' }))).toContain('an-kind--unknown');
  });

  it('PlanHero and PlanFigs print exactly what they are given', () => {
    const out = html(createElement(PlanHero, { label: 'Take-home', amount: '$1,234.56', figs: [{ label: 'Gross', value: '$2,000.00', sub: 'before tax' }] }));
    expect(out).toContain('$1,234.56');
    expect(out).toContain('$2,000.00');
    expect(out).toContain('before tax');
    expect(html(createElement(PlanHero, { label: 'x', amount: 'y', stack: true }))).toContain('pl-hero--stack');
    expect(html(createElement(PlanFigs, { figs: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }] }))).toContain('an-fig');
  });

  it('PlanChecks gives every row a word as well as a mark', () => {
    const out = html(createElement(PlanChecks, { words: { ok: 'Done', info: 'Note', warn: 'To do' }, items: [{ id: 'a', level: 'warn', title: 'Fix it' }, { id: 'b', level: 'ok', title: 'Fine' }] }));
    expect(out).toContain('To do');
    expect(out).toContain('Done');
  });

  it('Fields is a fieldset with a legend, Lines is a labelled list', () => {
    expect(html(createElement(Fields, { legend: 'Financing', children: createElement('span', null, 'x') }))).toMatch(/<fieldset[^>]*><legend>Financing<\/legend>/);
    const out = html(createElement(Lines, { rows: [{ label: 'Tax', value: '$5.00', strong: true }] }));
    expect(out).toContain('<dt>Tax</dt>');
    expect(out).toContain('pl-line--strong');
  });

  it('a field with no visible label can still be named for a screen reader', () => {
    expect(html(createElement(MoneyField, { ariaLabel: 'Per year for Roth IRA', cents: 0, onChange: () => {} }))).toContain('aria-label="Per year for Roth IRA"');
    expect(html(createElement(NumField, { ariaLabel: 'Grows', value: 3, onChange: () => {} }))).toContain('aria-label="Grows"');
  });
});

describe('D18 FanChart fit option', () => {
  const data = { startYear: 2026, p10: [1, 2], p25: [1, 3], p50: [1, 4], p75: [1, 5], p90: [1, 6], steady: [1, 4] };
  it('draws as before unless fit is asked for', () => {
    const plain = html(createElement(FanChart, { data, title: 't', subtitle: 's', realTerms: true }));
    expect(plain).toContain('viewBox="0 0 720 320"');
    expect(plain).not.toContain('viz-fit');
    expect(html(createElement(FanChart, { data, title: 't', subtitle: 's', realTerms: true, fit: true }))).toContain('viz-fit');
  });
});

describe('D18 source guards', () => {
  it('the presentation file does no storage, clock or engine work', () => {
    const t = code(read('src/pages/PlanParts.tsx'));
    expect(t).not.toMatch(/localStorage|sessionStorage|indexedDB|Date\.now|new Date|from '\.\.\/db'|from '\.\.\/lib\//);
    expect(t).not.toMatch(/useLiveQuery/);
  });

  it('no planning page imports a new engine or changes where its numbers come from', () => {
    for (const f of PAGES) {
      const t = read(f);
      expect(t, f).toContain("import './plan.css'");
      expect(t, f).not.toMatch(/from 'recharts'|from 'chart\.js'|from 'd3/);
    }
  });

  it('the pages still use the engines they used before D18', () => {
    const uses: Record<string, string[]> = {
      'src/pages/IncomePage.tsx': ['buildIncomeModel', 'hsaYearImpact', 'parseTablesJson'],
      'src/pages/PaycheckPage.tsx': ['runScenario', 'runActual', 'scenarioFromProfile', 'blankScenario', 'headline'],
      'src/pages/TaxPlanPage.tsx': ['useTaxPlanData', 'withHarvest', 'estimatedDueDates'],
      'src/pages/GivingPage.tsx': ['deductionAnalysis', 'bunching', 'gainAvoided'],
      'src/pages/AffordPage.tsx': ['evaluatePurchase', 'maxAffordablePrice', 'rentVsBuy', 'runForecast'],
      'src/pages/ProjectionPage.tsx': ['runMonteCarlo', 'steadyPath', 'probAtLeast', 'buildProjection'],
      'src/pages/RetirementPage.tsx': ['planRetirement', 'sustainableSpending', 'trailingAnnualSpending'],
      'src/pages/RothPage.tsx': ['comparePlans', 'runMonteCarlo', 'buildPlanInput'],
      'src/pages/GoalsPage.tsx': ['solveGoal', 'buildProjection'],
      'src/pages/ProtectionPage.tsx': ['emergencyFund', 'lifeNeed', 'disabilityNeed', 'umbrellaNeed', 'findings'],
    };
    for (const [f, names] of Object.entries(uses)) for (const n of names) expect(read(f), `${f} ${n}`).toContain(n);
  });

  it('the stylesheet uses tokens: no hex color, no priority override', () => {
    const css = code(read('src/pages/plan.css'));
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important/);
  });

  it('Hide amounts was not extended to these pages', () => {
    for (const f of PAGES) expect(read(f), f).not.toMatch(/hideAmounts|useHideAmounts/);
  });

  it('refund or amount due, and gain or loss, are never colored by sign on these pages', () => {
    for (const f of PAGES) expect(code(read(f)), f).not.toMatch(/\$\{[^}]*>= 0 \? 'pos' : 'neg'\}/);
  });
});

describe('D18 correction: PercentField follows the saved value', () => {
  const src = code(read('src/pages/fields.tsx'));
  const pf = src.slice(src.indexOf('export function PercentField'), src.indexOf('export function MoneyField'));
  it('shows a value that arrives after the first paint, but never while the user is typing', () => {
    expect(pf).toMatch(/if \(value !== seen\)/);
    expect(pf).toMatch(/if \(!editing\) setText\(String\(value\)\)/);
    expect(pf).toMatch(/onFocus=\{\(\) => setEditing\(true\)\}/);
    expect(pf).toMatch(/setEditing\(false\)/);
  });
  it('still commits only on blur, within its limits, and the sync itself never calls onChange', () => {
    expect(pf).toContain('Math.min(max, Math.max(min, n))');
    expect(pf).toContain('if (v !== value) onChange(v)');
    expect(pf.slice(0, pf.indexOf('const input'))).not.toContain('onChange(');
  });
  it('renders the given value first', () => {
    expect(html(createElement(PercentField, { label: 'x', value: 85, min: 0, max: 99, onChange: () => {} }))).toContain('value="85"');
  });
});
