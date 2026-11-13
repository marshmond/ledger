import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CLASSIC, PRESETS, contrastRatio, varsFor, type PaletteColors } from '../palette';
import { dateTileModel, inlineDateText, isIsoDate } from '../ui/dateTileModel';
import { DateInline, DateTile } from '../ui/DateTile';
import { StatusChip, STATUS_TONES, TONE_ICON, statusChipClass } from '../ui/StatusChip';
import { Figure } from '../ui/Figure';
import { figureView } from '../ui/figureModel';
import { Banner, EmptyLine, EmptyState, PageHeader } from '../ui/components';
import { ICON_NAMES, Icon } from '../ui/icons';
import Modal from './Modal';
import { all, parseHtml } from '../lib/a11yTestkit';
import { BASELINE, measure } from './uiBaseline';

/**
 * D6. Shared components and the Signature look of the shared layer. Three groups:
 *  1. the new presentational pieces (date tile, status chip, financial figure, icons, empty line): what they show and what they refuse to do;
 *  2. the restyled shared pieces (Banner, EmptyState, PageHeader, Modal): behaviour, text and structure unchanged;
 *  3. the stylesheet: every new appearance token defaults to the OLD value (so Classic and the older presets cannot change), the Signature values are readable,
 *     and the new shared stylesheet follows the rules (tokens only, no priority overrides, no font file).
 * No personal data: every date and figure below is invented.
 */

const read = (f: string) => readFileSync(f, 'utf8');
const tokens = read('src/ui/tokens.css');
const styles = read('src/styles.css');
const components = read('src/ui/components.css');
const SIG = PRESETS.find((p) => p.id === 'signature')!;
const text = (html: string) => html.replace(/<[^>]+>/g, '');

// ---------------------------------------------------------------- 1a. the date tile

describe('D6 date tile model: pure, with no clock and no time zone', () => {
  const TODAY = '2026-11-11'; // a Wednesday

  it('weekday, day, month and the full date come from the date alone', () => {
    const m = dateTileModel('2026-11-11', TODAY)!;
    expect([m.weekday, m.weekdayLong, m.day, m.month, m.monthLong, m.year]).toEqual(['WED', 'Wednesday', '11', 'NOV', 'November', 2026]);
    expect(m.fullLabel).toBe('Wednesday, November 11, 2026');
    expect(dateTileModel('2026-12-05', TODAY)!.day).toBe('5'); // no leading zero
    expect(dateTileModel('2024-02-29', '2024-02-28')!.fullLabel).toBe('Thursday, February 29, 2024'); // a leap day
    expect(dateTileModel('2027-01-01', '2026-12-31')!.relative).toBe('Tomorrow'); // across New Year
    expect(dateTileModel('2026-12-31', '2027-01-01')!.relative).toBe('Yesterday');
  });

  it('gives the same answer for the days the clocks change (it never builds a local-time Date)', () => {
    for (const [iso, weekday] of [['2026-03-08', 'SUN'], ['2026-11-01', 'SUN'], ['2026-03-29', 'SUN'], ['2026-10-25', 'SUN'], ['2026-03-09', 'MON']] as const) {
      expect(dateTileModel(iso, '2026-01-01')!.weekday).toBe(weekday);
    }
  });

  it('calendar tones come from today: today, tomorrow, weekend, otherwise default', () => {
    const tone = (iso: string) => dateTileModel(iso, TODAY)!.tone;
    expect(tone('2026-11-11')).toBe('today');
    expect(tone('2026-11-12')).toBe('tomorrow');
    expect(tone('2026-11-14')).toBe('weekend'); // Saturday
    expect(tone('2026-11-15')).toBe('weekend'); // Sunday
    expect(tone('2026-11-17')).toBe('default');
    expect(tone('2026-11-09')).toBe('default'); // a past date is NOT called overdue by this function
  });

  it('overdue and special are only what the caller says, and win over the calendar facts', () => {
    expect(dateTileModel('2026-11-09', TODAY, { overdue: true })!.tone).toBe('overdue');
    expect(dateTileModel('2026-11-11', TODAY, { overdue: true })!.tone).toBe('overdue');
    expect(dateTileModel('2026-11-12', TODAY, { special: true })!.tone).toBe('special');
    expect(dateTileModel('2026-11-12', TODAY, { overdue: true, special: true })!.tone).toBe('overdue');
    expect(dateTileModel('2026-11-12', TODAY, { overdue: false, special: false })!.tone).toBe('tomorrow');
  });

  it('refuses anything that is not a real date', () => {
    for (const bad of ['', 'abc', '2026-1-5', '2026-02-30', '2026-13-01', '2026-11-31', '20261111', '2026-11-11T10:00:00Z']) {
      expect(isIsoDate(bad), bad).toBe(false);
      expect(dateTileModel(bad, TODAY), bad).toBeNull();
    }
    expect(dateTileModel('2026-11-11', 'nope')).toBeNull();
    expect(isIsoDate(undefined)).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2025-02-29')).toBe(false);
  });

  it('the compact form drops the year only when it is the current year', () => {
    expect(inlineDateText('2026-11-11', TODAY)).toBe('Wed, Nov 11');
    expect(inlineDateText('2027-02-03', TODAY)).toBe('Wed, Feb 3, 2027');
    expect(inlineDateText('2026-07-04', TODAY)).toBe('Sat, Jul 4');
    expect(inlineDateText('bad', TODAY)).toBeNull();
  });
});

