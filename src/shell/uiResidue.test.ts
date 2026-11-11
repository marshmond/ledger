import { describe, expect, it } from 'vitest';
import { BASELINE, measure } from './uiBaseline';

/**
 * D5. Residue report. Today's old-style residue is recorded in src/shell/uiBaseline.ts (the D4 numbers, re-measured). This file MEASURES it and
 * REPORTS how each count compares with the baseline, so later phases can see progress (or growth) in the test output.
 *
 * It deliberately never fails the run because a count moved: legacy-style counts are guidance for the redesign, not release blockers.
 * Only the measuring itself is checked (it must find the source and produce sane numbers), so the report cannot silently stop working.
 * When a phase lowers a count, lower the number in uiBaseline.ts (and docs/UI-COVERAGE.md section 6) to keep the comparison meaningful.
 */
const m = measure();

const rows: [string, number, number][] = [
  ['inline style={{ }} in screens', m.inlineStyles, BASELINE.inlineStyles],
  ['screen files with inline styles', m.inlineStyleFiles, BASELINE.inlineStyleFiles],
  ['raw border-radius pixel values in CSS', m.rawRadiusPx, BASELINE.rawRadiusPx],
  ['raw font-size values in CSS', m.rawFontSize, BASELINE.rawFontSize],
  ['font sizes below 12px (px)', m.fontBelow12Px, BASELINE.fontBelow12Px],
  ['font sizes below 12px (px and rem)', m.fontBelow12All, BASELINE.fontBelow12All],
  ['hex colours in CSS', m.hexCss, BASELINE.hexCss],
  ['hex colours in module CSS', m.hexModuleCss, BASELINE.hexModuleCss],
  ['files with their own <h1>', m.ownH1Files, BASELINE.ownH1Files],
  ['browser-native confirm() calls', m.nativeConfirm, BASELINE.nativeConfirm],
  ['files with a native confirm()', m.nativeConfirmFiles, BASELINE.nativeConfirmFiles],
  ['<Modal> call sites', m.modalSites, BASELINE.modalSites],
  ['files with a <Modal>', m.modalFiles, BASELINE.modalFiles],
  ['!important', m.important, BASELINE.important],
];

describe('D5 residue report (informational: never fails because a count moved)', () => {
  it('measures the source and prints each count against its baseline', () => {
    const lines = rows.map(([name, now, base]) => `${now > base ? 'UP  ' : now < base ? 'down' : 'same'}  ${name}: ${now} (baseline ${base})`);
    const up = rows.filter(([, now, base]) => now > base).length;
    // eslint-disable-next-line no-console
    console.info(`\nUI residue vs D5 baseline (${up} higher):\n${lines.join('\n')}\n`);
    if (up > 0) console.warn(`NOTE: ${up} legacy-style count(s) are above the D5 baseline. Informational only; prefer shared classes and tokens in new work.`);
    expect(rows).toHaveLength(14);
  });

  it('the measuring works: it found the screens, the stylesheets and the tests', () => {
    expect(m.screens).toBeGreaterThan(100);
    expect(m.testFiles).toBeGreaterThan(100);
    expect(m.hexCss).toBeGreaterThan(0);
    expect(m.modalSites).toBeGreaterThan(0);
    for (const [, now] of rows) expect(Number.isFinite(now) && now >= 0).toBe(true);
  });
});
