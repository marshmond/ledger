/**
 * D21: browser-bar colour before first paint, and a record of how the default appearance works TODAY (the "before" of the Signature default decision).
 *
 * Section 1 runs the real inline script from index.html against a fake page and fake storage.
 * Section 2 pins what is true now about the saved appearance, because it decides whether the default can be changed safely:
 *   a Classic choice is stored as NOTHING, so "chose Classic" and "never chose anything" look identical on a device.
 * If a later change makes Signature the default, these tests must be updated deliberately, in the same change as an owner-approved strategy
 * (see docs/LEDGER-SIGNATURE-D21-REPORT.md, section 5).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPreferences, collectPreferences } from '../lib/backupFile';
import { DEFAULT_CHOICE, PALETTE_KEY, PALETTE_VARS_KEY, PRESETS, loadPalette, parseChoice, resolvedVars, savePalette } from '../palette';
import { THEME_COLOR } from '../theme';

const html = readFileSync('index.html', 'utf8');

const store = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
};

/** Runs index.html's browser-bar script and returns the colour it wrote to the meta tag (the tag starts at the static value). */
function barColor(opts: { storage?: Record<string, string>; deviceDark?: boolean; brokenStorage?: boolean }): string {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('theme-color'));
  expect(script, 'the browser-bar script is in index.html').toBeTruthy();
  const staticColor = /<meta name="theme-color" content="(#[0-9a-f]{6})"/i.exec(html)![1];
  const meta = { content: staticColor, setAttribute: (_: string, v: string) => void (meta.content = v) };
  const s = store(opts.storage);
  const fakeLocal = opts.brokenStorage ? { getItem: () => { throw new Error('blocked'); } } : s;
  new Function('document', 'localStorage', 'window', script!)({ querySelector: () => meta }, fakeLocal, { matchMedia: () => ({ matches: !!opts.deviceDark }) });
  return meta.content;
}

const sigVars = JSON.stringify(resolvedVars({ id: 'signature' }));
const sig = PRESETS.find((p) => p.id === 'signature')!;

describe('D21 browser-bar colour before first paint (index.html)', () => {
  it('the static value and the script fallbacks are exactly THEME_COLOR (Classic light and dark)', () => {
    expect(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i.exec(html)![1].toLowerCase()).toBe(THEME_COLOR.light);
    expect(barColor({})).toBe(THEME_COLOR.light);
    expect(barColor({ storage: { 'ledger-theme': 'dark' } })).toBe(THEME_COLOR.dark);
    expect(barColor({ deviceDark: true })).toBe(THEME_COLOR.dark);
  });
  it('Signature takes its own canvas colour, light and dark, and follows Device when no mode is forced', () => {
    const pal = { [PALETTE_VARS_KEY]: sigVars };
    expect(barColor({ storage: { ...pal, 'ledger-theme': 'light' } }).toLowerCase()).toBe(sig.light.page!.toLowerCase());
    expect(barColor({ storage: { ...pal, 'ledger-theme': 'dark' } }).toLowerCase()).toBe(sig.dark.page!.toLowerCase());
    expect(barColor({ storage: pal, deviceDark: true }).toLowerCase()).toBe(sig.dark.page!.toLowerCase());
    expect(barColor({ storage: pal, deviceDark: false }).toLowerCase()).toBe(sig.light.page!.toLowerCase());
  });
  it('a forced mode wins over the device setting', () => {
    expect(barColor({ storage: { 'ledger-theme': 'light' }, deviceDark: true })).toBe(THEME_COLOR.light);
    expect(barColor({ storage: { 'ledger-theme': 'dark' }, deviceDark: false })).toBe(THEME_COLOR.dark);
  });
  it('every other preset and a custom palette use their own page colour', () => {
    for (const p of PRESETS) {
      const vars = JSON.stringify(resolvedVars({ id: p.id }));
      expect(barColor({ storage: { [PALETTE_VARS_KEY]: vars, 'ledger-theme': 'light' } }).toLowerCase()).toBe((p.light.page ?? p.light.bg).toLowerCase());
    }
  });
  it('ignores unusable stored values and unavailable storage (falls back to the Classic colours, never throws)', () => {
    expect(barColor({ storage: { [PALETTE_VARS_KEY]: 'not json' } })).toBe(THEME_COLOR.light);
    expect(barColor({ storage: { [PALETTE_VARS_KEY]: JSON.stringify({ light: { '--page': 'red' }, dark: {} }) } })).toBe(THEME_COLOR.light);
    expect(barColor({ storage: { [PALETTE_VARS_KEY]: JSON.stringify({ light: {}, dark: {} }) }, deviceDark: true })).toBe(THEME_COLOR.dark);
    expect(barColor({ brokenStorage: true })).toBe(THEME_COLOR.light);
  });
  it('the script reads storage only (no writes) and sits after the meta tag it updates', () => {
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('theme-color'))!;
    expect(script).not.toMatch(/setItem|removeItem|\.clear\(/);
    expect(html.indexOf('name="theme-color"')).toBeLessThan(html.indexOf(script));
  });
  it('the manifest still carries the Classic bar and splash colours (a manifest cannot change at run time)', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(m.theme_color.toLowerCase()).toBe(THEME_COLOR.light);
    expect(m.background_color).toBe('#ffffff');
  });
});

