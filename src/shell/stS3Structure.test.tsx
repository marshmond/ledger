import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PREFERENCE_KEYS } from '../lib/backupFile';
import { PREF_GROUP_TITLES, PREF_ITEMS, groupOf } from '../lib/devicePrefs';
import { HIDE_AMOUNTS_KEY } from '../core/hideAmounts';
import { LAYOUT_KEY } from '../modules/today/layout';
import { UPCOMING_KEY } from '../modules/services/upcomingWindow';
import { VISIBILITY_KEY } from '../modules/calendar/layerVisibility';
import { PALETTE_KEY, PALETTE_VARS_KEY } from '../palette';
import DevicePreferencesCard from '../pages/DevicePreferencesCard';
import { accessibleName, all, headingSkips, headings, parseHtml, textOf, unnamedButtons } from '../lib/a11yTestkit';
import { confirmParts, confirmText, noteLines, type AccountDependents } from '../lib/accountDependents';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const sources = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
const read = (f: string) => readFileSync(f, 'utf8');

describe('ST-S3 / AX-03: one main landmark, written one way', () => {
  it('no screen writes its own <main>: they all use shell/Main, which carries the id the skip link points at', () => {
    const offenders = sources.filter((f) => !/shell[\\/]Main\.tsx$/.test(f) && /<main[\s>]/.test(read(f)));
    expect(offenders).toEqual([]);
  });
  it('every module shell and Ledger\'s own shell uses Main', () => {
    const users = sources.filter((f) => /<Main[\s>]/.test(read(f))).map((f) => f.replace(/\\/g, '/'));
    for (const must of ['today/TodayModule', 'calendar/CalendarModule', 'tasks/TasksModule', 'projects/ProjectsModule', 'assets/AssetsModule', 'services/ServicesModule', 'bills/BillsModule', 'household/HouseholdModule', 'pages/SettingsPage', 'shell/Shell']) {
      expect(users.some((u) => u.includes(must)), must).toBe(true);
    }
  });
  it('the skip link and route announcer are mounted once, at the top of the app', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/<SkipLink \/>/);
    expect(app).toMatch(/<RouteAnnouncer pathname=\{loc\.pathname\} \/>/);
    expect(app.indexOf('<SkipLink />')).toBeLessThan(app.indexOf('<ModuleBar />')); // first Tab stop
  });
  it('the skip link does not rewrite the address (Ledger uses #/ addresses): its click handler prevents the browser jump', () => {
    const src = read('src/shell/SkipAndRoute.tsx');
    expect(src).toMatch(/e\.preventDefault\(\)/);
  });
});

describe('ST-S3 / AX-05: error messages are announced', () => {
  it('every block-level error message (div.error) in the app is announced (an alert, or a polite status for a failure nobody just asked for, such as a background sync problem)', () => {
    const bad: string[] = [];
    for (const f of sources.filter((x) => x.endsWith('.tsx'))) {
      read(f).split('\n').forEach((line, i) => { if (/<div className="error"/.test(line) && !/role="(alert|status)"/.test(line)) bad.push(`${f}:${i + 1}`); });
    }
    expect(bad).toEqual([]);
  });
});

describe('ST-S3 / UX-05: the device-preferences explanation tells the truth', () => {
  const deviceKeys = PREF_ITEMS.filter((i) => i.kind === 'device').flatMap((i) => i.keys ?? []);
  it('every key a backup carries is explained, once, as "saved in a backup file"', () => {
    const saved = PREF_ITEMS.filter((i) => groupOf(i) === 'deviceSaved').flatMap((i) => i.keys ?? []);
    expect([...saved].sort()).toEqual([...PREFERENCE_KEYS].sort());
    expect(new Set(saved).size).toBe(saved.length);
  });
  it('the things said NOT to be in a backup really are not', () => {
    const notSaved = PREF_ITEMS.filter((i) => groupOf(i) === 'deviceOnly').flatMap((i) => i.keys ?? []);
    expect(notSaved.length).toBeGreaterThan(0);
    for (const k of notSaved) expect(PREFERENCE_KEYS, k).not.toContain(k);
  });
  it('the key names written in the list are the ones the code actually uses', () => {
    expect(deviceKeys).toContain(HIDE_AMOUNTS_KEY);
    expect(deviceKeys).toContain(LAYOUT_KEY);
    expect(deviceKeys).toContain(UPCOMING_KEY);
    expect(deviceKeys).toContain(VISIBILITY_KEY);
    expect(deviceKeys).toContain(PALETTE_KEY);
    expect(deviceKeys).toContain(PALETTE_VARS_KEY);
    expect(read('src/modules/tasks/TasksPage.tsx')).toContain(`'tasks-last-view'`);
    expect(read('src/core/registry.ts')).toContain(`'ledger-last-module'`);
    expect(read('src/modules/calendar/CalendarPage.tsx')).toContain(`'calendar-last-view'`);
    expect(read('src/modules/calendar/CalendarPage.tsx')).toContain(`'calendar-agenda-range'`);
  });
  it('secrets are never in the backed-up list: the sync settings, the weekly-backup passphrase and the price key stay out', () => {
    for (const secret of ['ledger-sync-config', 'ledger-autobackup', 'ledger-autobackup-status', 'priceApiKey']) expect(PREFERENCE_KEYS).not.toContain(secret);
    expect(PREFERENCE_KEYS.filter((k) => /token|passphrase|secret|api-?key/i.test(k))).toEqual([]);
    expect(PREF_ITEMS.filter((i) => i.kind === 'secret')).toHaveLength(3);
    for (const i of PREF_ITEMS.filter((x) => x.kind === 'secret')) expect(i.keys).toBeUndefined(); // the explanation names them but never lists a storage key to copy
  });
  it('the card shows four titled groups, each with at least one item, under real headings', () => {
    const d = parseHtml(renderToStaticMarkup(createElement(DevicePreferencesCard)));
    const hs = headings(d);
    expect(hs[0].level).toBe(2);
    expect(hs.filter((h) => h.level === 3).map((h) => h.text)).toEqual(Object.values(PREF_GROUP_TITLES).map((g) => g.title));
    expect(headingSkips(d)).toEqual([]);
    expect(all(d, (e) => e.tag === 'li').length).toBe(PREF_ITEMS.length);
    expect(all(d, (e) => e.tag === 'section')[0].attrs['aria-labelledby']).toBe('device-prefs-title');
  });
  it('Hide amounts is described as staying on this device, and Calendar layers as not backed up', () => {
    const hide = PREF_ITEMS.find((i) => i.label === 'Hide amounts')!;
    expect(groupOf(hide)).toBe('deviceSaved');
    const cal = PREF_ITEMS.find((i) => /Calendar: which calendars/.test(i.label))!;
    expect(groupOf(cal)).toBe('deviceOnly');
  });
  it('the explanation has no figures, names or ids', () => {
    expect(PREF_ITEMS.map((i) => i.label).join(' ')).not.toMatch(/\d/);
  });
});

