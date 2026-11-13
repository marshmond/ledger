import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../db';
import { addTheme, parseThemes } from '../lib/savedThemes';
import { addView, parseViews } from '../lib/flowViews';
import { removeStoredFlowView, removeStoredTheme } from '../lib/savedRemoval';
import { CLASSIC } from '../palette';
import { all, parseHtml, textOf } from '../lib/a11yTestkit';
import { BASELINE, measure } from './uiBaseline';
import ConfirmDialog from './ConfirmDialog';
import { makeConfirmRunner } from './confirmRun';

/**
 * D20.1A. The first five native confirm() boxes became Ledger confirmation dialogs (gift, goal, policy record, saved flow view, saved theme).
 * The test environment has no browser DOM, so (as in D20) these checks use plain functions, a disposable database, static markup and the source text. Real keys, focus,
 * the phone layout and the "no operating-system box" check were done in a browser and are in the D20.1A report. Everything below is invented.
 */
const src = (f: string) => readFileSync(`src/${f}`, 'utf8');
const doc = (f: string) => readFileSync(`docs/${f}`, 'utf8');

// ---------------------------------------------------------------- the inventory, against the source
const INVENTORY = doc('LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md');
const rows = INVENTORY.split('\n').filter((l) => /^\| NC-\d\d \|/.test(l)).map((l) => l.split('|').map((c) => c.trim()).slice(1, -1)).filter((r) => r.length === 7); // the identification table (the behavior table has 5 columns)
const byId = new Map(rows.map((r) => [r[0], r]));

const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
/**
 * An ACTUAL browser-native call: `confirm(` that is not a member call, not the definition of a local function, and not an empty-argument call of one
 * (the browser's box always has a message). This is deliberately broader than the historical tracker rule, which only sees a quote right after the bracket.
 */
const NATIVE = /(?<![\w.])(?<!function )confirm\((?!\))/g;
const nativeCalls = () => walk('src').filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).flatMap((f) => (readFileSync(f, 'utf8').match(NATIVE) ?? []).map(() => f.replace(/\\/g, '/')));

describe('D20.1A inventory of native confirmations', () => {
  it('lists exactly 38 calls with unique stable ids NC-01 to NC-38', () => {
    expect(rows).toHaveLength(38);
    expect(byId.size).toBe(38);
    expect(rows.map((r) => r[0])).toEqual(Array.from({ length: 38 }, (_, i) => `NC-${String(i + 1).padStart(2, '0')}`));
  });
  it('assigns every call to exactly one batch, A to D, with 5, 12, 14 and 7', () => {
    const count = (b: string) => rows.filter((r) => r[5] === b).length;
    expect([count('A'), count('B'), count('C'), count('D')]).toEqual([5, 12, 14, 7]);
    for (const r of rows) expect(['A', 'B', 'C', 'D'], r[0]).toContain(r[5]);
  });
  it('marks as migrated exactly the five D20.1A candidates, and only those', () => {
    const done = rows.filter((r) => r[6].includes('Migrated')).map((r) => r[0]);
    expect(done).toEqual(['NC-07', 'NC-11', 'NC-12', 'NC-13', 'NC-28']);
    for (const id of done) expect(byId.get(id)![5]).toBe('A');
    for (const r of rows.filter((x) => x[5] === 'A')) expect(r[6]).toContain('Migrated');
  });
  it('the actual native count in the source equals the number of rows not yet migrated (33), and the unmigrated files match', () => {
    const calls = nativeCalls();
    const open = rows.filter((r) => !r[6].includes('Migrated'));
    expect(calls).toHaveLength(open.length);
    expect(calls).toHaveLength(33);
    const filesInInventory = open.map((r) => `src/${r[1].replace(/`/g, '').replace(/:\d+$/, '')}`).sort();
    expect(calls.sort()).toEqual(filesInInventory);
  });
  it('keeps the historical tracker metric separate: the rule is unchanged, its baseline is still the D4 37, and it now measures 32', () => {
    const m = measure();
    expect(BASELINE.nativeConfirm).toBe(37);
    expect(BASELINE.nativeConfirmFiles).toBe(24);
    expect(m.nativeConfirm).toBe(32);
    expect(m.nativeConfirmFiles).toBe(20);
    expect(readFileSync('src/shell/uiBaseline.ts', 'utf8')).toContain('/(^|[^A-Za-z.])confirm\\(\\s*[`\'"]/g');
    // the one call the historical rule cannot see (a variable instead of a quote) is still counted by the actual rule
    expect(nativeCalls().filter((f) => f.endsWith('modules/tasks/TasksPage.tsx'))).toHaveLength(1);
  });
  it('does not count the five local functions named confirm', () => {
    const calls = nativeCalls();
    for (const f of ['modules/assets/LifecycleDialog.tsx', 'modules/bills/PaymentUI.tsx', 'modules/bills/ScheduledUI.tsx', 'modules/contacts/RemoveContact.tsx']) expect(calls.some((c) => c.endsWith(f)), f).toBe(false);
  });
});