describe('D21 how the default appearance works today (before any default change)', () => {
  it('a device with nothing saved gets Classic', () => {
    expect(loadPalette(store())).toEqual({ id: 'classic' });
    expect(DEFAULT_CHOICE).toEqual({ id: 'classic' });
  });
  it('choosing Classic stores nothing, so it cannot be told apart from never choosing', () => {
    const chosen = store({ [PALETTE_KEY]: JSON.stringify({ id: 'signature' }), [PALETTE_VARS_KEY]: sigVars });
    savePalette({ id: 'classic' }, chosen);
    expect(chosen.dump()).toEqual({});
    expect(chosen.dump()).toEqual(store().dump());
  });
  it('an unreadable, unknown or incomplete saved value falls back to Classic', () => {
    for (const bad of ['not json', '{"id":"nope"}', '{"id":"custom"}', '{"id":"custom","custom":{"light":{},"dark":{}}}', 'null', '5', '']) expect(parseChoice(bad)).toEqual({ id: 'classic' });
  });
  it('an explicit Signature or other preset round-trips unchanged', () => {
    for (const p of PRESETS) {
      const s = store();
      savePalette({ id: p.id }, s);
      expect(loadPalette(s)).toEqual({ id: p.id });
    }
  });
  it('saved custom colors round-trip exactly, with their saved-theme link', () => {
    const custom = { light: { ...sig.light }, dark: { ...sig.dark } };
    const withoutExtras = (c: typeof sig.light) => ({ bg: c.bg, card: c.card, fg: c.fg, muted: c.muted, line: c.line, accent: c.accent, pos: c.pos, neg: c.neg, warn: c.warn, sideBg: c.sideBg, sideFg: c.sideFg, sideActive: c.sideActive });
    const s = store();
    savePalette({ id: 'custom', custom: { light: withoutExtras(custom.light), dark: withoutExtras(custom.dark) }, savedId: 'my-theme' }, s);
    const back = loadPalette(s);
    expect(back.id).toBe('custom');
    expect(back.savedId).toBe('my-theme');
    expect(back.custom!.light).toEqual(withoutExtras(custom.light));
    expect(back.custom!.dark).toEqual(withoutExtras(custom.dark));
  });
  it('unavailable storage gives Classic and does not throw', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadPalette(broken)).toEqual({ id: 'classic' });
    expect(() => savePalette({ id: 'signature' }, broken)).not.toThrow();
  });
  it('a backup carries the palette only when one was chosen; restoring never clears the device’s own choice', () => {
    const device = store({ [PALETTE_KEY]: JSON.stringify({ id: 'signature' }), [PALETTE_VARS_KEY]: sigVars, 'ledger-theme': 'dark' });
    const fromClassicBackup = collectPreferences(store({ 'ledger-theme': 'light' }));
    expect(Object.keys(fromClassicBackup)).toEqual(['ledger-theme']);
    applyPreferences(fromClassicBackup, device);
    expect(loadPalette(device)).toEqual({ id: 'signature' }); // restore added the theme and left the palette alone
    expect(device.getItem('ledger-theme')).toBe('light');
    const fromSignature = collectPreferences(device);
    const fresh = store();
    applyPreferences(fromSignature, fresh);
    expect(loadPalette(fresh)).toEqual({ id: 'signature' });
  });
  it('light and dark are saved separately from the palette (Device stores nothing)', () => {
    const s = store();
    savePalette({ id: 'signature' }, s);
    expect(s.getItem('ledger-theme')).toBeNull();
    expect(JSON.parse(s.getItem(PALETTE_VARS_KEY)!).dark['--page']).toBe(sig.dark.page);
  });
});
