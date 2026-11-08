import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allModules } from '../../core/registry';
import { registerModules } from '../index';

/**
 * B5 boundaries, enforced from the source itself so a later change cannot quietly cross them: the household module is READ ONLY, opens no Finance table of its own, uses no
 * network, stores no new data, and the three existing spending readers are untouched and never mention it.
 */
const DIR = 'src/modules/household';
const sources = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !['householdTestkit.ts', 'householdSeed.ts'].includes(f)).map((f) => ({ f, text: readFileSync(join(DIR, f), 'utf8') }));
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');

describe('B5 guard: the household module is read only', () => {
  it('has source files to check', () => {
    expect(sources.map((s) => s.f).sort()).toEqual(expect.arrayContaining(['commitments.ts', 'overview.ts', 'review.ts', 'unionSpend.ts', 'relatedBill.ts', 'Parts.tsx', 'OverviewPage.tsx', 'todayCards.tsx']));
  });

  it('calls no database write (add, put, update, delete, bulk writes, clear, a read-write transaction) and imports no writer', () => {
    for (const s of sources) {
      const c = code(s.text);
      // names no Set or Map has are forbidden anywhere; the names a Set or Map also has (add, delete, clear) are forbidden on a database table (d.x or db.x)
      expect(c, s.f).not.toMatch(/\.(put|bulkAdd|bulkPut|bulkDelete|modify|update)\(/);
      expect(c, s.f).not.toMatch(/\b(d|db)\.[A-Za-z]+\.(add|delete|clear)\(/);
      expect(c, s.f).not.toMatch(/transaction\(\s*['"]rw/);
      expect(c, s.f).not.toMatch(/\b(createTask|saveTask|completeTask|removeTasks|recordFact|applyLifecycle|applyServiceLink|createObligation|createArrangement|insertService|logVisit|ensureNextVisitTask|repo\()/);
    }
  });

  it('imports from lib only the pure date, money and Finance-reference helpers, and never a Finance writer, the forecast or the posting code', () => {
    for (const s of sources) {
      for (const m of s.text.matchAll(/from '\.\.\/\.\.\/lib\/([A-Za-z/]+)'/g)) expect(s.f.endsWith('searchSource.ts') ? ['dates', 'money', 'txnLookup', 'txnRef', 'search'] : ['dates', 'money', 'txnLookup', 'txnRef'], `${s.f} imports lib/${m[1]}`).toContain(m[1]);
      // (the imports above are whitelisted, so no forecast or posting module can come in; the words are not searched because on-screen copy says "not a forecast")
      expect(code(s.text), s.f).not.toMatch(/recurringLog|\.recurring\b|loadScheduled|d\.txns|db\.txns/);
    }
  });

  it('uses no network, no timer-driven refresh and writes no browser storage (a read of the Hide Amounts choice is the only storage use)', () => {
    for (const s of sources) {
      const c = code(s.text);
      expect(c, s.f).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/);
      expect(c, s.f).not.toMatch(/localStorage\.(setItem|removeItem|clear)|sessionStorage|indexedDB|saveHideAmounts/);
    }
  });

  it('reads Finance only through the shared bulk loader (loadTxnMap) and never its own table access', () => {
    const o = sources.find((s) => s.f === 'overview.ts')!.text;
    expect(o).toMatch(/loadTxnMap/);
    for (const s of sources) expect(code(s.text), s.f).not.toMatch(/\.where\(|\.bulkGet\(|\.toArray\(\)\.filter/);
  });
});

describe('B5 guard: the existing readers are untouched and unaware of the household module', () => {
  const READERS = ['src/modules/assets/spending.ts', 'src/modules/services/householdSpend.ts', 'src/modules/bills/billsSpend.ts', 'src/lib/txnRef.ts', 'src/lib/costSource.ts', 'src/lib/txnLookup.ts', 'src/lib/financeRead.ts'];

  it('none of the spending readers or the shared Finance-reference code mentions the household module', () => {
    for (const f of READERS) expect(readFileSync(f, 'utf8'), f).not.toMatch(/household\/|unionSpend|recordedAcrossModules|householdCommitments/);
  });

  it('the household module is imported from exactly two places: the module list and the Services arrangement page (for the Related bill card)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) { if (p.replace(/\\/g, '/') !== DIR) walk(p); } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && /from '[./]+\/household(\/[A-Za-z]+)?'/.test(readFileSync(p, 'utf8'))) hits.push(p.replace(/\\/g, '/')); } };
    walk('src');
    expect(hits.sort()).toEqual(['src/modules/index.ts', 'src/modules/services/ArrangementPage.tsx']);
  });
});

describe('B5 guard: registration', () => {
  it('registers the household module once, with a counts-only Today card whose id starts with the module id, a page-only search source (ST-S2, NV-01), and no Calendar layer, quick add or record kind', () => {
    registerModules();
    const m = allModules().find((x) => x.id === 'household')!;
    expect(m).toBeDefined();
    expect(Object.keys(m.contributes ?? {}).sort()).toEqual(['searchSource', 'todayCards']);
    expect(m.contributes!.todayCards!.map((c) => c.id)).toEqual(['household.attention']);
    expect(m.contributes!.todayCards![0].hideWhenEmpty).toBe(true);
  });
});
