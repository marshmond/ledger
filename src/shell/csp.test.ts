import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPolicy, CONNECT_HOSTS } from './csp';

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('content security policy', () => {
  it('allows only this site, the listed hosts and the named inline scripts', () => {
    const p = buildPolicy(["'sha256-abc='"]);
    expect(p).toContain("default-src 'self'");
    expect(p).toContain("script-src 'self' 'sha256-abc='");
    expect(p).not.toMatch(/script-src[^;]*unsafe/);
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("base-uri 'none'");
    for (const h of CONNECT_HOSTS) expect(p).toContain(h);
  });

  it('every outside host a file fetches from is in the allowed list', () => {
    const missing: string[] = [];
    for (const f of walk('src')) {
      const text = readFileSync(f, 'utf8');
      if (!/\bfetch\(|\bcaller\(/.test(text)) continue;
      for (const m of text.matchAll(/https:\/\/[a-z0-9.-]+/gi)) if (!CONNECT_HOSTS.includes(m[0])) missing.push(`${f}: ${m[0]}`);
    }
    expect(missing, 'Add the host to CONNECT_HOSTS in src/shell/csp.ts, or the browser will block it in the published app').toEqual([]);
  });
});
