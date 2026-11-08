import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanText, scrubGeneratedIds } from './leakTestkit';

/**
 * ST-S1 / TS-01. Two jobs:
 *  1. Prove the helper hides only generated ids and timestamps, never a real leak.
 *  2. Fail any test that looks for a short forbidden number ("not.toMatch(/4455/)", "not.toContain('12345')") in text WITHOUT going through the
 *     helper, because record ids and timestamps are clock-based numbers that can contain it and fail the test for no real reason.
 */

describe('scanText hides generated ids and timestamps, nothing else', () => {
  const id = 1799427600891530; // clock-based id (16 digits, starts 1799 in January 2027)
  const stamp = 1799427600891; // epoch milliseconds (13 digits)

  it('a forbidden number inside a generated id or timestamp is hidden', () => {
    const item = { id: `bills:due-${id}-m2027-01:2027-01-18`, icsUid: `bills-${id}-m2027-01@ledger.local`, createdAt: stamp, title: 'Streaming', detail: 'Due soon' };
    expect(scanText(item)).not.toMatch(/1799|4242|1234|9427|6008/);
    expect(scanText(item)).toContain('Streaming'); // the readable text is still scanned
    expect(scanText({ fixed: 9007199254740001 })).toBe('{"fixed":"#"}'.replace('"#"', '#')); // a fixed built-in id (9e15 range)
  });

  it('REAL leaks are still found: an amount, an account number, a card number and a note are all left in place', () => {
    expect(scanText({ title: 'Pay $17.99', id })).toMatch(/17\.99/);
    expect(scanText({ detail: 'account 12345678' })).toMatch(/12345678/);
    expect(scanText({ detail: 'card 4242424242424242 ok' })).toMatch(/4242424242424242/); // 16 digits, but not id-shaped (starts with 4)
    expect(scanText({ note: 'gate code 4455', id })).toMatch(/4455/);
    expect(scanText({ cents: 1799, id })).toMatch(/1799/); // an amount in cents is a short number, not an id
    expect(scrubGeneratedIds('amount 114520 and id ' + id)).toBe('amount 114520 and id #');
  });

  it('a leak written in the NON-numeric part of an id-bearing string is still found', () => {
    expect(scanText({ icsUid: `bills-${id}-secret-note@ledger.local` })).toMatch(/secret-note/);
  });
});

// ---- the source guard ----

const SELF = 'leakScanGuard.test.ts';
const SENTINEL_RUN = /(?<![\w-])\d{3,}(?![\w-])/; // a bare run of 3+ digits (not part of a date, a phone number or a word-number code like SN-777)

/** Lines that forbid a short digit run without the helper. Pure, so it can be tested. */
export function findRiskyAssertions(source: string): { line: number; text: string }[] {
  const lines = source.split(/\r?\n/);
  const safeVars = new Set([...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:scanText|scrubGeneratedIds)\(/g)].map((m) => m[1]));
  const out: { line: number; text: string }[] = [];
  lines.forEach((ln, i) => {
    const m = ln.match(/\.not\.(?:toMatch|toContain)\((.*)\)\s*;?/);
    if (!m) return;
    const literal = m[1].replace(/\\[dDbBsSwW]/g, '').replace(/\{\d+(?:,\d*)?\}/g, '');
    if (!SENTINEL_RUN.test(literal)) return;
    if (/scanText\(|scrubGeneratedIds\(|\/\/ ids-ok/.test(ln)) return;
    const subject = ln.match(/expect\((\w+)/)?.[1];
    if (subject && safeVars.has(subject)) return;
    out.push({ line: i + 1, text: ln.trim().slice(0, 140) });
  });
  return out;
}

function testFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) testFiles(p, acc);
    else if (/\.test\.tsx?$/.test(e.name) && e.name !== SELF) acc.push(p);
  }
  return acc;
}

describe('no test looks for a short forbidden number without scanText', () => {
  it('detector self-test: it flags the risky shapes and accepts the safe ones', () => {
    expect(findRiskyAssertions(`expect(JSON.stringify(items)).not.toMatch(/4455|secret/);`)).toHaveLength(1);
    expect(findRiskyAssertions(`const text = JSON.stringify(items);\nexpect(text).not.toContain('12345');`)).toHaveLength(1);
    expect(findRiskyAssertions(`expect(text).not.toMatch(/1799/);`)).toHaveLength(1);
    expect(findRiskyAssertions(`expect(scanText(items)).not.toMatch(/4455|secret/);`)).toHaveLength(0);
    expect(findRiskyAssertions(`const text = scanText(items);\nexpect(text).not.toMatch(/4455/);`)).toHaveLength(0);
    expect(findRiskyAssertions(`expect(text).not.toMatch(/4455/); // ids-ok: plain words`)).toHaveLength(0);
    // dates, phone-style codes and word codes are not id-shaped risks; \\d tokens are not literal digits
    expect(findRiskyAssertions(`expect(dates).not.toContain('2026-11-18');`)).toHaveLength(0);
    expect(findRiskyAssertions(`expect(t).not.toMatch(/555-0100|SN-777/);`)).toHaveLength(0);
    expect(findRiskyAssertions(`expect(t).not.toMatch(/\\$|\\d+\\.\\d{2}\\b/);`)).toHaveLength(0);
  });

  it('every existing test file is clean (a new one that breaks the rule shows up here with its file and line)', () => {
    const bad: string[] = [];
    for (const f of testFiles(join(process.cwd(), 'src'))) {
      for (const r of findRiskyAssertions(readFileSync(f, 'utf8'))) bad.push(`${f.replace(/.*[\\/]src[\\/]/, 'src/')}:${r.line}  ${r.text}`);
    }
    expect(bad, 'Use scanText(value) or scrubGeneratedIds(text) from src/lib/leakTestkit.ts, or add "// ids-ok: reason" if the text can never hold an id').toEqual([]);
  });
});
