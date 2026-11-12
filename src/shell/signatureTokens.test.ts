import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { COLORS } from '../modules/family/model';
import { CLASSIC, PRESETS, applyPalette, contrastRatio, extrasOf, isHex, loadPalette, onColor, parseChoice, resolvedVars, savePalette, varsFor, withoutOptional, type PaletteChoice } from '../palette';
import { applyPreferences, collectPreferences } from '../lib/backupFile';
import { decodeTheme, encodeTheme } from '../lib/savedThemes';

/**
 * D5. Guards for the Ledger Signature foundation: the preset's values are valid and readable in light and dark, the dark values in the
 * stylesheets cannot drift apart, the new tokens are harmless aliases for every older palette, and the preference storage format is unchanged.
 * Every colour here is a design value, no personal data.
 */

const read = (f: string) => readFileSync(f, 'utf8');
const tokens = read('src/ui/tokens.css');
const styles = read('src/styles.css');
const SIG = PRESETS.find((p) => p.id === 'signature')!;

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

describe('D5 the Signature preset is a valid, readable palette', () => {
  it('is the fifth preset, opt-in (never the default), and labelled preview', () => {
    expect(SIG.name).toBe('Ledger Signature');
    expect(SIG.preview).toBe(true);
    expect(parseChoice(null)).toEqual({ id: 'classic' }); // nothing stored = Classic, as before
    expect(loadPalette({ getItem: () => null, setItem: () => {}, removeItem: () => {} })).toEqual({ id: 'classic' });
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
    const l = SIG.extras!.light;
    const d = SIG.extras!.dark;
    expect(Object.keys(l).sort()).toEqual(Object.keys(d).sort());
    for (const [k, v] of Object.entries({ ...l, ...d })) {
      expect(k).toMatch(/^--[a-z0-9-]+$/);
      if (/^--(surface|fg|control|btn|info)/.test(k)) expect(v, k).toMatch(HEXRE);
    }
  });

  it('every extra variable is one the token file declares or knowingly introduces, so none is a typo', () => {
    // --fs-md is deliberately NOT in the token file (see the test on it below), so Signature is the only thing that sets it.
    // D6: the chart variables (--viz-*) are deliberately not declared either: styles.css reads each with the old chart colour as its fallback (see d6Shared.test.tsx).
    const known = new Set([...Object.keys(decls(rootBlock(tokens))), '--shadow-1', '--shadow-2', '--shadow-3', '--fs-md']);
    for (const k of Object.keys(SIG.extras!.light)) expect(known.has(k) || k.startsWith('--viz-'), `${k} is not declared in src/ui/tokens.css`).toBe(true);
  });

  it('the eight Signature variables the design names exist: page, surface, raised, soft, sunken, secondary text, control border, primary button, info', () => {
    const v = varsFor(SIG.light);
    expect(v['--page']).toBe('#EEF1F6');
    expect(v['--surface']).toBe('#FFFFFF');
    const e = SIG.extras!.light;
    for (const k of ['--surface-raised', '--surface-soft', '--surface-sunken', '--fg-2', '--control-line', '--btn-bg', '--btn-ink', '--info', '--info-soft']) expect(e[k], k).toMatch(HEXRE);
  });
});

