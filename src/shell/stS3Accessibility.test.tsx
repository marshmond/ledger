import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { accessibleName, all, byId, byTag, describedBy, headingSkips, headings, parseHtml, textOf, unnamedButtons, unnamedFields } from '../lib/a11yTestkit';
import { assignedLabel, dueAmountLabel, dueApproveLabel, dueDateLabel, dueSkipLabel, ruleActionLabel, txnRowLabel } from '../lib/a11yLabels';
import { Assigned } from '../pages/BudgetPage';
import { DueRow } from '../pages/ScheduledPage';
import AmountInput from '../pages/AmountInput';
import { MoneyField } from '../pages/fields';
import { PageHeader, PageHeadingLevel } from '../ui/components';
import ConfirmDialog from './ConfirmDialog';
import Main, { MAIN_ID } from './Main';
import { SkipLink } from './SkipAndRoute';
import { focusMain, focusWasLost, headingTitle, pageTitle } from './routeFocus';
import { nextIndex, rovingIndex, rovingKeys } from '../ui/rovingKeys';
import type { BudgetRow } from '../lib/budget';
import type { DueInstance } from '../lib/schedule';

// The sync chip and the Add button read live app state; the module bar's own semantics are what these tests are about.
vi.mock('../core/SyncChip', () => ({ default: () => null }));
vi.mock('./QuickAdd', () => ({ default: () => null }));

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(el));
const row = (name: string, key = 'c1'): BudgetRow => ({ key, kind: 'category', categoryId: 1, name, groupId: 1, carry: 0, assigned: 12345, activity: 0, available: 0 });
const due = (payee: string, date: string, id = 1): DueInstance => ({ date, rule: { id, accountId: 1, payee, amountCents: -6000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-01-01', active: true } });

describe('ST-S3 / AX-01: the test helper itself (so a pass means something)', () => {
  it('computes names the way a browser does, and does not accept a placeholder as a name', () => {
    const d = html(createElement('div', null,
      createElement('label', { htmlFor: 'a' }, 'Alpha'), createElement('input', { id: 'a' }),
      createElement('label', null, 'Beta ', createElement('input', { id: 'b' })),
      createElement('input', { id: 'c', 'aria-label': 'Gamma' }),
      createElement('span', { id: 'd-l' }, 'Delta'), createElement('input', { id: 'd', 'aria-labelledby': 'd-l' }),
      createElement('input', { id: 'e', placeholder: '0.00' }),
    ));
    const names = Object.fromEntries(byTag(d, 'input').map((i) => [i.attrs.id, accessibleName(d, i)]));
    expect(names).toEqual({ a: 'Alpha', b: 'Beta', c: 'Gamma', d: 'Delta', e: '' });
    expect(unnamedFields(d).map((f) => f.attrs.id)).toEqual(['e']);
  });
});

describe('ST-S3 / AX-01: Budget "Assigned" boxes', () => {
  it('each box is named for its budget line and its purpose, and a placeholder alone is not relied on', () => {
    const lines = ['Groceries', 'Rent / Mortgage', 'Payment: Demo Card'];
    const d = html(createElement('table', null, createElement('tbody', null, lines.map((n, i) => createElement('tr', { key: n }, createElement('td', null, createElement(Assigned, { month: '2026-11', row: row(n, `c${i}`) })))))));
    const inputs = byTag(d, 'input');
    expect(inputs).toHaveLength(3);
    expect(inputs.map((i) => accessibleName(d, i))).toEqual(lines.map((n) => `Assigned amount for ${n}`));
    expect(inputs.every((i) => i.attrs.placeholder === '0.00')).toBe(true); // the placeholder is still there, but it is not the name
    expect(unnamedFields(d)).toHaveLength(0);
  });
  it('names follow the record, not the position: the same lines in another order keep their own names', () => {
    const names = (order: string[]) => {
      const d = html(createElement('table', null, createElement('tbody', null, order.map((n) => createElement('tr', { key: n }, createElement('td', null, createElement(Assigned, { month: '2026-11', row: row(n, `k-${n}`) })))))));
      return byTag(d, 'input').map((i) => accessibleName(d, i));
    };
    expect(names(['Dining Out', 'Gas', 'Medical']).slice().sort()).toEqual(names(['Medical', 'Dining Out', 'Gas']).slice().sort());
    expect(names(['Gas', 'Medical'])[0]).toBe('Assigned amount for Gas');
    expect(names(['Medical', 'Gas'])[0]).toBe('Assigned amount for Medical');
  });
  it('the label carries no money figure (it names the line only), even though the row holds an assigned amount', () => {
    const d = html(createElement(Assigned, { month: '2026-11', row: row('Groceries') }));
    const input = byTag(d, 'input')[0];
    expect(accessibleName(d, input)).not.toMatch(/\d/);
    expect(assignedLabel('  ')).toBe('Assigned amount for this budget line'); // a blank name still produces a sentence, never an empty label
  });
});

describe('ST-S3 / AX-01: Scheduled due rows', () => {
  const render = (items: DueInstance[]) => html(createElement('table', null, createElement('tbody', null, items.map((x) => createElement(DueRow, { key: `${x.rule.id}-${x.date}`, item: x, accountMissing: false })))));
  it('date and amount boxes say what they are and which item and scheduled date they belong to', () => {
    const d = render([due('Demo Internet', '2026-10-05', 1), due('Demo Insurance', '2026-10-07', 2)]);
    const names = byTag(d, 'input').map((i) => accessibleName(d, i));
    expect(names).toEqual([
      dueDateLabel('Demo Internet', '2026-10-05'), dueAmountLabel('Demo Internet', '2026-10-05'),
      dueDateLabel('Demo Insurance', '2026-10-07'), dueAmountLabel('Demo Insurance', '2026-10-07'),
    ]);
    expect(names[0]).toBe('Posting date for Demo Internet, scheduled 2026-10-05');
    expect(names[1]).toBe('Amount to post for Demo Internet, scheduled 2026-10-05');
    expect(unnamedFields(d)).toHaveLength(0);
  });
  it('the same item coming due twice gets two different names (the scheduled date tells them apart)', () => {
    const d = render([due('Demo Internet', '2026-10-05', 1), due('Demo Internet', '2026-11-05', 1)]);
    const names = byTag(d, 'input').map((i) => accessibleName(d, i));
    expect(new Set(names).size).toBe(names.length);
  });
  it('Approve and Skip are named for their item so a list of them is not "Approve, Approve, Approve"', () => {
    const d = render([due('Demo Internet', '2026-10-05', 1), due('Demo Insurance', '2026-10-07', 2)]);
    const buttons = byTag(d, 'button').map((b) => accessibleName(d, b));
    expect(buttons).toEqual([dueApproveLabel('Demo Internet', '2026-10-05'), dueSkipLabel('Demo Internet', '2026-10-05'), dueApproveLabel('Demo Insurance', '2026-10-07'), dueSkipLabel('Demo Insurance', '2026-10-07')]);
    for (const b of byTag(d, 'button')) expect(accessibleName(d, b).toLowerCase()).toContain(textOf(b).trim().toLowerCase()); // visible words are inside the spoken name (WCAG 2.5.3)
    expect(unnamedButtons(d)).toHaveLength(0);
  });
  it('the amount box carries no figure in its name; an account that no longer exists still names its fields', () => {
    const d = html(createElement('table', null, createElement('tbody', null, createElement(DueRow, { item: due('Demo Internet', '2026-10-05'), accountMissing: true }))));
    for (const i of byTag(d, 'input')) expect(accessibleName(d, i)).not.toMatch(/\$|\d{2,}\.\d{2}/);
    expect(ruleActionLabel('Edit', 'Demo Internet')).toBe('Edit Demo Internet');
    expect(ruleActionLabel('Delete', '')).toBe('Delete this recurring item');
  });
});

describe('ST-S3 / AX-01: Finance transaction rows', () => {
  it('Edit and Delete in a list of transactions are told apart by payee and date, never by amount', () => {
    const rows = [['Demo Market', '2026-11-06'], ['Demo Market', '2026-11-02'], ['Demo Power Co', '2026-11-05']] as const;
    const names = rows.flatMap(([p, d]) => [txnRowLabel('Edit', p, d), txnRowLabel('Delete', p, d)]);
    expect(new Set(names).size).toBe(names.length); // two Demo Market rows on different dates are still different
    expect(txnRowLabel('Delete', 'Demo Market', '2026-11-06')).toBe('Delete Demo Market, 2026-11-06');
    for (const n of names) expect(n).not.toMatch(/\$|\d+\.\d\d/);
    expect(txnRowLabel('Select', undefined, '2026-11-06')).toBe('Select transaction, 2026-11-06'); // no payee still gives a sentence
    expect(txnRowLabel('Edit', '  ', '')).toBe('Edit transaction, date unknown');
  });
  it('both transaction tables use the label on Edit, Delete and the row checkbox', () => {
    for (const file of ['src/pages/LedgerPage.tsx', 'src/pages/TransactionsPage.tsx']) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).toContain("txnRowLabel('Edit'");
      expect(src, file).toContain("txnRowLabel('Delete'");
    }
    expect(readFileSync('src/pages/TransactionsPage.tsx', 'utf8')).toContain("txnRowLabel('Select'");
  });
});

describe('ST-S3 / AX-05: errors are words, tied to a field, and announced', () => {
  it('AmountInput points at its error message when told it is invalid', () => {
    const d = html(createElement('div', null, createElement(AmountInput, { value: 'x', onChange: () => undefined, label: 'Amount', id: 'amt', invalid: true, describedBy: 'amt-err' }), createElement('div', { id: 'amt-err', role: 'alert', className: 'error' }, 'Enter an amount')));
    const input = byTag(d, 'input')[0];
    expect(input.attrs['aria-invalid']).toBe('true');
    expect(describedBy(d, input)).toEqual([{ id: 'amt-err', text: 'Enter an amount', role: 'alert' }]);
    expect(accessibleName(d, input)).toBe('Amount');
  });
  it('AmountInput without an error has neither attribute (no noise for ordinary forms)', () => {
    const input = byTag(html(createElement(AmountInput, { value: '', onChange: () => undefined, label: 'Amount' })), 'input')[0];
    expect(input.attrs['aria-invalid']).toBeUndefined();
    expect(input.attrs['aria-describedby']).toBeUndefined();
  });
  it('a labelled MoneyField keeps exactly its visible label as its name (the error text is not folded into it)', () => {
    const d = html(createElement(MoneyField, { label: 'Price', cents: 0, onChange: () => undefined }));
    expect(accessibleName(d, byTag(d, 'input')[0])).toBe('Price');
  });
});

describe('ST-S3 / AX-03: page structure', () => {
  it('Main is the one main landmark: it has the stable id and can take focus without joining the Tab order', () => {
    const d = html(createElement(Main, { className: 'main cal-main', children: createElement('p', null, 'x') }));
    const m = byTag(d, 'main');
    expect(m).toHaveLength(1);
    expect(m[0].attrs.id).toBe(MAIN_ID);
    expect(m[0].attrs.tabindex).toBe('-1');
    expect(m[0].attrs.class).toBe('main cal-main');
  });
  it('the skip link is a real link to the main content and has words', () => {
    const d = html(createElement(SkipLink));
    const a = byTag(d, 'a')[0];
    expect(a.attrs.href).toBe(`#${MAIN_ID}`);
    expect(accessibleName(d, a)).toBe('Skip to main content');
  });
  it('a page title is one h1; inside Settings the sub-page title is an h2 so the page still has exactly one h1', () => {
    const alone = html(createElement(PageHeader, { title: 'Budget' }));
    expect(headings(alone)).toEqual([{ level: 1, text: 'Budget' }]);
    const nested = html(createElement('div', null, createElement(PageHeader, { title: 'Settings' }), createElement(PageHeadingLevel.Provider, { value: 2 }, createElement(PageHeader, { title: 'Data & Backups' }))));
    expect(headings(nested)).toEqual([{ level: 1, text: 'Settings' }, { level: 2, text: 'Data & Backups' }]);
    expect(headingSkips(nested)).toEqual([]);
  });
  it('the heading-skip detector does flag h1 followed by h3', () => {
    expect(headingSkips(parseHtml('<h1>A</h1><h3>B</h3>'))).toHaveLength(1);
    expect(headingSkips(parseHtml('<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>'))).toEqual([]);
  });
  it('the module bar is a named nav landmark; the switcher is a disclosure, not an ARIA menu that promises arrow keys', async () => {
    const { default: ModuleBar } = await import('../core/ModuleBar');
    const { registerModules } = await import('../modules');
    registerModules();
    const d = html(createElement(MemoryRouter, { initialEntries: ['/today'] }, createElement(ModuleBar)));
    const nav = byTag(d, 'nav');
    expect(nav).toHaveLength(1);
    expect(nav[0].attrs['aria-label']).toBe('Modules and tools');
    const btn = all(d, (e) => e.tag === 'button' && e.attrs['aria-controls'] === 'module-list')[0];
    expect(btn.attrs['aria-expanded']).toBe('false');
    expect(btn.attrs['aria-haspopup']).toBeUndefined();
    expect(all(d, (e) => e.attrs.role === 'menu' || e.attrs.role === 'menuitem')).toHaveLength(0);
    expect(accessibleName(d, btn)).toMatch(/^Switch module\. Current module: Today/);
    const settings = all(d, (e) => e.tag === 'a' && e.attrs.href === '/settings')[0];
    expect(accessibleName(d, settings)).toBe('Settings');
    expect(unnamedButtons(d)).toHaveLength(0);
  });
});

describe('ST-S3 / keyboard: focus after a page change', () => {
  const body = {};
  it('focus that is still on a real control is left alone; lost focus is put on the page', () => {
    const tab = {};
    expect(focusWasLost({ active: tab, body, attached: () => true })).toBe(false);
    expect(focusWasLost({ active: body, body, attached: () => true })).toBe(true);
    expect(focusWasLost({ active: null, body, attached: () => true })).toBe(true);
    expect(focusWasLost({ active: tab, body, attached: () => false })).toBe(true); // the control was removed with the old page
  });
  it('moves focus to the main landmark without scrolling, and reports when there is none', () => {
    const calls: unknown[] = [];
    const doc = { getElementById: (id: string) => (id === MAIN_ID ? ({ focus: (o: unknown) => calls.push(o) } as unknown as HTMLElement) : null) };
    expect(focusMain(doc, MAIN_ID)).toBe(true);
    expect(calls).toEqual([{ preventScroll: true }]);
    expect(focusMain(doc, 'nope')).toBe(false);
  });
  it('the page name is "Heading · Ledger", falling back to the module, then to the app name', () => {
    expect(pageTitle('Budget', 'Ledger')).toBe('Budget · Ledger');
    expect(pageTitle('  Data &   Backups ', null)).toBe('Data & Backups · Ledger');
    expect(pageTitle('', 'Tasks')).toBe('Tasks · Ledger');
    expect(pageTitle(null, null)).toBe('Ledger');
    expect(pageTitle('Ledger', 'Ledger')).toBe('Ledger');
  });
  it('a heading that changes as you use the page (the Calendar date range) can name the page separately; ordinary headings use their own words', () => {
    expect(headingTitle({ textContent: ' Sun, Nov 8 – Sat, Nov 21, 2026 ', dataset: { pageTitle: 'Calendar' } })).toBe('Calendar');
    expect(headingTitle({ textContent: ' Budget ', dataset: {} })).toBe('Budget');
    expect(headingTitle(null)).toBe('');
  });
});

describe('ST-S3 / keyboard: arrow keys in tabs and radio groups', () => {
  it('Left/Up go back, Right/Down go forward, both wrap; Home and End jump; other keys are ignored', () => {
    expect(nextIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextIndex('ArrowUp', 1, 3)).toBe(0);
    expect(nextIndex('ArrowDown', 1, 3)).toBe(2);
    expect(nextIndex('Home', 2, 3)).toBe(0);
    expect(nextIndex('End', 0, 3)).toBe(2);
    expect(nextIndex('a', 0, 3)).toBeNull();
    expect(nextIndex('Enter', 0, 3)).toBeNull();
    expect(nextIndex('ArrowRight', 0, 0)).toBeNull();
  });
  it('only the chosen item is in the Tab order; with none chosen the first one is', () => {
    expect([0, 1, 2].map((i) => rovingIndex(i, 1))).toEqual([-1, 0, -1]);
    expect([0, 1, 2].map((i) => rovingIndex(i, -1))).toEqual([0, -1, -1]);
  });
  it('the key handler moves focus to the next enabled tab and chooses it, and does nothing for keys it does not own', () => {
    const log: string[] = [];
    const tab = (n: string, disabled = false) => ({ disabled, focus: () => log.push(`focus ${n}`), click: () => log.push(`click ${n}`) });
    const a = tab('a'), b = tab('b', true), c = tab('c');
    const group = { querySelectorAll: () => [a, b, c] };
    let prevented = 0;
    rovingKeys({ key: 'ArrowRight', currentTarget: group, target: a, preventDefault: () => { prevented++; } });
    expect(log).toEqual(['focus c', 'click c']); // the disabled tab is skipped
    log.length = 0;
    rovingKeys({ key: 'ArrowRight', currentTarget: group, target: c, preventDefault: () => { prevented++; } });
    expect(log).toEqual(['focus a', 'click a']); // wraps
    log.length = 0;
    rovingKeys({ key: 'Tab', currentTarget: group, target: a, preventDefault: () => { prevented++; } });
    rovingKeys({ key: 'ArrowRight', currentTarget: group, target: {}, preventDefault: () => { prevented++; } }); // focus not on a tab (for example in a text box inside the group)
    expect(log).toEqual([]);
    expect(prevented).toBe(2);
  });
});

describe('ST-S3 / UX-03: the shared confirmation dialog', () => {
  const render = () => html(createElement(ConfirmDialog, { title: 'Delete "Demo Checking"?', confirmLabel: 'Delete account', onConfirm: () => undefined, onCancel: () => undefined, children: createElement('p', null, 'This cannot be undone.') }));
  it('is a modal dialog named for the action, with the consequence text inside it', () => {
    const d = render();
    const dlg = all(d, (e) => e.attrs.role === 'dialog')[0];
    expect(dlg.attrs['aria-modal']).toBe('true');
    expect(dlg.attrs['aria-label']).toBe('Delete "Demo Checking"?');
    expect(textOf(dlg)).toContain('This cannot be undone.');
  });
  it('Cancel comes before the destructive button, and the destructive button says what it does', () => {
    const d = render();
    const labels = byTag(d, 'button').map((b) => textOf(b).trim()).filter((t) => t !== '✕');
    expect(labels).toEqual(['Cancel', 'Delete account']);
    const del = byTag(d, 'button').find((b) => textOf(b).trim() === 'Delete account')!;
    expect(del.attrs.class).toContain('danger');
    expect(byTag(d, 'button').find((b) => textOf(b).trim() === 'Cancel')!.attrs.class ?? '').not.toContain('danger');
  });
  it('the close (cross) button has a name', () => {
    const d = render();
    expect(unnamedButtons(d)).toHaveLength(0);
    expect(byTag(d, 'button').some((b) => accessibleName(d, b) === 'Close')).toBe(true);
  });
  it('the dialog is not busy and shows no error until something happens', () => {
    const d = render();
    expect(byId(d, 'x')).toBeNull();
    expect(all(d, (e) => e.attrs.role === 'alert')).toHaveLength(0);
  });
});
