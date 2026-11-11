/**
 * Color palettes. "Classic" is the original look (no overrides). The others, and a custom palette you build yourself, set CSS variables
 * on the page for light and dark separately. The choice is remembered per device in localStorage; index.html applies the saved values
 * before first paint so there is no flash.
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
  /** Sidebar background. */
  sideBg: string;
  /** Sidebar text. */
  sideFg: string;
  /** The active page in the sidebar. */
  sideActive: string;
}

/**
 * D5: a preset may also set two OPTIONAL roles. They are deliberately not part of `Colors` or COLOR_ROLES, so the colour map, saved themes, theme codes,
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
  { key: 'sideBg', label: 'Sidebar background', help: 'The menu on the left (desktop).' },
  { key: 'sideFg', label: 'Sidebar text', help: 'Menu names.' },
  { key: 'sideActive', label: 'Sidebar highlight', help: 'The page you are on.' },
];

export interface PaletteDef {
  id: PresetId;
  name: string;
  blurb: string;
  light: PaletteColors;
  dark: PaletteColors;
  /** Shown in Settings > Appearance as "preview" while the screens are still being redesigned for it. Remove the flag to remove the label. */
  preview?: boolean;
  /**
   * Extra CSS variables only this preset sets (light and dark), on top of the twelve colours: tokens that have no palette role, such as the
   * control border, the navy button, shadows and the font stack. Nothing is stored for them: they are derived from the preset id each time.
   */
  extras?: { light: Record<string, string>; dark: Record<string, string> };
}

export type PresetId = 'teal' | 'navy' | 'forest' | 'slate' | 'signature';
export type PaletteId = 'classic' | PresetId | 'custom';

