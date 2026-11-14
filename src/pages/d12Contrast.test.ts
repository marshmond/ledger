import { describe, expect, it } from 'vitest';
import { PRESETS, contrastRatio, deriveExtras, extrasOf, varsFor, type PaletteColors } from '../palette';
import { CLASSIC, LEGACY_PRESETS } from '../shell/legacyFixtures';

/**
 * D12. The words on Ledger Home's dark net-worth panel (the "hero"), and the bar flag and "so far" text that D12 adds, measured for Classic and every built-in palette,
 * light and dark. A tint is the color mixed with the page background exactly as the stylesheet's color-mix() does. Under Classic and the older presets the hero is
 * an ordinary card (--hero-bg is the card color, --hero-ink the text color), so the same pairs are measured there too. This is arithmetic from the palette values,
 * not a look at a real screen; it does not prove forced-colors or real-device rendering.
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
  const heroBg = v['--hero-bg'] ?? surface; // the token's default is the card color
  const heroInk = v['--hero-ink'] ?? fg;
  const heroInk2 = v['--hero-ink-2'] ?? muted;
  const heroPos = v['--hero-pos'] ?? mix(v['--pos'], fg, 0.78);
  const heroNeg = v['--hero-neg'] ?? mix(v['--neg'], fg, 0.78);
  const negText = mix(v['--neg'], fg, 0.78);
  const negSoft = mix(v['--neg'], bg, 0.13);
  const accSoft = mix(v['--accent'], bg, 0.12);
  const accText = mix(v['--accent'], fg, 0.78);
  return {
    'net worth figure on the hero': [heroInk, heroBg, 4.5],
    'label and trend note on the hero': [heroInk2, heroBg, 4.5],
    'a gain on the hero': [heroPos, heroBg, 4.5],
    'a loss (negative net worth) on the hero': [heroNeg, heroBg, 4.5],
    'the "Over budget" flag on its tint': [negText, negSoft, 4.5],
    'a large month figure on the card': [fg, surface, 4.5],
    '"Ready to assign" on its tint': [fg, accSoft, 4.5],
    'a link on the "Ready to assign" tint': [accText, accSoft, 4.5],
    'the "so far" note under the chart': [muted, surface, 4.5],
    'the hero small figure label on its tinted chip': [heroInk2, mix(heroInk, heroBg, 0.07), 4.5],
    'the hero small figure on its tinted chip': [heroInk, mix(heroInk, heroBg, 0.07), 4.5],
    'a filled check-in segment against its track (a shape, 3:1)': [v['--accent'], mix(fg, surface, 0.08), 3],
    'the check-in count and the own-and-owe parts text': [mix(fg, muted, 0.78), surface, 4.5],
    'the own-and-owe assets bar against its track (a shape, 3:1)': [v['--pos'], mix(fg, surface, 0.08), 3],
    'phone month card: figures on the card surface': [fg, surface, 4.5],
    'phone month card: labels (fg-2) on the card surface': [mix(fg, muted, 0.78), surface, 4.5],
    'phone month card: Ready to assign (positive text color)': [mix(v['--pos'], fg, 0.78), surface, 4.5],
    'phone month card: a negative figure (negative text color)': [negText, surface, 4.5],
    'phone month card: the Budget link': [accText, surface, 4.5],
    'phone month card: the Spent bar fill against its track (a shape, 3:1)': [fg, mix(v['--line'] ?? fg, surface, 1), 3],
  };
}

describe('D12 contrast: the new Home words read at 4.5:1 or better in every palette', () => {
  for (const s of sets) {
    it(s.name, () => {
      const low = Object.entries(pairs(s)).map(([k, [a, b, min]]) => [k, Math.round(contrastRatio(a, b) * 100) / 100, min] as const).filter(([, r, min]) => r < min);
      expect(low).toEqual([]);
    });
  }
});
