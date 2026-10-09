/**
 * Light / Dark / Device theme. "Device" (the default) follows the OS setting; a forced choice sets data-theme on <html>.
 * The choice is remembered per device in localStorage; if storage is unavailable the app still works (it just forgets).
 * index.html applies the saved choice before first paint so there is no flash of the wrong theme.
 */

export type Theme = 'device' | 'light' | 'dark';

export const THEME_KEY = 'ledger-theme';
const ORDER: Theme[] = ['device', 'light', 'dark'];

/** Meta theme-color values (browser bar on phones). Match --accent-ish brand blue in light, page background in dark. */
export const THEME_COLOR = { light: '#1f6feb', dark: '#12151a' } as const;

export const nextTheme = (t: Theme): Theme => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length];

export const THEME_LABEL: Record<Theme, string> = { device: 'Device', light: 'Light', dark: 'Dark' };

export function parseTheme(raw: unknown): Theme {
  return raw === 'light' || raw === 'dark' ? raw : 'device';
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadTheme(storage?: StorageLike): Theme {
  try {
    return parseTheme((storage ?? localStorage).getItem(THEME_KEY));
  } catch {
    return 'device';
  }
}

export function saveTheme(t: Theme, storage?: StorageLike): void {
  try {
    const s = storage ?? localStorage;
    if (t === 'device') s.removeItem(THEME_KEY);
    else s.setItem(THEME_KEY, t);
  } catch {
    /* private mode / blocked storage: the choice just won't persist */
  }
}

/** Whether the screen is actually dark for a given choice and device preference. */
export const isDark = (t: Theme, deviceDark: boolean): boolean => (t === 'device' ? deviceDark : t === 'dark');

/** Applies the theme to the document and keeps the browser-bar color in sync. */
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'device') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  const deviceDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const color = isDark(t, deviceDark) ? THEME_COLOR.dark : THEME_COLOR.light;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}

/** Call once at startup: applies the saved theme and re-syncs when the device setting changes while on "Device". */
export function initTheme(): Theme {
  const t = loadTheme();
  applyTheme(t);
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (loadTheme() === 'device') applyTheme('device');
    });
  }
  return t;
}
