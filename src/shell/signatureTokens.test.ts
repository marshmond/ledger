import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLORS } from '../modules/family/model';
import { PRESETS, contrastRatio, parseChoice, varsFor, loadPalette } from '../palette';

/**
 * D5. Guards for the Ledger Signature foundation: the preset's values are valid and readable in light and dark, the dark values in the
 * stylesheets cannot drift apart, the new tokens are harmless aliases for every older palette, and the preference storage format is unchanged.
 * Every colour here is a design value, no personal data.
 */

const read = (f: string) => readFileSync(f, 'utf8');
const tokens = read('src/ui/tokens.css');
const SIG = PRESETS.find((p) => p.id === 'signature-navy')!;

// ---------- reading the stylesheets ----------

/** The `--name: value;` lines of a block body. */
const decls = (body: string) => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const mediaDark = (css: string) => css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
const forcedDark = (css: string) => css.match(/^:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/m)?.[1] ?? '';
const rootBlock = (css: string) => css.match(/^:root \{([\s\S]*?)\n\}/m)?.[1] ?? '';

// ---------- colour helpers (same maths as the stylesheet's color-mix in srgb) ----------

const hex = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: string, b: string, pctOfA: number) => `#${hex(a).map((v, i) => Math.round(v * pctOfA + hex(b)[i] * (1 - pctOfA)).toString(16).padStart(2, '0')).join('')}`;
const HEXRE = /^#[0-9a-f]{6}$/i;

describe('D5 the Signature Navy palette is a valid, readable palette', () => {
  it('is the first palette and the default (D21.1): nothing stored means Signature Navy', () => {
    expect(SIG.name).toBe('Signature Navy');
    expect(PRESETS[0].id).toBe('signature-navy');
    expect(parseChoice(null)).toEqual({ id: 'signature-navy' });
    expect(loadPalette({ getItem: () => null, setItem: () => {}, removeItem: () => {} })).toEqual({ id: 'signature-navy' });
  });

  for (const mode of ['light', 'dark'] as const) {
    it(`${mode}: every colour, including the two optional roles, is a six-digit hex`, () => {
      for (const [k, v] of Object.entries(SIG[mode])) expect(v, `${mode}.${k}`).toMatch(HEXRE);
      expect(SIG[mode].page).toBeTruthy();
      expect(SIG[mode].surface).toBeTruthy();
    });
  }

  it('light and dark define the same keys, and the extra variables are valid in both', () => {
    expect(Object.keys(SIG.light).sort()).toEqual(Object.keys(SIG.dark).sort());
    const l = SIG.extras.light;
    const d = SIG.extras.dark;
    expect(Object.keys(l).sort()).toEqual(Object.keys(d).sort());
    for (const [k, v] of Object.entries({ ...l, ...d })) {
      expect(k).toMatch(/^--[a-z0-9-]+$/);
      if (/^--(surface|fg|control|btn|info)/.test(k)) expect(v, k).toMatch(HEXRE);
    }
  });

  it('every extra variable is declared in the default colors (src/ui/palette-base.css), so none is a typo', () => {
    const known = new Set(Object.keys(decls(rootBlock(read('src/ui/palette-base.css')))));
    for (const k of Object.keys(SIG.extras.light)) expect(known.has(k), `${k} is not declared in src/ui/palette-base.css`).toBe(true);
  });

  it('the eight Signature variables the design names exist: page, surface, raised, soft, sunken, secondary text, control border, primary button, info', () => {
    const v = varsFor(SIG.light);
    expect(v['--page']).toBe('#EEF1F6');
    expect(v['--surface']).toBe('#FFFFFF');
    const e = SIG.extras.light;
    for (const k of ['--surface-raised', '--surface-soft', '--surface-sunken', '--fg-2', '--control-line', '--btn-bg', '--btn-ink', '--info', '--info-soft']) expect(e[k], k).toMatch(HEXRE);
  });
});

