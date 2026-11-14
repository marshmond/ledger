/**
 * D21.1: Ledger Signature is the one design system; a palette chooses colors only.
 *
 * Guards in this file (all measured or read from the real files; every color is a design value, no personal data):
 *  1. Architecture: the Signature structure is the stylesheet default, no palette can set structure, nothing in the code keys off a palette's identity.
 *  2. Fidelity: Signature Navy equals the approved prior Signature values, and the stylesheet's default colors equal Signature Navy line by line.
 *  3. The five palettes: complete, valid, readable (WCAG) in Light and Dark, with shared status colors, and Family colors readable on all of them.
 *  4. Custom themes: the adapter gives every stored twelve-color theme the whole set, readable, without changing what is stored.
 *  5. Older choices and the one-time transition: documented mapping, nothing deleted, repeat-safe, damaged values left in place.
 *  6. The Appearance page and the page application of a palette.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPreferences } from '../lib/backupFile';
import { COLORS } from '../modules/family/model';
import {
  DEFAULT_CHOICE, EXTRA_KEYS, LEGACY_PALETTE_MAP, PALETTE_KEY, PALETTE_VARS_KEY, PRESETS, VARS_VERSION, applyPalette, colorsOf, contrastNotes, contrastRatio, deriveExtras, extrasOf,
  loadPalette, migrateStoredPalette, mixHex, parseChoice, resolvedVars, savePalette, varsFor, varsOf, withoutOptional, type Colors, type PaletteChoice,
} from '../palette';
import { CLASSIC, LEGACY_PRESETS } from './legacyFixtures';

const read = (f: string) => readFileSync(f, 'utf8');
const tokens = read('src/ui/tokens.css');
const base = read('src/ui/palette-base.css');
const decls = (body: string) => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const rootBlock = (css: string) => css.match(/^:root \{([\s\S]*?)\n\}/m)?.[1] ?? '';
const mediaDark = (css: string) => css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
const forcedDark = (css: string) => css.match(/^:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/m)?.[1] ?? '';
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const appFiles = () => walk('src').filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('legacyFixtures.ts'));
const HEXRE = /^#[0-9a-f]{6}$/i;
const modes = ['light', 'dark'] as const;
const store = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), dump: () => Object.fromEntries(m) };
};

// ================================================================ 1. architecture: one design system, many palettes

const STRUCTURAL = /^--(r-|fs-|sp-|hdr-|lnav|ui-|h1-|th-|w-btn|font|control-h|topbar|bar-h|sub-h|shadow-[123]$|search-|disabled-|invalid-|label-|ctl-|viz-(surface|ink|grid|axis))/;
const allowedKeys = new Set<string>([...Object.keys(varsFor(PRESETS[0].light)), ...EXTRA_KEYS]);

describe('D21.1 universal design system: the structure is the same for every palette', () => {
  it('the Signature structure is the stylesheet default: header 62px (60 on a phone), 46px navigation with icons, 10px controls, 16px cards, 20px dialogs, Inter first, 600 buttons, capital table headings', () => {
    const t = decls(rootBlock(tokens));
    expect([t['--hdr-h'], t['--hdr-h-touch'], t['--hdr-h-phone'], t['--hdr-ctl-h']]).toEqual(['62px', '62px', '60px', '40px']);
    expect([t['--lnav-h'], t['--ui-lnav-ic'], t['--ui-brand'], t['--ui-modall'], t['--ui-kbd']]).toEqual(['46px', 'inline-flex', 'flex', 'inline', 'inline-block']);
    expect([t['--r-md'], t['--r-lg'], t['--r-modal'], t['--fs-md']]).toEqual(['10px', '16px', '20px', '1rem']);
    expect([t['--w-btn'], t['--h1-weight'], t['--h1-ls'], t['--th-tt'], t['--th-ls']]).toEqual(['600', '700', '-0.03em', 'uppercase', '0.04em']);
    expect(t['--font-sans']).toMatch(/^Inter, system-ui/);
    expect([t['--ui-eyebrow'], t['--ui-glyph'], t['--ui-glyph-legacy']]).toEqual(['block', 'inline-block', 'none']);
  });

  it('no palette, and no custom palette, sets any size, corner, type, header, navigation, table, shadow-shape or layout variable: only colors', () => {
    const custom = (c: Colors, dark: boolean) => ({ ...varsFor(c), ...deriveExtras(c, dark) });
    const sets: [string, Record<string, string>][] = [];
    for (const p of PRESETS) for (const m of modes) sets.push([`${p.id} ${m}`, varsOf({ id: p.id }, m === 'dark')]);
    for (const m of modes) for (const f of [CLASSIC, ...LEGACY_PRESETS]) sets.push([`custom ${m}`, custom(f[m], m === 'dark')]);
    for (const [name, vars] of sets) {
      for (const k of Object.keys(vars)) {
        expect(STRUCTURAL.test(k), `${name} sets ${k}`).toBe(false);
        expect(allowedKeys.has(k), `${name} sets ${k}, which is not on the list of palette variables`).toBe(true);
      }
    }
  });

  it('nothing in the application keys off a palette\'s identity: no selector, no comparison, no data attribute (only palette.ts and the Appearance page name palettes)', () => {
    const ids = [...PRESETS.map((p) => p.id), ...Object.keys(LEGACY_PALETTE_MAP)];
    const offenders: string[] = [];
    for (const f of appFiles()) {
      if (f === 'src/palette.ts' || f === 'src/pages/AppearanceCard.tsx') continue;
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/data-palette|data-preset|palette-(navy|slate|evergreen|stone|plum)/.test(text)) offenders.push(`${f}: palette attribute or class`);
      for (const id of ids) if (new RegExp(`['"\`]${id}['"\`]`).test(text) && /palette|choice/i.test(text)) offenders.push(`${f}: names '${id}'`);
    }
    expect(offenders).toEqual([]);
  });

  it('the old Classic look is gone: no code path, class or token exists to draw it (the legacy glyph and thin-bar tokens only keep their Signature value)', () => {
    expect(read('src/palette.ts')).not.toMatch(/export const CLASSIC|colorsOf.*classic|'classic'.*\bnull\b/);
    expect(base).not.toMatch(/#1a5fd0|#1f6feb|#12151a/i); // Classic's blue and dark grey
    expect(read('src/styles.css')).not.toMatch(/--accent: #1a5fd0/i);
  });

  it('the default colors file carries every palette variable, in all three scopes, and the two dark scopes are identical', () => {
    const light = decls(rootBlock(base));
    const a = decls(mediaDark(base));
    const b = decls(forcedDark(base));
    expect(Object.keys(b).length).toBeGreaterThan(40);
    expect(b).toEqual(a);
    for (const k of allowedKeys) {
      expect(light[k], `light ${k}`).toBeTruthy();
      expect(b[k], `dark ${k}`).toBeTruthy();
    }
    expect(Object.keys(light).filter((k) => !allowedKeys.has(k))).toEqual([]);
  });
});

// ================================================================ 2. fidelity: Signature Navy is the approved Signature

/** The approved Ledger Signature values as they stood at D21 (commit 582ce64), written out so any later drift in Signature Navy is caught. */
const PRIOR = {
  light: { '--page': '#EEF1F6', '--surface': '#FFFFFF', '--bg': '#FFFFFF', '--card': '#FFFFFF', '--fg': '#101B33', '--muted': '#566379', '--line': '#DFE5EE', '--accent': '#267880', '--pos': '#23694F', '--neg': '#B0443B', '--warn': '#8F5D16', '--side-bg': '#F6F8FB', '--side-fg': '#101B33', '--side-active': '#267880',
    '--surface-raised': '#FFFFFF', '--surface-soft': '#F6F8FB', '--surface-sunken': '#EEF2F8', '--fg-2': '#37445B', '--control-line': '#7A879F', '--btn-bg': '#0E1A33', '--btn-ink': '#FFFFFF', '--info': '#3B6BA3', '--info-soft': '#E6EEF8',
    '--field-bg': '#FFFFFF', '--btn-bg-hover': '#1C2D52', '--scrim': 'rgba(11, 18, 32, 0.55)', '--toast-bg': '#0E1A33', '--toast-ink': '#FFFFFF',
    '--viz-s1': '#1D3A6B', '--viz-s2': '#267880', '--viz-s3': '#A8730F', '--viz-s4': '#8391AA', '--hero-bg': '#0E1A33', '--chart-spend': '#1D3A6B',
    '--viz-c1': '#1D3A6B', '--viz-c2': '#267880', '--viz-c3': '#5FAAB2', '--viz-c4': '#8391AA', '--viz-c5': '#A8730F', '--viz-c6': '#B3BDCF',
    '--hero-ink': '#FFFFFF', '--hero-ink-2': '#B6C3DB', '--hero-line': 'rgba(255, 255, 255, 0.16)', '--hero-pos': '#8EE0B8', '--hero-neg': '#FFB3AB',
    '--viz-hc1': '#8FB0E6', '--viz-hc2': '#3A9AA4', '--viz-hc3': '#7DC8CF', '--viz-hc4': '#D0D8E6', '--viz-hc5': '#E5B865' },
  dark: { '--page': '#0B1220', '--surface': '#131D31', '--bg': '#131D31', '--card': '#131D31', '--fg': '#E9EEF7', '--muted': '#9AA8BF', '--line': '#26354F', '--accent': '#6CC0C8', '--pos': '#72CBA3', '--neg': '#F2928A', '--warn': '#E5B865', '--side-bg': '#0B1220', '--side-fg': '#E9EEF7', '--side-active': '#6CC0C8',
    '--surface-raised': '#182339', '--surface-soft': '#182339', '--surface-sunken': '#1E2B46', '--fg-2': '#C3CDDF', '--control-line': '#6F82A3', '--btn-bg': '#277A83', '--btn-ink': '#FFFFFF', '--info': '#8FB0E6', '--info-soft': '#1B2A47',
    '--field-bg': '#0E1727', '--btn-bg-hover': '#216D75', '--scrim': 'rgba(3, 7, 14, 0.7)', '--toast-bg': '#223454', '--toast-ink': '#E9EEF7', '--toast-edge': 'var(--shadow-2), inset 0 0 0 1px #3A4D72',
    '--viz-s1': '#8FB0E6', '--viz-s2': '#3A9AA4', '--viz-s3': '#E5B865', '--viz-s4': '#D0D8E6', '--hero-bg': '#1B2D52', '--chart-spend': '#8FB0E6',
    '--viz-c1': '#8FB0E6', '--viz-c2': '#3A9AA4', '--viz-c3': '#7DC8CF', '--viz-c4': '#D0D8E6', '--viz-c5': '#E5B865', '--viz-c6': '#6F82A3',
    '--hero-ink': '#FFFFFF', '--hero-ink-2': '#B6C3DB', '--hero-line': 'rgba(255, 255, 255, 0.16)', '--hero-pos': '#8EE0B8', '--hero-neg': '#FFB3AB',
    '--viz-hc1': '#8FB0E6', '--viz-hc2': '#3A9AA4', '--viz-hc3': '#7DC8CF', '--viz-hc4': '#D0D8E6', '--viz-hc5': '#E5B865' },
};