describe('D6 DateTile and DateInline: the full date stays readable and meaning is never colour alone', () => {
  const TODAY = '2026-11-11';
  const tile = (props: Partial<Parameters<typeof DateTile>[0]> = {}) => renderToStaticMarkup(<DateTile iso="2026-11-12" today={TODAY} {...props} />);

  it('is a <time> element with the machine date, a tone class, and the full date as hidden text', () => {
    const html = tile();
    const t = all(parseHtml(html), (e) => e.tag === 'time')[0];
    expect(t.attrs.dateTime).toBe('2026-11-12'); // React writes the attribute as dateTime (HTML attribute names are not case-sensitive)
    expect(t.attrs.class).toContain('ui-dtile--tomorrow');
    expect(html).toContain('<span class="sr-only">Thursday, November 12, 2026, tomorrow</span>');
  });

  it('the small weekday, day and month labels are hidden from assistive technology; the hidden sentence stands in for them', () => {
    const html = tile();
    for (const cls of ['ui-dtile-wd', 'ui-dtile-day', 'ui-dtile-mo']) expect(html).toMatch(new RegExp(`class="${cls}" aria-hidden="true"`));
  });

  it('overdue is also said in words for a screen reader, and a caption can show a word on the tile', () => {
    expect(tile({ iso: '2026-11-09', overdue: true })).toContain('Monday, November 9, 2026, overdue');
    const html = tile({ iso: '2026-11-09', overdue: true, caption: 'Overdue' });
    expect(html).toContain('<span class="ui-dtile-cap">Overdue</span>');
    expect(html).toContain('ui-dtile--overdue');
  });

  it('a caption replaces the "today / tomorrow" words in the hidden sentence, so they are not read twice', () => {
    expect(tile({ caption: 'Due' })).toContain('Thursday, November 12, 2026</span>');
  });

  it('labelled={false} hides the whole tile for a row that prints the date in words', () => {
    const html = tile({ labelled: false });
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('sr-only');
  });

  it('draws nothing for an invalid date and supports the small size', () => {
    expect(renderToStaticMarkup(<DateTile iso="2026-02-30" today={TODAY} />)).toBe('');
    expect(tile({ size: 'sm' })).toContain('ui-dtile--sm');
  });

  it('DateInline shows readable text ("Wed, Nov 11"), with bold weekday, and "(overdue)" in hidden text', () => {
    const html = renderToStaticMarkup(<DateInline iso="2026-11-09" today={TODAY} overdue />);
    expect(text(html).replace(/\s+/g, ' ')).toBe('Mon, Nov 9 (overdue)');
    expect(html).toContain('<b>Mon</b>');
    expect(html).toContain('ui-dinline--overdue');
    expect(renderToStaticMarkup(<DateInline iso="2026-11-11" today={TODAY} />)).toContain('ui-dinline--today');
    expect(renderToStaticMarkup(<DateInline iso="nope" today={TODAY} />)).toBe('');
  });
});

// ---------------------------------------------------------------- 1b. status chip

