import { describe, expect, it } from 'vitest';
import { PRESETS, parseChoice, type Colors } from '../palette';
import { MAX_THEMES, addTheme, atLimit, checkThemeName, decodeTheme, encodeTheme, parseThemes, removeTheme, renameTheme, sameColors, uniqueName, updateTheme } from './savedThemes';

const colors = { light: PRESETS[0].light, dark: PRESETS[0].dark };
const other = { light: { ...PRESETS[1].light }, dark: { ...PRESETS[1].dark } };

describe('the saved themes list', () => {
  it('saves a copy, so later edits to the colors do not change the saved theme', () => {
    const c = { light: { ...colors.light }, dark: { ...colors.dark } };
    const list = addTheme([], '  Sunset ', c, 'a');
    c.light.accent = '#000000';
    expect(list).toEqual([{ id: 'a', name: 'Sunset', light: colors.light, dark: colors.dark }]);
  });
  it('renames, updates, and deletes one theme', () => {
    let list = addTheme(addTheme([], 'A', colors, '1'), 'B', colors, '2');
    list = renameTheme(list, '2', ' Night ');
    list = updateTheme(list, '1', other);
    expect(list.map((t) => t.name)).toEqual(['A', 'Night']);
    expect(list[0].light).toEqual(other.light);
    expect(list[1].light).toEqual(colors.light);
    expect(removeTheme(list, '1').map((t) => t.id)).toEqual(['2']);
  });
  it('validates names and the limit of 20', () => {
    const list = addTheme([], 'Sunset', colors, '1');
    expect(checkThemeName(list, ' ')).toBe('Give the theme a name.');
    expect(checkThemeName(list, 'x'.repeat(41))).toMatch(/under 40/);
    expect(checkThemeName(list, 'SUNSET')).toBe('You already have a theme with that name.');
    expect(checkThemeName(list, 'sunset', '1')).toBeNull();
    let full = [] as ReturnType<typeof addTheme>;
    for (let i = 0; i < MAX_THEMES; i++) full = addTheme(full, `T${i}`, colors, `id${i}`);
    expect(atLimit(list)).toBe(false);
    expect(atLimit(full)).toBe(true);
  });
  it('finds a free name for a shared theme', () => {
    let list = addTheme([], 'Sunset', colors, '1');
    expect(uniqueName(list, 'Sunset')).toBe('Sunset (2)');
    list = addTheme(list, 'Sunset (2)', colors, '2');
    expect(uniqueName(list, ' sunset ')).toBe('sunset (3)');
    expect(uniqueName(list, 'Fresh')).toBe('Fresh');
    expect(uniqueName([], '')).toBe('Shared theme');
    expect(uniqueName(addTheme([], 'y'.repeat(40), colors, '1'), 'y'.repeat(40))).toHaveLength(40);
  });
  it('compares colors ignoring letter case', () => {
    expect(sameColors(colors, { light: { ...colors.light, accent: colors.light.accent.toLowerCase() }, dark: colors.dark })).toBe(true);
    expect(sameColors(colors, other)).toBe(false);
  });
});

describe('reading stored themes', () => {
  it('keeps good themes and drops damaged ones', () => {
    const good = { id: 'a', name: 'Good', ...colors };
    const badColors = { ...colors.light, bg: 'red' } as Colors;
    expect(parseThemes([good, { ...good, id: 3 }, { ...good, name: ' ' }, { ...good, light: badColors }, { ...good, dark: undefined }, null, 'x'])).toEqual([good]);
    expect(parseThemes(undefined)).toEqual([]);
    expect(parseThemes({ a: 1 })).toEqual([]);
  });
});

describe('theme codes', () => {
  it('round trips a theme, including a name with unusual characters', () => {
    const code = encodeTheme({ name: 'Café ☕ “night”', ...other });
    expect(code.startsWith('ledger-theme-1:')).toBe(true);
    expect(code).not.toMatch(/\s/);
    const d = decodeTheme(code);
    expect(d).toEqual({ ok: true, name: 'Café ☕ “night”', light: other.light, dark: other.dark });
  });
  it('tolerates spaces and line breaks from copying', () => {
    const code = encodeTheme({ name: 'A', ...colors });
    expect(decodeTheme(`  ${code.slice(0, 30)}\n${code.slice(30)}  `)).toMatchObject({ ok: true, name: 'A' });
  });
  it('rejects things that are not theme codes', () => {
    for (const bad of ['', 'hello', 'ledger-theme-1:', 'ledger-theme-1:!!!!', `ledger-theme-1:${btoa('{"n":"x"}')}`, `ledger-theme-1:${btoa(JSON.stringify({ n: 'x', l: ['ZZZZZZ'], d: [] }))}`]) {
      const d = decodeTheme(bad);
      expect(d.ok).toBe(false);
    }
    const d = decodeTheme('nope');
    expect(d.ok === false && d.error).toMatch(/does not look like a theme code/);
  });
  it('rejects a code with an invalid color in it', () => {
    const code = encodeTheme({ name: 'A', ...colors });
    const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.slice(15).replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (code.slice(15).length % 4)) % 4)), (c) => c.charCodeAt(0))));
    raw.l[0] = 'GGGGGG';
    expect(decodeTheme(`ledger-theme-1:${btoa(JSON.stringify(raw))}`).ok).toBe(false);
  });
});

describe('active theme remembers which saved theme it came from', () => {
  it('keeps savedId on a custom choice', () => {
    const c = parseChoice({ id: 'custom', custom: other, savedId: 't1' });
    expect(c).toEqual({ id: 'custom', custom: other, savedId: 't1' });
    expect(parseChoice({ id: 'custom', custom: other })).toEqual({ id: 'custom', custom: other });
    expect(parseChoice({ id: 'custom', custom: other, savedId: 7 })).toEqual({ id: 'custom', custom: other });
  });
});
