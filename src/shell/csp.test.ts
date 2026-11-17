import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPolicy, CONNECT_HOSTS, GOOGLE_GSI_PATH, GOOGLE_SCRIPT_SRC } from './csp';

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
    // CAL-G1: the only outside script is Google's sign-in library, by its exact address, followed by the named inline scripts.
    expect(p).toContain(`script-src 'self' ${GOOGLE_SCRIPT_SRC} 'sha256-abc='`);
    expect(p).not.toMatch(/script-src[^;]*unsafe/);
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("base-uri 'none'");
    for (const h of CONNECT_HOSTS) expect(p).toContain(h);
  });

  it('CAL-G1: Google is allowed only by exact path, with no wildcard, no whole-domain entry and no style or image access', () => {
    const p = buildPolicy([]);
    const directive = (n: string) => p.split('; ').find((d) => d.startsWith(`${n} `)) ?? '';
    expect(directive('script-src')).toBe(`script-src 'self' ${GOOGLE_SCRIPT_SRC}`);
    expect(directive('frame-src')).toBe(`frame-src ${GOOGLE_GSI_PATH}`);
    expect(directive('connect-src')).toContain('https://gmail.googleapis.com');
    expect(directive('connect-src')).toContain(GOOGLE_GSI_PATH);
    expect(GOOGLE_SCRIPT_SRC).toBe('https://accounts.google.com/gsi/client');
    expect(p).not.toMatch(/\*/);
    expect(p).not.toMatch(/https:\/\/accounts\.google\.com(?!\/gsi\/)/); // every mention of Google's sign-in host names the /gsi/ path
    expect(p).not.toMatch(/googleapis\.com\/(?!$)|https:\/\/[a-z]*\.?google\.com[ ;]/); // and no bare Google domain is allowed
    expect(directive('style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive('img-src')).toBe("img-src 'self' data: blob:");
    expect(p).toContain("default-src 'self'");
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
