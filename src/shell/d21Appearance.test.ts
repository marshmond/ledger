/**
 * D21 (updated by D21.1): browser-bar colour before first paint, and how the saved appearance works under the universal Signature model.
 *
 * Section 1 runs the real inline script from index.html against a fake page and fake storage.
 * Section 2 pins how the saved appearance works now. D21 recorded that a Classic choice was stored as NOTHING, so "chose Classic" and "never chose" looked identical,
 * and stopped before changing the default. D21.1 (owner decision: Signature is the one interface, palettes choose colors only) replaced that model:
 *   - a device with nothing saved uses Signature Navy;
 *   - a choice is always stored explicitly (Signature Navy included);
 *   - older ids (Classic, Calm teal, ...) are read as the palette they map to (see d211Palettes.test.ts for the full migration cases).
 * Superseded D21 rules: "a device with nothing saved gets Classic", "choosing Classic stores nothing", "the manifest carries the Classic colours", "the static bar
 * colour is Classic's blue / dark grey". Replacements are below.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPreferences, collectPreferences } from '../lib/backupFile';
import { DEFAULT_CHOICE, PALETTE_KEY, PALETTE_VARS_KEY, PRESETS, loadPalette, parseChoice, resolvedVars, savePalette, withoutOptional } from '../palette';
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

/** Runs index.html's palette-variables script and returns the variables it set on the page. */
function prePaintVars(opts: { storage?: Record<string, string>; deviceDark?: boolean }): Record<string, string> {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('ledger-palette-vars') && s.includes('setProperty'));
  expect(script, 'the palette script is in index.html').toBeTruthy();
  const props: Record<string, string> = {};
  const doc = { documentElement: { style: { setProperty: (k: string, v: string) => void (props[k] = v) } } };
  new Function('document', 'localStorage', 'window', script!)(doc, store(opts.storage), { matchMedia: () => ({ matches: !!opts.deviceDark }) });
  return props;
}

const navy = PRESETS[0];

describe('D21.1 browser-bar colour before first paint (index.html)', () => {
  it('the static value and the script fallbacks are exactly THEME_COLOR (Signature Navy light and dark)', () => {
    expect(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i.exec(html)![1].toLowerCase()).toBe(THEME_COLOR.light.toLowerCase());
    expect(THEME_COLOR.light).toBe(navy.light.page);
    expect(THEME_COLOR.dark).toBe(navy.dark.page);
    expect(barColor({}).toLowerCase()).toBe(THEME_COLOR.light.toLowerCase());
    expect(barColor({ storage: { 'ledger-theme': 'dark' } }).toLowerCase()).toBe(THEME_COLOR.dark.toLowerCase());
    expect(barColor({ deviceDark: true }).toLowerCase()).toBe(THEME_COLOR.dark.toLowerCase());
  });
  it('every palette takes its own canvas colour, light and dark, and follows Device when no mode is forced', () => {
    for (const p of PRESETS) {
      const pal = { [PALETTE_VARS_KEY]: JSON.stringify(resolvedVars({ id: p.id })) };
      expect(barColor({ storage: { ...pal, 'ledger-theme': 'light' } }).toLowerCase(), `${p.id} light`).toBe(p.light.page!.toLowerCase());
      expect(barColor({ storage: { ...pal, 'ledger-theme': 'dark' } }).toLowerCase(), `${p.id} dark`).toBe(p.dark.page!.toLowerCase());
      expect(barColor({ storage: pal, deviceDark: true }).toLowerCase(), `${p.id} device dark`).toBe(p.dark.page!.toLowerCase());
      expect(barColor({ storage: pal, deviceDark: false }).toLowerCase(), `${p.id} device light`).toBe(p.light.page!.toLowerCase());
    }
  });
  it('a forced mode wins over the device setting', () => {
    expect(barColor({ storage: { 'ledger-theme': 'light' }, deviceDark: true }).toLowerCase()).toBe(THEME_COLOR.light.toLowerCase());
    expect(barColor({ storage: { 'ledger-theme': 'dark' }, deviceDark: false }).toLowerCase()).toBe(THEME_COLOR.dark.toLowerCase());
  });
  it('a custom palette uses its own page colour', () => {
    const custom = { id: 'custom' as const, custom: { light: withoutOptional(navy.light), dark: withoutOptional(navy.dark) } };
    const pal = { [PALETTE_VARS_KEY]: JSON.stringify(resolvedVars(custom)) };
    expect(barColor({ storage: { ...pal, 'ledger-theme': 'light' } }).toLowerCase()).toBe(navy.light.bg.toLowerCase());
  });
  it('ignores unusable stored values and unavailable storage (falls back to the Signature Navy colours, never throws)', () => {
    expect(barColor({ storage: { [PALETTE_VARS_KEY]: 'not json' } }).toLowerCase()).toBe(THEME_COLOR.light.toLowerCase());
    expect(barColor({ storage: { [PALETTE_VARS_KEY]: JSON.stringify({ v: 2, light: { '--page': 'red' }, dark: {} }) } }).toLowerCase()).toBe(THEME_COLOR.light.toLowerCase());
    expect(barColor({ storage: { [PALETTE_VARS_KEY]: JSON.stringify({ v: 2, light: {}, dark: {} }) }, deviceDark: true }).toLowerCase()).toBe(THEME_COLOR.dark.toLowerCase());
    expect(barColor({ brokenStorage: true }).toLowerCase()).toBe(THEME_COLOR.light.toLowerCase());
  });
  it('an older-format copy of the palette variables (no v: 2) is ignored, never applied half-way', () => {
    const older = JSON.stringify({ light: { '--page': '#FAFAF8', '--accent': '#0F766E' }, dark: {} });
    expect(barColor({ storage: { [PALETTE_VARS_KEY]: older } }).toLowerCase()).toBe(THEME_COLOR.light.toLowerCase());
    expect(prePaintVars({ storage: { [PALETTE_VARS_KEY]: older } })).toEqual({});
  });
  it('the palette script applies a v: 2 copy for the right mode, and nothing when there is none', () => {
    expect(prePaintVars({})).toEqual({});
    const ev = PRESETS[2];
    const storage = { [PALETTE_VARS_KEY]: JSON.stringify(resolvedVars({ id: ev.id })) };
    expect(prePaintVars({ storage })['--accent']).toBe(ev.light.accent);
    expect(prePaintVars({ storage, deviceDark: true })['--accent']).toBe(ev.dark.accent);
    expect(prePaintVars({ storage: { ...storage, 'ledger-theme': 'light' }, deviceDark: true })['--accent']).toBe(ev.light.accent);
  });
  it('the scripts read storage only (no writes) and the bar script sits after the meta tag it updates', () => {
    for (const script of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.includes('ledger-'))) expect(script).not.toMatch(/setItem|removeItem|\.clear\(/);
    const bar = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('theme-color'))!;
    expect(html.indexOf('name="theme-color"')).toBeLessThan(html.indexOf(bar));
  });
  it('the manifest carries the Signature Navy bar and splash colours (a manifest cannot change at run time)', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(m.theme_color.toLowerCase()).toBe(THEME_COLOR.light.toLowerCase());
    expect(m.background_color.toLowerCase()).toBe(THEME_COLOR.light.toLowerCase());
  });
});

