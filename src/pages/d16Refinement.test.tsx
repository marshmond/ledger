import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RowActionsView } from './RowActions';

/**
 * D16 final mobile refinement. A phone transaction row keeps ONE labeled Actions button; a computer keeps the row of links. These tests check the markup the two
 * trees produce, that every action and its long accessible name is still in the pages, that the selection box and split toggle are NOT inside the menu, that
 * the Scheduled recurring list no longer prints a date it cannot vouch for, and that the new CSS keeps 44 px targets. Layout is checked in a real browser.
 */
const read = (f: string) => readFileSync(f, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const buttons = [
  createElement('button', { key: 'e', className: 'link', 'aria-label': 'Edit Demo Market, 2026-11-06' }, 'Edit'),
  createElement('button', { key: 'd', className: 'link danger', 'aria-label': 'Delete Demo Market, 2026-11-06' }, 'Delete'),
];

describe('D16 refinement: the row actions', () => {
  it('on a phone: one Actions disclosure named for its row, holding every action', () => {
    const m = renderToStaticMarkup(createElement(RowActionsView, { phone: true, label: 'Demo Market, 2026-11-06', children: buttons }));
    expect(m).toMatch(/^<details class="mny-act"/);
    expect(m).toContain('<summary aria-label="Actions for Demo Market, 2026-11-06">Actions</summary>');
    expect(m).toContain('aria-label="Edit Demo Market, 2026-11-06"');
    expect(m).toContain('aria-label="Delete Demo Market, 2026-11-06"');
    expect(m).toMatch(/role="group" aria-label="Actions for Demo Market, 2026-11-06"/);
    expect(m).not.toContain(' open=');
  });
  it('on a computer: the same buttons in a plain row, no disclosure', () => {
    const m = renderToStaticMarkup(createElement(RowActionsView, { phone: false, label: 'x', children: buttons }));
    expect(m).toMatch(/^<div class="mny-rowact">/);
    expect(m).not.toContain('<details');
    expect(m).toContain('>Edit</button>');
    expect(m).toContain('>Delete</button>');
  });
  it('rendering writes nothing and wraps no handler (the component has no storage, database or confirmation code)', () => {
    const c = code(read('src/pages/RowActions.tsx'));
    expect(c).not.toMatch(/\bdb\b|Dexie|localStorage|confirm\(|\.(add|put|update|delete)\(/);
    expect(c).not.toMatch(/onClick/); // it never replaces or delays an action's own handler
    expect(c).toMatch(/Escape/);
    expect(c).toMatch(/pointerdown/);
  });
});

describe('D16 refinement: the pages keep every action and keep selection separate', () => {
  const ledger = read('src/pages/LedgerPage.tsx');
  const txns = read('src/pages/TransactionsPage.tsx');
  it('the account register offers Add task, Clear, Edit, Unlink and Delete inside the row actions', () => {
    const block = ledger.slice(ledger.indexOf('<RowActions'), ledger.indexOf('</RowActions>'));
    for (const t of ['TaskActions module="ledger"', "txnRowLabel('Clear'", "txnRowLabel('Edit'", "txnRowLabel('Unlink'", "txnRowLabel('Delete'", 'unlinkTransfer(db', 'setDeletingTxn(t.id!)', 'updateTxn(db, t.id!, { status']) expect(block, t).toContain(t);
  });
  it('Transactions offers Edit and Delete inside the row actions, and Delete still goes through the guarded dialog', () => {
    const block = txns.slice(txns.indexOf('<RowActions'), txns.indexOf('</RowActions>'));
    expect(block).toContain("txnRowLabel('Edit'");
    expect(block).toContain("txnRowLabel('Delete'");
    expect(block).toContain("setDeleting({ ids: [t.id!], subject: 'transaction' })");
    expect(code(txns)).not.toMatch(/deleteTxn\s*\(|bulkDelete\s*\(/);
  });
  it('the row selection box is outside the actions menu and keeps its long name; the split toggle is outside too', () => {
    const before = txns.slice(0, txns.indexOf('<RowActions'));
    expect(before).toContain("txnRowLabel('Select'");
    expect(before).toContain('mny-selhit');
    expect(txns.slice(txns.indexOf('<RowActions'), txns.indexOf('</RowActions>'))).not.toContain('SplitToggle');
    expect(ledger.slice(ledger.indexOf('<RowActions'), ledger.indexOf('</RowActions>'))).not.toContain('SplitToggle');
  });
  it('the phone row still says payee, status, date, category or other account and, on the account page, the running balance', () => {
    expect(ledger).toMatch(/mny-nameline[\s\S]*STATUS_WORD\[t\.status\][\s\S]*mny-metaline[\s\S]*t\.date[\s\S]*Balance \{formatCents\(run\)\}/);
    expect(txns).toMatch(/mny-nameline[\s\S]*STATUS_WORD\[t\.status\][\s\S]*mny-metaline[\s\S]*t\.date[\s\S]*accountName[\s\S]*categoryLabel/);
    expect(ledger).toContain('Transfer</StatusChip>');
    expect(txns).toContain('Transfer</StatusChip>');
  });
});

describe('D16 refinement: Scheduled prints no date it cannot vouch for', () => {
  const s = code(read('src/pages/ScheduledPage.tsx'));
  it('the recurring list shows frequency, range, amount, account and state, and no "Next scheduled" line', () => {
    expect(s).not.toMatch(/Next scheduled/i);
    expect(s).not.toMatch(/occurrencesBetween/); // the page no longer imports or calls it
    expect(s).toMatch(/FREQ\[r\.frequency\]/);
    expect(s).toMatch(/from \{r\.startDate\}/);
    expect(s).toMatch(/Paused/);
  });
  it('the engine files were not touched by this refinement', () => {
    expect(read('src/lib/schedule.ts')).toMatch(/export function occurrencesBetween/);
    expect(read('src/lib/schedule.ts')).toMatch(/export async function dueInstances/);
  });
});

describe('D16 refinement: the new CSS keeps comfortable targets and tokens', () => {
  const css = read('src/pages/money.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const phone = css;
  it('the Actions button, every menu item and the checkbox area are at least 44 px', () => {
    expect(phone).toMatch(/\.mny-act > summary \{[^}]*min-height: 44px/);
    expect(phone).toMatch(/\.mny-act-menu button[^{]*\{[^}]*min-height: 44px/);
    expect(phone).toMatch(/\.mny-selhit \{[^}]*width: 44px; height: 44px/);
    expect(phone).toMatch(/\.mny-page \.split-toggle \{[^}]*min-height: 44px/);
  });
  it('the row layout keeps the amount in its own column and the Actions button beside the meta line', () => {
    expect(css).toContain('grid-template-areas: "sel name amt" "sel meta act"');
    expect(css).toContain('grid-template-areas: "name amt" "meta act"');
  });
  it('still no hex colors, raw radii or priority overrides', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/border-radius:\s*\d+px/);
    expect(css).not.toMatch(/!important/);
  });
});
