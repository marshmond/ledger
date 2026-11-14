/**
 * Color palettes (D21.1). Ledger has ONE design system, Ledger Signature: layout, type, corners, header, navigation, tables, dialogs and charts' structure all live in
 * the stylesheets (src/ui/tokens.css, src/ui/palette-base.css, src/styles.css) and are the same for everyone. A palette only chooses COLORS, for Light and Dark:
 * five curated palettes (Signature Navy is the default, and is what the stylesheet itself draws when nothing is saved) and "My own colors" (a custom palette built
 * from twelve colors, with the rest derived, see `deriveExtras`). Light, Dark and Device mode is separate (src/theme.ts).
 *
 * The choice is remembered per device in localStorage. index.html applies the saved values before first paint so there is no flash.
 * Older saved choices (Classic, Calm teal, Deep navy and gold, Forest green and stone, Slate and indigo, and the earlier "signature") are read through
 * LEGACY_PALETTE_MAP: nothing is deleted, and `migrateStoredPalette` rewrites the stored choice once, keeping the old id in `from`.
 */

export interface Colors {
  /** Page background. */
  bg: string;
  /** Cards and panels. */
  card: string;
  /** Main text. */
  fg: string;
  /** Quieter text (hints, labels). */
  muted: string;
  /** Lines and borders. */
  line: string;
  /** Buttons, links, and the active page. */
  accent: string;
  /** Good news: gains, refunds, money in. */
  pos: string;
  /** Bad news: losses, overspending, money you owe. */
  neg: string;
  /** Warnings. */
  warn: string;
  /** Menu bar background (the Ledger bar under the header; the role keeps its stored name `sideBg`). */
  sideBg: string;
  /** Menu bar text. */
  sideFg: string;
  /** The active section in the menu bar. */
  sideActive: string;
}

/**
 * A preset also sets two OPTIONAL roles. They are deliberately not part of `Colors` or COLOR_ROLES, so the colour map, saved themes, theme codes,
 * stored custom palettes and every existing signature keep working untouched.
 */
export interface PaletteColors extends Colors {
  /** The canvas behind everything, when it should differ from `bg` (the ground for inputs and table headings). Absent means `bg`. */
  page?: string;
  /** The fill of cards and panels, when it should differ from `card`. Absent means `card`. */
  surface?: string;
}

export type ColorKey = keyof Colors;

/** The twelve required colours only (what "My own colors" starts from, so editing "Page background" in the map still changes the whole canvas). */
export function withoutOptional(c: PaletteColors): Colors {
  const { page: _page, surface: _surface, ...rest } = c;
  return rest;
}

export interface ColorRole {
  key: ColorKey;
  label: string;
  help: string;
}

/** The color map shown when you build your own palette. */
export const COLOR_ROLES: ColorRole[] = [
  { key: 'bg', label: 'Page background', help: 'Behind everything.' },
  { key: 'card', label: 'Cards and panels', help: 'Boxes that group things, and table stripes.' },
  { key: 'fg', label: 'Text', help: 'Headings, numbers, and body text.' },
  { key: 'muted', label: 'Quiet text', help: 'Hints, labels, and dates.' },
  { key: 'line', label: 'Lines and borders', help: 'Dividers and outlines.' },
  { key: 'accent', label: 'Main accent', help: 'Buttons, links, and the selected tab.' },
  { key: 'pos', label: 'Good news', help: 'Gains, refunds, and money in.' },
  { key: 'neg', label: 'Bad news', help: 'Losses, overspending, and money owed.' },
  { key: 'warn', label: 'Warnings', help: 'Things that need a look.' },
  { key: 'sideBg', label: 'Menu bar background', help: 'The Ledger menu bar under the header (computer-width screens).' },
  { key: 'sideFg', label: 'Menu bar text', help: 'Menu names.' },
  { key: 'sideActive', label: 'Menu bar highlight', help: 'The section you are in.' },
];

export type PresetId = 'signature-navy' | 'coastal-slate' | 'evergreen' | 'warm-stone' | 'midnight-plum';
export type PaletteId = PresetId | 'custom';

/** The ids earlier versions stored. They are only ever READ (never written), and each maps to one of the five palettes. */
export type LegacyPaletteId = 'classic' | 'signature' | 'navy' | 'teal' | 'forest' | 'slate';
export const LEGACY_PALETTE_MAP: Record<LegacyPaletteId, PresetId> = {
  classic: 'signature-navy',   // Classic stored nothing; accepted in case a copy ever stored it
  signature: 'signature-navy', // the same look, new name
  navy: 'signature-navy',      // "Deep navy and gold": the navy family
  teal: 'evergreen',           // "Calm teal": soft, natural, green-teal
  forest: 'evergreen',         // "Forest green and stone"
  slate: 'coastal-slate',      // "Slate and indigo": cool grey-blue
};
export const isLegacyId = (id: unknown): id is LegacyPaletteId => typeof id === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_PALETTE_MAP, id);