describe('D5 contrast of the Signature tokens (WCAG: 4.5 for text, 3 for borders and icons), light and dark', () => {
  for (const mode of ['light', 'dark'] as const) {
    const c = SIG[mode];
    const e = SIG.extras![mode];
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
  for (const [name, css] of [['src/ui/tokens.css', tokens], ['src/styles.css', styles]] as const) {
    it(`${name} defines the same dark variables with the same values in both scopes`, () => {
      const a = decls(mediaDark(css));
      const b = decls(forcedDark(css));
      expect(Object.keys(a).length, 'the media-query block was read').toBeGreaterThan(5);
      expect(b).toEqual(a);
    });
  }
  it('Signature light and dark extras differ only where they should (no light value left in dark)', () => {
    const l = SIG.extras!.light;
    const d = SIG.extras!.dark;
    for (const k of ['--surface-raised', '--surface-soft', '--surface-sunken', '--fg-2', '--control-line', '--info', '--info-soft']) expect(l[k], k).not.toBe(d[k]);
    expect(SIG.light.page).not.toBe(SIG.dark.page);
    expect(SIG.light.surface).not.toBe(SIG.dark.surface);
  });
});

describe('D5 older palettes are protected: the new tokens are aliases of what they already had', () => {
  const root = decls(rootBlock(tokens));
  it('each new token defaults to a legacy value in the token file', () => {
    expect(root['--page']).toBe('var(--bg)');
    expect(root['--surface']).toBe('var(--card)');
    expect(root['--surface-raised']).toBe('var(--bg)');
    expect(root['--control-line']).toBe('var(--line-strong)');
    expect(root['--btn-bg']).toBe('var(--accent)');
    expect(root['--btn-ink']).toBe('var(--on-accent, #fff)');
    expect(root['--info']).toBe('var(--accent)');
    expect(root['--info-soft']).toBe('var(--accent-soft)');
    expect(root['--surface-soft']).toMatch(/^color-mix\(in srgb, var\(--fg\) 4%, var\(--surface\)\)$/);
    expect(root['--surface-sunken']).toMatch(/^color-mix\(in srgb, var\(--fg\) 8%, var\(--surface\)\)$/);
    expect(root['--fg-2']).toMatch(/^color-mix\(in srgb, var\(--fg\) 78%, var\(--muted\)\)$/);
  });
  it('the font stack default is the stack the stylesheet used before (no Inter, no font file)', () => {
    expect(root['--font-sans']).toBe("system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
    expect(rootBlock(styles)).toContain('font-family: var(--font-sans)');
    expect(SIG.extras!.light['--font-sans'].startsWith('Inter, system-ui')).toBe(true);
  });
  it('--fs-md is NOT defined for everyone: eight module rules fall back to 1rem or 1.05rem, and defining it would change them', () => {
    expect(root['--fs-md']).toBeUndefined(); // D6 settled it: still not defined for everyone (the card title falls back to --fs-lg); see d6Shared.test.tsx
    expect(SIG.extras!.light['--fs-md']).toBe('1rem');
  });
  it('--r-md defaults to the 8px every existing var(--r-md, 8px) already falls back to', () => {
    expect(root['--r-md']).toBe('8px');
    const all = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(`${d}/${e.name}`) : e.name.endsWith('.css') ? [`${d}/${e.name}`] : []));
    const fallbacks = new Set<string>();
    for (const f of all('src')) for (const m of read(f).matchAll(/var\(--r-md,\s*([^)]+)\)/g)) fallbacks.add(m[1].trim());
    expect([...fallbacks]).toEqual(['8px']);
  });
  it('--fs-hero (used by .hero) and the other existing type, space and radius tokens keep their values', () => {
    expect(root['--fs-hero']).toBe('2.5rem');
    expect(root['--fs-base']).toBe('0.9375rem');
    expect(root['--r-sm']).toBe('8px');
    expect(root['--r-lg']).toBe('14px');
    expect(root['--shadow-1']).toBe('0 1px 2px rgba(16, 24, 40, 0.06)');
    expect(root['--control-h']).toBe('40px');
  });
  it('the page background still reads --page (it falls back to --bg, so it cannot change an older palette); D6 added more rules that read new tokens, and src/shell/d6Shared.test.tsx pins the old-value default of each', () => {
    expect(styles).toMatch(/body \{ margin: 0; background: var\(--page\);/);
  });

  it('a palette without the optional roles writes --page and --surface from bg and card (every older preset and Classic as a custom base)', () => {
    for (const p of PRESETS.filter((x) => x.id !== 'signature')) {
      for (const mode of ['light', 'dark'] as const) {
        const v = varsFor(p[mode]);
        expect(v['--page'], `${p.id} ${mode}`).toBe(p[mode].bg);
        expect(v['--surface'], `${p.id} ${mode}`).toBe(p[mode].card);
        expect(Object.keys(p.extras?.[mode] ?? {})).toEqual([]);
      }
    }
    for (const mode of ['light', 'dark'] as const) expect(varsFor(CLASSIC[mode])['--page']).toBe(CLASSIC[mode].bg);
  });
  it('an older preset still resolves to the same twelve colours and derived button text, plus only --page and --surface', () => {
    const teal = resolvedVars({ id: 'teal' })!;
    const legacyKeys = ['--bg', '--card', '--fg', '--muted', '--line', '--accent', '--pos', '--neg', '--warn', '--side-bg', '--side-fg', '--side-active', '--on-accent', '--on-pos', '--on-warn'];
    expect(Object.keys(teal.light).sort()).toEqual([...legacyKeys, '--page', '--surface'].sort());
    expect(teal.light['--accent']).toBe('#0F766E');
    expect(teal.dark['--accent']).toBe('#2DD4BF');
  });
  it('a damaged optional role never reaches the page: it falls back to bg or card', () => {
    const v = varsFor({ ...CLASSIC.light, page: 'red; background: url(x)', surface: 'nope' });
    expect(v['--page']).toBe(CLASSIC.light.bg);
    expect(v['--surface']).toBe(CLASSIC.light.card);
    expect(isHex(v['--page'])).toBe(true);
  });
  it('Classic stays "no overrides", and so do extras for Classic and custom palettes', () => {
    expect(resolvedVars({ id: 'classic' })).toBeNull();
    expect(extrasOf({ id: 'classic' }, false)).toEqual({});
    expect(extrasOf({ id: 'custom', custom: { light: CLASSIC.light, dark: CLASSIC.dark } }, true)).toEqual({});
    expect(extrasOf({ id: 'signature' }, true)['--btn-bg']).toBe('#277A83');
  });
  it('a custom palette started from Signature carries only the twelve colours, so "Page background" in the colour map still changes the whole canvas', () => {
    const base = withoutOptional(SIG.light);
    expect(Object.keys(base).sort()).toEqual(Object.keys(CLASSIC.light).sort());
    expect('page' in base).toBe(false);
    expect(varsFor(base)['--page']).toBe(SIG.light.bg);
  });
});

