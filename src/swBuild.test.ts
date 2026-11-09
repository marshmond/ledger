import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_MARKER, FILES_MARKER, buildId, injectBuild, precacheList } from './swBuild';

const SW = readFileSync('public/sw.js', 'utf8');

describe('precacheList', () => {
  it('lists every built script and style, relative to the worker, in a stable order, and nothing else', () => {
    const emitted = ['index.html', 'assets/index-AAA11111.js', 'assets/BillsModule-BBB22222.js', 'assets/index-CCC33333.css', 'assets/readme.txt', 'sw.js', 'icons/icon.svg', 'assets/x.js.map'];
    expect(precacheList(emitted)).toEqual(['./assets/BillsModule-BBB22222.js', './assets/index-AAA11111.js', './assets/index-CCC33333.css']);
  });
  it('is empty when nothing was built (the worker then falls back to reading index.html)', () => {
    expect(precacheList([])).toEqual([]);
  });
});

describe('buildId', () => {
  const parts = { 'index.html': '<html>1</html>', 'assets/a-1.js': 'assets/a-1.js', 'icons/icon.svg': new Uint8Array([1, 2, 3]) };
  it('is the same for the same build, whatever order the parts come in', () => {
    const reordered = { 'icons/icon.svg': new Uint8Array([1, 2, 3]), 'assets/a-1.js': 'assets/a-1.js', 'index.html': '<html>1</html>' };
    expect(buildId(parts)).toBe(buildId(reordered));
    expect(buildId(parts)).toMatch(/^[0-9a-f]{12}$/);
  });
  it('changes when any saved file changes: a page, a script name (its content hash), an icon, or the worker itself', () => {
    const base = buildId(parts);
    expect(buildId({ ...parts, 'index.html': '<html>2</html>' })).not.toBe(base);
    expect(buildId({ ...parts, 'assets/a-1.js': 'assets/a-2.js' })).not.toBe(base);
    expect(buildId({ ...parts, 'icons/icon.svg': new Uint8Array([1, 2, 4]) })).not.toBe(base);
    expect(buildId({ ...parts, 'sw.js': 'x' })).not.toBe(base);
  });
  it('does not mix up a file name with its content', () => {
    expect(buildId({ ab: 'c' })).not.toBe(buildId({ a: 'bc' }));
  });
});

describe('injectBuild', () => {
  it('fills the build id and the file list into the real worker, and the result still has the shape the worker expects', () => {
    const out = injectBuild(SW, 'abc123def456', ['./assets/a-1.js', './assets/b-2.css']);
    expect(out).toContain("const BUILD = 'abc123def456';");
    expect(out).toContain('/*LEDGER_FILES*/ ["./assets/a-1.js","./assets/b-2.css"] /*END_LEDGER_FILES*/');
    expect(out).not.toContain('__LEDGER_BUILD__');
    expect(out.length).toBeGreaterThan(SW.length - 100);
  });
  it('makes the worker file differ from build to build (otherwise the browser would never install the new one)', () => {
    expect(injectBuild(SW, 'aaaaaaaaaaaa', [])).not.toBe(injectBuild(SW, 'bbbbbbbbbbbb', []));
  });
  it('the build id can never look like the "not filled in" placeholder', () => {
    expect(buildId({ a: 'b' }).startsWith('__')).toBe(false);
  });
  it('refuses a worker that has lost either placeholder, so a release cannot ship a cache that never changes', () => {
    expect(() => injectBuild(SW.replace(BUILD_MARKER, "'fixed'"), 'x', [])).toThrow(/placeholder/);
    expect(() => injectBuild(SW.replace(FILES_MARKER, ''), 'x', [])).toThrow(/placeholder/);
    expect(() => injectBuild('self.addEventListener("fetch", () => {});', 'x', [])).toThrow(/placeholder/);
  });
  it('the real worker has exactly one of each placeholder', () => {
    expect(SW.split(BUILD_MARKER)).toHaveLength(2);
    expect(SW.match(/\/\*LEDGER_FILES\*\//g)).toHaveLength(1);
  });
});