/**
 * The variables a palette may set besides the twelve colours (and --page, --surface, --on-*). All are COLOURS (or colour-bearing shadows/strings), never sizes or
 * layout: structure is the same for every palette, and a test pins that. Every preset sets every one of these for both modes, and `deriveExtras` sets every one for
 * custom palettes, so switching palettes never leaves one behind.
 */
export const EXTRA_KEYS = [
  '--surface-raised', '--surface-soft', '--surface-sunken', '--fg-2', '--control-line', '--field-bg',
  '--btn-bg', '--btn-bg-hover', '--btn-ink', '--info', '--info-soft', '--shadow-rgb',
  '--scrim', '--toast-bg', '--toast-ink', '--toast-edge',
  '--viz-s1', '--viz-s2', '--viz-s3', '--viz-s4',
  '--viz-c1', '--viz-c2', '--viz-c3', '--viz-c4', '--viz-c5', '--viz-c6',
  '--viz-hc1', '--viz-hc2', '--viz-hc3', '--viz-hc4', '--viz-hc5',
  '--hero-bg', '--hero-ink', '--hero-ink-2', '--hero-line', '--hero-pos', '--hero-neg', '--chart-spend',
] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];
type Extras = Record<ExtraKey, string>;

export interface PaletteDef {
  id: PresetId;
  name: string;
  blurb: string;
  light: PaletteColors;
  dark: PaletteColors;
  extras: { light: Record<string, string>; dark: Record<string, string> };
}

// ---------- the five palettes ----------

/** What one mode of a palette is made of. The status colours (good, bad, warning, informational) are SHARED by all five palettes: a gain, a loss or a warning means the same thing everywhere. */
interface ModeSpec {
  page: string; surface: string; raised: string; soft: string; sunken: string; field: string;
  fg: string; fg2: string; muted: string; line: string; control: string;
  accent: string; sideBg: string;
  btn: string; btnHover: string;
  shadowRgb: string; scrim: string; toastBg: string; toastInk: string; toastEdge: string;
  s: [string, string, string, string];
  c: [string, string, string, string, string, string];
  hc: [string, string, string, string, string];
  heroBg: string; heroInk2: string; spend: string;
}

const STATUS = {
  light: { pos: '#23694F', neg: '#B0443B', warn: '#8F5D16', info: '#3B6BA3', infoSoft: '#E6EEF8' },
  dark: { pos: '#72CBA3', neg: '#F2928A', warn: '#E5B865', info: '#8FB0E6', infoSoft: '#1B2A47' },
};
/** The text and lines on the dark Home panel (the panel is dark in both modes). The good and bad tints are the same everywhere. */
const HERO = { ink: '#FFFFFF', line: 'rgba(255, 255, 255, 0.16)', pos: '#8EE0B8', neg: '#FFB3AB' };

function build(id: PresetId, name: string, blurb: string, L: ModeSpec, D: ModeSpec): PaletteDef {
  const one = (m: ModeSpec, dark: boolean): { colors: PaletteColors; extras: Extras } => {
    const st = STATUS[dark ? 'dark' : 'light'];
    const colors: PaletteColors = {
      bg: m.surface, card: m.surface, fg: m.fg, muted: m.muted, line: m.line, accent: m.accent, pos: st.pos, neg: st.neg, warn: st.warn,
      sideBg: m.sideBg, sideFg: m.fg, sideActive: m.accent, page: m.page, surface: m.surface,
    };
    const extras: Extras = {
      '--surface-raised': m.raised, '--surface-soft': m.soft, '--surface-sunken': m.sunken, '--fg-2': m.fg2, '--control-line': m.control, '--field-bg': m.field,
      '--btn-bg': m.btn, '--btn-bg-hover': m.btnHover, '--btn-ink': '#FFFFFF', '--info': st.info, '--info-soft': st.infoSoft, '--shadow-rgb': m.shadowRgb,
      '--scrim': m.scrim, '--toast-bg': m.toastBg, '--toast-ink': m.toastInk, '--toast-edge': m.toastEdge,
      '--viz-s1': m.s[0], '--viz-s2': m.s[1], '--viz-s3': m.s[2], '--viz-s4': m.s[3],
      '--viz-c1': m.c[0], '--viz-c2': m.c[1], '--viz-c3': m.c[2], '--viz-c4': m.c[3], '--viz-c5': m.c[4], '--viz-c6': m.c[5],
      '--viz-hc1': m.hc[0], '--viz-hc2': m.hc[1], '--viz-hc3': m.hc[2], '--viz-hc4': m.hc[3], '--viz-hc5': m.hc[4],
      '--hero-bg': m.heroBg, '--hero-ink': HERO.ink, '--hero-ink-2': m.heroInk2, '--hero-line': HERO.line, '--hero-pos': HERO.pos, '--hero-neg': HERO.neg, '--chart-spend': m.spend,
    };
    return { colors, extras };
  };
  const l = one(L, false);
  const d = one(D, true);
  return { id, name, blurb, light: l.colors, dark: d.colors, extras: { light: l.extras, dark: d.extras } };
}

