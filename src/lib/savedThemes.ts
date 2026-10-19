import { COLOR_ROLES, isHex, validColors, type Colors } from '../palette';

/**
 * Your saved color themes. The library (names and colors, light and dark) is stored with your data, so it is in backups and syncs between
 * devices. Which theme is in use stays per device (see palette.ts). A theme can also be shared as a short text code.
 */

export interface SavedTheme {
  id: string;
  name: string;
  light: Colors;
  dark: Colors;
}

export const MAX_THEMES = 20;
const MAX_NAME = 40;

export const newThemeId = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Reads what was stored, ignoring anything damaged. */
export function parseThemes(raw: unknown): SavedTheme[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedTheme[] = [];
  for (const r of raw) {
    const o = r as { id?: unknown; name?: unknown; light?: unknown; dark?: unknown } | null;
    if (o && typeof o.id === 'string' && typeof o.name === 'string' && o.name.trim() && validColors(o.light) && validColors(o.dark)) {
      out.push({ id: o.id, name: o.name, light: { ...o.light }, dark: { ...o.dark } });
    }
  }
  return out.slice(0, MAX_THEMES);
}

export function checkThemeName(list: SavedTheme[], name: string, exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the theme a name.';
  if (n.length > MAX_NAME) return `Keep the name under ${MAX_NAME} characters.`;
  if (list.some((t) => t.id !== exceptId && t.name.toLowerCase() === n.toLowerCase())) return 'You already have a theme with that name.';
  return null;
}

export const atLimit = (list: SavedTheme[]) => list.length >= MAX_THEMES;
export const LIMIT_MESSAGE = `You can save up to ${MAX_THEMES} themes. Delete one to make room.`;

export const addTheme = (list: SavedTheme[], name: string, colors: { light: Colors; dark: Colors }, id: string): SavedTheme[] => [
  ...list,
  { id, name: name.trim(), light: { ...colors.light }, dark: { ...colors.dark } },
];
export const renameTheme = (list: SavedTheme[], id: string, name: string): SavedTheme[] => list.map((t) => (t.id === id ? { ...t, name: name.trim() } : t));
export const updateTheme = (list: SavedTheme[], id: string, colors: { light: Colors; dark: Colors }): SavedTheme[] =>
  list.map((t) => (t.id === id ? { ...t, light: { ...colors.light }, dark: { ...colors.dark } } : t));
export const removeTheme = (list: SavedTheme[], id: string): SavedTheme[] => list.filter((t) => t.id !== id);

const same = (a: Colors, b: Colors) => COLOR_ROLES.every((r) => a[r.key].toLowerCase() === b[r.key].toLowerCase());
export const sameColors = (a: { light: Colors; dark: Colors }, b: { light: Colors; dark: Colors }) => same(a.light, b.light) && same(a.dark, b.dark);

/** A name that is not taken yet: "Sunset", then "Sunset (2)", "Sunset (3)". */
export function uniqueName(list: SavedTheme[], name: string): string {
  const base = name.trim().slice(0, MAX_NAME) || 'Shared theme';
  let n = base;
  for (let i = 2; list.some((t) => t.name.toLowerCase() === n.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    n = base.slice(0, MAX_NAME - suffix.length) + suffix;
  }
  return n;
}

// ---- share as text ----

const PREFIX = 'ledger-theme-1:';
const b64url = (bytes: Uint8Array) => {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(p + '='.repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

const list = (c: Colors) => COLOR_ROLES.map((r) => c[r.key].replace('#', '').toUpperCase());

/** A short text code for a theme that can be pasted into another copy of the app. */
export function encodeTheme(t: { name: string; light: Colors; dark: Colors }): string {
  return PREFIX + b64url(new TextEncoder().encode(JSON.stringify({ n: t.name, l: list(t.light), d: list(t.dark) })));
}

function toColors(raw: unknown): Colors | null {
  if (!Array.isArray(raw) || raw.length !== COLOR_ROLES.length) return null;
  const c = {} as Record<string, string>;
  for (let i = 0; i < COLOR_ROLES.length; i++) {
    const v = typeof raw[i] === 'string' ? `#${(raw[i] as string).replace(/^#/, '')}` : '';
    if (!isHex(v)) return null;
    c[COLOR_ROLES[i].key] = v.toUpperCase();
  }
  return c as unknown as Colors;
}

export type DecodedTheme = { ok: true; name: string; light: Colors; dark: Colors } | { ok: false; error: string };

export function decodeTheme(text: string): DecodedTheme {
  const bad: DecodedTheme = { ok: false, error: 'That does not look like a theme code. Copy the whole code, starting with “ledger-theme-1:”.' };
  const t = text.trim().replace(/\s+/g, '');
  if (!t.startsWith(PREFIX)) return bad;
  try {
    const o = JSON.parse(new TextDecoder().decode(fromB64url(t.slice(PREFIX.length)))) as { n?: unknown; l?: unknown; d?: unknown };
    const light = toColors(o.l);
    const dark = toColors(o.d);
    if (!light || !dark) return bad;
    return { ok: true, name: typeof o.n === 'string' ? o.n : '', light, dark };
  } catch {
    return bad;
  }
}