describe('D21.1 Signature Navy is the approved Signature, unchanged', () => {
  for (const m of modes) {
    it(`${m}: every value the approved Signature set (colors and extras) is exactly the same in Signature Navy`, () => {
      const v = varsOf({ id: 'signature-navy' }, m === 'dark');
      for (const [k, want] of Object.entries(PRIOR[m])) expect(v[k], `${m} ${k}`).toBe(want);
    });
    it(`${m}: the stylesheet default colors equal Signature Navy, variable by variable (so a device with nothing saved looks the same as one that chose it)`, () => {
      const css = m === 'light' ? decls(rootBlock(base)) : decls(forcedDark(base));
      const v = varsOf({ id: 'signature-navy' }, m === 'dark');
      for (const k of allowedKeys) expect(css[k]?.toLowerCase(), `${m} ${k}`).toBe(v[k].toLowerCase());
    });
  }
  it('the shadows are the approved ones, with the tint taken from the palette in light mode', () => {
    const t = decls(rootBlock(tokens));
    expect(t['--shadow-1']).toBe('0 1px 2px rgba(var(--shadow-rgb), 0.05)');
    expect(t['--shadow-2']).toBe('0 1px 2px rgba(var(--shadow-rgb), 0.04), 0 8px 24px rgba(var(--shadow-rgb), 0.06)');
    expect(t['--shadow-3']).toBe('0 2px 6px rgba(var(--shadow-rgb), 0.08), 0 24px 60px rgba(var(--shadow-rgb), 0.18)');
    expect(varsOf({ id: 'signature-navy' }, false)['--shadow-rgb']).toBe('14, 26, 51');
    expect(decls(forcedDark(tokens))['--shadow-1']).toBe('0 1px 2px rgba(0, 0, 0, 0.4)');
  });
  it('the default is Signature Navy for a device with nothing saved, and it takes no stored value to get it', () => {
    expect(DEFAULT_CHOICE.id).toBe('signature-navy');
    expect(loadPalette(store())).toEqual(DEFAULT_CHOICE);
    expect(PRESETS[0].name).toBe('Signature Navy');
  });
});