export const PRESETS: PaletteDef[] = [
  // 1. Signature Navy: the approved Ledger Signature look, unchanged (D5 to D21 values; src/ui/palette-base.css repeats them as the stylesheet default, and a test compares the two).
  build('signature-navy', 'Signature Navy', 'The Ledger look: deep navy and muted teal on a cool grey canvas, with white cards.',
    {
      page: '#EEF1F6', surface: '#FFFFFF', raised: '#FFFFFF', soft: '#F6F8FB', sunken: '#EEF2F8', field: '#FFFFFF',
      fg: '#101B33', fg2: '#37445B', muted: '#566379', line: '#DFE5EE', control: '#7A879F',
      accent: '#267880', sideBg: '#F6F8FB', btn: '#0E1A33', btnHover: '#1C2D52',
      shadowRgb: '14, 26, 51', scrim: 'rgba(11, 18, 32, 0.55)', toastBg: '#0E1A33', toastInk: '#FFFFFF', toastEdge: 'var(--shadow-2)',
      s: ['#1D3A6B', '#267880', '#A8730F', '#8391AA'], c: ['#1D3A6B', '#267880', '#5FAAB2', '#8391AA', '#A8730F', '#B3BDCF'],
      hc: ['#8FB0E6', '#3A9AA4', '#7DC8CF', '#D0D8E6', '#E5B865'], heroBg: '#0E1A33', heroInk2: '#B6C3DB', spend: '#1D3A6B',
    },
    {
      page: '#0B1220', surface: '#131D31', raised: '#182339', soft: '#182339', sunken: '#1E2B46', field: '#0E1727',
      fg: '#E9EEF7', fg2: '#C3CDDF', muted: '#9AA8BF', line: '#26354F', control: '#6F82A3',
      accent: '#6CC0C8', sideBg: '#0B1220', btn: '#277A83', btnHover: '#216D75',
      shadowRgb: '0, 0, 0', scrim: 'rgba(3, 7, 14, 0.7)', toastBg: '#223454', toastInk: '#E9EEF7', toastEdge: 'var(--shadow-2), inset 0 0 0 1px #3A4D72',
      s: ['#8FB0E6', '#3A9AA4', '#E5B865', '#D0D8E6'], c: ['#8FB0E6', '#3A9AA4', '#7DC8CF', '#D0D8E6', '#E5B865', '#6F82A3'],
      hc: ['#8FB0E6', '#3A9AA4', '#7DC8CF', '#D0D8E6', '#E5B865'], heroBg: '#1B2D52', heroInk2: '#B6C3DB', spend: '#8FB0E6',
    }),

  // 2. Coastal Slate: cool, understated, professional. Primary #34475A, accent family #668999 (the link colour is a darker step of it so text reads at 4.5:1).
  build('coastal-slate', 'Coastal Slate', 'Cool and understated: slate blue with a soft sea-glass accent. Professional and calm.',
    {
      page: '#F1F4F6', surface: '#FFFFFF', raised: '#FFFFFF', soft: '#F7F9FA', sunken: '#EAEFF2', field: '#FFFFFF',
      fg: '#17222D', fg2: '#364552', muted: '#546370', line: '#DCE2E8', control: '#76879A',
      accent: '#376679', sideBg: '#F7F9FA', btn: '#34475A', btnHover: '#2A3A4A',
      shadowRgb: '27, 41, 58', scrim: 'rgba(14, 21, 30, 0.55)', toastBg: '#2A3A4A', toastInk: '#FFFFFF', toastEdge: 'var(--shadow-2)',
      s: ['#34475A', '#3F7087', '#A8730F', '#8493A0'], c: ['#34475A', '#5F8393', '#9DB6C2', '#8D9BA8', '#A8730F', '#B8C3CC'],
      hc: ['#A9C0D4', '#7FA4B7', '#B8D3DD', '#D5DEE6', '#E5B865'], heroBg: '#2A3A4A', heroInk2: '#BFCBD6', spend: '#34475A',
    },
    {
      page: '#0D141B', surface: '#151E27', raised: '#1A2530', soft: '#1A2530', sunken: '#212E3B', field: '#0F1820',
      fg: '#E8EDF1', fg2: '#C4CFD9', muted: '#98A8B6', line: '#27333F', control: '#6E8091',
      accent: '#8DB5C7', sideBg: '#0D141B', btn: '#436C80', btnHover: '#3B6073',
      shadowRgb: '0, 0, 0', scrim: 'rgba(3, 7, 12, 0.7)', toastBg: '#243645', toastInk: '#E8EDF1', toastEdge: 'var(--shadow-2), inset 0 0 0 1px #3B5063',
      s: ['#7FA6BC', '#4D8399', '#E5B865', '#CBD6DF'], c: ['#9DBBCC', '#6C98AC', '#A7C6D3', '#CBD6DF', '#E5B865', '#6E8091'],
      hc: ['#A9C0D4', '#7FA4B7', '#B8D3DD', '#D5DEE6', '#E5B865'], heroBg: '#1F3042', heroInk2: '#B9C7D3', spend: '#9DBBCC',
    }),

  // 3. Evergreen: natural, grounded, sophisticated. Primary #24483D, accent family #729481.
  build('evergreen', 'Evergreen', 'Natural and grounded: deep forest green with a soft sage accent on a pale green-grey canvas.',
    {
      page: '#F0F4EF', surface: '#FFFFFF', raised: '#FFFFFF', soft: '#F6F9F5', sunken: '#E8EEE7', field: '#FFFFFF',
      fg: '#16241F', fg2: '#34453D', muted: '#52645A', line: '#DAE3D9', control: '#738679',
      accent: '#2F6A55', sideBg: '#F6F9F5', btn: '#24483D', btnHover: '#1B382F',
      shadowRgb: '20, 45, 36', scrim: 'rgba(9, 21, 17, 0.55)', toastBg: '#24483D', toastInk: '#FFFFFF', toastEdge: 'var(--shadow-2)',
      s: ['#24483D', '#3F7A5F', '#A8730F', '#7F9488'], c: ['#24483D', '#4F8068', '#8DB59F', '#8FA397', '#A8730F', '#B8C6BC'],
      hc: ['#9FC4B0', '#6FA58A', '#B5D6C5', '#D3E0D8', '#E5B865'], heroBg: '#1F3F35', heroInk2: '#B7CCC2', spend: '#24483D',
    },
    {
      page: '#0C1411', surface: '#131E19', raised: '#18251F', soft: '#18251F', sunken: '#1F2E27', field: '#0E1814',
      fg: '#E6EEE9', fg2: '#C2D0C8', muted: '#96A89E', line: '#25352D', control: '#6C8277',
      accent: '#7FBF9F', sideBg: '#0C1411', btn: '#2B7258', btnHover: '#246049',
      shadowRgb: '0, 0, 0', scrim: 'rgba(3, 9, 6, 0.7)', toastBg: '#213A30', toastInk: '#E6EEE9', toastEdge: 'var(--shadow-2), inset 0 0 0 1px #3A584B',
      s: ['#8FBBA4', '#4F8F70', '#E5B865', '#D3E0D8'], c: ['#9FC4B0', '#6FA58A', '#B5D6C5', '#D3E0D8', '#E5B865', '#6C8277'],
      hc: ['#9FC4B0', '#6FA58A', '#B5D6C5', '#D3E0D8', '#E5B865'], heroBg: '#1B3A2E', heroInk2: '#B7CCC2', spend: '#9FC4B0',
    }),

  // 4. Warm Stone: warm, soft, approachable. Primary #51493F, accent family #9F816B.
  build('warm-stone', 'Warm Stone', 'Warm and soft: taupe and clay on a pale sand canvas. Approachable without being playful.',
    {
      page: '#F7F4EE', surface: '#FFFFFF', raised: '#FFFFFF', soft: '#FBF9F5', sunken: '#F0ECE4', field: '#FFFFFF',
      fg: '#26211B', fg2: '#4A4238', muted: '#645A4F', line: '#E4DED3', control: '#847968',
      accent: '#7A5C46', sideBg: '#FBF9F5', btn: '#51493F', btnHover: '#3F3830',
      shadowRgb: '60, 48, 36', scrim: 'rgba(26, 20, 14, 0.55)', toastBg: '#3F3830', toastInk: '#FFFFFF', toastEdge: 'var(--shadow-2)',
      s: ['#51493F', '#2A7F7F', '#A8730F', '#9A9183'], c: ['#51493F', '#9F816B', '#C4AE9C', '#A9A196', '#3E7A80', '#D8D0C3'],
      hc: ['#D1BBA8', '#B99A80', '#E3D2C3', '#EDE6DC', '#8CC1C5'], heroBg: '#3F382F', heroInk2: '#D1C8BB', spend: '#51493F',
    },
    {
      page: '#14110E', surface: '#1D1915', raised: '#231F1A', soft: '#231F1A', sunken: '#2B2620', field: '#16130F',
      fg: '#EDE8E0', fg2: '#D0C8BC', muted: '#A39A8D', line: '#332D26', control: '#857A6C',
      accent: '#D1AE93', sideBg: '#14110E', btn: '#8A6A52', btnHover: '#7B5E47',
      shadowRgb: '0, 0, 0', scrim: 'rgba(8, 6, 4, 0.7)', toastBg: '#3A332B', toastInk: '#EDE8E0', toastEdge: 'var(--shadow-2), inset 0 0 0 1px #544A3F',
      s: ['#C9A68B', '#8E6E57', '#6FB5C9', '#E4DCCF'], c: ['#D1AE93', '#B8967C', '#E3D2C3', '#D8D0C3', '#7DC0C6', '#857A6C'],
      hc: ['#D1BBA8', '#B99A80', '#E3D2C3', '#EDE6DC', '#8CC1C5'], heroBg: '#332C25', heroInk2: '#D1C8BB', spend: '#D1AE93',
    }),

  // 5. Midnight Plum: rich and contemporary. Primary #40334E, accent family #8D789F.
  build('midnight-plum', 'Midnight Plum', 'Rich and contemporary: deep plum with a soft lilac accent on a pale lavender-grey canvas.',
    {
      page: '#F3F0F6', surface: '#FFFFFF', raised: '#FFFFFF', soft: '#F8F6FA', sunken: '#ECE8F0', field: '#FFFFFF',
      fg: '#1F1828', fg2: '#443A52', muted: '#5C5369', line: '#E2DCE8', control: '#80748E',
      accent: '#6B5580', sideBg: '#F8F6FA', btn: '#40334E', btnHover: '#31263D',
      shadowRgb: '40, 28, 58', scrim: 'rgba(20, 12, 30, 0.55)', toastBg: '#31263D', toastInk: '#FFFFFF', toastEdge: 'var(--shadow-2)',
      s: ['#40334E', '#6A4F8C', '#A8730F', '#8F859C'], c: ['#40334E', '#8D789F', '#B9A9C9', '#A59BB3', '#2F7F85', '#D5CCDE'],
      hc: ['#C9B8DA', '#A58FBB', '#DCCFE8', '#EAE3F0', '#8CC9CD'], heroBg: '#33283F', heroInk2: '#CABFD6', spend: '#40334E',
    },
    {
      page: '#120E18', surface: '#1B1624', raised: '#211B2B', soft: '#211B2B', sunken: '#2A2336', field: '#150F1C',
      fg: '#EDE8F3', fg2: '#CFC6DC', muted: '#A094B2', line: '#30283C', control: '#85799A',
      accent: '#C0A8DA', sideBg: '#120E18', btn: '#76599A', btnHover: '#684D89',
      shadowRgb: '0, 0, 0', scrim: 'rgba(6, 3, 10, 0.7)', toastBg: '#34293F', toastInk: '#EDE8F3', toastEdge: 'var(--shadow-2), inset 0 0 0 1px #4F4163',
      s: ['#B79BD6', '#7A5F98', '#E5B865', '#E1D8EB'], c: ['#C0A8DA', '#9C84B8', '#DCCFE8', '#D5CCDE', '#7DC4C9', '#85799A'],
      hc: ['#C9B8DA', '#A58FBB', '#DCCFE8', '#EAE3F0', '#8CC9CD'], heroBg: '#2D2340', heroInk2: '#CABFD6', spend: '#C0A8DA',
    }),
];

