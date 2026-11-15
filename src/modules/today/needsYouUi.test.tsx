import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ModuleBase } from '../../core/router';
import { allTodayCards } from '../../core/registry';
import { attentionProblem, containsMoney, rankAttention, type AttentionItem } from '../../core/attention';
import { computeAlerts, type AlertInput } from '../../lib/alerts';
import { registerModules } from '../index';
import { ledgerAttentionItems } from '../ledger/attention';
import { ARRANGEMENT_KEY, DEFAULT_SIDE_ORDER, STATUS_GROUP_IDS, loadArrangement, sanitizeArrangement } from './composition';
import { alertKey } from './settings';
import { NEEDS_HREF, NeedsYouSection } from './NeedsYou';
import type { NeedsYou } from './useNeedsYou';

/**
 * R1.1 screen and Ledger-alert guards. Every name, date and amount is invented.
 */
const TODAY = '2026-11-08';
let n = 0;
const item = (over: Partial<AttentionItem> = {}): AttentionItem => {
  n++;
  return { id: `assets:t${n}`, moduleId: 'assets', recordId: null, condition: null, kind: 'overdue', date: '2026-11-01', title: `Furnace task ${n}`, reason: 'A maintenance task is overdue.', href: '#/assets/1', provenance: 'Home & Assets overview: overdue maintenance', ...over };
};
const needs = (items: AttentionItem[], over: Partial<NeedsYou> = {}): NeedsYou => ({ ranked: rankAttention(items, TODAY), ready: true, failed: [], ...over });
const html = (nd: NeedsYou, hide = false) => renderToStaticMarkup(
  <MemoryRouter><ModuleBase value="/today"><NeedsYouSection needs={nd} today={TODAY} hideAmounts={hide} /></ModuleBase></MemoryRouter>);
const rows = (h: string) => (h.match(/class="td-need"/g) ?? []).length;
const many = (k: number) => Array.from({ length: k }, (_, i) => item({ id: `assets:m${String(i).padStart(2, '0')}`, date: `2026-10-${String(i + 1).padStart(2, '0')}` }));