// ---------------------------------------------------------------- the migrated callers
const FILES = {
  gift: 'pages/GivingPage.tsx', goal: 'pages/GoalsPage.tsx', policy: 'pages/ProtectionPage.tsx', view: 'pages/FlowViews.tsx', theme: 'pages/AppearanceCard.tsx',
};

describe('D20.1A: the five callers no longer use the browser box for these actions', () => {
  it('has no native confirm left in the gift, goal, policy and saved-view files', () => {
    for (const f of [FILES.gift, FILES.goal, FILES.policy, FILES.view]) expect(src(f).match(NATIVE), f).toBeNull();
  });
  it('keeps exactly one native confirm in AppearanceCard.tsx: the separate "Replace your colors" select (NC-08, a later batch), not the saved-theme delete', () => {
    const t = src(FILES.theme);
    expect(t.match(NATIVE)).toHaveLength(1);
    expect(t).toContain('Replace your colors with');
    expect(t).not.toContain('Delete the theme');
    expect(t).toMatch(/onChange=\{\(e\) => \{ const id = e\.target\.value as PaletteId; setBase\(id\); if \(confirm\(/);
  });
  it('every delete button now only records WHICH item (by id) and changes nothing; cancel only clears that', () => {
    expect(src(FILES.gift)).toContain('onClick={() => setAskGift(d.id!)}');
    expect(src(FILES.gift)).toContain('onCancel={() => setAskGift(null)}');
    expect(src(FILES.goal)).toContain('onClick={() => setAskDelete(true)}');
    expect(src(FILES.goal)).toContain('onCancel={() => setAskDelete(false)}');
    expect(src(FILES.policy)).toContain('onClick={() => setAskDelete(true)}');
    expect(src(FILES.policy)).toContain('onCancel={() => setAskDelete(false)}');
    expect(src(FILES.view)).toContain('onClick={() => setAskDelete(active.id)}');
    expect(src(FILES.view)).toContain('onCancel={() => setAskDelete(null)}');
    expect(src(FILES.theme)).toContain('onClick={() => setAskDelete(active.id)}');
    expect(src(FILES.theme)).toContain('onCancel={() => setAskDelete(null)}');
  });
  it('the write happens only inside the dialog\'s own confirm handler, and it targets the id that was picked', () => {
    expect(src(FILES.gift)).toMatch(/onConfirm=\{async \(\) => \{ await db\.donations\.delete\(gift\.id!\); setAskGift\(null\); \}\}/);
    expect(src(FILES.goal)).toMatch(/onConfirm=\{async \(\) => \{ await db\.goals\.delete\(goal\.id!\); setAskDelete\(false\); \}\}/);
    expect(src(FILES.policy)).toMatch(/onConfirm=\{async \(\) => \{ await ins\.remove\(p\.id\); setAskDelete\(false\); \}\}/);
    expect(src(FILES.view)).toContain('await removeStoredFlowView(db, target.id);');
    expect(src(FILES.theme)).toContain('await removeStoredTheme(db, target.id);');
    // no other write to the stored lists is left in the two list-based callers' delete paths
    expect(src(FILES.view)).not.toContain('removeView(');
    expect(src(FILES.theme)).not.toContain('removeTheme(');
  });
  it('the dialogs use the shared ConfirmDialog (no second framework, no promise queue, no event bus) with the specified wording', () => {
    const wording: [string, string, string][] = [
      [FILES.gift, 'Delete gift?', 'Delete gift'], [FILES.goal, 'Delete goal?', 'Delete goal'], [FILES.policy, 'Delete policy?', 'Delete policy'],
      [FILES.view, 'Delete saved view?', 'Delete view'], [FILES.theme, 'Delete saved theme?', 'Delete theme'],
    ];
    for (const [f, title, label] of wording) {
      const t = src(f);
      expect(t, f).toContain("import ConfirmDialog from '../shell/ConfirmDialog';");
      expect(t, f).toContain(`title="${title}"`);
      expect(t, f).toContain(`confirmLabel="${label}"`);
      expect(t, f).not.toMatch(/useConfirm|CustomEvent|dispatchEvent|window\.confirm|globalThis\.confirm/);
    }
  });
  it('the policy dialog says it deletes only the Ledger record and does not cancel real coverage', () => {
    const t = src(FILES.policy);
    expect(t).toContain('deletes the policy record from Ledger only');
    expect(t).toContain('does not cancel or change any coverage with the insurer');
  });
  it('only ONE source of truth for the dialog being open: a gift is found again by id in the live list, so a vanished gift closes the dialog', () => {
    expect(src(FILES.gift)).toContain('askGift === null ? undefined : donations.find((d) => d.id === askGift)');
    expect(src(FILES.view)).toContain('askDelete === null ? undefined : views.find((v) => v.id === askDelete)');
    expect(src(FILES.theme)).toContain('askDelete === null ? undefined : themes.find((t) => t.id === askDelete)');
  });
  it('none of the five files calls the browser alert, and the saved-theme delete still keeps the colors on', () => {
    expect(src(FILES.theme)).toContain("if (choice.savedId === target.id && custom) set({ id: 'custom', custom });");
    expect(src(FILES.view)).toContain('if (activeRef.current === target.id) setActiveId(null);');
  });
});

// ---------------------------------------------------------------- what the dialog shows (shared component, with each real wording)
describe('D20.1A: the confirmation as drawn', () => {
  const draw = (title: string, label: string) => renderToStaticMarkup(createElement(ConfirmDialog, { title, confirmLabel: label, busyLabel: 'Deleting…', onConfirm: () => undefined, onCancel: () => undefined, children: createElement('p', null, 'x') }));
  it.each([['Delete gift?', 'Delete gift'], ['Delete goal?', 'Delete goal'], ['Delete policy?', 'Delete policy'], ['Delete saved view?', 'Delete view'], ['Delete saved theme?', 'Delete theme']])(
    '%s: Cancel comes first, the action names itself, destructive styling, small and danger-accented',
    (title, label) => {
      const html = draw(title, label);
      const buttons = all(parseHtml(html), (n) => n.tag === 'button');
      const names = buttons.map((b) => textOf(b).trim());
      expect(names.filter(Boolean)).toEqual(['✕', 'Cancel', label]);
      expect(html).toContain('modal--confirm modal--danger');
      expect(html).toContain('modal--sm');
      expect(html).toContain(`aria-label="${title}"`);
      expect(html).toMatch(/<button[^>]*class="danger"[^>]*>/);
    },
  );
});

// ---------------------------------------------------------------- the stored lists, on a disposable database
const THEME_A = { light: { ...CLASSIC.light }, dark: { ...CLASSIC.dark } };
const VIEW_STATE = { view: 'net' as const, preset: 'last3' as never, detail: 'groups' as const, off: [], accountsOff: [] };
let db: FinanceDB;
const store = (key: string, value: unknown) => db.settings.put({ key, value });
const stored = async (key: string) => (await db.settings.get(key))?.value;
let k = 0;
beforeEach(async () => { db = new FinanceDB(`d201a-${k++}`); await db.open(); });

describe('D20.1A: removing one saved theme or flow view by id', () => {
  it('removes only the chosen theme when two have similar names, and leaves the colors in the others untouched', async () => {
    let list = addTheme([], 'Sunset', THEME_A, 'ta');
    list = addTheme(list, 'Sunset 2', { light: { ...CLASSIC.light, accent: '#112233' }, dark: { ...CLASSIC.dark } }, 'tb');
    list = addTheme(list, 'sunset', THEME_A, 'tc');
    await store('savedThemes', list);
    const before = await stored('savedThemes');
    expect(await removeStoredTheme(db, 'tb')).toBe(true);
    const after = parseThemes(await stored('savedThemes'));
    expect(after.map((t) => t.id)).toEqual(['ta', 'tc']);
    expect(JSON.stringify(after[0])).toBe(JSON.stringify((before as typeof list)[0]));
    expect(JSON.stringify(after[1])).toBe(JSON.stringify((before as typeof list)[2]));
  });
  it('removes only the chosen flow view, by id, even when names repeat in different capitals', async () => {
    let list = addView([], 'Monthly', VIEW_STATE, 'va');
    list = addView(list, 'MONTHLY', VIEW_STATE, 'vb');
    await store('flowViews', list);
    expect(await removeStoredFlowView(db, 'va')).toBe(true);
    expect(parseViews(await stored('flowViews')).map((v) => v.id)).toEqual(['vb']);
  });
  it('a record that disappeared while the dialog was open: nothing is written and nothing else is removed', async () => {
    const list = addView([], 'Keep me', VIEW_STATE, 'vk');
    await store('flowViews', list);
    const writes = vi.fn();
    db.settings.hook('creating', writes);
    db.settings.hook('updating', writes);
    db.settings.hook('deleting', writes);
    expect(await removeStoredFlowView(db, 'gone')).toBe(false);
    db.settings.hook('creating').unsubscribe(writes);
    db.settings.hook('updating').unsubscribe(writes);
    db.settings.hook('deleting').unsubscribe(writes);
    expect(writes).not.toHaveBeenCalled();
    expect(parseViews(await stored('flowViews')).map((v) => v.id)).toEqual(['vk']);
    // and an empty store is also a quiet no-op
    await db.settings.delete('savedThemes');
    expect(await removeStoredTheme(db, 'nothing')).toBe(false);
    expect(await db.settings.get('savedThemes')).toBeUndefined();
  });
  it('reads the list again at confirmation: a view that arrived while the dialog was open is not lost (the old copy-and-write-back would have dropped it)', async () => {
    const opened = addView(addView([], 'One', VIEW_STATE, 'v1'), 'Two', VIEW_STATE, 'v2');
    await store('flowViews', opened);
    // another device adds a third view after the dialog was opened on the copy above
    await store('flowViews', addView(opened, 'Three', VIEW_STATE, 'v3'));
    expect(await removeStoredFlowView(db, 'v1')).toBe(true);
    expect(parseViews(await stored('flowViews')).map((v) => v.id)).toEqual(['v2', 'v3']);
    // the same for themes
    const t0 = addTheme(addTheme([], 'A', THEME_A, 'x1'), 'B', THEME_A, 'x2');
    await store('savedThemes', t0);
    await store('savedThemes', addTheme(t0, 'C', THEME_A, 'x3'));
    expect(await removeStoredTheme(db, 'x1')).toBe(true);
    expect(parseThemes(await stored('savedThemes')).map((t) => t.id)).toEqual(['x2', 'x3']);
  });
  it('deleting the ACTIVE flow view or theme leaves its colors and settings data alone: only the list changes', async () => {
    await store('flowViews', addView([], 'Active', VIEW_STATE, 'va'));
    await store('savedThemes', addTheme([], 'Active', THEME_A, 'ta'));
    await store('projection', { years: 30 });
    await removeStoredFlowView(db, 'va');
    await removeStoredTheme(db, 'ta');
    expect(await stored('flowViews')).toEqual([]);
    expect(await stored('savedThemes')).toEqual([]);
    expect(await stored('projection')).toEqual({ years: 30 });
  });
  it('is one transaction on the settings table only (no other table is read or written)', () => {
    const t = src('lib/savedRemoval.ts');
    expect(t).toContain("d.transaction('rw', d.settings,");
    expect(t).not.toMatch(/d\.(txns|accounts|donations|goals|categories)/);
  });
});

describe('D20.1A: gift and goal deletion against a disposable database', () => {
  it('deleting one of two identical-looking gifts removes only the chosen id; deleting a gift that is already gone does nothing and throws nothing', async () => {
    const mk = { date: '2026-03-01', charity: 'Food Bank', kind: 'cash' as const, amountCents: 5000, receipt: false, note: '' };
    const a = await db.donations.add({ ...mk });
    const b = await db.donations.add({ ...mk });
    const c = await db.donations.add({ ...mk, charity: 'Food Bank ', amountCents: 5001 });
    await db.donations.delete(a);
    expect((await db.donations.toArray()).map((d) => d.id)).toEqual([b, c]);
    await expect(db.donations.delete(a)).resolves.toBeUndefined();
    expect((await db.donations.toArray()).map((d) => d.id)).toEqual([b, c]);
  });
  it('deleting a goal does not delete its funding account or the account\'s money', async () => {
    const acct = await db.invAccounts.add({ name: 'Education 529', kind: '529', taxType: 'taxable', cashCents: 123456, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false } as never);
    const g1 = await db.goals.add({ name: 'College', accountId: acct, startYear: 2040, years: 4, annualCostCents: 100, costInflationPct: 4, fundingPct: 100, contributionGrowthPct: 0, confidencePct: 80 });
    const g2 = await db.goals.add({ name: 'College', accountId: acct, startYear: 2042, years: 4, annualCostCents: 100, costInflationPct: 4, fundingPct: 100, contributionGrowthPct: 0, confidencePct: 80 });
    await db.goals.delete(g1);
    expect((await db.goals.toArray()).map((g) => g.id)).toEqual([g2]);
    expect((await db.invAccounts.get(acct))?.cashCents).toBe(123456);
  });
  it('a policy is removed by id from the stored list and the other policies are untouched (the hook\'s own rule)', () => {
    expect(src('pages/useInsurance.ts')).toContain('remove: (id: string) => save(policies.filter((p) => p.id !== id)),');
  });
});

// ---------------------------------------------------------------- press-once, errors, and no false success, with the real handler
describe('D20.1A: the confirm button runs the existing operation once and never reports a false success', () => {
  const hooks = () => { const log: string[] = []; return { log, setBusy: (b: boolean) => log.push(`busy:${b}`), setError: (m: string | null) => log.push(`error:${m}`) }; };
  it('two presses at once remove the theme once, and the second press does nothing', async () => {
    await store('savedThemes', addTheme(addTheme([], 'A', THEME_A, 'p1'), 'B', THEME_A, 'p2'));
    let closed = 0;
    const h = hooks();
    const runner = makeConfirmRunner(() => async () => { await removeStoredTheme(db, 'p1'); closed++; }, h);
    await Promise.all([runner.go(), runner.go(), runner.go()]);
    expect(closed).toBe(1);
    expect(h.log.filter((l) => l === 'busy:true')).toHaveLength(1);
    expect(parseThemes(await stored('savedThemes')).map((t) => t.id)).toEqual(['p2']);
  });
  it('a failing database leaves the dialog open with a message: the "closed" step is never reached and nothing is reported as done', async () => {
    const broken = { transaction: () => Promise.reject(new Error('The database is locked.')), settings: db.settings } as never;
    let closed = false;
    const h = hooks();
    const runner = makeConfirmRunner(() => async () => { await removeStoredFlowView(broken, 'x'); closed = true; }, h);
    await runner.go();
    expect(closed).toBe(false);
    expect(h.log).toContain('error:The database is locked.');
    expect(runner.running).toBe(false);
  });
  it('after a failure the same dialog can be pressed again and then succeeds', async () => {
    await store('flowViews', addView([], 'Retry', VIEW_STATE, 'vr'));
    let fail = true;
    const h = hooks();
    const runner = makeConfirmRunner(() => async () => { if (fail) throw new Error('first try failed'); await removeStoredFlowView(db, 'vr'); }, h);
    await runner.go();
    expect(h.log).toContain('error:first try failed');
    expect(parseViews(await stored('flowViews'))).toHaveLength(1);
    fail = false;
    await runner.go();
    expect(parseViews(await stored('flowViews'))).toHaveLength(0);
  });
  it('opening and cancelling the question writes nothing: drawing the dialog and its wiring touch no table', async () => {
    await store('flowViews', addView([], 'Quiet', VIEW_STATE, 'vq'));
    await store('savedThemes', addTheme([], 'Quiet', THEME_A, 'tq'));
    const donation = await db.donations.add({ date: '2026-01-01', charity: 'X', kind: 'cash', amountCents: 1, receipt: false, note: '' });
    const snap = async () => JSON.stringify([await db.settings.toArray(), await db.donations.toArray(), await db.goals.toArray()]);
    const before = await snap();
    renderToStaticMarkup(createElement(ConfirmDialog, { title: 'Delete gift?', confirmLabel: 'Delete gift', onConfirm: () => { throw new Error('must not run'); }, onCancel: () => undefined, children: 'x' }));
    expect(await snap()).toBe(before);
    expect(await db.donations.get(donation)).toBeTruthy();
  });
});

describe('D20.1A: documents and tracker are honest about what is done', () => {
  it('records OD-6 as approved and CF-03 as partially migrated, not complete, and D21 as not started', () => {
    const tracker = doc('UI-COVERAGE.md');
    expect(INVENTORY).toContain('OD-6: Owner approved option (a), replacement of all 38 native confirmations, in controlled batches with high-risk workflows last.');
    const cf03 = tracker.split('\n').find((l) => l.startsWith('| CF-03 |'))!;
    expect(cf03).toMatch(/PARTIALLY MIGRATED/);
    expect(cf03).toContain(`${BASELINE.nativeConfirm} in ${BASELINE.nativeConfirmFiles} files`);
    expect(cf03).toMatch(/\| NS \|$|\| BLT \|$/);
    expect(doc('LEDGER-SIGNATURE-D20.1A-REPORT.md')).toMatch(/D21[^.]*not started/i);
  });
});