describe('D6 StatusChip: words first, an icon shape second, colour third; independent of any module', () => {
  it('has the six approved tones and a class for each', () => {
    expect(STATUS_TONES).toEqual(['neutral', 'overdue', 'warning', 'done', 'info', 'active']);
    expect(statusChipClass()).toBe('ui-chip');
    expect(statusChipClass('neutral')).toBe('ui-chip');
    for (const t of STATUS_TONES.filter((x) => x !== 'neutral')) expect(statusChipClass(t)).toBe(`ui-chip ui-chip--${t}`);
  });

  it('always prints the words it is given, and every tone but neutral has its own icon (a shape, not only a colour)', () => {
    for (const t of STATUS_TONES) {
      const html = renderToStaticMarkup(<StatusChip tone={t}>Waiting on you</StatusChip>);
      expect(text(html)).toBe('Waiting on you');
      expect(html.includes('<svg'), t).toBe(TONE_ICON[t] !== null);
    }
    const shapes = STATUS_TONES.map((t) => TONE_ICON[t]).filter(Boolean);
    expect(new Set(shapes).size).toBe(shapes.length); // no two tones share a shape
  });

  it('the icon is decoration (hidden from assistive technology) and can be turned off or changed', () => {
    expect(renderToStaticMarkup(<StatusChip tone="done">Paid</StatusChip>)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<StatusChip tone="done" icon={false}>Paid</StatusChip>)).not.toContain('<svg');
    expect(renderToStaticMarkup(<StatusChip tone="info" icon="wave">Estimated</StatusChip>)).toContain('<svg');
  });

  it('is presentational: it imports nothing from a module, the database or the money code', () => {
    for (const f of ['src/ui/StatusChip.tsx', 'src/ui/DateTile.tsx', 'src/ui/Figure.tsx', 'src/ui/icons.tsx', 'src/ui/dateTileModel.ts', 'src/ui/figureModel.ts']) {
      const imports = [...read(f).matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
      for (const i of imports) expect(i, `${f} imports ${i}`).toMatch(/^(react|\.\/[A-Za-z]+|\.\.\/lib\/dates)$/);
    }
  });
});

// ---------------------------------------------------------------- 1c. financial figure