describe('the Today section', () => {
  it('shows five of seven, with "See all (7)" pointing at the full list, and the true count on the badge', () => {
    const h = html(needs(many(7)));
    expect(rows(h)).toBe(5);
    expect(h).toContain('See all (7)');
    expect(h).toContain('aria-label="See all 7 items that need you"');
    expect(h).toContain('href="/today/needs"');
    expect(NEEDS_HREF).toBe('#/today/needs');
    expect(h).toMatch(/class="badge" aria-label="7 items">7</);
    expect(h).toContain('Furnace task'); // the oldest five, in order
  });
  it('exactly five shows no "See all"', () => {
    const h = html(needs(many(5)));
    expect(rows(h)).toBe(5);
    expect(h).not.toContain('See all');
  });
  it('one item: singular badge, no "See all"', () => {
    const h = html(needs([item()]));
    expect(rows(h)).toBe(1);
    expect(h).toContain('aria-label="1 item"');
  });
  it('draws nothing at all (no empty box) when nothing needs attention, and nothing before every source has answered', () => {
    expect(html(needs([]))).toBe('');
    expect(html(needs(many(3), { ready: false }))).toBe('');
  });
  it('a module that could not be read is named, never shown as "nothing"', () => {
    const only = html(needs([], { failed: ['bills'] }));
    expect(only).toContain('could not be checked');
    expect(only).toContain('role="status"');
    expect(rows(only)).toBe(0);
    expect(html(needs(many(2), { failed: ['bills'] }))).toContain('could not be checked');
  });
  it('each row is ONE link (one Tab stop) with the title, the plain reason, the words for urgency and the module', () => {
    const h = html(needs([item({ title: 'Replace furnace filter', reason: 'The maintenance task for Furnace is 12 days overdue.', href: '#/assets/4', date: '2026-10-27' })]));
    expect(h).toContain('<a class="td-need" href="#/assets/4">');
    expect(h).toContain('Replace furnace filter');
    expect(h).toContain('The maintenance task for Furnace is 12 days overdue.');
    expect(h).toContain('12 days overdue');
    expect(h).toContain('ui-chip--overdue');
    expect(h).toContain('Home &amp; Assets');
    expect((h.match(/<a /g) ?? []).length).toBe(1);
  });
  it('urgency is told in words, never by color alone: due soon and needs review have their own words', () => {
    const h = html(needs([item({ id: 'bills:a', moduleId: 'bills', kind: 'deadline', date: '2026-11-10', title: 'Streamly' }), item({ id: 'bills:b', moduleId: 'bills', kind: 'review', date: null, title: 'Power' })]));
    expect(h).toContain('Due in 2 days');
    expect(h).toContain('Needs review');
    expect(h).toContain('ui-chip--warning');
  });
  it('lists them most urgent first', () => {
    const h = html(needs([item({ id: 'bills:r', moduleId: 'bills', kind: 'review', date: null, title: 'Review thing' }), item({ id: 'assets:o', kind: 'overdue', title: 'Overdue thing' })]));
    expect(h.indexOf('Overdue thing')).toBeGreaterThan(-1);
    expect(h.indexOf('Overdue thing')).toBeLessThan(h.indexOf('Review thing'));
  });
  it('Hide amounts masks any amount that reached it (a second guard; nothing here carries one)', () => {
    const leaky = item({ title: 'Pay $1,200.00 now', reason: 'Owes $15.49.' });
    expect(html(needs([leaky]), true)).not.toMatch(/\$\s?\d/);
    expect(html(needs([leaky]), false)).toContain('$1,200.00');
  });
  it('the row and chip markup carry no heading level skip: one h2, rows are list items', () => {
    const h = html(needs(many(2)));
    expect((h.match(/<h2/g) ?? []).length).toBe(1);
    expect((h.match(/<h[13-6]/g) ?? []).length).toBe(0);
    expect(h).toContain('<ul class="plain td-list td-need-list">');
  });
});

describe('the stylesheet: phone targets, no overflow, and the placement', () => {
  const css = readFileSync('src/modules/today/today.css', 'utf8');
  const block = css.slice(css.indexOf('R1.1: Needs you'));
  it('each row is at least 44 px tall and wraps long words instead of widening the page', () => {
    expect(block).toMatch(/\.td-need \{[^}]*min-height: 44px/);
    expect(block).toMatch(/\.td-need \{[^}]*overflow-wrap: anywhere/);
  });
  it('on a wide area it sits at the top of the SECOND column with the supporting column below it; on one column it is first', () => {
    expect(block).toMatch(/@container \(min-width: 880px\)[\s\S]*\.td-needs \{ grid-column: 2; grid-row: 1; \}/);
    expect(block).toMatch(/\.td-col--side \{ grid-column: 2; grid-row: 2; \}/);
    expect(block).toMatch(/\.td-col--agenda \{ grid-column: 1; grid-row: 1 \/ span 2; \}/);
    expect(block).not.toMatch(/(^|\n)\.td-needs \{[^}]*order:/);
  });
});