// ================================================================ 3. the five palettes

describe('D21.1 the palette collection', () => {
  it('is five palettes in the approved order, each with its approved starting colors somewhere in its set', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['Signature Navy', 'Coastal Slate', 'Evergreen', 'Warm Stone', 'Midnight Plum']);
    const start: Record<string, { canvas: string; primary: string; accent: string }> = {
      'signature-navy': { canvas: '#EEF1F6', primary: '#14263F', accent: '#287E85' },
      'coastal-slate': { canvas: '#F1F4F6', primary: '#34475A', accent: '#668999' },
      evergreen: { canvas: '#F0F4EF', primary: '#24483D', accent: '#729481' },
      'warm-stone': { canvas: '#F7F4EE', primary: '#51493F', accent: '#9F816B' },
      'midnight-plum': { canvas: '#F3F0F6', primary: '#40334E', accent: '#8D789F' },
    };
    for (const p of PRESETS) {
      expect(p.light.page!.toUpperCase(), `${p.id} canvas`).toBe(start[p.id].canvas);
      expect(p.light.surface!.toUpperCase(), `${p.id} surface`).toBe('#FFFFFF');
      // The starting primary and accent are the owner's design directions; the working values are adjusted from them for contrast. They must stay close in hue and not drift far in tone.
      const e = p.extras.light;
      const near = (a: string, b: string, maxDist: number) => { const h = (x: string): number[] => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16)); const [x, y] = [h(a), h(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) <= maxDist; };
      if (p.id !== 'signature-navy') {
        expect(near(e['--btn-bg'], start[p.id].primary, 4), `${p.id} button is the approved primary`).toBe(true);
        expect([e['--viz-s2'], e['--viz-c2'], p.light.accent, e['--viz-c1']].some((c) => near(c, start[p.id].accent, 60)), `${p.id} carries its approved accent family`).toBe(true);
      }
    }
  });

  it('the status colors are shared by all five palettes (a gain, a loss and a warning mean the same everywhere), light and dark', () => {
    for (const m of modes) {
      const ref = PRESETS[0][m];
      for (const p of PRESETS) {
        for (const k of ['pos', 'neg', 'warn'] as const) expect(p[m][k], `${p.id} ${m} ${k}`).toBe(ref[k]);
        expect(p.extras[m]['--info'], `${p.id} ${m} info`).toBe(PRESETS[0].extras[m]['--info']);
        expect([p.extras[m]['--hero-pos'], p.extras[m]['--hero-neg']]).toEqual([PRESETS[0].extras[m]['--hero-pos'], PRESETS[0].extras[m]['--hero-neg']]);
      }
    }
  });

  it('each palette is complete: all twelve colors plus canvas and card, every extra, for light and for dark, with valid values', () => {
    for (const p of PRESETS) {
      for (const m of modes) {
        for (const [k, v] of Object.entries(p[m])) expect(v, `${p.id} ${m} ${k}`).toMatch(HEXRE);
        expect(Object.keys(p.extras[m]).sort(), `${p.id} ${m}`).toEqual([...EXTRA_KEYS].sort());
        for (const [k, v] of Object.entries(p.extras[m])) {
          if (/^--(surface|fg|control|field|btn-(bg|ink)|info|viz|hero-(bg|ink|pos|neg)|toast-(bg|ink)|chart)/.test(k)) expect(v, `${p.id} ${m} ${k}`).toMatch(HEXRE);
        }
      }
      expect(p.light.page, p.id).not.toBe(p.dark.page);
      expect(p.light.surface, p.id).not.toBe(p.dark.surface);
    }
  });

  it('the five palettes are distinct from each other in their canvas, primary button and accent', () => {
    for (const m of modes) {
      for (const field of [(p: (typeof PRESETS)[number]) => p[m].page, (p: (typeof PRESETS)[number]) => p.extras[m]['--btn-bg'], (p: (typeof PRESETS)[number]) => p[m].accent]) {
        expect(new Set(PRESETS.map((p) => field(p)!.toLowerCase())).size).toBe(5);
      }
    }
  });

  for (const p of PRESETS) {
    for (const m of modes) {
      const c = p[m];
      const e = p.extras[m];
      const page = c.page!;
      const surface = c.surface!;
      const dark = m === 'dark';
      const label = `${p.name} ${m}`;
      const grounds: Record<string, string> = { page, surface, raised: e['--surface-raised'], soft: e['--surface-soft'], sunken: e['--surface-sunken'] };

      it(`${label}: main, secondary and quiet text read on every surface (4.5:1), and in a field`, () => {
        const low: string[] = [];
        for (const [g, bg] of Object.entries(grounds)) for (const [t, fg] of [['text', c.fg], ['secondary', e['--fg-2']], ['quiet', c.muted]] as const) if (contrastRatio(fg, bg) < 4.5) low.push(`${t} on ${g}: ${contrastRatio(fg, bg).toFixed(2)}`);
        for (const [t, fg] of [['text', c.fg], ['placeholder', c.muted]] as const) if (contrastRatio(fg, e['--field-bg']) < 4.5) low.push(`${t} in a field: ${contrastRatio(fg, e['--field-bg']).toFixed(2)}`);
        expect(low).toEqual([]);
      });

      it(`${label}: links, good, bad, warning and information read as text on the page and on cards (4.5:1)`, () => {
        const low: string[] = [];
        for (const [g, bg] of Object.entries({ page, surface })) for (const [t, fg] of [['link', c.accent], ['good', c.pos], ['bad', c.neg], ['warning', c.warn], ['info', e['--info']]] as const) if (contrastRatio(fg, bg) < 4.5) low.push(`${t} on ${g}: ${contrastRatio(fg, bg).toFixed(2)}`);
        expect(low).toEqual([]);
      });

      it(`${label}: the text tone on a color's own tint reads (accent, good, bad, warning), and information on its soft fill`, () => {
        const low: string[] = [];
        const tint = { accent: 0.12, warn: 0.14, pos: 0.13, neg: 0.13 } as const;
        for (const [g, bg] of Object.entries({ page, surface })) for (const k of ['accent', 'warn', 'pos', 'neg'] as const) {
          const r = contrastRatio(mixHex(c[k], c.fg, 0.22), mixHex(bg, c[k], tint[k]));
          if (r < 4.5) low.push(`${k} text on its tint over ${g}: ${r.toFixed(2)}`);
        }
        expect(low).toEqual([]);
        expect(contrastRatio(e['--info'], e['--info-soft'])).toBeGreaterThanOrEqual(4.5);
      });

      it(`${label}: the filled button and its hover read (4.5:1), the toast reads (7:1), the menu bar text reads and its highlight stands out`, () => {
        expect(contrastRatio(e['--btn-ink'], e['--btn-bg'])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(e['--btn-ink'], e['--btn-bg-hover'])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(e['--toast-ink'], e['--toast-bg'])).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(c.sideFg, c.sideBg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.sideActive, c.sideBg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastNotes(c)).toEqual([]);
      });

      it(`${label}: the control border stands out from the page, cards, soft fill and field (3:1), and the hairline stays quiet`, () => {
        for (const [g, bg] of Object.entries({ page, surface, soft: e['--surface-soft'], field: e['--field-bg'] })) expect(contrastRatio(e['--control-line'], bg), `border on ${g}`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(c.line, surface)).toBeGreaterThan(1.05);
        expect(contrastRatio(c.line, surface)).toBeLessThan(3);
      });

      it(`${label}: keyboard focus is visible (the accent is 3:1 against the page and cards, and the focus ring tints it)`, () => {
        expect(contrastRatio(c.accent, page)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(c.accent, surface)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(c.accent, e['--field-bg'])).toBeGreaterThanOrEqual(3);
      });

      it(`${label}: the dark Home panel reads (text 7:1, quiet text, good and bad figures 4.5:1) and its chart ramp stands out from it (3:1)`, () => {
        expect(contrastRatio(e['--hero-ink'], e['--hero-bg'])).toBeGreaterThanOrEqual(7);
        for (const k of ['--hero-ink-2', '--hero-pos', '--hero-neg'] as const) expect(contrastRatio(e[k], e['--hero-bg']), k).toBeGreaterThanOrEqual(4.5);
        for (const k of ['--viz-hc1', '--viz-hc2', '--viz-hc3', '--viz-hc4', '--viz-hc5'] as const) expect(contrastRatio(e[k], e['--hero-bg']), k).toBeGreaterThanOrEqual(3);
      });

      it(`${label}: chart series 1 to 4 are 3:1 marks on the card and any two are told apart (lightness or hue)`, () => {
        const four = [e['--viz-s1'], e['--viz-s2'], e['--viz-s3'], e['--viz-s4']];
        for (const s of four) expect(contrastRatio(s, surface), s).toBeGreaterThanOrEqual(3);
        const rgb = (x: string): number[] => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
        for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
          const [a, b] = [rgb(four[i]), rgb(four[j])];
          expect(contrastRatio(four[i], four[j]) >= 1.5 || Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= 100, `series ${i + 1} and ${j + 1}`).toBe(true);
        }
        expect(dark ? contrastRatio(four[0], page) : contrastRatio(four[0], page)).toBeGreaterThanOrEqual(3);
      });

      it(`${label}: Family colors read as a dot (3:1) and as monogram text (4.5:1) on the card (the eight stored values never change)`, () => {
        const css = decls(dark ? forcedDark(tokens) : rootBlock(tokens));
        const low: string[] = [];
        for (const f of COLORS) {
          const col = css[`--mc-${f.name.toLowerCase()}`];
          if (contrastRatio(col, surface) < 3) low.push(`${f.name} dot: ${contrastRatio(col, surface).toFixed(2)}`);
          const monogram = contrastRatio(mixHex(col, c.fg, 0.42), mixHex(surface, col, 0.16)); // text: 58% of the member color in the text color; tile: 16% of it in the card
          if (monogram < 4.5) low.push(`${f.name} monogram text: ${monogram.toFixed(2)}`);
        }
        expect(low).toEqual([]);
      });
    }
  }

  it('the eight Family identity colors are unchanged and identical for every palette (they are not palette variables)', () => {
    expect(COLORS.map((c) => c.value)).toEqual(['#4a7bd0', '#2f8f6b', '#c0562f', '#8a5cc7', '#c4398a', '#b8860b', '#2a9fb0', '#6b7280']);
    for (const p of PRESETS) for (const m of modes) for (const k of Object.keys(p.extras[m])) expect(k.startsWith('--mc-'), `${p.id} ${k}`).toBe(false);
    for (const k of Object.keys(varsFor(PRESETS[0].light))) expect(k.startsWith('--mc-')).toBe(false);
  });
});