describe('D5 preferences: the storage format is unchanged and backup and restore carry Signature', () => {
  const memory = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return { map: m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('the saved choice is just {id}, in the same keys as before; the variables are a derived copy', () => {
    const s = memory();
    savePalette({ id: 'signature' }, s);
    expect([...s.map.keys()].sort()).toEqual(['ledger-palette', 'ledger-palette-vars']);
    expect(JSON.parse(s.map.get('ledger-palette')!)).toEqual({ id: 'signature' });
    expect(loadPalette(s)).toEqual({ id: 'signature' });
    const vars = JSON.parse(s.map.get('ledger-palette-vars')!);
    expect(vars.light['--page']).toBe('#EEF1F6');
    expect(vars.dark['--page']).toBe('#0B1220');
    expect(vars.light['--btn-bg']).toBe('#0E1A33');
  });

  it('a choice saved by the previous version still loads exactly as it did, and nothing about it changed shape', () => {
    for (const old of ['{"id":"teal"}', '{"id":"navy"}', '{"id":"forest"}', '{"id":"slate"}']) expect(parseChoice(old)).toEqual(JSON.parse(old));
    const custom = { id: 'custom', custom: { light: CLASSIC.light, dark: CLASSIC.dark }, savedId: 'tabc' };
    expect(parseChoice(JSON.stringify(custom))).toEqual(custom);
    // variables saved by the previous version (no --page, no --surface) still apply, and resolve through the aliases
    const prev = { light: { '--bg': '#FAFAF8', '--accent': '#0F766E' }, dark: {} };
    expect(Object.keys(prev.light)).not.toContain('--page');
  });

  it('a custom palette saved by an older version has no optional roles and loads unchanged', () => {
    const stored = JSON.stringify({ id: 'custom', custom: { light: CLASSIC.light, dark: CLASSIC.dark } });
    const back = parseChoice(stored);
    expect(back.custom!.light).toEqual(CLASSIC.light);
    expect(varsFor(back.custom!.light)['--page']).toBe(CLASSIC.light.bg);
  });

  it('a backup carries Signature and restoring it puts both keys back byte for byte', () => {
    const here = memory();
    savePalette({ id: 'signature' }, here);
    here.setItem('ledger-theme', 'dark');
    const prefs = collectPreferences(here);
    expect(prefs['ledger-palette']).toBe('{"id":"signature"}');
    expect(prefs['ledger-palette-vars']).toBeTruthy();
    const there = memory({ 'ledger-palette': '{"id":"teal"}' });
    applyPreferences(prefs, there as never);
    expect(there.map.get('ledger-palette')).toBe(here.map.get('ledger-palette'));
    expect(there.map.get('ledger-palette-vars')).toBe(here.map.get('ledger-palette-vars'));
    expect(loadPalette(there)).toEqual({ id: 'signature' });
  });

  it('a saved-theme code still round trips (themes carry only the twelve colours)', () => {
    const code = encodeTheme({ name: 'Sample', light: withoutOptional(SIG.light), dark: withoutOptional(SIG.dark) });
    const d = decodeTheme(code);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.light.accent).toBe(SIG.light.accent);
  });

  it('a choice an older copy of the app does not know falls back to Classic rather than failing (downgrade safety)', () => {
    const olderKnown = ['teal', 'navy', 'forest', 'slate'];
    const parseOld = (raw: string) => { const id = JSON.parse(raw).id; return olderKnown.includes(id) ? { id } : { id: 'classic' }; };
    expect(parseOld('{"id":"signature"}')).toEqual({ id: 'classic' });
  });

  it('index.html applies whatever variables are stored, before first paint, with no list of names to go stale', () => {
    const html = read('index.html');
    expect(html).toContain('ledger-palette-vars');
    expect(html).toContain('for(var k in v){document.documentElement.style.setProperty(k,v[k])}');
  });
});