export const DEFAULT_PRESET: PresetId = 'signature-navy';

export interface PaletteChoice {
  id: PaletteId;
  /** Your own colors, for light and dark (used when id is 'custom'). */
  custom?: { light: Colors; dark: Colors };
  /** The saved theme these colors came from (see lib/savedThemes.ts), so it can be updated. */
  savedId?: string;
  /** Set once when an older stored choice was moved to one of the five palettes: the id it had (kept, never deleted, so nothing about the old choice is lost). */
  from?: string;
}

export const DEFAULT_CHOICE: PaletteChoice = { id: DEFAULT_PRESET };

// ---------- color math ----------

const HEX = /^#([0-9a-f]{6})$/i;
export const isHex = (s: string): boolean => HEX.test(s);

function rgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1 to 21). 4.5 is the usual minimum for text. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on top of the given color (for text on buttons). */
export const onColor = (bg: string): string => (contrastRatio('#FFFFFF', bg) >= contrastRatio('#111111', bg) ? '#FFFFFF' : '#111111');

/** `t` of the way from `a` to `b` (0 gives a, 1 gives b), as an uppercase hex colour. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const h = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${h(ar, br)}${h(ag, bg)}${h(ab, bb)}`.toUpperCase();
}

export interface ContrastNote {
  key: ColorKey;
  ratio: number;
  min: number;
  message: string;
}

/** Combinations that would be hard to read, with a plain-language message. */
export function contrastNotes(c: Colors): ContrastNote[] {
  const checks: { key: ColorKey; against: ColorKey; min: number; message: string }[] = [
    { key: 'fg', against: 'bg', min: 4.5, message: 'Text is hard to read on the page background.' },
    { key: 'fg', against: 'card', min: 4.5, message: 'Text is hard to read on cards.' },
    { key: 'muted', against: 'bg', min: 4.5, message: 'Quiet text is hard to read on the page background.' },
    { key: 'accent', against: 'bg', min: 3, message: 'The accent barely stands out from the page background.' },
    { key: 'pos', against: 'card', min: 3, message: 'Good-news color is hard to see on cards.' },
    { key: 'neg', against: 'card', min: 3, message: 'Bad-news color is hard to see on cards.' },
    { key: 'warn', against: 'card', min: 3, message: 'Warning color is hard to see on cards.' },
    { key: 'sideFg', against: 'sideBg', min: 4.5, message: 'Menu bar text is hard to read on the menu bar background.' },
    { key: 'sideActive', against: 'sideBg', min: 3, message: 'The menu bar highlight barely stands out.' },
  ];
  return checks.flatMap((k) => {
    const ratio = contrastRatio(c[k.key], c[k.against]);
    return ratio < k.min ? [{ key: k.key, ratio, min: k.min, message: k.message }] : [];
  });
}