// ================================================================ 4. custom themes: the adapter

describe('D21.1 custom themes keep working: twelve stored colors, everything else derived', () => {
  const fixtures: [string, { light: Colors; dark: Colors }][] = [
    ['Classic', CLASSIC],
    ...LEGACY_PRESETS.map((p) => [p.name, { light: p.light, dark: p.dark }] as [string, { light: Colors; dark: Colors }]),
    ...PRESETS.map((p) => [`${p.name} as custom colors`, { light: withoutOptional(p.light), dark: withoutOptional(p.dark) }] as [string, { light: Colors; dark: Colors }]),
  ];

  for (const [name, f] of fixtures) {
    for (const m of modes) {
      const c = f[m];
      const e = deriveExtras(c, m === 'dark');
      it(`${name} ${m}: the adapter sets every palette variable (so no earlier palette can show through), all valid`, () => {
        expect(Object.keys(e).sort()).toEqual([...EXTRA_KEYS].sort());
        for (const k of ['--surface-raised', '--surface-soft', '--surface-sunken', '--fg-2', '--control-line', '--field-bg', '--btn-bg', '--btn-bg-hover', '--btn-ink', '--info', '--info-soft', '--toast-bg', '--toast-ink', '--hero-bg', '--hero-ink', '--hero-ink-2', '--hero-pos', '--hero-neg', '--viz-s1', '--viz-c1', '--viz-hc1', '--chart-spend'] as const) expect(e[k], k).toMatch(HEXRE);
        expect(deriveExtras(c, m === 'dark')).toEqual(e); // deterministic
      });
      it(`${name} ${m}: the derived roles read (buttons 4.5:1, the Home panel 7:1 with readable quiet text and figures, toast 7:1)`, () => {
        expect(contrastRatio(e['--btn-ink'], e['--btn-bg'])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(e['--toast-ink'], e['--toast-bg'])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(e['--hero-ink'], e['--hero-bg'])).toBeGreaterThanOrEqual(7);
        for (const k of ['--hero-ink-2', '--hero-pos', '--hero-neg'] as const) expect(contrastRatio(e[k], e['--hero-bg']), k).toBeGreaterThanOrEqual(4.5);
        // Stored themes get the chart colors the app has always used (the fixed, validated set in src/styles.css), so a theme made before D21.1 draws the same charts.
        expect([e['--viz-s1'], e['--viz-s2'], e['--viz-s3'], e['--viz-s4']]).toEqual(m === 'dark' ? ['#3987E5', '#D95926', '#199E70', '#C98500'] : ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100']);
      });
    }
  }

  it('the adapter does not change what is stored: a custom choice round-trips its twelve colors exactly, and the derived roles are never written back', () => {
    const s = store();
    for (const [, f] of fixtures) {
      savePalette({ id: 'custom', custom: f, savedId: 'tX' }, s);
      const back = loadPalette(s);
      expect(back.custom).toEqual(f);
      expect(back.savedId).toBe('tX');
      expect(Object.keys(JSON.parse(s.getItem(PALETTE_KEY)!).custom.light).sort()).toEqual(Object.keys(f.light).sort());
    }
  });

  it('an unreadable custom theme is kept as it is and the user is told in plain words which pairs fail (the readability check), never silently changed', () => {
    const bad: Colors = { ...CLASSIC.light, fg: '#EEEEEE' };
    const notes = contrastNotes(bad);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => /hard to read|barely|hard to see/.test(n.message))).toBe(true);
    expect(parseChoice({ id: 'custom', custom: { light: bad, dark: CLASSIC.dark } }).custom!.light.fg).toBe('#EEEEEE'); // stored value untouched
  });
});