describe('D6 Figure: shows what it is given, never computes, never turns "missing" into zero', () => {
  it('shows an already-formatted value exactly as given', () => {
    const html = renderToStaticMarkup(<Figure label="Monthly total" value="$1,234.56" description="From your accounts" />);
    expect(html).toContain('<div class="ui-figure-value">$1,234.56</div>');
    expect(html).toContain('ui-figure--known');
    expect(html).not.toContain('ui-figure-tag');
    expect(html).toContain('From your accounts');
  });

  it('a missing value is "not known", never $0.00', () => {
    for (const value of [undefined, null, '', '   ', false]) {
      const html = renderToStaticMarkup(<Figure label="Insurance" value={value as never} />);
      expect(html, String(value)).toContain('ui-figure--unknown');
      expect(html, String(value)).toContain('Not known');
      expect(html, String(value)).not.toMatch(/\$|0\.00/);
      expect(html, String(value)).toContain('<span aria-hidden="true">—</span>'); // a dash a screen reader skips; the tag carries the words
    }
    // a "known" figure with no text is treated as unknown, and so is an "estimated" one
    expect(figureView({ value: undefined, certainty: 'known' }).certainty).toBe('unknown');
    expect(figureView({ value: '', certainty: 'estimated' }).certainty).toBe('unknown');
  });

  it('an amount stated as 0 is a known zero, not a missing value (the text "$0.00" is real text)', () => {
    expect(figureView({ value: '$0.00' }).certainty).toBe('known');
    expect(figureView({ value: '$0.00', certainty: 'estimated' }).certainty).toBe('estimated');
  });

  it('estimated is marked in words and with an icon, not by line style alone', () => {
    const html = renderToStaticMarkup(<Figure label="Water" value="$40.00" certainty="estimated" />);
    expect(html).toContain('ui-figure--estimated');
    expect(html).toContain('Estimated</span>');
    expect(html).toContain('<svg');
  });

  it('unknown with a text value (for example "Not added") shows that text and the words "Not known"', () => {
    const html = renderToStaticMarkup(<Figure label="Insurance" value="Not added" certainty="unknown" description="Not added, and not zero" />);
    expect(html).toContain('Not added');
    expect(html).toContain('Not known');
    expect(html).toContain('Not added, and not zero');
  });

  it('progress is a ratio from the module: held to 0..100 for drawing, ignored when not a number or when the amount is not known', () => {
    expect(figureView({ value: '$1', progress: 0.5 }).percent).toBe(50);
    expect(figureView({ value: '$1', progress: 1.7 }).percent).toBe(100);
    expect(figureView({ value: '$1', progress: -3 }).percent).toBe(0);
    for (const p of [undefined, null, NaN, Infinity]) expect(figureView({ value: '$1', progress: p as never }).percent, String(p)).toBeNull();
    expect(figureView({ value: undefined, progress: 0.5 }).percent).toBeNull();
    const html = renderToStaticMarkup(<Figure label="Spent" value="$30.00" progress={0.3} progressLabel="Spent of budget" />);
    const bar = all(parseHtml(html), (e) => e.attrs.role === 'progressbar')[0];
    expect(bar.attrs['aria-valuenow']).toBe('30');
    expect(bar.attrs['aria-label']).toBe('Spent of budget');
    expect(html).toContain('style="width:30%"');
  });

  it('the component does no arithmetic: it imports no money or calculation code, and its source has no formatting of amounts', () => {
    for (const f of ['src/ui/Figure.tsx', 'src/ui/figureModel.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/formatCents|toFixed|Intl\.|parseFloat|Number\(/);
      expect(src, f).not.toMatch(/\.reduce\(|\bsum\b/);
    }
  });
});

describe('D6 icons and EmptyLine', () => {
  it('every icon is a plain inline SVG hidden from assistive technology, with no image file or dependency', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(8);
    for (const n of ICON_NAMES) {
      const html = renderToStaticMarkup(<Icon name={n} />);
      expect(html, n).toMatch(/^<svg class="ui-icon"/);
      expect(html, n).toContain('aria-hidden="true"');
      expect(html, n).not.toMatch(/<image|href=|xlink/);
    }
  });
  it('EmptyLine is one quiet paragraph', () => {
    expect(renderToStaticMarkup(<EmptyLine>Nothing due this week.</EmptyLine>)).toBe('<p class="ui-empty-line">Nothing due this week.</p>');
  });
});

// ---------------------------------------------------------------- 2. restyled shared pieces keep their text and structure

describe('D6 shared pieces: same words, same roles, same structure', () => {
  it('Banner keeps its title text, role and levels; the level icon is hidden decoration inside the title', () => {
    for (const level of ['info', 'warn', 'bad', 'ok'] as const) {
      const html = renderToStaticMarkup(<Banner level={level} title="Backup is overdue">Details here</Banner>);
      const root = parseHtml(html);
      expect(text(html)).toBe('Backup is overdue' + 'Details here');
      expect(html).toContain(`class="banner ${level}"`);
      expect(html.includes('role="alert"'), level).toBe(level === 'bad');
      expect(all(root, (e) => e.tag === 'svg').every((s) => s.attrs['aria-hidden'] === 'true')).toBe(true);
    }
    expect(renderToStaticMarkup(<Banner title="T" action={<button>Go</button>} />)).toContain('<div class="banner-act"><button>Go</button></div>');
  });

  it('EmptyState keeps its title, text and action; the old circle glyph stays for every palette and the new icon is decoration', () => {
    const html = renderToStaticMarkup(<EmptyState title="No bills yet" action={<button>Add one</button>}>Add the first one.</EmptyState>);
    expect(html).toContain('<strong>No bills yet</strong>');
    expect(html).toContain('<p class="muted">Add the first one.</p>');
    expect(html).toContain('<button>Add one</button>');
    expect(html).toContain('<span class="glyph-legacy">○</span>');
    expect(html).toContain('<div class="empty-icon" aria-hidden="true">');
  });

  it('PageHeader: one heading, title text unchanged; an eyebrow is drawn only when a page passes one and is not a heading', () => {
    const plain = renderToStaticMarkup(<PageHeader title="Tasks" description="What to do" />);
    expect(plain).toBe('<header class="page-head "><div class="page-head-text"><h1>Tasks</h1><p class="page-desc">What to do</p></div></header>');
    const withEyebrow = renderToStaticMarkup(<PageHeader title="Tasks" eyebrow="Productivity" />);
    const root = parseHtml(withEyebrow);
    expect(all(root, (e) => e.tag === 'h1').length).toBe(1);
    expect(all(root, (e) => /^h[1-6]$/.test(e.tag)).length).toBe(1); // the eyebrow is a div, so it adds no heading
    expect(withEyebrow).toContain('<div class="ui-eyebrow ui-eyebrow--head">Productivity</div>');
  });

  it('Modal keeps its dialog role, label, close button and (by default) its exact classes; the sheet variant only adds class names', () => {
    const base = renderToStaticMarkup(<Modal title="Add task" onClose={() => {}}><p>Body</p></Modal>);
    expect(base).toContain('<div class="modal-back">');
    expect(base).toContain('class="modal " role="dialog" aria-modal="true" aria-label="Add task"');
    expect(base).toContain('aria-label="Close"');
    const sheet = renderToStaticMarkup(<Modal title="Add task" onClose={() => {}} variant="sheet"><p>Body</p></Modal>);
    expect(sheet).toContain('class="modal-back modal-back--sheet"');
    expect(sheet).toContain('class="modal  modal--sheet" role="dialog" aria-modal="true" aria-label="Add task"');
    expect(sheet.replace(/ modal-back--sheet| modal--sheet/g, '').replace('modal  ', 'modal ')).toBe(base);
    const wide = renderToStaticMarkup(<Modal title="T" onClose={() => {}} wide variant="sheet"><p>x</p></Modal>);
    expect(wide).toContain('class="modal wide modal--sheet"');
  });

  it('only the Add box uses the sheet variant (D10 adopted it); the Add button, search and confirmation dialogs do not', () => {
    for (const f of ['src/shell/QuickAdd.tsx', 'src/shell/SearchDialog.tsx', 'src/shell/ConfirmDialog.tsx']) expect(read(f), f).not.toMatch(/variant=/);
    expect(read('src/shell/AddBox.tsx')).toMatch(/variant="sheet"/);
  });
});

// ---------------------------------------------------------------- 3a. the older palettes cannot change

/** The new appearance tokens and the value each had before D6 (what the stylesheet used to say). */
const D6_DEFAULTS: Record<string, string> = {
  '--field-bg': 'var(--bg)', '--search-bg': 'var(--field-bg)', '--disabled-bg': 'var(--field-bg)', '--disabled-ink': 'var(--fg)',
  '--invalid-line': 'var(--control-line)', '--label-fg': 'var(--muted)', '--ctl-accent': 'auto', '--w-btn': '500',
  '--btn-bg-hover': 'color-mix(in srgb, var(--btn-bg) 88%, var(--fg))',
  '--h1-size': 'var(--fs-xl)', '--h1-weight': '650', '--h1-ls': '-0.01em', '--h1-lh': '1.25', '--ui-eyebrow': 'none',
  '--th-bg': 'var(--bg)', '--th-fg': 'var(--muted)', '--th-fs': 'var(--fs-sm)', '--th-tt': 'none', '--th-ls': 'normal',
  '--scrim': 'rgba(0, 0, 0, 0.5)', '--r-modal': 'var(--r-lg)', '--toast-bg': 'var(--fg)', '--toast-ink': 'var(--bg)', '--toast-edge': 'var(--shadow-2)',
  '--ui-glyph': 'none', '--ui-glyph-legacy': 'inline',
};
const rootBlock = (css: string) => css.match(/^:root \{([\s\S]*?)\n\}/m)?.[1] ?? '';
const decls = (body: string) => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

describe('D6 older palettes are protected: every new appearance token defaults to the value the stylesheet used before', () => {
  const root = decls(rootBlock(tokens));

  it('each new token is declared at :root with its pre-D6 value', () => {
    for (const [k, v] of Object.entries(D6_DEFAULTS)) expect(root[k], k).toBe(v);
  });

  it('the rules that read them reproduce the old declarations when the defaults apply (spot checks of the replaced lines)', () => {
    const has = (s: string) => expect(styles, s).toContain(s);
    has('h1 { font-size: var(--h1-size); line-height: var(--h1-lh); font-weight: var(--h1-weight); letter-spacing: var(--h1-ls);');
    has('.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg);');
    has('border: 1px solid var(--control-line); border-radius: var(--r-md); background: var(--bg); padding: 0 var(--sp-3); }');
    has('button.primary, .btn.primary { background: var(--btn-bg); color: var(--btn-ink); border-color: var(--btn-bg); }');
    has('th { color: var(--th-fg); font-weight: 600; font-size: var(--th-fs); background: var(--th-bg); text-transform: var(--th-tt); letter-spacing: var(--th-ls); }');
    has('background: var(--toast-bg); color: var(--toast-ink); border-radius: var(--r-md); box-shadow: var(--toast-edge); }');
    has('overflow: auto; background: var(--scrim); }');
  });

  it('the pre-existing values these defaults stand on are unchanged (so "the old value" really is the old value)', () => {
    expect(root['--r-md']).toBe('8px');
    expect(root['--r-sm']).toBe('8px'); // controls moved from --r-sm to --r-md: same pixels for every palette that does not set --r-md
    expect(root['--r-lg']).toBe('14px');
    expect(root['--fs-xl']).toBe('1.5rem');
    expect(root['--control-line']).toBe('var(--line-strong)'); // inputs and buttons moved from --line-strong to --control-line: same colour
    expect(root['--btn-bg']).toBe('var(--accent)');
    expect(root['--btn-ink']).toBe('var(--on-accent, #fff)');
    expect(root['--surface']).toBe('var(--card)');
    expect(root['--surface-raised']).toBe('var(--bg)');
    expect(root['--info']).toBe('var(--accent)');
    expect(root['--info-soft']).toBe('var(--accent-soft)');
  });

  it('--fs-md is still NOT defined for everyone (D6 keeps the D5 decision: eight module rules would change); the card title falls back to --fs-lg', () => {
    expect(root['--fs-md']).toBeUndefined();
    expect(styles).toContain('.card-head strong, .card-title { font-size: var(--fs-md, var(--fs-lg)); font-weight: 600; }');
  });

  it('the page title is one step smaller on a phone only through --fs-title, which only Signature reads', () => {
    expect(tokens).toMatch(/@media \(max-width: 640px\) \{\s*:root \{ --fs-title: var\(--fs-title-sm\); \}\s*\}/);
    expect(SIG.extras!.light['--h1-size']).toBe('var(--fs-title)');
  });

  it('no older palette, and not Classic, sets any of the new tokens (only Signature does)', () => {
    const newKeys = [...Object.keys(D6_DEFAULTS), '--r-lg', '--viz-surface', '--viz-s1'];
    for (const p of PRESETS.filter((x) => x.id !== 'signature')) {
      expect(Object.keys(p.extras ?? {}), p.id).toEqual([]);
      for (const mode of ['light', 'dark'] as const) for (const k of newKeys) expect(varsFor(p[mode])[k], `${p.id} ${mode} ${k}`).toBeUndefined();
    }
    for (const k of newKeys) expect(varsFor(CLASSIC.light)[k]).toBeUndefined();
  });

  it('every chart variable keeps its old value as the fallback, in light and in both dark scopes, and series 5 to 8 are never overridable', () => {
    const legacy: Record<string, string> = {
      '--surface-1': '#fcfcfb', '--ink': '#0b0b0b', '--ink-2': '#52514e', '--ink-3': '#898781', '--grid': '#e1e0d9', '--axis': '#c3c2b7',
      '--s1': '#2a78d6', '--s2': '#eb6834', '--s3': '#1baf7a', '--s4': '#eda100', '--s5': '#e87ba4', '--s6': '#008300', '--s7': '#4a3aa7', '--s8': '#e34948',
    };
    const legacyDark: Record<string, string> = {
      '--surface-1': '#1a1a19', '--ink': '#ffffff', '--ink-2': '#c3c2b7', '--ink-3': '#898781', '--grid': '#2c2c2a', '--axis': '#383835',
      '--s1': '#3987e5', '--s2': '#d95926', '--s3': '#199e70', '--s4': '#c98500', '--s5': '#d55181', '--s6': '#008300', '--s7': '#9085e9', '--s8': '#e66767',
    };
    const viz = (re: RegExp) => decls(styles.match(re)?.[1] ?? '');
    const light = viz(/\n\.viz \{([\s\S]*?)\n  background:/);
    const darkMedia = viz(/:root:not\(\[data-theme="light"\]\) \.viz \{([\s\S]*?)\n  \}/);
    const darkForced = viz(/:root\[data-theme="dark"\] \.viz \{([\s\S]*?)\n\}/);
    const fallback = (v: string) => v.replace(/^var\(--viz-[a-z0-9-]+,\s*(.*)\)$/, '$1');
    for (const [k, v] of Object.entries(legacy)) expect(fallback(light[k]), `light ${k}`).toBe(v);
    for (const [k, v] of Object.entries(legacyDark)) {
      expect(fallback(darkMedia[k]), `dark media ${k}`).toBe(v);
      expect(fallback(darkForced[k]), `dark forced ${k}`).toBe(v);
    }
    expect(darkMedia).toEqual(darkForced); // the two dark scopes cannot drift apart
    for (const k of ['--s5', '--s6', '--s7', '--s8']) expect(light[k]).not.toContain('--viz-'); // OD-8: series 5 to 8 keep their validated hues for every palette
  });

  it('no rule reads a --viz-* variable without a fallback (otherwise an older palette would lose its chart colours)', () => {
    expect(styles).not.toMatch(/var\(--viz-[a-z0-9-]+\)/);
  });
});

// ---------------------------------------------------------------- 3b. Signature values are readable

type Vars = Record<string, string>;
const hexOf = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (a: string, b: string, pctOfA: number) => `#${hexOf(a).map((v, i) => Math.round(v * pctOfA + hexOf(b)[i] * (1 - pctOfA)).toString(16).padStart(2, '0')).join('')}`;
/** Resolves a variable that is a hex or a var() chain to a hex, using the colours and extras that a palette puts on the page. */
const sigVars = (mode: 'light' | 'dark'): Vars => ({ ...varsFor(SIG[mode]), ...SIG.extras![mode] });
function resolve(vars: Vars, name: string, seen = 0): string {
  const v = vars[name];
  if (v === undefined || seen > 8) throw new Error(`cannot resolve ${name}`);
  const m = v.match(/^var\((--[a-z0-9-]+)\)$/);
  return m ? resolve(vars, m[1], seen + 1) : v;
}

describe('D6 Ledger Signature: the new shared-component values are readable in light and dark', () => {
  for (const mode of ['light', 'dark'] as const) {
    const v = sigVars(mode);
    const r = (n: string) => resolve(v, n);
    const text = (fg: string, bg: string) => contrastRatio(r(fg), r(bg));

    it(`${mode}: fields: text, placeholder and a 3:1 border on the field fill, and on the search fill`, () => {
      for (const fill of ['--field-bg', '--search-bg']) {
        expect(text('--fg', fill), `fg on ${fill}`).toBeGreaterThanOrEqual(4.5);
        expect(text('--muted', fill), `placeholder on ${fill}`).toBeGreaterThanOrEqual(4.5);
        expect(text('--control-line', fill), `border on ${fill}`).toBeGreaterThanOrEqual(3);
      }
      expect(text('--invalid-line', '--field-bg'), 'error border').toBeGreaterThanOrEqual(3);
      expect(text('--label-fg', '--surface'), 'label on a card').toBeGreaterThanOrEqual(4.5);
      expect(text('--label-fg', '--page'), 'label on the page').toBeGreaterThanOrEqual(4.5);
    });

    it(`${mode}: the filled button, its hover, and the toast read`, () => {
      expect(text('--btn-ink', '--btn-bg')).toBeGreaterThanOrEqual(4.5);
      expect(text('--btn-ink', '--btn-bg-hover'), 'hover').toBeGreaterThanOrEqual(4.5);
      expect(text('--toast-ink', '--toast-bg')).toBeGreaterThanOrEqual(7);
    });

    it(`${mode}: table headings read on their soft fill`, () => {
      expect(text('--th-fg', '--th-bg')).toBeGreaterThanOrEqual(4.5);
    });

    it(`${mode}: chart series 1 to 4 are 3:1 marks on the chart surface, and chart text reads`, () => {
      for (const s of ['--viz-s1', '--viz-s2', '--viz-s3', '--viz-s4']) expect(text(s, '--viz-surface'), s).toBeGreaterThanOrEqual(3);
      expect(text('--viz-ink', '--viz-surface')).toBeGreaterThanOrEqual(7);
      expect(text('--viz-ink-2', '--viz-surface')).toBeGreaterThanOrEqual(4.5);
      expect(text('--viz-ink-3', '--viz-surface')).toBeGreaterThanOrEqual(4.5);
      // Charts use the series slots by position (Spending is series 2 and Income series 3, for example), so any two of the four must be told apart:
      // clearly different in lightness, or clearly different in hue (RGB distance). The D4 tonal ramp (navy, teal, light teal, grey-blue) failed this
      // for neighbouring slots; see the D6 report.
      const four = ['--viz-s1', '--viz-s2', '--viz-s3', '--viz-s4'].map(r);
      expect(new Set(four).size).toBe(4);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        const [a, b] = [hexOf(four[i]), hexOf(four[j])];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(contrastRatio(four[i], four[j]) >= 1.5 || dist >= 100, `${mode} series ${i + 1} and ${j + 1}`).toBe(true);
      }
    });
  }

  it('light and dark define the same new variables; the shared ones are identical text, the colours differ by mode', () => {
    expect(Object.keys(SIG.extras!.light).sort()).toEqual(Object.keys(SIG.extras!.dark).sort());
    for (const k of ['--field-bg', '--btn-bg-hover', '--scrim', '--toast-bg', '--toast-ink', '--viz-s1', '--viz-s2', '--viz-s3', '--viz-s4']) expect(SIG.extras!.light[k], k).not.toBe(SIG.extras!.dark[k]);
    for (const k of ['--r-lg', '--r-modal', '--w-btn', '--h1-weight', '--th-tt', '--ui-glyph']) expect(SIG.extras!.light[k], k).toBe(SIG.extras!.dark[k]);
  });

  it('every new Signature variable is declared in the token file or is a chart variable (so none is a typo)', () => {
    const declared = new Set(Object.keys(decls(rootBlock(tokens))));
    for (const mode of ['light', 'dark'] as const) for (const k of Object.keys(SIG.extras![mode])) expect(declared.has(k) || k.startsWith('--viz-') || k === '--fs-md' || /^--shadow-[123]$/.test(k), k).toBe(true);
  });
});

describe('D6 chip, tile and notice tones read on every palette (the tint text pairs used by the shared classes)', () => {
  const sets: Array<[string, 'light' | 'dark', PaletteColors]> = [];
  for (const mode of ['light', 'dark'] as const) {
    sets.push(['classic', mode, CLASSIC[mode]]);
    for (const p of PRESETS) sets.push([p.id, mode, p[mode]]);
  }
  for (const [id, mode, c] of sets) {
    it(`${id} ${mode}: status text on its own tint, date-tile labels on their tints, and the small labels on the soft fills`, () => {
      const sig = id === 'signature' ? SIG.extras![mode] : null;
      const pairs: Array<[string, string, string]> = [];
      for (const [tone, pct] of [['accent', 0.12], ['pos', 0.13], ['neg', 0.13], ['warn', 0.14]] as const) {
        const tint = mixHex(c[tone], c.bg, pct);
        pairs.push([`${tone} text on ${tone} tint`, mixHex(c[tone], c.fg, 0.78), tint]);
      }
      const info = sig?.['--info'] ?? c.accent;
      const infoSoft = sig?.['--info-soft'] ?? mixHex(c.accent, c.bg, 0.12);
      pairs.push(['info text on info tint', mixHex(info, c.fg, 0.78), infoSoft]);
      const surface = c.surface ?? c.card;
      const soft = sig?.['--surface-soft'] ?? mixHex(c.fg, surface, 0.04);
      const sunken = sig?.['--surface-sunken'] ?? mixHex(c.fg, surface, 0.08);
      const fg2 = sig?.['--fg-2'] ?? mixHex(c.fg, c.muted, 0.78);
      pairs.push(['default tile label (quiet text) on the soft fill', c.muted, soft], ['weekend tile label on the sunken fill', c.muted, sunken], ['neutral chip text on the sunken fill', fg2, sunken], ['segmented option text on the track', fg2, sunken], ['selected segment text on the card', c.fg, surface]);
      for (const [name, fg, bg] of pairs) expect(contrastRatio(fg, bg), `${id} ${mode}: ${name}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// ---------------------------------------------------------------- 3c. the shared stylesheet follows its own rules

describe('D6 src/ui/components.css follows the rules for the shared stylesheet', () => {
  const code = components.replace(/\/\*[\s\S]*?\*\//g, '');

  it('uses no colour literal of its own (only tokens, system colour words in the forced-colours block, and the keywords transparent/currentColor)', () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });
  it('has no priority override, no cascade layer, and loads no font', () => {
    expect(code).not.toMatch(/!important/);
    expect(code).not.toMatch(/@layer|@font-face|url\(/);
  });
  it('every selector class it defines starts with ui- (or is the dialog sheet pair, which extends the existing .modal classes)', () => {
    const classes = new Set([...code.matchAll(/\.([a-z][a-z0-9-_]*)/g)].map((m) => m[1]));
    const odd = [...classes].filter((c) => !c.startsWith('ui-') && !['modal-back', 'modal', 'sr-only', 'on', 'active', 'row', 'fm-actions'].includes(c) && !c.startsWith('modal'));
    expect(odd).toEqual([]);
  });
  it('is still imported right after the tokens, and defines its two animations only here (reduced motion switches animation off app-wide)', () => {
    expect(styles.split('\n').slice(0, 2)).toEqual(["@import './ui/tokens.css';", "@import './ui/components.css';"]);
    expect(styles).toMatch(/prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ transition: none !important; animation: none !important;/);
    expect([...code.matchAll(/@keyframes ([a-z-]+)/g)].map((m) => m[1])).toEqual(['ui-spin']);
  });
  it('the number of priority overrides in the app did not grow (11 before D6)', () => {
    expect(measure().important).toBeLessThanOrEqual(BASELINE.important);
  });
});