describe('the Today layout preferences are untouched', () => {
  registerModules();
  const ids = () => allTodayCards().map((c) => c.id);
  it('no card was added, removed or moved: Needs you is not a Today card', () => {
    expect([...ids()].sort()).toEqual(['assets.attention', 'bills.attention', 'household.attention', 'ledger.attention', 'ledger.cash', 'projects.attention', 'services.attention', 'today.agenda', 'today.overdue', 'today.reminders', 'today.upcoming']);
    expect(ids()).not.toContain('today.needs');
    expect(ids().filter((i) => /needs/i.test(i))).toEqual([]);
    expect(allTodayCards()).toHaveLength(11);
  });
  it('the designed order, the status group and the storage key are exactly what they were', () => {
    expect([...DEFAULT_SIDE_ORDER]).toEqual(['ledger.attention', 'ledger.cash', 'group:status']);
    expect([...STATUS_GROUP_IDS]).toEqual(['bills.attention', 'household.attention', 'assets.attention', 'services.attention', 'projects.attention']);
    expect(ARRANGEMENT_KEY).toBe('today.layout.v2');
  });
  it('a saved arrangement loads exactly as saved (order and hidden cards), with no section added to it', () => {
    const saved = { side: ['group:status', 'ledger.cash', 'ledger.attention'], hidden: ['projects.attention', 'ledger.cash'] };
    const store = { getItem: (k: string) => (k === ARRANGEMENT_KEY ? JSON.stringify(saved) : null) };
    const got = loadArrangement(allTodayCards(), store as Pick<Storage, 'getItem'>);
    expect(got.source).toBe('saved');
    expect(got.arrangement).toEqual(saved);
    expect(sanitizeArrangement(saved, allTodayCards())).toEqual(saved);
  });
  it('the new files never read or write a layout key, or any browser storage', () => {
    for (const f of ['NeedsYou.tsx', 'useNeedsYou.ts']) {
      const text = readFileSync(`src/modules/today/${f}`, 'utf8');
      expect(text, f).not.toMatch(/localStorage|sessionStorage|saveArrangement|saveLayout|setItem|today\.layout/);
    }
  });
  it('rendering Today does not write storage (the screen only reads its saved arrangement)', async () => {
    const writes: string[] = [];
    const store = { getItem: () => null, setItem: (k: string) => { writes.push(k); }, removeItem: (k: string) => { writes.push(`rm:${k}`); } };
    vi.stubGlobal('localStorage', store);
    const { default: TodayModule } = await import('./TodayModule');
    const out = renderToStaticMarkup(<MemoryRouter initialEntries={['/today']}><TodayModule /></MemoryRouter>);
    vi.unstubAllGlobals();
    expect(out).toContain('data-col="agenda"');
    expect(out).toContain('data-needs="off"'); // nothing has been read yet in a static render, so the section is not drawn
    expect(writes.filter((w) => /layout|needs|attention/i.test(w))).toEqual([]);
  });
});

