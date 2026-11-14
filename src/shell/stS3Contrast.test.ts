import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESETS, contrastRatio, onColor, type Colors } from '../palette';
import { CLASSIC, LEGACY_PRESETS } from './legacyFixtures';

/**
 * ST-S3 / AX-04. Measures the colour pairs the stylesheet actually uses (read from src/styles.css, so a later edit is caught),
 * for Classic light and dark and for every built-in palette. A tinted background is the colour mixed with the page background, the same
 * way the stylesheet's color-mix() does (--pos-soft 13%, --neg-soft 13%, --warn-soft 14%, --accent-soft 12%, badge 7% of the text colour).
 */
const css = readFileSync('src/styles.css', 'utf8');
// D21.1: the stylesheet's colors (Signature Navy, the default) moved from styles.css to src/ui/palette-base.css. The pairs below are read from there.
const base = readFileSync('src/ui/palette-base.css', 'utf8');
const block = (re: RegExp) => base.match(re)?.[0] ?? '';
const vars = (b: string) => Object.fromEntries([...b.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const LIGHT = vars(block(/^:root \{[\s\S]*?\n\}/m));
const DARK = vars(block(/^:root\[data-theme="dark"\] \{[\s\S]*?\n\}/m));

const hex = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: string, b: string, pctOfA: number) => `#${hex(a).map((v, i) => Math.round(v * pctOfA + hex(b)[i] * (1 - pctOfA)).toString(16).padStart(2, '0')).join('')}`;

/** Every text/background pair the app uses for words, with the smallest ratio that is acceptable (4.5 for text). */
function textPairs(c: { bg: string; card: string; fg: string; muted: string; neg: string; pos: string; warn: string; accent: string }) {
  return {
    'text on page': [c.fg, c.bg],
    'text on card': [c.fg, c.card],
    'muted text on page': [c.muted, c.bg],
    'muted text on card': [c.muted, c.card],
    'muted text on a badge (7% tint)': [c.muted, mix(c.fg, c.bg, 0.07)],
    'muted text on a warning banner': [c.muted, mix(c.warn, c.bg, 0.14)],
    'muted text on an error banner': [c.muted, mix(c.neg, c.bg, 0.13)],
    'warning text on its banner': [c.warn, mix(c.warn, c.bg, 0.14)],
    'error text on its banner': [c.neg, mix(c.neg, c.bg, 0.13)],
    'good-news text on its tint': [c.pos, mix(c.pos, c.bg, 0.13)],
    'link on page': [c.accent, c.bg],
    // Words on the accent's own tint use the text tone (--accent-text, the accent pulled 22% toward the text colour), as every chip and banner does (tested below for every palette).
    'link text on its tint': [mix(c.accent, c.fg, 0.78), mix(c.accent, c.bg, 0.12)],
    'error text on page': [c.neg, c.bg],
    'good-news text on page': [c.pos, c.bg],
    'warning text on page': [c.warn, c.bg],
  } as Record<string, [string, string]>;
}

describe('AX-04 the stylesheet defaults (Signature Navy) light and dark: every text pair is at least 4.5:1', () => {
  for (const [name, v, bgKey] of [['light', LIGHT, 'bg'], ['dark', DARK, 'bg']] as const) {
    it(`${name}: the stylesheet's colours were read`, () => {
      for (const k of ['fg', 'muted', 'card', 'accent', 'neg', 'pos', 'warn']) expect(v[k], `--${k} (${name})`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(v[bgKey]).toBeTruthy();
    });
  }
  it('light (the stylesheet defaults)', () => {
    const c = { ...LIGHT } as unknown as Colors;
    const low = Object.entries(textPairs(c)).map(([k, [a, b]]) => [k, contrastRatio(a, b)] as const).filter(([, r]) => r < 4.5);
    expect(low).toEqual([]);
  });
  it('dark', () => {
    const c = { ...LIGHT, ...DARK } as unknown as Colors; // dark overrides what it names; anything it does not name keeps the light value, as in the browser
    const low = Object.entries(textPairs(c)).map(([k, [a, b]]) => [k, contrastRatio(a, b)] as const).filter(([, r]) => r < 4.5);
    expect(low).toEqual([]);
  });
  it('the four S0 failures are fixed by name', () => {
    // 1. "Data & Backups" tab: the active Settings tab must NOT paint accent behind dark text. The rule now clears the background.
    expect(css).toMatch(/\.settings-tabs a\.active \{ background: none;/);
    // 2. Calendar check marks: chosen per swatch colour (see the next test). 3-4. warning/muted/error text on tinted banners: see the pairs above.
    expect(contrastRatio(LIGHT.warn, mix(LIGHT.warn, LIGHT.bg, 0.14))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(LIGHT.muted, mix(LIGHT.warn, LIGHT.bg, 0.14))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AX-04 calendar check marks', () => {
  it('the mark colour is chosen to read on whatever swatch colour a calendar has (the three that failed in S0, and the extremes)', () => {
    for (const swatch of ['#2f8f6b', '#b07a1f', '#4a7bd0', '#ffffff', '#000000', '#ffd400', '#7a1fb0']) {
      expect(contrastRatio(onColor(swatch), swatch), swatch).toBeGreaterThanOrEqual(4.5);
    }
    // For comparison, the old fixed white mark failed on these three.
    for (const swatch of ['#2f8f6b', '#b07a1f', '#4a7bd0']) expect(contrastRatio('#ffffff', swatch)).toBeLessThan(4.5);
  });
});

describe('AX-04 built-in palettes and Classic as the base of a custom palette', () => {
  const all: [string, Colors][] = [['classic light', CLASSIC.light], ['classic dark', CLASSIC.dark], ...LEGACY_PRESETS.flatMap((p) => [[`${p.name} (older) light`, p.light], [`${p.name} (older) dark`, p.dark]] as [string, Colors][]), ...PRESETS.flatMap((p) => [[`${p.name} light`, p.light], [`${p.name} dark`, p.dark]] as [string, Colors][])];
  for (const [name, c] of all) {
    it(`${name}: main and quiet text read on the page and on cards, and button text reads on the accent`, () => {
      expect(contrastRatio(c.fg, c.bg), 'text on page').toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.fg, c.card), 'text on card').toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.muted, c.bg), 'muted on page').toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.muted, c.card), 'muted on card').toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(onColor(c.accent), c.accent), 'text on accent buttons').toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.sideFg, c.sideBg), 'sidebar text').toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * Words that sit on the light tint of their own colour (chips, badges, banners). The stylesheet uses a "text tone": the palette colour pulled 22%
 * toward the text colour (--accent-text, --warn-text, --pos-text, --neg-text in src/ui/tokens.css). This checks that tone, for every palette.
 */
describe('AX-04 words on a colour\'s own tint use the text tone, and it passes on every palette', () => {
  const tokens = readFileSync('src/ui/tokens.css', 'utf8');
  it('the four text-tone tokens exist and are the 78% mix the tests below assume', () => {
    for (const k of ['accent', 'warn', 'pos', 'neg']) expect(tokens).toContain(`--${k}-text: color-mix(in srgb, var(--${k}) 78%, var(--fg));`);
  });
  const tint: Record<'accent' | 'warn' | 'pos' | 'neg', number> = { accent: 0.12, warn: 0.14, pos: 0.13, neg: 0.13 };
  const all: [string, Colors][] = [['classic light', CLASSIC.light], ['classic dark', CLASSIC.dark], ...LEGACY_PRESETS.flatMap((p) => [[`${p.name} (older) light`, p.light], [`${p.name} (older) dark`, p.dark]] as [string, Colors][]), ...PRESETS.flatMap((p) => [[`${p.name} light`, p.light], [`${p.name} dark`, p.dark]] as [string, Colors][])];
  for (const [name, c] of all) {
    it(`${name}: text tone on its own tint is at least 4.5:1 for accent, warning, good and error`, () => {
      for (const k of ['accent', 'warn', 'pos', 'neg'] as const) {
        const text = mix(c[k], c.fg, 0.78);
        expect(contrastRatio(text, mix(c[k], c.bg, tint[k])), `${k} on its tint`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(c.muted, mix(c.fg, c.bg, 0.07)), 'quiet text on a badge').toBeGreaterThanOrEqual(4.5);
    });
  }
  it('the stylesheet uses the tone for the status chips and banners it names (so the tokens are not decoration)', () => {
    for (const rule of [/\.badge\.pending \{ color: var\(--warn-text\)/, /\.badge\.reconciled \{ color: var\(--pos-text\)/, /\.badge\.cleared \{ color: var\(--accent-text\)/, /\.banner\.warn, \.alert\.warn \{ color: var\(--warn-text\)/, /\.banner\.ok, \.alert\.ok \{ color: var\(--pos-text\)/]) expect(css).toMatch(rule);
    const cal = readFileSync('src/modules/calendar/calendar.css', 'utf8');
    expect(cal).toMatch(/\.cal-flag\.bad \{ color: var\(--neg-text\)/);
    expect(cal).toMatch(/\.cal-flag\.warn \{ color: var\(--warn-text\)/);
  });
  it('no rule puts a colour on its own tint without the text tone (the pattern that failed in S0)', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.css') ? [`${d}/${e.name}`] : []));
    const bad: string[] = [];
    for (const f of walk('src')) {
      if (f.endsWith('tokens.css')) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        for (const k of ['accent', 'warn', 'pos', 'neg']) if (line.includes(`background: var(--${k}-soft)`) && new RegExp(`(^|[ {;])color: var\(--${k}\)`).test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('AX-04 the default colors file equals Signature Navy, and Classic as the base of a custom palette still starts at AA', () => {
  it('the stylesheet default colors are the Signature Navy palette (the first palette)', () => {
    const nav = PRESETS[0];
    for (const [k, v] of [['accent', nav.light.accent], ['muted', nav.light.muted], ['neg', nav.light.neg], ['pos', nav.light.pos], ['warn', nav.light.warn], ['fg', nav.light.fg]] as const) expect(LIGHT[k].toLowerCase(), k).toBe(v.toLowerCase());
    expect(DARK.accent.toLowerCase()).toBe(nav.dark.accent.toLowerCase());
  });
  it('CLASSIC (a stored custom theme started from the old default) still has AA text and links', () => {
    expect(contrastRatio(CLASSIC.light.accent, CLASSIC.light.bg), 'link on page').toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(CLASSIC.light.muted, CLASSIC.light.bg), 'quiet text').toBeGreaterThanOrEqual(4.5);
  });
});