export const PRESETS: PaletteDef[] = [
  {
    id: 'teal',
    name: 'Calm teal',
    blurb: 'Soft warm white with a deep teal accent. Calm and easy on the eyes.',
    light: { bg: '#FAFAF8', card: '#F1F4F2', fg: '#1B2421', muted: '#566761', line: '#DCE4E0', accent: '#0F766E', pos: '#15803D', neg: '#B91C1C', warn: '#B45309', sideBg: '#EDF2EF', sideFg: '#1B2421', sideActive: '#0F766E' },
    dark: { bg: '#101614', card: '#18211E', fg: '#E6EEEA', muted: '#9DB0A8', line: '#26332F', accent: '#2DD4BF', pos: '#4ADE80', neg: '#F87171', warn: '#FBBF24', sideBg: '#0C1210', sideFg: '#E6EEEA', sideActive: '#2DD4BF' },
  },
  {
    id: 'navy',
    name: 'Deep navy and gold',
    blurb: 'A classic private-bank look: navy sidebar, white content, gold highlights.',
    light: { bg: '#FFFFFF', card: '#F4F6FA', fg: '#14213D', muted: '#555F7A', line: '#DFE3EC', accent: '#1E3A8A', pos: '#166534', neg: '#B91C1C', warn: '#8A6508', sideBg: '#14213D', sideFg: '#E8ECF4', sideActive: '#E9C46A' },
    dark: { bg: '#0E1420', card: '#161E2E', fg: '#E8ECF4', muted: '#A2AEC8', line: '#25304A', accent: '#7DA2FF', pos: '#4ADE80', neg: '#F87171', warn: '#E9C46A', sideBg: '#0A0F19', sideFg: '#E8ECF4', sideActive: '#E9C46A' },
  },
  {
    id: 'forest',
    name: 'Forest green and stone',
    blurb: 'Grounded stone neutrals with a confident green accent.',
    light: { bg: '#FBFAF7', card: '#F2F0EA', fg: '#22251F', muted: '#5C6155', line: '#E1DED3', accent: '#2F6B3A', pos: '#2F6B3A', neg: '#B3261E', warn: '#9A5805', sideBg: '#EFEBE0', sideFg: '#22251F', sideActive: '#2F6B3A' },
    dark: { bg: '#131512', card: '#1C1F1B', fg: '#E9ECE5', muted: '#A3AA9B', line: '#2B2F28', accent: '#6FCF83', pos: '#6FCF83', neg: '#F2A29B', warn: '#E8B44A', sideBg: '#0E100D', sideFg: '#E9ECE5', sideActive: '#6FCF83' },
  },
  {
    id: 'slate',
    name: 'Slate and indigo',
    blurb: 'Modern, neutral grey-blues with an indigo accent. Crisp and clean.',
    light: { bg: '#FFFFFF', card: '#F5F6F8', fg: '#1A1D24', muted: '#585F6C', line: '#E3E6EB', accent: '#4F46E5', pos: '#15803D', neg: '#B91C1C', warn: '#B45309', sideBg: '#F1F2F5', sideFg: '#1A1D24', sideActive: '#4F46E5' },
    dark: { bg: '#0F1115', card: '#171A21', fg: '#E7E9EE', muted: '#A0A7B4', line: '#272B35', accent: '#8B93FF', pos: '#4ADE80', neg: '#F87171', warn: '#FBBF24', sideBg: '#0B0D11', sideFg: '#E7E9EE', sideActive: '#8B93FF' },
  },
  {
    // D5: Ledger Signature (navy and muted teal on a cool grey canvas). Opt-in; Classic stays the default until a later phase. Values are the D4 proposals,
    // re-measured in src/palette.test.ts and src/shell/signatureTokens.test.ts. `bg` is the white ground that inputs, buttons and table headings sit on;
    // the grey canvas is `page`, and cards are `surface`. Until a screen is restyled it simply reads these twelve colours, so it stays legible.
    id: 'signature',
    name: 'Ledger Signature',
    blurb: 'Navy and muted teal on a cool grey canvas, with white cards. The new look, still being rolled out screen by screen.',
    preview: true,
    light: { bg: '#FFFFFF', card: '#FFFFFF', fg: '#101B33', muted: '#566379', line: '#DFE5EE', accent: '#267880', pos: '#23694F', neg: '#B0443B', warn: '#8F5D16', sideBg: '#F6F8FB', sideFg: '#101B33', sideActive: '#267880', page: '#EEF1F6', surface: '#FFFFFF' },
    dark: { bg: '#131D31', card: '#131D31', fg: '#E9EEF7', muted: '#9AA8BF', line: '#26354F', accent: '#6CC0C8', pos: '#72CBA3', neg: '#F2928A', warn: '#E5B865', sideBg: '#0B1220', sideFg: '#E9EEF7', sideActive: '#6CC0C8', page: '#0B1220', surface: '#131D31' },
    extras: {
      light: {
        '--surface-raised': '#FFFFFF', '--surface-soft': '#F6F8FB', '--surface-sunken': '#EEF2F8',
        '--fg-2': '#37445B', '--control-line': '#7A879F',
        '--btn-bg': '#0E1A33', '--btn-ink': '#FFFFFF',
        '--info': '#3B6BA3', '--info-soft': '#E6EEF8',
        '--shadow-1': '0 1px 2px rgba(14, 26, 51, 0.05)',
        '--shadow-2': '0 1px 2px rgba(14, 26, 51, 0.04), 0 8px 24px rgba(14, 26, 51, 0.06)',
        '--shadow-3': '0 2px 6px rgba(14, 26, 51, 0.08), 0 24px 60px rgba(14, 26, 51, 0.18)',
        '--r-md': '10px', '--fs-md': '1rem',
        '--font-sans': "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      },
      dark: {
        '--surface-raised': '#182339', '--surface-soft': '#182339', '--surface-sunken': '#1E2B46',
        '--fg-2': '#C3CDDF', '--control-line': '#6F82A3',
        '--btn-bg': '#277A83', '--btn-ink': '#FFFFFF',
        '--info': '#8FB0E6', '--info-soft': '#1B2A47',
        '--shadow-1': '0 1px 2px rgba(0, 0, 0, 0.4)',
        '--shadow-2': '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.45)',
        '--shadow-3': '0 2px 6px rgba(0, 0, 0, 0.5), 0 24px 60px rgba(0, 0, 0, 0.65)',
        '--r-md': '10px', '--fs-md': '1rem',
        '--font-sans': "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      },
    },
  },
];

/** The original look, as the page's default styles define it (used as a starting point for your own colors). */
export const CLASSIC: { light: Colors; dark: Colors } = {
  // ST-S3 (AX-04): these light values now match the Classic stylesheet (src/styles.css), which was darkened a little for contrast. Before, Classic's own values here
  // (accent #1F6FEB, muted #667085, warn #B26A00) fell under 4.5:1 for links and quiet text, and a custom palette started from them inherited that.
  light: { bg: '#FFFFFF', card: '#F8F9FB', fg: '#1C2024', muted: '#5D6779', line: '#E4E7EC', accent: '#1A5FD0', pos: '#187636', neg: '#C02424', warn: '#8C5200', sideBg: '#F8F9FB', sideFg: '#1C2024', sideActive: '#1A5FD0' },
  dark: { bg: '#12151A', card: '#1A1E25', fg: '#E8EAED', muted: '#98A2B3', line: '#2A2F38', accent: '#5B9BFF', pos: '#56D364', neg: '#FF7B72', warn: '#E3B341', sideBg: '#1A1E25', sideFg: '#E8EAED', sideActive: '#5B9BFF' },
};

export interface PaletteChoice {
  id: PaletteId;
  /** Your own colors, for light and dark (used when id is 'custom'). */
  custom?: { light: Colors; dark: Colors };
  /** The saved theme these colors came from (see lib/savedThemes.ts), so it can be updated. */
  savedId?: string;
}

export const DEFAULT_CHOICE: PaletteChoice = { id: 'classic' };

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
    { key: 'sideFg', against: 'sideBg', min: 4.5, message: 'Sidebar text is hard to read on the sidebar background.' },
    { key: 'sideActive', against: 'sideBg', min: 3, message: 'The sidebar highlight barely stands out.' },
  ];
  return checks.flatMap((k) => {
    const ratio = contrastRatio(c[k.key], c[k.against]);
    return ratio < k.min ? [{ key: k.key, ratio, min: k.min, message: k.message }] : [];
  });
}