// ================================================================ 5. older choices and the one-time transition

describe('D21.1 older choices: documented mapping, read safely', () => {
  it('maps every older palette id to one of the five, as documented', () => {
    expect(LEGACY_PALETTE_MAP).toEqual({ classic: 'signature-navy', signature: 'signature-navy', navy: 'signature-navy', teal: 'evergreen', forest: 'evergreen', slate: 'coastal-slate' });
    for (const to of Object.values(LEGACY_PALETTE_MAP)) expect(PRESETS.map((p) => p.id)).toContain(to);
  });
  it('reads each older id as the palette it maps to and remembers the old id in `from`', () => {
    for (const [from, to] of Object.entries(LEGACY_PALETTE_MAP)) expect(parseChoice(JSON.stringify({ id: from })), from).toEqual({ id: to, from });
    expect(loadPalette(store({ [PALETTE_KEY]: '{"id":"teal"}' }))).toEqual({ id: 'evergreen', from: 'teal' });
  });
  it('reading never writes (a stored older choice stays exactly as it was until the transition runs)', () => {
    const s = store({ [PALETTE_KEY]: '{"id":"forest"}' });
    loadPalette(s);
    expect(s.dump()).toEqual({ [PALETTE_KEY]: '{"id":"forest"}' });
  });
  it('an unknown id, a damaged value and an empty value fall back to Signature Navy', () => {
    for (const bad of ['{"id":"neon"}', 'not json', '', '{}', '[]', '{"id":42}', 'null']) expect(parseChoice(bad), bad).toEqual(DEFAULT_CHOICE);
  });
});