describe('D5 applying and clearing palettes on the page (Light, Dark and Device)', () => {
  const g = globalThis as unknown as { document?: unknown };
  afterEach(() => { delete g.document; });

  function fakePage() {
    const props = new Map<string, string>();
    const meta = { content: '', setAttribute(_n: string, v: string) { this.content = v; } };
    g.document = {
      documentElement: { style: { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) } },
      querySelectorAll: () => [meta],
    };
    return { props, meta };
  }

  it('Signature in light and dark sets the colours, the canvas, the extras and the browser-bar colour', () => {
    const { props, meta } = fakePage();
    applyPalette({ id: 'signature' }, false);
    expect(props.get('--page')).toBe('#EEF1F6');
    expect(props.get('--surface')).toBe('#FFFFFF');
    expect(props.get('--control-line')).toBe('#7A879F');
    expect(props.get('--font-sans')?.startsWith('Inter')).toBe(true);
    expect(meta.content).toBe('#EEF1F6');
    applyPalette({ id: 'signature' }, true);
    expect(props.get('--page')).toBe('#0B1220');
    expect(props.get('--surface')).toBe('#131D31');
    expect(props.get('--control-line')).toBe('#6F82A3');
    expect(props.get('--shadow-3')).toContain('rgba(0, 0, 0');
    expect(meta.content).toBe('#0B1220');
  });

  it('switching from Signature to an older preset leaves none of Signature behind, and the browser-bar colour is that preset\'s background as before', () => {
    const { props, meta } = fakePage();
    applyPalette({ id: 'signature' }, false);
    applyPalette({ id: 'teal' }, false);
    for (const k of Object.keys(SIG.extras!.light)) expect(props.has(k), `${k} should be cleared`).toBe(false);
    expect(props.get('--page')).toBe('#FAFAF8'); // the Calm teal background, via the fallback
    expect(props.get('--surface')).toBe('#F1F4F2');
    expect(meta.content).toBe('#FAFAF8');
  });

  it('switching to Classic clears every variable, including the new ones', () => {
    const { props } = fakePage();
    applyPalette({ id: 'signature' }, true);
    applyPalette({ id: 'classic' } as PaletteChoice, true);
    expect(props.size).toBe(0);
  });

  it('a custom palette (no extras) after Signature gets the colours only', () => {
    const { props } = fakePage();
    applyPalette({ id: 'signature' }, false);
    applyPalette({ id: 'custom', custom: { light: CLASSIC.light, dark: CLASSIC.dark } }, false);
    expect(props.has('--btn-bg')).toBe(false);
    expect(props.get('--page')).toBe(CLASSIC.light.bg);
  });

  it('the button text colour is still derived from the accent (white on Signature teal in both modes)', () => {
    expect(onColor(SIG.light.accent)).toBe('#FFFFFF');
    expect(contrastRatio(onColor(SIG.dark.accent), SIG.dark.accent)).toBeGreaterThanOrEqual(4.5);
  });
});

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
