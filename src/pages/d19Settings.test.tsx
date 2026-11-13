import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeadingLevel } from '../ui/components';
import { Pill, SettingsSection } from './SettingsParts';
import { LEDGER_ROUTE_PATHS } from '../modules/ledger/routePaths';
import { COLOR_ROLES } from '../palette';

/**
 * D19: More, Settings and the document pages were recomposed; no engine, storage or protocol changed. These checks pin the parts that could
 * silently weaken a safeguard (restore and sync wording, the five Settings addresses, the print rules) and the one new shared piece.
 */
const src = (f: string) => readFileSync(`src/pages/${f}`, 'utf8');

describe('D19 SettingsSection', () => {
  it('draws an h2 on a page of its own and an h3 under another titled page (Settings), and labels the section by its heading', () => {
    const alone = renderToStaticMarkup(createElement(SettingsSection, { id: 'x', title: 'T', children: 'body' }));
    expect(alone).toContain('<h2');
    expect(alone).toContain('aria-labelledby="x-h"');
    const inside = renderToStaticMarkup(createElement(PageHeadingLevel.Provider, { value: 2 }, createElement(SettingsSection, { id: 'x', title: 'T', children: 'body' })));
    expect(inside).toContain('<h3');
    expect(inside).not.toContain('<h2');
  });
  it('can keep an existing heading id (the device-preferences card is labelled by "device-prefs-title")', () => {
    const html = renderToStaticMarkup(createElement(SettingsSection, { id: 'a', titleId: 'device-prefs-title', title: 'T', children: 'b' }));
    expect(html).toContain('id="device-prefs-title"');
    expect(html).toContain('aria-labelledby="device-prefs-title"');
  });
  it('a status pill carries a word, not only a color', () => {
    expect(renderToStaticMarkup(createElement(Pill, { tone: 'bad', children: 'Replaces everything on this device' }))).toContain('Replaces everything on this device');
  });
});

describe('D19 Settings frame', () => {
  const t = src('SettingsPage.tsx');
  it('keeps the five addresses and the redirect, and lists every one in the navigation', () => {
    for (const p of ['general', 'appearance', 'backup', 'sync', 'calendar']) {
      expect(t).toContain(`<Route path="${p}"`);
      expect(t).toContain(`to: '/${p}'`);
    }
    expect(t).toContain('<Route path="*" element={<Navigate to="/settings/backup" replace />} />');
    expect(t).toContain('aria-label="Settings pages"');
  });
});

describe('D19 More', () => {
  const t = src('MorePage.tsx');
  it('links only to pages that exist', () => {
    const ledger = [...t.matchAll(/<Dest to="(\/[a-z]+)"/g)].map((m) => m[1]);
    for (const to of ledger) expect(LEDGER_ROUTE_PATHS, to).toContain(to);
    const settings = [...t.matchAll(/to="\/settings\/([a-z]+)"/g)].map((m) => m[1]);
    expect(new Set(settings)).toEqual(new Set(['backup', 'sync', 'appearance', 'general', 'calendar']));
  });
  it('keeps the shortcuts, the amount-entry switch and the About text', () => {
    expect(t).toContain('<AmountEntryCard />');
    expect(t).toContain('opens search from anywhere');
    expect(t).toContain('a planning aid, not tax, legal, or');
  });
});

describe('D19 Data & Backups keeps every safeguard', () => {
  const b = src('BackupPage.tsx');
  const p = src('PlainBackupCard.tsx');
  it('restore still runs the same sequence: check, confirm, safety copy, one-transaction restore', () => {
    expect(b).toContain('prepareEncryptedRestore(await f.text(), pass)');
    expect(b).toContain('restoreWithSafetyCopy(db, pending.file');
    expect(b).toContain('if (readConfig()) await touchAll(db)');
    expect(b).toContain("sessionStorage.setItem('ledger-restored', saved)");
    expect(p).toContain('checkBackupText(await f.text())');
    expect(p).toContain('restoreWithSafetyCopy(db, pending.file');
  });
  it('the replacement warning and its confirmation are still there, and restore is labelled as a replacement on both cards', () => {
    expect(p).toContain('This REPLACES all the data currently in this browser');
    expect(p).toContain('role="alertdialog"');
    expect(p).toContain("Replace my data");
    expect(b.match(/Replaces everything on this device/g)?.length).toBe(1);
    expect(p.match(/Replaces everything on this device/g)?.length).toBe(1);
    expect(b).toContain('onConfirm={replaceFromEncrypted}');
  });
  it('the passphrase rules and the plain-backup privacy warning are unchanged', () => {
    expect(b).toContain('Use a passphrase of at least 8 characters. You cannot recover the backup without it.');
    expect(b).toContain('AUTO_BACKUP_MIN_PASSPHRASE');
    expect(p).toContain('This file is NOT encrypted');
  });
});

describe('D19 Sync devices keeps every safeguard', () => {
  const s = src('SyncPage.tsx');
  it('upload and replace stay separate, replace needs its checkbox, and the private-repository check is untouched', () => {
    expect(s).toContain("connect('upload')");
    expect(s).toContain("connect('replace')");
    expect(s).toContain('disabled={busy || !replaceOk}');
    expect(s).toContain("await takeSnapshot(db, meta, 'before-replace'");
    expect(s).toContain("That repository is public. Make it private on GitHub");
  });
  it('the confirmations, the conflict list anchor and the token and turn-off controls are still there', () => {
    expect(s).toContain('Stop syncing this device?');
    expect(s).toContain('Remove ${clearKeys.length === 1');
    expect(s).toContain('id="conflicts"');
    expect(s).toContain('Put that version back');
    expect(s).toContain('Update token');
    expect(s).toContain('Stop syncing on this device');
  });
  it('never renders a stored token or passphrase', () => {
    expect(s).not.toMatch(/\{\s*(c|cfg|config|s)\.(token|passphrase)\s*\}/);
    expect(s.match(/type="password"/g)?.length).toBe(3);
  });
});

describe('D19 palette wording', () => {
  it('the twelve color roles keep their stored keys; only the three menu labels changed, and none says sidebar', () => {
    expect(COLOR_ROLES.map((r) => r.key)).toEqual(['bg', 'card', 'fg', 'muted', 'line', 'accent', 'pos', 'neg', 'warn', 'sideBg', 'sideFg', 'sideActive']);
    for (const r of COLOR_ROLES) expect(`${r.label} ${r.help}`).not.toMatch(/sidebar/i);
  });
});

describe('D19 documents print on white without chrome', () => {
  const css = readFileSync('src/pages/docs.css', 'utf8');
  const print = css.slice(css.indexOf('@media print'));
  it('redefines the page colors locally so dark palettes still print dark on white', () => {
    expect(print).toContain('--surface: #fff');
    expect(print).toContain('--fg: #000');
    expect(print).toContain('--hero-bg: #fff');
  });
  it('the three documents are wrapped so those rules apply, and keep a print-only title', () => {
    for (const f of ['ReviewPage.tsx', 'GuidePage.tsx', 'TaxPackagePage.tsx']) {
      const t = src(f);
      expect(t, f).toContain('className="dc-doc');
      expect(t, f).toContain('className="print-only"');
    }
  });
  it('the guide prints what it shows: balances only when "Show balances" is on, and typed answers as text', () => {
    const g = src('GuidePage.tsx');
    expect(g.match(/g\.showBalances &&/g)?.length).toBe(2);
    expect(g).toContain('print-only dc-pre');
    expect(g).not.toContain('showBalances: true');
  });
});
