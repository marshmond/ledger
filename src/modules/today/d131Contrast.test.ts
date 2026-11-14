import { describe, expect, it } from 'vitest';
import { PRESETS, contrastRatio, deriveExtras, extrasOf, varsFor, type PaletteColors } from '../../palette';
import { CLASSIC, LEGACY_PRESETS } from '../../shell/legacyFixtures';

/**
 * D13.1. The words and icons the Today composition draws on tinted backgrounds, measured for Classic and every built-in palette, light and dark (the same arithmetic
 * as d11Contrast.test.ts: a tint is the color mixed with the page background as the stylesheet's color-mix() does). This is arithmetic from the palette values, not a
 * look at a real screen.
 */
const hex = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: string, b: string, pctOfA: number) => `#${hex(a).map((v, i) => Math.round(v * pctOfA + hex(b)[i] * (1 - pctOfA)).toString(16).padStart(2, '0')).join('')}`;

interface Set { name: string; c: PaletteColors; extras: Record<string, string> }
const sets: Set[] = [
  // D21.1: Classic and the four older presets now exist only as stored custom themes; they render through the adapter (deriveExtras), so that is what is measured.
  ...[{ id: 'classic', light: CLASSIC.light, dark: CLASSIC.dark }, ...LEGACY_PRESETS].flatMap((p) => [
    { name: `${p.id} (custom) light`, c: p.light as PaletteColors, extras: deriveExtras(p.light, false) },
    { name: `${p.id} (custom) dark`, c: p.dark as PaletteColors, extras: deriveExtras(p.dark, true) },
  ]),
  ...PRESETS.flatMap((p) => [
    { name: `${p.id} light`, c: p.light, extras: extrasOf({ id: p.id }, false) },
    { name: `${p.id} dark`, c: p.dark, extras: extrasOf({ id: p.id }, true) },
  ]),
];

function pairs({ c, extras }: Set): Record<string, [string, string, number]> {
  const v = { ...varsFor(c), ...extras };
  const bg = v['--bg'];
  const surface = v['--surface'];
  const fg = v['--fg'];
  const muted = v['--muted'];
  const soft = mix(fg, surface, 0.04);
  const warnText = mix(v['--warn'], fg, 0.78);
  const warnSoft = mix(v['--warn'], bg, 0.14);
  const accText = mix(v['--accent'], fg, 0.78);
  const infoSoft = mix(v['--accent'], bg, 0.12);
  const negText = mix(v['--neg'], fg, 0.78);
  const negSoft = mix(v['--neg'], bg, 0.13);
  const hover = mix(fg, surface, 0.06);
  return {
    'module strip name and count (muted on the soft strip)': [muted, soft, 4.5],
    'Household status strips (muted on the soft strip)': [muted, soft, 4.5],
    'Needs attention icon (warning tone)': [warnText, warnSoft, 4.5],
    'Needs attention icon (information tone)': [accText, infoSoft, 4.5],
    'Overdue count badge': [negText, negSoft, 4.5],
    'Overdue chip beside a title': [negText, negSoft, 4.5],
    'the outlined action button (text on the card)': [fg, surface, 4.5],
    'the outlined action button on hover': [fg, hover, 4.5],
    'time and source lines (muted on the card)': [muted, surface, 4.5],
    'Show all and Show fewer button (accent text on the card)': [accText, surface, 4.5],
    'Show all button second line on hover': [muted, hover, 4.5],
  };
}

describe('D13.1 contrast: the composition\'s tinted words read at 4.5:1 or better in every palette', () => {
  for (const s of sets) {
    it(s.name, () => {
      const low = Object.entries(pairs(s)).map(([k, [a, b, min]]) => [k, Math.round(contrastRatio(a, b) * 100) / 100, min] as const).filter(([, r, min]) => r < min);
      expect(low).toEqual([]);
    });
  }
});