describe('D21.1 the one-time transition (migrateStoredPalette): deterministic, repeat-safe, nothing deleted', () => {
  const oldVars = JSON.stringify({ light: { '--page': '#FAFAF8', '--accent': '#0F766E' }, dark: { '--page': '#101614' } }); // the format of the previous version (no v)

  it('nothing saved: nothing is written and the device uses Signature Navy', () => {
    const s = store();
    expect(migrateStoredPalette(s)).toBe('none');
    expect(s.dump()).toEqual({});
  });

  it('every older preset id is replaced by the palette it maps to, with its pre-paint copy rebuilt, and the old id kept in `from`', () => {
    for (const [from, to] of Object.entries(LEGACY_PALETTE_MAP)) {
      const s = store({ [PALETTE_KEY]: JSON.stringify({ id: from }), [PALETTE_VARS_KEY]: oldVars, 'ledger-theme': 'dark', 'ledger-collapsed': 'x' });
      expect(migrateStoredPalette(s), from).toBe('migrated');
      expect(JSON.parse(s.getItem(PALETTE_KEY)!), from).toEqual({ id: to, from });
      const vars = JSON.parse(s.getItem(PALETTE_VARS_KEY)!);
      expect(vars).toEqual(resolvedVars({ id: to }));
      expect(vars.v).toBe(VARS_VERSION);
      expect(s.getItem('ledger-theme'), 'the saved Light/Dark choice is untouched').toBe('dark');
      expect(s.getItem('ledger-collapsed'), 'unrelated preferences are untouched').toBe('x');
    }
  });

  it('is idempotent: a second and third run change nothing, and report the state as current', () => {
    const s = store({ [PALETTE_KEY]: '{"id":"slate"}', [PALETTE_VARS_KEY]: oldVars });
    expect(migrateStoredPalette(s)).toBe('migrated');
    const after = s.dump();
    expect(migrateStoredPalette(s)).toBe('current');
    expect(migrateStoredPalette(s)).toBe('current');
    expect(s.dump()).toEqual(after);
    expect(loadPalette(s)).toEqual({ id: 'coastal-slate', from: 'slate' });
  });

  it('a choice that is already a current palette is left alone, but a missing or older pre-paint copy is rebuilt (for example after restoring an old backup)', () => {
    const s1 = store({ [PALETTE_KEY]: '{"id":"warm-stone"}', [PALETTE_VARS_KEY]: JSON.stringify(resolvedVars({ id: 'warm-stone' })) });
    const before = s1.dump();
    expect(migrateStoredPalette(s1)).toBe('current');
    expect(s1.dump()).toEqual(before);
    for (const stale of [undefined, oldVars, 'not json', JSON.stringify({ v: 1, light: {}, dark: {} })]) {
      const s2 = store({ [PALETTE_KEY]: '{"id":"warm-stone"}', ...(stale === undefined ? {} : { [PALETTE_VARS_KEY]: stale }) });
      expect(migrateStoredPalette(s2)).toBe('refreshed');
      expect(s2.getItem(PALETTE_KEY)).toBe('{"id":"warm-stone"}'); // the choice itself is not rewritten
      expect(JSON.parse(s2.getItem(PALETTE_VARS_KEY)!)).toEqual(resolvedVars({ id: 'warm-stone' }));
    }
  });

  it('custom colors and their saved-theme link are preserved byte for byte, even when the pre-paint copy is rebuilt', () => {
    const raw = JSON.stringify({ id: 'custom', custom: { light: CLASSIC.light, dark: CLASSIC.dark }, savedId: 'tabc' });
    const s = store({ [PALETTE_KEY]: raw, [PALETTE_VARS_KEY]: oldVars });
    expect(migrateStoredPalette(s)).toBe('refreshed');
    expect(s.getItem(PALETTE_KEY)).toBe(raw);
    expect(loadPalette(s)).toEqual({ id: 'custom', custom: { light: CLASSIC.light, dark: CLASSIC.dark }, savedId: 'tabc' });
    const v = JSON.parse(s.getItem(PALETTE_VARS_KEY)!);
    expect(v.light['--accent']).toBe(CLASSIC.light.accent);
    expect(Object.keys(v.light)).toEqual(expect.arrayContaining(['--btn-bg', '--hero-bg', '--viz-s1']));
    expect(migrateStoredPalette(s)).toBe('current');
  });

  it('a damaged value, or a choice from a newer copy of the app, is LEFT IN PLACE (never deleted) and the device simply uses Signature Navy', () => {
    for (const raw of ['not json', '{"id":"aurora"}', '{"id":"custom"}', '{"id":"custom","custom":{"light":{},"dark":{}}}', '5']) {
      const s = store({ [PALETTE_KEY]: raw, [PALETTE_VARS_KEY]: oldVars });
      expect(migrateStoredPalette(s), raw).toBe('unreadable');
      expect(s.dump(), raw).toEqual({ [PALETTE_KEY]: raw, [PALETTE_VARS_KEY]: oldVars });
      expect(loadPalette(s), raw).toEqual(DEFAULT_CHOICE);
    }
  });

  it('unavailable storage never throws', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => migrateStoredPalette(throwing)).not.toThrow();
    const readOnly = { getItem: (k: string) => (k === PALETTE_KEY ? '{"id":"teal"}' : null), setItem: () => { throw new Error('full'); }, removeItem: () => undefined };
    expect(() => migrateStoredPalette(readOnly)).not.toThrow();
  });

  it('restoring a backup made by the previous version (older id, older pre-paint copy) lands on today\'s format after the transition, and touches nothing else', () => {
    const backupPrefs = { 'ledger-theme': 'light', 'ledger-palette': '{"id":"teal"}', 'ledger-palette-vars': oldVars, 'tasks-last-view': 'week' };
    const device = store({ 'ledger-palette': '{"id":"signature"}', 'ledger-theme': 'dark' });
    applyPreferences(backupPrefs, device as never);
    expect(device.getItem(PALETTE_KEY)).toBe('{"id":"teal"}'); // restore writes the backup's values as they are
    expect(migrateStoredPalette(device)).toBe('migrated');
    expect(loadPalette(device)).toEqual({ id: 'evergreen', from: 'teal' });
    expect(device.getItem('ledger-theme')).toBe('light');
    expect(device.getItem('tasks-last-view')).toBe('week');
  });

  it('a backup made today restores unchanged and is already current', () => {
    const here = store();
    savePalette({ id: 'midnight-plum' }, here);
    const prefs = { 'ledger-palette': here.getItem(PALETTE_KEY)!, 'ledger-palette-vars': here.getItem(PALETTE_VARS_KEY)! };
    const there = store();
    applyPreferences(prefs, there as never);
    expect(there.dump()).toEqual(here.dump());
    expect(migrateStoredPalette(there)).toBe('current');
  });

  it('the transition never touches the database: it only reads and writes the two palette keys (a source check)', () => {
    const src = read('src/palette.ts');
    const body = src.slice(src.indexOf('export function migrateStoredPalette'), src.indexOf('/** Every variable any palette can set'));
    expect(body).not.toMatch(/\bdb\b|indexedDB|Dexie|settings\.put|localStorage\.(clear|removeItem)/);
    expect(body).not.toMatch(/removeItem/);
    expect([...body.matchAll(/s\.setItem\(([A-Z_]+)/g)].map((m) => m[1]).sort()).toEqual(['PALETTE_VARS_KEY']);
  });
});

