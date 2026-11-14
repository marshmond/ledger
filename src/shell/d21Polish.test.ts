/** D21: two small finishing corrections found by the width and accessibility sweep. Source-level checks, like the other shell guards. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(f, 'utf8');

describe('D21 Income deductions table', () => {
  const src = read('src/pages/ProfileEditor.tsx');
  const block = src.slice(src.indexOf('Reduces tax on') - 200, src.indexOf('Reduces tax on') + 2600);
  it('sits in the shared scroll wrapper so it can never widen the page between 800 and 1024 px', () => {
    expect(block).toMatch(/<div className="an-tablewrap">\s*<table>/);
  });
  it('gives every deduction field a spoken name (name, how it is figured, amount)', () => {
    expect(block).toMatch(/<input aria-label=\{`Deduction name: /);
    expect(block).toMatch(/<select aria-label=\{`How /);
    expect(block).toMatch(/<NumField ariaLabel=/);
    expect(block).toMatch(/<MoneyField ariaLabel=/);
  });
  it('changes no stored value or calculation: the handlers are the same calls as before', () => {
    expect(block).toContain("setDed(x.id, { mode: e.target.value as 'percent' | 'fixed', value: 0 })");
    expect(block).toContain('setDed(x.id, { name: e.target.value })');
  });
});

describe('D21 shared table wrapper', () => {
  it('is a positioned scroll container, so screen-reader-only text inside a wide table is clipped with it', () => {
    const css = read('src/pages/analysis.css');
    const rule = /\.an-tablewrap \{([^}]*)\}/.exec(css)![1];
    expect(rule).toContain('overflow-x: auto');
    expect(rule).toContain('position: relative');
  });
});

describe('D21 Debt payoff card minimum payment', () => {
  it('has a spoken name that includes the card', () => {
    expect(read('src/pages/PayoffPage.tsx')).toMatch(/<MoneyField key=\{`\$\{cardId\}-\$\{t\?\.minPaymentCents\}`\} ariaLabel=\{`Minimum payment per month for \$\{d\.name\}`\}/);
  });
});
