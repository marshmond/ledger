import { describe, expect, it } from 'vitest';
import { THEME_KEY, isDark, loadTheme, nextTheme, parseTheme, saveTheme } from './theme';

const fakeStorage = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
};

describe('theme', () => {
  it('cycles Device -> Light -> Dark -> Device', () => {
    expect(nextTheme('device')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('device');
  });

  it('only accepts light or dark as saved values; anything else means Device', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    for (const bad of [null, undefined, '', 'device', 'DARK', 'blue', 5]) expect(parseTheme(bad)).toBe('device');
  });

  it('saves a forced choice and clears the entry for Device', () => {
    const s = fakeStorage();
    saveTheme('dark', s);
    expect(s.dump()).toEqual({ [THEME_KEY]: 'dark' });
    expect(loadTheme(s)).toBe('dark');
    saveTheme('device', s);
    expect(s.dump()).toEqual({});
    expect(loadTheme(s)).toBe('device');
  });

  it('keeps working when storage is unavailable', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(loadTheme(broken)).toBe('device');
    expect(() => saveTheme('dark', broken)).not.toThrow();
  });

  it('a forced choice beats the device setting both ways', () => {
    expect(isDark('dark', false)).toBe(true);
    expect(isDark('light', true)).toBe(false);
    expect(isDark('device', true)).toBe(true);
    expect(isDark('device', false)).toBe(false);
  });
});