// ================================================================ 6. applying a palette to the page

describe('D21.1 applying a palette: every palette sets the same variables, so switching leaves nothing behind and moves no layout', () => {
  const g = globalThis as unknown as { document?: unknown };
  afterEach(() => { delete g.document; });
  function fakePage() {
    const props = new Map<string, string>();
    const meta = { content: '', setAttribute(_n: string, v: string) { this.content = v; } };
    g.document = { documentElement: { style: { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) } }, querySelectorAll: () => [meta] };
    return { props, meta };
  }
  const keysOf = (props: Map<string, string>) => [...props.keys()].sort();

  it('each palette sets exactly the same set of variables in light and dark, and the browser-bar color is its canvas', () => {
    const { props, meta } = fakePage();
    const ref = new Set<string>();
    for (const p of PRESETS) for (const m of modes) {
      applyPalette({ id: p.id }, m === 'dark');
      if (ref.size === 0) keysOf(props).forEach((k) => ref.add(k));
      expect(keysOf(props), `${p.id} ${m}`).toEqual([...ref].sort());
      expect(meta.content).toBe(p[m].page);
      expect(props.get('--accent')).toBe(p[m].accent);
    }
    expect(ref.size).toBeGreaterThanOrEqual(55);
  });

  it('switching between palettes, and to custom colors and back, leaves no variable of the earlier one behind', () => {
    const { props } = fakePage();
    applyPalette({ id: 'evergreen' }, false);
    const evergreen = keysOf(props);
    applyPalette({ id: 'custom', custom: CLASSIC }, false);
    expect(keysOf(props)).toEqual(evergreen);
    expect(props.get('--accent')).toBe(CLASSIC.light.accent);
    expect(props.get('--btn-bg')).toBe(CLASSIC.light.accent); // derived, not Evergreen's
    applyPalette({ id: 'warm-stone' }, true);
    expect(keysOf(props)).toEqual(evergreen);
    expect(props.get('--btn-bg')).toBe(PRESETS[3].extras.dark['--btn-bg']);
  });

  it('only palette variables are ever written to the page (no size, layout or other app variable)', () => {
    const { props } = fakePage();
    for (const choice of [{ id: 'coastal-slate' }, { id: 'custom', custom: CLASSIC }] as PaletteChoice[]) for (const m of modes) {
      applyPalette(choice, m === 'dark');
      for (const k of props.keys()) expect(allowedKeys.has(k), k).toBe(true);
    }
  });

  it('choosing a palette is an appearance-only action: the Appearance page writes the palette keys and the theme only, never the database records or other preferences (source check)', () => {
    const page = read('src/pages/AppearanceCard.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    const writes = [...page.matchAll(/db\.([a-zA-Z]+)\.(put|add|delete|update|bulk[A-Za-z]*)/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(writes).toEqual(['settings.put']); // the saved-themes list only (key 'savedThemes'), as before
    expect(page).toMatch(/db\.settings\.put\(\{ key: 'savedThemes'/);
    expect(page).not.toMatch(/localStorage|sessionStorage/);
    expect(read('src/theme.ts')).not.toMatch(/\bdb\b|settings\.put/);
  });
});

describe('D21.1 Settings > Appearance reflects one interface with five palettes', () => {
  const page = read('src/pages/AppearanceCard.tsx');
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('lists the five palettes from the palette code, plus saved themes and My own colors, and no Classic or Signature-versus-Classic choice', () => {
    expect(page).toContain('PRESETS.map');
    expect(code).not.toMatch(/Classic|classic|CLASSIC|\(preview\)|Ledger Signature|Calm teal|Deep navy|Forest green|Slate and indigo/);
    expect(page).toMatch(/My own colors/);
    expect(page).toContain('aria-label="Color palette"');
    expect(page).toContain('aria-label="My saved themes"');
    expect(page).toContain('aria-label="Appearance mode"');
  });
  it('offers Light, Dark and Device as three radio buttons, applied and saved through the theme code', () => {
    expect(page).toMatch(/\['light', 'dark'|id: 'light'[\s\S]*id: 'dark'[\s\S]*id: 'device'/);
    expect(page).toMatch(/saveTheme\(t\); applyTheme\(t\)/);
  });
  it('keeps the customization tools: the color map, the readability check, a preview, saving, renaming, deleting with its confirmation, theme codes, and the guarded "start over"', () => {
    for (const s of ['COLOR_ROLES.map', 'contrastNotes(current)', 'Readability check', 'Preview (', 'Save as new theme', 'openName(\'rename\')', 'setAskDelete(active.id)', 'Delete saved theme?', 'copy theme code', 'Add a theme from a code', 'Replace your colors?', 'removeStoredTheme(db, target.id)']) expect(page, s).toContain(s);
  });
  it('draws its previews from the palette variables of the interface (the adapter for custom colors), not from separate dot colors', () => {
    expect(page).toContain('customVars(current, editing === \'dark\')');
    expect(page).toContain('varsOf(c, false)');
    expect(page).not.toMatch(/swatches/);
  });
  it('a stored theme\'s colors reach the picture through the same adapter that the page uses', () => {
    const t = { light: CLASSIC.light, dark: CLASSIC.dark };
    expect(extrasOf({ id: 'custom', custom: t }, false)).toEqual(deriveExtras(CLASSIC.light, false));
    expect(colorsOf({ id: 'custom', custom: t }, true)).toEqual(CLASSIC.dark);
  });
});
