import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { maskMoney, MASKED_AMOUNT, pickerSpendText, RevealControl, spendText, spendTextMasked } from './TxnRefs';

/** Pre-commit correction, finding 3: Hide Amounts in the shared transaction picker. Pure helpers and the reveal control (no DOM is needed). */
describe('transaction picker and Hide Amounts', () => {
  it('with Hide Amounts ON and nothing revealed, no figure is produced: the direction stays, the amount does not', () => {
    expect(pickerSpendText(12500, true, false)).toBe('Paid $••••');
    expect(pickerSpendText(-3000, true, false)).toBe('Money back $••••');
    for (const c of [12500, -3000, 0, 1]) expect(pickerSpendText(c, true, false)).not.toMatch(/\d/);
    expect(spendTextMasked(5)).toBe(`Paid ${MASKED_AMOUNT}`);
  });
  it('after the owner chooses Show amounts the real figures appear; choosing again returns to masked', () => {
    let revealed = false;
    const toggle = () => { revealed = !revealed; };
    expect(pickerSpendText(12500, true, revealed)).toBe('Paid $••••');
    toggle();
    expect(pickerSpendText(12500, true, revealed)).toBe('Paid $125.00');
    expect(pickerSpendText(-3000, true, revealed)).toBe('Money back $30.00');
    toggle();
    expect(pickerSpendText(12500, true, revealed)).toBe('Paid $••••');
  });
  it('with Hide Amounts OFF (Home & Assets and anyone who has not asked for it) nothing changes from the original picker text', () => {
    for (const c of [12500, -3000, 0]) { expect(pickerSpendText(c, false, false)).toBe(spendText(c)); expect(pickerSpendText(c, false, true)).toBe(spendText(c)); }
  });
  it('the reveal control: absent when Hide Amounts is off; a real, labelled button with its state exposed when on', () => {
    expect(renderToStaticMarkup(createElement(RevealControl, { hide: false, revealed: false, onToggle: () => undefined }))).toBe('');
    const masked = renderToStaticMarkup(createElement(RevealControl, { hide: true, revealed: false, onToggle: () => undefined }));
    expect(masked).toMatch(/<button[^>]*type="button"[^>]*aria-pressed="false"[^>]*>Show amounts<\/button>/);
    expect(masked).toMatch(/role="status"/);
    expect(masked).not.toMatch(/\$\d/);
    const shown = renderToStaticMarkup(createElement(RevealControl, { hide: true, revealed: true, onToggle: () => undefined }));
    expect(shown).toMatch(/aria-pressed="true"[^>]*>Hide amounts again<\/button>/);
  });
  it('amounts quoted inside a note are masked for the reference lines too', () => {
    expect(maskMoney('(Gone Co on 2026-10-01, paid $1,090.50 when linked)')).toBe('(Gone Co on 2026-10-01, paid $•••• when linked)');
    expect(maskMoney('no money here')).toBe('no money here');
  });
});