// ---------- custom palettes: the adapter ----------

/**
 * A custom palette (and every saved theme) stores only the twelve colours. The rest of what the Signature interface reads is DERIVED here from those twelve, in plain
 * terms: buttons use the accent, raised surfaces and fields use the page background, the chart colours are a fixed readable set, and the dark Home panel is a dark tone
 * of the text colour (light mode) or of the accent (dark mode) with text that is checked against it. Nothing stored is changed; a theme made years ago renders through this.
 */
export function deriveExtras(c: Colors, dark: boolean): Extras {
  const accentSoft = mixHex(c.bg, c.accent, 0.12);
  // The dark Home panel. Candidate first; if its text could not reach 7:1 (an unusual palette), darken it until it does.
  let heroBg = dark ? mixHex(c.bg, c.accent, 0.22) : mixHex(c.bg, c.fg, 0.9);
  for (let i = 0; i < 6 && contrastRatio(onColor(heroBg), heroBg) < 7; i++) heroBg = mixHex(heroBg, '#000000', 0.25);
  const heroInk = onColor(heroBg);
  const readable = (tint: string, fallback: string) => (contrastRatio(tint, heroBg) >= 4.5 ? tint : fallback);
  const heroInk2 = readable(mixHex(heroInk, heroBg, 0.3), heroInk);
  const heroPos = readable(mixHex(c.pos, heroInk, 0.45), heroInk);
  const heroNeg = readable(mixHex(c.neg, heroInk, 0.45), heroInk);
  const ramp = dark
    ? ['#7AA2EE', '#E8946A', '#52C08F', '#B894E8', '#EE86C0', '#A3ACBB'] // light steps of fixed, distinct hues
    : ['#3F7FD9', '#E08A2B', '#3AA17E', '#9B6AD6', '#D65F7A', '#7A8794'];
  const series = dark ? ['#3987E5', '#D95926', '#199E70', '#C98500'] : ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100'];
  return {
    '--surface-raised': c.bg,
    '--surface-soft': mixHex(c.card, c.fg, 0.04),
    '--surface-sunken': mixHex(c.card, c.fg, 0.08),
    '--fg-2': mixHex(c.fg, c.muted, 0.22),
    '--control-line': mixHex(c.bg, c.fg, 0.24),
    '--field-bg': c.bg,
    '--btn-bg': c.accent,
    '--btn-bg-hover': mixHex(c.accent, c.fg, 0.12),
    '--btn-ink': onColor(c.accent),
    '--info': c.accent,
    '--info-soft': accentSoft,
    '--shadow-rgb': dark ? '0, 0, 0' : '16, 24, 40',
    '--scrim': dark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
    '--toast-bg': c.fg,
    '--toast-ink': c.bg,
    '--toast-edge': 'var(--shadow-2)',
    '--viz-s1': series[0], '--viz-s2': series[1], '--viz-s3': series[2], '--viz-s4': series[3],
    '--viz-c1': ramp[0], '--viz-c2': ramp[1], '--viz-c3': ramp[2], '--viz-c4': ramp[3], '--viz-c5': ramp[4], '--viz-c6': ramp[5],
    '--viz-hc1': ramp[0], '--viz-hc2': ramp[1], '--viz-hc3': ramp[2], '--viz-hc4': ramp[3], '--viz-hc5': ramp[4],
    '--hero-bg': heroBg,
    '--hero-ink': heroInk,
    '--hero-ink-2': heroInk2,
    '--hero-line': heroInk === '#FFFFFF' ? 'rgba(255, 255, 255, 0.16)' : 'rgba(17, 17, 17, 0.2)',
    '--hero-pos': heroPos,
    '--hero-neg': heroNeg,
    '--chart-spend': ramp[1],
  };
}

