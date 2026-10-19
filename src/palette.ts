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

export type ColorKey = keyof Colors;

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
  light: Colors;
  dark: Colors;
}

export type PresetId = 'teal' | 'navy' | 'forest' | 'slate';
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
];

/** The original look, as the page's default styles define it (used as a starting point for your own colors). */
export const CLASSIC: { light: Colors; dark: Colors } = {
  light: { bg: '#FFFFFF', card: '#F8F9FB', fg: '#1C2024', muted: '#667085', line: '#E4E7EC', accent: '#1F6FEB', pos: '#1B7F3B', neg: '#C92A2A', warn: '#B26A00', sideBg: '#F8F9FB', sideFg: '#1C2024', sideActive: '#1F6FEB' },
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

/** CSS variables for a set of colors. */
export function varsFor(c: Colors): Record<string, string> {
  return {
    '--bg': c.bg,
    '--card': c.card,
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

export function colorsOf(choice: PaletteChoice, dark: boolean): Colors | null {
  if (choice.id === 'classic') return null;
  if (choice.id === 'custom') return choice.custom ? (dark ? choice.custom.dark : choice.custom.light) : null;
  const p = PRESETS.find((x) => x.id === choice.id);
  return p ? (dark ? p.dark : p.light) : null;
}

/** Both schemes resolved to CSS variables (what index.html reads before first paint). */
export function resolvedVars(choice: PaletteChoice): { light: Record<string, string>; dark: Record<string, string> } | null {
  const l = colorsOf(choice, false);
  const d = colorsOf(choice, true);
  return l && d ? { light: varsFor(l), dark: varsFor(d) } : null;
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

const ALL_VARS = Object.keys(varsFor(PRESETS[0].light));

/** Sets (or clears) the palette's variables on the page for the current light or dark mode, and the phone browser-bar color. */
export function applyPalette(choice: PaletteChoice, dark: boolean): void {
  const root = document.documentElement;
  const c = colorsOf(choice, dark);
  if (!c) {
    for (const k of ALL_VARS) root.style.removeProperty(k);
    return;
  }
  for (const [k, v] of Object.entries(varsFor(c))) root.style.setProperty(k, v);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', c.bg));
}
