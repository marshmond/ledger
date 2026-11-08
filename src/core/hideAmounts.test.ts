import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HIDE_AMOUNTS_KEY, HIDE_AMOUNTS_SCOPE, loadHideAmounts, saveHideAmounts } from './hideAmounts';
import { PREFERENCE_KEYS } from '../lib/backupFile';

/** ST-S2 (ARCH-01, UX-01): the Hide amounts preference lives in core, unchanged, and its scope is stated honestly. */
const mem = () => { const m = new Map<string, string>(); return { m, store: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } } }; };

describe('Hide amounts preference (moved to core)', () => {
  it('keeps the same storage key, which the plain backup still carries', () => {
    expect(HIDE_AMOUNTS_KEY).toBe('today.hideAmounts.v1');
    expect(PREFERENCE_KEYS).toContain(HIDE_AMOUNTS_KEY);
  });
  it('defaults to not hidden, reads "1" as hidden, and writes the same values as before', () => {
    const { m, store } = mem();
    expect(loadHideAmounts(store)).toBe(false);
    saveHideAmounts(true, store); expect(m.get(HIDE_AMOUNTS_KEY)).toBe('1'); expect(loadHideAmounts(store)).toBe(true);
    saveHideAmounts(false, store); expect(m.get(HIDE_AMOUNTS_KEY)).toBe('0'); expect(loadHideAmounts(store)).toBe(false);
  });
  it('an unreadable or unwritable store means "not hidden", never an error; so does no storage at all', () => {
    expect(loadHideAmounts({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
    expect(() => saveHideAmounts(true, { setItem: () => { throw new Error('full'); } })).not.toThrow();
    expect(loadHideAmounts()).toBe(false); // node has no localStorage
  });
  it('says what it covers and what it does not', () => {
    expect(HIDE_AMOUNTS_SCOPE.help).toMatch(/Today, Calendar, Bills, Services, Home & Assets and Household finances/);
    expect(HIDE_AMOUNTS_SCOPE.help).toMatch(/Accounts, Transactions, Budget, Reports/);
    expect(HIDE_AMOUNTS_SCOPE.help).toMatch(/not a privacy lock/);
    expect(HIDE_AMOUNTS_SCOPE.doesNotCover).toMatch(/exports and backups still contain them/);
  });
});

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p.replace(/\\/g, '/')); }
  return out;
}
describe('no module reaches into Today for the shared helper', () => {
  it('nothing outside modules/today imports loadHideAmounts / saveHideAmounts / HIDE_AMOUNTS_KEY from Today', () => {
    const bad = walk('src').filter((f) => !f.startsWith('src/modules/today/')).filter((f) => /import[^;]*\b(loadHideAmounts|saveHideAmounts|HIDE_AMOUNTS_KEY)\b[^;]*from\s+['"][^'"]*today\//.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('Today itself no longer defines it either (one source of truth)', () => {
    expect(readFileSync('src/modules/today/layout.ts', 'utf8')).not.toMatch(/loadHideAmounts|saveHideAmounts|HIDE_AMOUNTS_KEY/);
  });
});