// ---------- applying ----------

/** CSS variables for a set of colors. `--page` and `--surface` are always written: they fall back to `bg` and `card` (also when a stored value is not a valid hex). */
export function varsFor(c: PaletteColors): Record<string, string> {
  return {
    '--bg': c.bg,
    '--card': c.card,
    '--page': c.page && isHex(c.page) ? c.page : c.bg,
    '--surface': c.surface && isHex(c.surface) ? c.surface : c.card,
    '--fg': c.fg,
    '--muted': c.muted,
    '--line': c.line,
    '--accent': c.accent,
    '--pos': c.pos,
    '--neg': c.neg,
    '--warn': c.warn,
    '--side-bg': c.sideBg,
    '--side-fg': c.sideFg,
    '--side-active': c.sideActive,
    '--on-accent': onColor(c.accent),
    '--on-pos': onColor(c.pos),
    '--on-warn': onColor(c.warn),
  };
}

export function colorsOf(choice: PaletteChoice, dark: boolean): PaletteColors {
  if (choice.id === 'custom' && choice.custom) return dark ? choice.custom.dark : choice.custom.light;
  const p = PRESETS.find((x) => x.id === choice.id) ?? PRESETS[0];
  return dark ? p.dark : p.light;
}

/** The extra variables beyond the twelve colours: the preset's own, or (custom palettes) derived from the twelve. */
export function extrasOf(choice: PaletteChoice, dark: boolean): Record<string, string> {
  if (choice.id === 'custom' && choice.custom) return deriveExtras(dark ? choice.custom.dark : choice.custom.light, dark);
  const p = PRESETS.find((x) => x.id === choice.id) ?? PRESETS[0];
  return { ...p.extras[dark ? 'dark' : 'light'] };
}

