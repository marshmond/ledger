import { readFileSync, readdirSync } from 'node:fs';

/**
 * D5: the measured "old UI residue" of the app and the baseline each measure is held to. Used only by tests (src/shell/uiResidue.test.ts and
 * uiCoverage.test.ts); nothing in the running app imports it.
 *
 * The baseline is a REPORT, not a gate: uiResidue.test.ts prints each count against it and never fails because a count moved. When a phase lowers a count, lower the
 * number here in the same change (and in docs/UI-COVERAGE.md section 6) so the gain is locked in. The counting rules are written next to each
 * measure; they are deliberately simple text searches, not a CSS or TypeScript parser.
 */

/** Baseline counted 2026-11-10 at commit 8ab1789 (the D4 numbers) and re-measured in D5 with the rules below. */
export const BASELINE = {
  /** `style={{` in non-test .tsx files (D4: 307 in 83 files). */
  inlineStyles: 307,
  inlineStyleFiles: 83,
  /** `border-radius: <number>px` at the start of a value, pills (999px) included (D4: 67; 83 with the 16 percent values). */
  rawRadiusPx: 67,
  /** `font-size: <number>px|rem` (D4: 36). */
  rawFontSize: 36,
  /** Of those, below 12px: pixel values only (D4: 9), and pixel plus rem values (D5: 11). */
  fontBelow12Px: 9,
  fontBelow12All: 11,
  /** Hex colours in CSS (D4: 152), and in the module sheets under src/modules (D4: 56). src/ui/tokens.css is not counted: it is the one place colours are meant to be defined. */
  hexCss: 152,
  hexModuleCss: 56,
  /** Non-test .tsx files with their own `<h1` instead of PageHeader (D4: 13). */
  ownH1Files: 13,
  /** `className="card` uses (D4: 395). Informational: .card is restyled in place, not removed. */
  cardUses: 395,
  /** Calls to the browser's own confirm box, with a message, in non-test .ts/.tsx (D4: 37 in 24 files). Local functions that happen to be named confirm are not counted. */
  nativeConfirm: 37,
  nativeConfirmFiles: 24,
  /** `<Modal` call sites in non-test .tsx (D4: 62 in 41 files; D11: 63 in 42, the Tasks Filters sheet). */
  modalSites: 63,
  modalFiles: 42,
  /** The important flag in CSS (D4: 11). */
  important: 11,
} as const;

const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);
const read = (f: string) => readFileSync(f, 'utf8');

function count(files: string[], re: RegExp): { n: number; files: number } {
  let n = 0;
  let nf = 0;
  for (const f of files) {
    const m = read(f).match(re);
    if (m) { n += m.length; nf++; }
  }
  return { n, files: nf };
}

export interface Measures {
  inlineStyles: number; inlineStyleFiles: number; rawRadiusPx: number; rawFontSize: number; fontBelow12Px: number; fontBelow12All: number;
  hexCss: number; hexModuleCss: number; ownH1Files: number; cardUses: number; nativeConfirm: number; nativeConfirmFiles: number;
  modalSites: number; modalFiles: number; important: number; screens: number; testFiles: number;
}

/** Counts everything under src/. Pure reading, no side effects. */
export function measure(root = 'src'): Measures {
  const all = walk(root);
  const tsx = all.filter((f) => f.endsWith('.tsx') && !isTest(f));
  const code = all.filter((f) => /\.tsx?$/.test(f) && !isTest(f));
  const css = all.filter((f) => f.endsWith('.css'));
  const inline = count(tsx, /style=\{\{/g);
  const confirmCalls = count(code, /(^|[^A-Za-z.])confirm\(\s*[`'"]/g);
  const modal = count(tsx, /<Modal[ >\n]/g);
  let below12Px = 0;
  let below12All = 0;
  for (const f of css) {
    for (const m of read(f).matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
      const px = m[2] === 'rem' ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
      if (px < 12) { below12All++; if (m[2] === 'px') below12Px++; }
    }
  }
  return {
    inlineStyles: inline.n, inlineStyleFiles: inline.files,
    rawRadiusPx: count(css, /border-radius:\s*\d+(?:\.\d+)?px/g).n,
    rawFontSize: count(css, /font-size:\s*[\d.]+(?:px|rem)/g).n,
    fontBelow12Px: below12Px, fontBelow12All: below12All,
    hexCss: count(css.filter((f) => !f.endsWith('ui/tokens.css')), /#[0-9a-fA-F]{3,8}\b/g).n,
    hexModuleCss: count(css.filter((f) => f.includes('/modules/')), /#[0-9a-fA-F]{3,8}\b/g).n,
    ownH1Files: count(tsx, /<h1[ >]/g).files,
    cardUses: count(tsx, /className="card/g).n,
    nativeConfirm: confirmCalls.n, nativeConfirmFiles: confirmCalls.files,
    modalSites: modal.n, modalFiles: modal.files,
    important: count(css, /!important/g).n,
    screens: tsx.length,
    testFiles: all.filter(isTest).length,
  };
}