describe('D5 contrast of the Signature tokens (WCAG: 4.5 for text, 3 for borders and icons), light and dark', () => {
  for (const mode of ['light', 'dark'] as const) {
    const c = SIG[mode];
    const e = SIG.extras[mode];
    const page = c.page!;
    const surface = c.surface!;
    const grounds: Record<string, string> = { page, surface, 'raised surface': e['--surface-raised'], 'soft surface': e['--surface-soft'], 'sunken surface': e['--surface-sunken'] };

    it(`${mode}: main, secondary and quiet text read on every surface`, () => {
      const low: string[] = [];
      for (const [gname, g] of Object.entries(grounds)) {
        for (const [tname, t] of [['text', c.fg], ['secondary text', e['--fg-2']], ['quiet text', c.muted]] as const) {
          const r = contrastRatio(t, g);
          if (r < 4.5) low.push(`${tname} on ${gname}: ${r.toFixed(2)}`);
        }
      }
      expect(low).toEqual([]);
    });

    it(`${mode}: links, status colours and informational colour read as text on the page and on cards`, () => {
      const low: string[] = [];
      for (const [gname, g] of Object.entries({ page, surface })) {
        for (const [tname, t] of [['accent', c.accent], ['good', c.pos], ['bad', c.neg], ['warning', c.warn], ['info', e['--info']]] as const) {
          const r = contrastRatio(t, g);
          if (r < 4.5) low.push(`${tname} on ${gname}: ${r.toFixed(2)}`);
        }
      }
      expect(low).toEqual([]);
    });

    it(`${mode}: the text tone on a colour's own tint reads (accent, good, bad, warning), on the page and on cards`, () => {
      const tint = { accent: 0.12, warn: 0.14, pos: 0.13, neg: 0.13 } as const;
      const low: string[] = [];
      for (const [gname, g] of Object.entries({ page, surface })) {
        for (const k of ['accent', 'warn', 'pos', 'neg'] as const) {
          const r = contrastRatio(mix(c[k], c.fg, 0.78), mix(c[k], g, tint[k]));
          if (r < 4.5) low.push(`${k} text on its tint over ${gname}: ${r.toFixed(2)}`);
        }
      }
      expect(low).toEqual([]);
      expect(contrastRatio(e['--info'], e['--info-soft']), 'info on its soft fill').toBeGreaterThanOrEqual(4.5);
    });

    it(`${mode}: the filled primary button's text reads on it`, () => {
      expect(contrastRatio(e['--btn-ink'], e['--btn-bg'])).toBeGreaterThanOrEqual(4.5);
    });

    it(`${mode}: the control border stands out from the page, cards and the soft fill (3:1)`, () => {
      const low: string[] = [];
      for (const [gname, g] of Object.entries({ page, surface, 'soft surface': e['--surface-soft'] })) {
        const r = contrastRatio(e['--control-line'], g);
        if (r < 3) low.push(`control border on ${gname}: ${r.toFixed(2)}`);
      }
      expect(low).toEqual([]);
    });

    it(`${mode}: the hairline is a quiet divider (visible but not a control border), and the page differs from cards`, () => {
      expect(contrastRatio(c.line, surface)).toBeGreaterThan(1.05);
      expect(contrastRatio(c.line, surface)).toBeLessThan(3);
      expect(page.toLowerCase()).not.toBe(surface.toLowerCase());
    });
  }
});