/** Every variable for one mode: the colours, then the extras. */
export function varsOf(choice: PaletteChoice, dark: boolean): Record<string, string> {
  return { ...varsFor(colorsOf(choice, dark)), ...extrasOf(choice, dark) };
}

/** Variables for a set of twelve colours as a custom palette (used by the editor's preview). */
export const customVars = (c: Colors, dark: boolean): Record<string, string> => ({ ...varsFor(c), ...deriveExtras(c, dark) });

/** Both schemes resolved to CSS variables (what index.html reads before first paint). `v` marks the format: an older copy without it is ignored by index.html and rewritten by the app. */
export function resolvedVars(choice: PaletteChoice): { v: number; light: Record<string, string>; dark: Record<string, string> } {
  return { v: VARS_VERSION, light: varsOf(choice, false), dark: varsOf(choice, true) };
}

export const PALETTE_KEY = 'ledger-palette';
export const PALETTE_VARS_KEY = 'ledger-palette-vars';
export const VARS_VERSION = 2;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function validColors(c: unknown): c is Colors {
  if (!c || typeof c !== 'object') return false;
  return COLOR_ROLES.every((r) => typeof (c as Record<string, unknown>)[r.key] === 'string' && isHex((c as Record<string, string>)[r.key]));
}

/** Reads a saved choice, tolerating anything odd in storage (it falls back to Signature Navy). An older id is read as the palette it maps to; `from` keeps the old id. */
export function parseChoice(raw: unknown): PaletteChoice {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return DEFAULT_CHOICE;
    const id = (o as { id?: unknown }).id;
    const from = (o as { from?: unknown }).from;
    if (id === 'custom') {
      const c = (o as { custom?: { light?: unknown; dark?: unknown } }).custom;
      const savedId = (o as { savedId?: unknown }).savedId;
      return c && validColors(c.light) && validColors(c.dark) ? { id: 'custom', custom: { light: c.light, dark: c.dark }, ...(typeof savedId === 'string' ? { savedId } : {}) } : DEFAULT_CHOICE;
    }
    if (isLegacyId(id)) return { id: LEGACY_PALETTE_MAP[id], from: id };
    return PRESETS.some((p) => p.id === id) ? { id: id as PresetId, ...(typeof from === 'string' ? { from } : {}) } : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function loadPalette(storage?: StorageLike): PaletteChoice {
  try {
    return parseChoice((storage ?? localStorage).getItem(PALETTE_KEY));
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function savePalette(choice: PaletteChoice, storage?: StorageLike): void {
  try {
    const s = storage ?? localStorage;
    s.setItem(PALETTE_KEY, JSON.stringify(choice));
    s.setItem(PALETTE_VARS_KEY, JSON.stringify(resolvedVars(choice)));
  } catch {
    /* storage unavailable: the choice just will not persist */
  }
}

/**
 * One-time, repeat-safe transition of what an older version stored. Returns what it did:
 *  - 'none'     nothing is stored (the device uses Signature Navy; nothing is written).
 *  - 'current'  the stored choice and its pre-paint copy are already in today's format (nothing is written).
 *  - 'migrated' an older palette id (Classic, Calm teal, ...) was replaced by the palette it maps to; the old id is kept in `from`.
 *  - 'refreshed' the choice was fine but its pre-paint copy was missing or in an older format (for example after restoring an old backup): the copy was rebuilt.
 *  - 'unreadable' the stored value is damaged or from a newer copy of the app: it is LEFT AS IT IS (not deleted) and the device uses Signature Navy.
 * Custom colours and saved themes are never touched.
 */
export function migrateStoredPalette(storage?: StorageLike): 'none' | 'current' | 'migrated' | 'refreshed' | 'unreadable' {
  try {
    const s = storage ?? localStorage;
    const raw = s.getItem(PALETTE_KEY);
    if (raw === null) return 'none';
    let o: unknown;
    try { o = JSON.parse(raw); } catch { return 'unreadable'; }
    const id = o && typeof o === 'object' ? (o as { id?: unknown }).id : undefined;
    const choice = parseChoice(o);
    const known = id === 'custom' ? choice.id === 'custom' : isLegacyId(id) || PRESETS.some((p) => p.id === id);
    if (!known) return 'unreadable';
    if (isLegacyId(id)) {
      savePalette(choice, s);
      return 'migrated';
    }
    let cached: { v?: unknown } | null = null;
    try { cached = JSON.parse(s.getItem(PALETTE_VARS_KEY) ?? 'null'); } catch { /* rebuilt below */ }
    if (!cached || cached.v !== VARS_VERSION) {
      s.setItem(PALETTE_VARS_KEY, JSON.stringify(resolvedVars(choice)));
      return 'refreshed';
    }
    return 'current';
  } catch {
    return 'unreadable';
  }
}

/** Every variable any palette can set, so switching palettes never leaves one behind. */
const ALL_VARS: string[] = [...new Set([...Object.keys(varsFor(PRESETS[0].light)), ...EXTRA_KEYS])];

/** Sets the palette's variables on the page for the current light or dark mode, and the phone browser-bar color. */
export function applyPalette(choice: PaletteChoice, dark: boolean): void {
  const root = document.documentElement;
  const vars = varsOf(choice, dark);
  // A variable this palette does not set must not keep an earlier palette's value.
  for (const k of ALL_VARS) if (!(k in vars)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', vars['--page']));
}