// ---------- applying ----------

/** CSS variables for a set of colors. `--page` and `--surface` are always written: they fall back to `bg` and `card` (also when a stored value is not a valid hex), so an older palette looks as it always did. */
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

export function colorsOf(choice: PaletteChoice, dark: boolean): PaletteColors | null {
  if (choice.id === 'classic') return null;
  if (choice.id === 'custom') return choice.custom ? (dark ? choice.custom.dark : choice.custom.light) : null;
  const p = PRESETS.find((x) => x.id === choice.id);
  return p ? (dark ? p.dark : p.light) : null;
}

/** The extra variables a preset sets on top of its colours (none for Classic, the other presets and custom palettes). */
export function extrasOf(choice: PaletteChoice, dark: boolean): Record<string, string> {
  if (choice.id === 'classic' || choice.id === 'custom') return {};
  const p = PRESETS.find((x) => x.id === choice.id);
  return p?.extras ? p.extras[dark ? 'dark' : 'light'] : {};
}

/** Every variable for one mode: the colours, then the preset's extras. Null for Classic. */
export function varsOf(choice: PaletteChoice, dark: boolean): Record<string, string> | null {
  const c = colorsOf(choice, dark);
  return c ? { ...varsFor(c), ...extrasOf(choice, dark) } : null;
}

/** Both schemes resolved to CSS variables (what index.html reads before first paint). */
export function resolvedVars(choice: PaletteChoice): { light: Record<string, string>; dark: Record<string, string> } | null {
  const l = varsOf(choice, false);
  const d = varsOf(choice, true);
  return l && d ? { light: l, dark: d } : null;
}

export const PALETTE_KEY = 'ledger-palette';
export const PALETTE_VARS_KEY = 'ledger-palette-vars';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function validColors(c: unknown): c is Colors {
  if (!c || typeof c !== 'object') return false;
  return COLOR_ROLES.every((r) => typeof (c as Record<string, unknown>)[r.key] === 'string' && isHex((c as Record<string, string>)[r.key]));
}

/** Reads a saved choice, tolerating anything odd in storage (it falls back to Classic). */
export function parseChoice(raw: unknown): PaletteChoice {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return DEFAULT_CHOICE;
    const id = (o as { id?: unknown }).id;
    if (id === 'custom') {
      const c = (o as { custom?: { light?: unknown; dark?: unknown } }).custom;
      const savedId = (o as { savedId?: unknown }).savedId;
      return c && validColors(c.light) && validColors(c.dark) ? { id: 'custom', custom: { light: c.light, dark: c.dark }, ...(typeof savedId === 'string' ? { savedId } : {}) } : DEFAULT_CHOICE;
    }
    return PRESETS.some((p) => p.id === id) ? { id: id as PresetId } : DEFAULT_CHOICE;
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
    const vars = resolvedVars(choice);
    if (!vars) {
      s.removeItem(PALETTE_KEY);
      s.removeItem(PALETTE_VARS_KEY);
      return;
    }
    s.setItem(PALETTE_KEY, JSON.stringify(choice));
    s.setItem(PALETTE_VARS_KEY, JSON.stringify(vars));
  } catch {
    /* storage unavailable: the choice just will not persist */
  }
}

/** Every variable any palette can set, so switching palettes never leaves one behind. */
const ALL_VARS = [...new Set([...Object.keys(varsFor(PRESETS[0].light)), ...PRESETS.flatMap((p) => [...Object.keys(p.extras?.light ?? {}), ...Object.keys(p.extras?.dark ?? {})])])];

/** Sets (or clears) the palette's variables on the page for the current light or dark mode, and the phone browser-bar color. */
export function applyPalette(choice: PaletteChoice, dark: boolean): void {
  const root = document.documentElement;
  const c = colorsOf(choice, dark);
  if (!c) {
    for (const k of ALL_VARS) root.style.removeProperty(k);
    return;
  }
  const vars = { ...varsFor(c), ...extrasOf(choice, dark) };
  // A variable this palette does not set must not keep an earlier palette's value (for example Signature's navy button after switching away).
  for (const k of ALL_VARS) if (!(k in vars)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', vars['--page']));
}
