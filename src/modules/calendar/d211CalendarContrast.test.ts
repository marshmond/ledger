import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESETS, contrastRatio, mixHex } from '../../palette';
import { COLORS } from '../family/model';

/**
 * D21.1 final correction: text on Calendar chips must read at 4.5:1 in every palette and mode. Days outside the month used to be de-emphasised with
 * `opacity: 0.85` on the chip (and reminders with 0.78 / 0.8, projected marks with 0.7), which put the small time and priority marks at 3.9 to 4.5:1.
 * They are now de-emphasised by a sunken cell, a lighter chip fill and the secondary text color. These checks pin the rules and measure the pairs.
 */
const css = readFileSync('src/modules/calendar/calendar.css', 'utf8');
const rule = (sel: string) => css.split('\n').find((l) => l.startsWith(sel)) ?? '';
const DARK_MC = ['#7aa2ee', '#52c08f', '#e8946a', '#b894e8', '#ee86c0', '#e0b04a', '#5cc3d1', '#a3acbb'];

describe('D21.1 Calendar chips: no text is faded by opacity', () => {
  it('out-of-month chips, reminder chips and rows, and the projected mark no longer use opacity', () => {
    for (const sel of ['.cal-cell.out .cal-chip', '.cal-chip.p-reminder', '.cal-row.p-reminder', '.cal-chip-proj']) {
      expect(rule(sel), sel).not.toBe('');
      expect(rule(sel), sel).not.toMatch(/opacity/);
    }
  });
  it('out-of-month chips keep their identity edge and are told apart by fill and text color, not by hiding', () => {
    const r = rule('.cal-cell.out .cal-chip');
    expect(r).toContain('var(--surface-sunken)');
    expect(r).toContain('color: var(--fg-2)');
    expect(r).not.toMatch(/border/);
    expect(rule('.cal-cell.out {')).toContain('var(--surface-sunken)');
  });
  it('completed items are unchanged (their strike-through carries the meaning)', () => {
    expect(rule('.cal-chip.done')).toContain('opacity: 0.6');
  });
});

describe('D21.1 Calendar chip text reads on every palette, mode and layer color (4.5:1)', () => {
  for (const p of PRESETS) {
    for (const m of ['light', 'dark'] as const) {
      it(`${p.name} ${m}`, () => {
        const sunken = p.extras[m]['--surface-sunken'];
        const surface = p[m].surface!;
        const layers = [...COLORS.map((c) => c.value), ...(m === 'dark' ? DARK_MC : []), p[m].accent];
        const low: string[] = [];
        for (const chip of layers) {
          const outFill = mixHex(sunken, chip, 0.08);
          const inFill = mixHex(surface, chip, 0.15);
          const remFill = mixHex(surface, chip, 0.07);
          const pairs: [string, string, string][] = [
            ['out title (secondary text)', p.extras[m]['--fg-2'], outFill],
            ['out time and low-priority mark (quiet text)', p[m].muted, outFill],
            ['in-month time (quiet text)', p[m].muted, inFill],
            ['reminder text (secondary text)', p.extras[m]['--fg-2'], remFill],
          ];
          for (const [name, fg, bg] of pairs) {
            const r = contrastRatio(fg, bg);
            if (r < 4.5) low.push(`${chip} ${name}: ${r.toFixed(2)}`);
          }
        }
        expect(low).toEqual([]);
      });
    }
  }
});