describe('D5 Family colours: presentation tokens only, nothing stored changes', () => {
  const lightRoot = decls(rootBlock(tokens));
  const darkForced = decls(forcedDark(tokens));
  const idOf = (name: string) => name.toLowerCase();

  it('each of the eight approved stored values has a --mc-<id> token with exactly that value (light)', () => {
    expect(COLORS).toHaveLength(8);
    for (const c of COLORS) expect(lightRoot[`--mc-${idOf(c.name)}`], c.name).toBe(c.value);
  });
  it('each has a dark variant, and there are no extra member tokens', () => {
    const ids = COLORS.map((c) => `--mc-${idOf(c.name)}`);
    expect(Object.keys(darkForced).filter((k) => k.startsWith('--mc-')).sort()).toEqual([...ids].sort());
    expect(Object.keys(lightRoot).filter((k) => /^--mc-(?!ink|tint)/.test(k)).sort()).toEqual([...ids].sort());
  });
  it('the approved stored values themselves are unchanged (this phase touched no Family model or stored colour)', () => {
    expect(COLORS.map((c) => c.value)).toEqual(['#4a7bd0', '#2f8f6b', '#c0562f', '#8a5cc7', '#c4398a', '#b8860b', '#2a9fb0', '#6b7280']);
  });
  it('member colours read as an icon or dot (3:1) on the Signature surfaces, light and dark, and the monogram text reads (4.5:1)', () => {
    const low: string[] = [];
    for (const mode of ['light', 'dark'] as const) {
      const surface = SIG[mode].surface!;
      const fg = SIG[mode].fg;
      const values = mode === 'light' ? lightRoot : darkForced;
      for (const c of COLORS) {
        const col = values[`--mc-${idOf(c.name)}`];
        const dot = contrastRatio(col, surface);
        if (dot < 3) low.push(`${c.name} ${mode} as a dot on surface: ${dot.toFixed(2)}`);
        const tile = mix(col, surface, 0.16);
        const text = contrastRatio(mix(col, fg, 0.58), tile);
        if (text < 4.5) low.push(`${c.name} ${mode} monogram text: ${text.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });
  it('the monogram mix percentages in the file are the ones measured above', () => {
    expect(lightRoot['--mc-ink-mix']).toBe('58%');
    expect(lightRoot['--mc-tint-mix']).toBe('16%');
  });
  it('the Calendar layer colour and Family layer colour are untouched by this phase', () => {
    const cal = read('src/modules/calendar/model.ts');
    expect(cal).toContain('#c4398a'); // FAMILY_LAYER_COLOR
    for (const c of COLORS) expect(cal.toLowerCase()).toContain(c.value);
  });
});

describe('D5 dark values cannot drift: the "follow the device" block equals the "forced dark" block', () => {
  for (const [name, css] of [['src/ui/tokens.css', tokens], ['src/ui/palette-base.css', read('src/ui/palette-base.css')]] as const) {
    it(`${name} defines the same dark variables with the same values in both scopes`, () => {
      const a = decls(mediaDark(css));
      const b = decls(forcedDark(css));
      expect(Object.keys(a).length, 'the media-query block was read').toBeGreaterThan(5);
      expect(b).toEqual(a);
    });
  }
  it('Signature light and dark extras differ only where they should (no light value left in dark)', () => {
    const l = SIG.extras.light;
    const d = SIG.extras.dark;
    for (const k of ['--surface-raised', '--surface-soft', '--surface-sunken', '--fg-2', '--control-line', '--info', '--info-soft']) expect(l[k], k).not.toBe(d[k]);
    expect(SIG.light.page).not.toBe(SIG.dark.page);
    expect(SIG.light.surface).not.toBe(SIG.dark.surface);
  });
});

/*
 * D21.1 SUPERSEDED RULES (documented per the phase brief; nothing was relaxed to pass):
 *  - "D5 older palettes are protected: the new tokens are aliases of what they already had" pinned the Classic defaults (8px radii, 14px --r-lg, 36px header, system font,
 *    --fs-md undefined, Classic stays "no overrides"). The approved requirement is now that Ledger Signature IS the interface for every palette. Replacement guards:
 *    src/shell/d211Palettes.test.ts ("universal design system": the Signature structure is the default in tokens.css, no palette sets structure, the default colors equal Signature Navy).
 *  - "D5 preferences: the storage format is unchanged" and the apply/clear tests pinned Classic as the default and the four older presets. Replacement guards:
 *    src/shell/d211Palettes.test.ts ("older choices", "migration") and src/shell/d21Appearance.test.ts (storage, backup and restore under the new model).
 */

describe('D5 fonts: a fallback stack only, no font file, no change to the security policy or service worker', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  it('no stylesheet loads a font (no @font-face, no font URL) and the page links no web font', () => {
    for (const f of walk('src').filter((x) => x.endsWith('.css'))) {
      const css = read(f);
      expect(css, f).not.toMatch(/@font-face/);
      expect(css, f).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
    expect(read('index.html')).not.toMatch(/fonts\.(googleapis|gstatic)\.com|\.woff2?/);
  });
  it('no font file is shipped in public/ or src/', () => {
    const files = [...walk('src'), ...walk('public')];
    expect(files.filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f))).toEqual([]);
  });
  it('the content security policy still allows fonts only from the app itself or inline data', () => {
    expect(read('src/shell/csp.ts')).toMatch(/font-src 'self' data:/);
  });
});
