import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: `x.toISOString().slice(0, 10)` gives the UTC day, which in the evening in the Americas is already tomorrow.
 * Use todayISO() / localDay() / localISO() for a local day. The few files below use it on dates built in UTC on purpose
 * (pure date arithmetic) or need one shared day across devices.
 */
const ALLOWED: Record<string, string> = {
  'src/lib/dates.ts': 'date arithmetic on dates built in UTC',
  'src/lib/calendar.ts': 'date arithmetic on dates built in UTC',
  'src/pages/PayoffPage.tsx': 'month labels built in UTC',
  'src/modules/today/settings.ts': 'checks that a typed date really exists',
  'src/lib/autoBackup.ts': 'one shared UTC day for weekly backup names on every device',
};

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('no accidental UTC days', () => {
  it('toISOString().slice(0, 10) appears only where it is meant to', () => {
    const bad = walk('src')
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => !(f in ALLOWED) && /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)|toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)/.test(readFileSync(f, 'utf8')));
    expect(bad, `Use a local-day helper instead in: ${bad.join(', ')}`).toEqual([]);
  });
});
