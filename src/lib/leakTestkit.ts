/**
 * Test-only helper (never imported by the app). ST-S1 / TS-01.
 *
 * Privacy tests check that an amount, an account number or a note never appears in what a person can see or export. They do that by looking
 * for a few forbidden numbers (for example `1234` or `4455`) in serialized text. Record ids are about 16 digits made from the clock
 * (`Date.now() * 1000 + random`) and timestamps are 13-digit epoch milliseconds, so for a few minutes now and then (and for twelve days from
 * 2027-01-03, when ids start with `1799`) a harmless id or timestamp CONTAINS a forbidden number and the test fails for no real reason.
 *
 * `scanText` serializes a value and replaces every generated-id-shaped or epoch-shaped number with `#` first. Everything a person could read
 * (titles, details, notes, amounts, account numbers, provider names, even the non-numeric parts of a calendar id) is still scanned, so a real
 * leak still fails. A number that is not id-shaped (a short amount, an account number, a card number starting 4 or 5) is never replaced.
 *
 * `leakScanGuard.test.ts` fails any new test that looks for a short forbidden number without going through these helpers.
 */

/** 16-digit generated ids (clock-based ones start 1 or 2; the fixed built-in ones start 9) and 13-digit epoch milliseconds (2017 to 2033). */
export const GENERATED_NUMBER = /(?<![0-9])(?:[12][0-9]{15}|9[0-9]{15}|1[5-9][0-9]{11})(?![0-9])/g;

export function scrubGeneratedIds(text: string): string {
  return text.replace(GENERATED_NUMBER, '#');
}

/** JSON text of a value with generated ids and timestamps replaced, for "this must not appear" checks. */
export function scanText(value: unknown): string {
  return scrubGeneratedIds(JSON.stringify(value) ?? '');
}