describe('Ledger alerts for Needs you', () => {
  /** An input that raises every kind of alert, several of them carrying an amount in their own wording. */
  const input: AlertInput = {
    today: TODAY, hasData: true, lastBackup: undefined, scheduledDue: 2, overspent: ['Groceries', 'Dining'],
    invAccounts: [{ id: 1, name: 'Old IRA', kind: 'ira', closed: false, personId: null, taxType: 'traditional', cashCents: 0 }] as never,
    holdings: [{ accountId: 1, securityId: 1, shares: 1, costBasisCents: 1000 }] as never,
    securities: [{ id: 1, ticker: 'DEMO', name: 'Demo Fund', priceCents: null, priceDate: null }] as never,
    lots: [{ id: 1, costBasisCents: 0, acquiredDate: '2026-01-01' }] as never,
    vests: [{ date: '2026-11-20', grant: 'Grant A' }] as never,
    people: [{ id: 1, name: 'Sam' }] as never,
    federalBalanceCents: -500000, estimatedDue: { date: '2026-11-15', amountCents: 120000 }, harvestableCents: 250000, checkinLeft: 3,
    forecastLow: { date: '2026-11-20', balanceCents: 12345, thresholdCents: 50000 }, yearEndTodo: 2,
    belowMinimum: [{ accountId: 4, name: 'Everyday', balanceCents: 1234, minCents: 50000 }], propertyStale: ['Lake cabin'],
  };
  const alerts = computeAlerts(input);

  it('the alerts really do carry amounts (so the checks below are not vacuous)', () => {
    expect(alerts.filter((a) => containsMoney(a.title) || containsMoney(a.detail)).map((a) => a.id).sort()).toEqual(['estimated', 'forecast', 'harvest', 'mincash:4', 'noprice', 'owe']);
  });
  it('every alert but the two informational ones becomes an item, and no item carries an amount', () => {
    const items = ledgerAttentionItems(alerts, {}, TODAY, new Map([[4, 'Everyday']]));
    expect(items).toHaveLength(alerts.length - 2);
    expect(alerts.length).toBeGreaterThanOrEqual(12);
    for (const i of items) {
      expect(attentionProblem('ledger', i), i.id).toBeNull();
      expect(containsMoney(`${i.title} ${i.reason}`), `${i.id}: ${i.title} / ${i.reason}`).toBe(false);
    }
    const ids = new Set(items.map((i) => i.id.split(':')[2]));
    expect(ids.has('vest')).toBe(false);
    expect(ids.has('harvest')).toBe(false);
    expect(items.find((i) => i.id.includes(':mincash:'))!.title).toBe('Everyday is under its minimum balance');
  });
  it('a "warn" alert is serious (tier 1, even with no date); an "info" alert is an ordinary review item; the source word is kept', () => {
    const items = ledgerAttentionItems(alerts, {}, TODAY);
    const backup = items.find((i) => i.id.startsWith('ledger:alert:backup'))!;
    expect(backup).toMatchObject({ severity: 'serious', sourceSeverity: 'warn', date: null });
    expect(rankAttention([backup], TODAY)[0].tier).toBe(1);
    const sched = items.find((i) => i.id.startsWith('ledger:alert:scheduled'))!;
    expect(sched.severity).toBeUndefined();
    expect(sched.sourceSeverity).toBe('info');
    expect(rankAttention([sched], TODAY)[0].tier).toBe(3);
  });
  it('keeps the source\'s dates for the two alerts that have one, and links into Ledger', () => {
    const items = ledgerAttentionItems(alerts, {}, TODAY);
    expect(items.find((i) => i.id.startsWith('ledger:alert:forecast'))!.date).toBe('2026-11-20');
    expect(items.find((i) => i.id.startsWith('ledger:alert:estimated'))!.date).toBe('2026-11-15');
    expect(items.find((i) => i.id.startsWith('ledger:alert:backup'))!.href).toBe('#/ledger/backup');
    expect(items.find((i) => i.id.includes(':mincash:'))!.href).toBe('#/ledger/account/4');
  });
  it('honors dismiss and snooze exactly as the card does: dismissed and snoozed alerts are not listed, an expired snooze is', () => {
    const backup = alerts.find((a) => a.id === 'backup')!;
    const scheduled = alerts.find((a) => a.id === 'scheduled')!;
    const memory = { [alertKey(backup)]: { state: 'dismissed' as const, at: 1 }, [alertKey(scheduled)]: { state: 'snoozed' as const, until: '2026-11-09', at: 1 } };
    const ids = (today: string) => ledgerAttentionItems(alerts, memory, today).map((i) => i.id);
    expect(ids(TODAY).some((i) => i.includes(':backup:'))).toBe(false);
    expect(ids(TODAY).some((i) => i.includes(':scheduled:'))).toBe(false);
    expect(ids('2026-11-09').some((i) => i.includes(':scheduled:'))).toBe(true); // the snooze ended
    expect(ids('2026-11-09').some((i) => i.includes(':backup:'))).toBe(false); // a dismissal lasts until the alert's period changes
    const restored = { [alertKey(backup)]: { state: 'active' as const, at: 2 } };
    expect(ledgerAttentionItems(alerts, restored, TODAY).some((i) => i.id.includes(':backup:'))).toBe(true);
  });
  it('a quiet Ledger gives no items', () => {
    expect(ledgerAttentionItems(computeAlerts({ ...input, hasData: false, scheduledDue: 0, overspent: [], invAccounts: [], holdings: [], securities: [], lots: [], vests: [], people: [], federalBalanceCents: null, estimatedDue: null, harvestableCents: 0, checkinLeft: 0, forecastLow: null, yearEndTodo: 0, belowMinimum: [], propertyStale: [] }), {}, TODAY)).toEqual([]);
  });
});