describe('D21.1 how the saved appearance works now', () => {
  it('a device with nothing saved gets Signature Navy', () => {
    expect(loadPalette(store())).toEqual({ id: 'signature-navy' });
    expect(DEFAULT_CHOICE).toEqual({ id: 'signature-navy' });
  });
  it('every choice, Signature Navy included, is stored explicitly (so it is kept, backed up and restored)', () => {
    for (const p of PRESETS) {
      const s = store();
      savePalette({ id: p.id }, s);
      expect(s.dump()[PALETTE_KEY]).toBe(JSON.stringify({ id: p.id }));
      expect(loadPalette(s)).toEqual({ id: p.id });
    }
  });
  it('an unreadable, unknown or incomplete saved value falls back to Signature Navy', () => {
    for (const bad of ['not json', '{"id":"nope"}', '{"id":"custom"}', '{"id":"custom","custom":{"light":{},"dark":{}}}', 'null', '5', '']) expect(parseChoice(bad)).toEqual({ id: 'signature-navy' });
  });
  it('saved custom colors round-trip exactly, with their saved-theme link', () => {
    const custom = { light: { ...navy.light }, dark: { ...navy.dark } };
    const s = store();
    savePalette({ id: 'custom', custom: { light: withoutOptional(custom.light), dark: withoutOptional(custom.dark) }, savedId: 'my-theme' }, s);
    const back = loadPalette(s);
    expect(back.id).toBe('custom');
    expect(back.savedId).toBe('my-theme');
    expect(back.custom!.light).toEqual(withoutOptional(custom.light));
    expect(back.custom!.dark).toEqual(withoutOptional(custom.dark));
  });
  it('unavailable storage gives Signature Navy and does not throw', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadPalette(broken)).toEqual({ id: 'signature-navy' });
    expect(() => savePalette({ id: 'evergreen' }, broken)).not.toThrow();
  });
  it('a backup carries the palette that was chosen; restoring puts it back, and a backup without one leaves the device’s own choice alone', () => {
    const device = store({ [PALETTE_KEY]: JSON.stringify({ id: 'warm-stone' }), [PALETTE_VARS_KEY]: JSON.stringify(resolvedVars({ id: 'warm-stone' })), 'ledger-theme': 'dark' });
    const fromOlderBackup = collectPreferences(store({ 'ledger-theme': 'light' }));
    expect(Object.keys(fromOlderBackup)).toEqual(['ledger-theme']);
    applyPreferences(fromOlderBackup, device);
    expect(loadPalette(device)).toEqual({ id: 'warm-stone' }); // restore added the theme and left the palette alone
    expect(device.getItem('ledger-theme')).toBe('light');
    const fromWarm = collectPreferences(device);
    const fresh = store();
    applyPreferences(fromWarm, fresh);
    expect(loadPalette(fresh)).toEqual({ id: 'warm-stone' });
    expect(fresh.getItem(PALETTE_VARS_KEY)).toBe(device.getItem(PALETTE_VARS_KEY));
  });
  it('light and dark are saved separately from the palette (Device stores nothing)', () => {
    const s = store();
    savePalette({ id: 'signature-navy' }, s);
    expect(s.getItem('ledger-theme')).toBeNull();
    expect(JSON.parse(s.getItem(PALETTE_VARS_KEY)!).dark['--page']).toBe(navy.dark.page);
  });
  it('the saved-choice shape is unchanged: the same two keys, and the choice is just { id } (plus savedId or from when they apply)', () => {
    expect(PALETTE_KEY).toBe('ledger-palette');
    expect(PALETTE_VARS_KEY).toBe('ledger-palette-vars');
  });
});