describe('ST-S3 / UX-03: account deletion question', () => {
  const dep = (over: Partial<AccountDependents> = {}): AccountDependents => ({ transactions: 4, rules: [], loans: [], billTitles: [], payeeRules: 0, isPrimary: false, importBatches: 0, ...over } as AccountDependents);
  it('is the same words as before, now split into a headline and a list so the dialog can show them properly', () => {
    const d = dep({ billTitles: ['Demo bill'], isPrimary: true });
    const { headline, notes } = confirmParts('Demo Checking', d);
    expect(headline).toBe('Delete "Demo Checking" and all 4 of its transactions? Linked transfer entries on other accounts are removed too. This cannot be undone.');
    expect(notes).toEqual(noteLines(d));
    expect(confirmText('Demo Checking', d)).toBe(`${headline}\n\nAlso:\n- ${notes.join('\n- ')}`);
  });
  it('with nothing else to say there is no "Also" part', () => {
    expect(confirmText('Demo Checking', dep())).toBe(confirmParts('Demo Checking', dep()).headline);
  });
  it('the Ledger page no longer uses the browser pop-up for account deletion, and the dependency re-check still happens inside the deletion', () => {
    const page = read('src/pages/LedgerPage.tsx');
    expect(page).not.toMatch(/\bconfirm\(/);
    expect(page).toMatch(/<ConfirmDialog/);
    expect(page).toMatch(/deleteAccountWithTransactions\(db, id\)/);
    expect(page).toMatch(/blocksDeletion\(dep\)\) return setBlocked\(dep\)/); // a blocked account never even reaches the question
    expect(page).toMatch(/if \(!res\.ok\) return setBlocked\(res\.dependents\)/); // a late block (a rule added meanwhile) is shown, nothing is deleted
  });
  it('the passphrase change and stop-syncing questions are dialogs too, with no browser pop-up left in the Backup and Sync pages', () => {
    expect(read('src/pages/SyncPage.tsx')).not.toMatch(/\bconfirm\(/);
    expect(read('src/pages/BackupPage.tsx')).not.toMatch(/\bconfirm\(/);
  });
});

describe('ST-S3 / UX-03: the Sync conflict question is explicit and never silent', () => {
  it('"clear this list" opens a question that says the versions cannot be put back, and removes only the versions it listed', () => {
    const page = read('src/pages/SyncPage.tsx');
    expect(page).toMatch(/setClearKeys\(conflicts\.map\(conflictKey\)\)/);
    expect(page).toMatch(/removeConflicts\(meta, keys\)/);
    expect(page).toMatch(/you can no longer put them back/);
    expect(page).not.toMatch(/clearConflictList|clearConflicts\(meta\)/); // the "remove everything" function is not what the page calls any more
  });
});

describe('ST-S3: dialog buttons all have names', () => {
  it('the close button in the shared Modal is named', async () => {
    const { default: Modal } = await import('./Modal');
    const d = parseHtml(renderToStaticMarkup(createElement(Modal, { title: 'Test', onClose: () => undefined, children: createElement('p', null, 'x') })));
    expect(unnamedButtons(d)).toEqual([]);
    expect(accessibleName(d, all(d, (e) => e.tag === 'button')[0])).toBe('Close');
    expect(textOf(all(d, (e) => e.attrs.role === 'dialog')[0])).toContain('x');
  });
});