describe('no new calculation, storage or network in the new files', () => {
  const files = ['core/attention.ts', 'core/liveAttention.ts', 'core/AttentionProviders.tsx', 'modules/ledger/alertsShare.tsx', 'modules/today/NeedsYou.tsx', 'modules/today/useNeedsYou.ts', ...['assets', 'bills', 'household', 'ledger', 'projects', 'services'].map((m) => `modules/${m}/attention.ts`)];
  it('they write nothing: no put, add, update, delete, bulk or transaction call, and no fetch or timer', () => {
    for (const f of files) {
      const text = readFileSync(`src/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(text, f).not.toMatch(/\.(put|add|bulkPut|bulkAdd|update|delete|bulkDelete|clear)\(|\.transaction\(|fetch\(|XMLHttpRequest|setInterval|localStorage|formatCents|toLocale/);
      // the one timer allowed is the short fallback that defers Today's Needs-you reads until the agenda has painted (NeedsYou.tsx)
      if (f !== 'modules/today/NeedsYou.tsx') expect(text, f).not.toMatch(/setTimeout/);
    }
  });
});

describe('Needs you never makes the one write the alert hook could make', () => {
  it('the Ledger source asks for the read-only form of the alert hook, which skips remembering a finished check-in; every earlier caller is unchanged', () => {
    expect(readFileSync('src/modules/ledger/alertsShare.tsx', 'utf8')).toMatch(/useLedgerAlerts\(today, \{ readOnly: true \}\)/);
    const ledgerSource = readFileSync('src/modules/ledger/attention.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(ledgerSource).not.toMatch(/useLedgerAlerts/); // the source never runs a copy of its own
    expect(readFileSync('src/modules/ledger/attention.ts', 'utf8')).toMatch(/Provider: LedgerAlertsProvider/);
    const alerts = readFileSync('src/pages/useLedgerAlerts.ts', 'utf8');
    expect(alerts).toMatch(/readOnly = false/);
    expect(alerts).toMatch(/useCheckin\(\{ remember: !readOnly \}\)/);
    const checkin = readFileSync('src/pages/useCheckin.ts', 'utf8');
    expect(checkin).toMatch(/remember = true/);
    expect(checkin).toMatch(/if \(remember && ready && prog\.complete/);
    expect(readFileSync('src/pages/HomePage.tsx', 'utf8')).toMatch(/useLedgerAlerts\(today\)/);
    expect(readFileSync('src/modules/ledger/todayCards.tsx', 'utf8')).toMatch(/useLedgerAlerts\(props\.today\)/); // the card's own fallback is exactly what it did before
    expect(readFileSync('src/pages/CheckinPage.tsx', 'utf8')).toMatch(/useCheckin\(\)/);
  });
});

describe('the full list wording (R1.1 polish)', () => {
  it('shows only what the row does not already say, and keeps the full provenance on the item', async () => {
    const { provenanceNote } = await import('./NeedsYou');
    expect(provenanceNote({ provenance: 'Bills & Subscriptions: bills not confirmed paid' })).toBe('Bills not confirmed paid');
    expect(provenanceNote({ provenance: 'Home & Assets overview: overdue maintenance' })).toBe('Overdue maintenance');
    expect(provenanceNote({ provenance: 'Ledger alerts (the same list as Ledger Home)' })).toBe('Same alert as on Ledger Home');
    expect(provenanceNote({ provenance: 'Something plain' })).toBe('Something plain');
    const item = rankAttention([{ id: 'bills:p', moduleId: 'bills', recordId: null, condition: null, kind: 'review', date: null, title: 'T', reason: 'R', href: '#/bills', provenance: 'Bills & Subscriptions: bills partly paid' }], TODAY)[0];
    expect(item.provenance).toBe('Bills & Subscriptions: bills partly paid');
  });
});
