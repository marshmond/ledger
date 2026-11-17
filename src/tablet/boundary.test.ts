import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CS-2 isolation (design F.7): the tablet app may use its own files, the display contract and the display transport, and nothing else from
 * Ledger. It must not be able to reach Ledger's database, modules, Finance code, sync credentials or the owner-only Family view, even by
 * accident. This walks every import (static, dynamic and re-exports) of those three folders and fails on any that leaves them.
 */
const SRC = resolve(__dirname, '..');
const TABLET = join(SRC, 'tablet');
const TRANSPORT = join(SRC, 'display', 'transport');
const CONTRACT = join(SRC, 'display', 'contract');
const INSIDE = [TABLET, TRANSPORT, CONTRACT];
const OUTSIDE_OK = new Set(['react', 'react-dom/client', 'react/jsx-runtime']);

const isTest = (f: string) => /\.test\.tsx?$/.test(f) || /Testkit\.tsx?$/.test(f);
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|css)$/.test(n) && !isTest(n) ? [p] : [];
  });
}
const importsOf = (src: string) => [...src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((m) => m[1]);
const within = (p: string) => INSIDE.some((d) => p === d || p.startsWith(d + sep));

describe('the tablet app and the shared display code are isolated from Ledger', () => {
  const all = INSIDE.flatMap(files);

  it('finds the files it is meant to check', () => {
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((f) => f.endsWith('retrieval.ts'))).toBe(true);
    expect(all.some((f) => f.endsWith(join('contract', 'index.ts')))).toBe(true);
  });

  it('every import stays inside the tablet, the contract and the transport (plus React)', () => {
    const stray: string[] = [];
    for (const f of all) {
      for (const spec of importsOf(readFileSync(f, 'utf8'))) {
        if (spec.startsWith('.')) {
          const target = resolve(dirname(f), spec);
          if (!within(target)) stray.push(`${f.replace(SRC, 'src')} imports ${spec}`);
        } else if (!OUTSIDE_OK.has(spec) && !spec.startsWith('node:')) stray.push(`${f.replace(SRC, 'src')} imports package ${spec}`);
      }
    }
    expect(stray).toEqual([]);
  });

  it('never touches Ledger\'s browser storage keys or the owner-side publisher', () => {
    for (const f of all) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/ledger-sync-config|ledger-display-publisher|ledger-display-activity|localStorage/);
      expect(text, f).not.toMatch(/display\/publish|display\/grants|buildFamilyView|moduleRecords/);
    }
  });

  it('the tablet pages show counts and times only: no code path reads an event or Task title for display', () => {
    const app = readFileSync(join(TABLET, 'App.tsx'), 'utf8');
    expect(app).not.toMatch(/\.title\b|(?<!counts)\.entries\b|(?<!counts)\.tasks\b|projection\(\)/); // the counts object is fine; the lists are not
  });

  it('the shared folders contain no Ledger sync, Finance or database vocabulary', () => {
    for (const f of [...files(TRANSPORT), ...files(CONTRACT)]) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from ['"]dexie['"]|\bFinanceDB\b|lib\/sync|\bsyncNow\b/);
  });
});

describe('the tablet build is separate from Ledger\'s', () => {
  it('has its own entry page and its own policy, and Ledger\'s page does not load tablet code', () => {
    const root = resolve(SRC, '..');
    const tabletHtml = readFileSync(join(root, 'tablet-app', 'index.html'), 'utf8');
    expect(tabletHtml).toContain('./main.tsx');
    expect(readFileSync(join(root, 'tablet-app', 'main.tsx'), 'utf8')).toContain('src/tablet/main');
    const cfg = readFileSync(join(root, 'vite.tablet.config.ts'), 'utf8');
    expect(cfg).toContain("connect-src 'self' https://api.github.com");
    expect(cfg).toContain("script-src 'self'");
    expect(cfg).toContain("object-src 'none'");
    expect(readFileSync(join(root, 'index.html'), 'utf8')).not.toMatch(/tablet/);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('dist-tablet');
  });

  it('Ledger\'s own code never imports the tablet app', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) { if (p !== TABLET) walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(n) || isTest(n)) continue;
        if (importsOf(readFileSync(p, 'utf8')).some((s) => s.startsWith('.') && resolve(dirname(p), s).startsWith(TABLET))) offenders.push(p.replace(SRC, 'src'));
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
