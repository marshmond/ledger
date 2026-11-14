import { describe, expect, it } from 'vitest';
import { PRESETS, contrastRatio, deriveExtras, extrasOf, varsFor, type PaletteColors } from '../../palette';
import { CLASSIC, LEGACY_PRESETS } from '../../shell/legacyFixtures';

/**
 * D11. The words D11 draws on tinted or filled backgrounds, measured for Classic and every built-in palette, light and dark. A tint is the color mixed with
 * the page background exactly as the stylesheet's color-mix() does (src/ui/tokens.css: --neg-soft 13%, --accent-soft 12%, -text colors 78% toward the text
 * color, --surface-soft 4% and --surface-sunken 8% of the text color over the surface). This is arithmetic from the palette values, not a look at a screen.
 * It does not prove real-device or forced-colors rendering.
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
  const btnBg = v['--btn-bg'] ?? v['--accent'];
  const btnInk = v['--btn-ink'] ?? v['--on-accent'];
  const fg2 = mix(fg, muted, 0.78);
  const soft = mix(fg, surface, 0.04);
  const sunken = mix(fg, surface, 0.08);
  const negText = mix(v['--neg'], fg, 0.78);
  const negSoft = mix(v['--neg'], bg, 0.13);
  const accText = mix(v['--accent'], fg, 0.78);
  const accSoft = mix(v['--accent'], bg, 0.12);
  return {
    'Next up bar text': [btnInk, btnBg, 4.5],
    'Next up button (the two bar colors swapped)': [btnBg, btnInk, 4.5],
    'quiet text on a card (Today stat lines, Tasks project and steps)': [muted, surface, 4.5],
    'column headings on the soft strip': [muted, soft, 4.5],
    'group headings on the soft strip': [fg2, soft, 4.5],
    'a count on the sunken fill': [fg2, sunken, 4.5],
    'overdue words on the overdue tint': [negText, negSoft, 4.5],
    'overdue words on the late row (tint over the card)': [negText, mix(negSoft, surface, 0.55), 4.5],
    'a set filter chip': [accText, accSoft, 4.5],
    'the selected Today stat or tab text': [accText, surface, 4.5],
    'main text on the late row': [fg, mix(negSoft, surface, 0.55), 4.5],
  };
}

describe('D11 contrast: the new words read at 4.5:1 or better in every palette', () => {
  for (const s of sets) {
    it(s.name, () => {
      const low = Object.entries(pairs(s)).map(([k, [a, b, min]]) => [k, Math.round(contrastRatio(a, b) * 100) / 100, min] as const).filter(([, r, min]) => r < min);
      expect(low).toEqual([]);
    });
  }
});
