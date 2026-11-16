import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { exportAll, importAll } from './backup';
import { installTracking } from './sync/track';
import {
  applySavedLayout, layoutFromMapping, classifyRows, commitImport, detectMapping, layoutKey, loadLayout, normalizeRows, parseTransactionText, readLayout, saveLayout, undoBatch,
  type CsvMapping,
} from './csvImport';
import { deleteAccountWithTransactions } from './accountDependents';

/**
 * R2.1 Import v2. Invented data only. The page's own rule (nothing is written until the person confirms) lives in ImportPage; here the
 * engine-level guarantees are checked: the saved layout is per account, only reused when the file really fits, upload and paste are
 * one pipeline, signs and duplicates behave the same, and the layout rides the ordinary backup.
 */
let d: FinanceDB;
let n = 0;
let checking: number;
let savings: number;

beforeEach(async () => {
  d = new FinanceDB(`test-r21-${n++}`);
  installTracking(d);
  checking = (await d.accounts.add({ name: 'Demo Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
  savings = (await d.accounts.add({ name: 'Demo Savings', kind: 'savings', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
});

const DEBIT_CREDIT = 'Transaction Date,Details,Money Out,Money In\n11/01/2026,Grocery Store,85.42,\n11/02/2026,Payroll,,4500.00\n';
const REORDERED = 'Money In,Money Out,Details,Transaction Date\n,12.00,Coffee Shop,11/03/2026\n';
const SIGNED = 'Date,Description,Amount\n2026-11-01,Grocery Store,-85.42\n2026-11-02,Payroll,4500.00\n';

/** What the page does for a file or pasted text: read, pick the layout, normalize, classify. */
async function run(text: string, accountId: number, manual?: CsvMapping) {
  const { csv, problem } = parseTransactionText(text);
  expect(problem).toBeNull();
  const saved = await loadLayout(d, accountId);
  const check = saved ? applySavedLayout(saved, csv!.headers) : null;
  const map = check?.ok ? check.map : (manual ?? detectMapping(csv!.headers));
  const { rows } = normalizeRows(csv!.rows, map);
  return { map, usedSaved: !!check?.ok, check, rows, classified: await classifyRows(d, accountId, rows) };
}

const manualMap = (): CsvMapping => ({ date: 'Transaction Date', description: 'Details', debit: 'Money Out', credit: 'Money In', dateOrder: 'MDY', invertSign: false });

describe('R2.1 remembered layout', () => {
  it('first import has no saved layout; previewing writes nothing', async () => {
    const r = await run(DEBIT_CREDIT, checking, manualMap());
    expect(r.usedSaved).toBe(false);
    expect(await d.settings.count()).toBe(0);
    expect(await d.txns.count()).toBe(0);
    expect(await d.importBatches.count()).toBe(0);
  });

  it('confirming saves the layout, and a second compatible import applies it', async () => {
    const first = await run(DEBIT_CREDIT, checking, manualMap());
    await commitImport(d, checking, 'one.csv', first.classified);
    await saveLayout(d, checking, manualMap());
    const second = await run(DEBIT_CREDIT, checking);
    expect(second.usedSaved).toBe(true);
    expect(second.map).toMatchObject({ date: 'Transaction Date', description: 'Details', debit: 'Money Out', credit: 'Money In' });
  });

  it('stores only column titles and options, never rows, and is keyed by the account id', async () => {
    await saveLayout(d, checking, manualMap());
    const row = await d.settings.get(layoutKey(checking));
    expect(row?.key).toBe(`import-layout:${checking}`);
    expect(JSON.stringify(row)).not.toMatch(/Grocery|85\.42|Payroll|4500/); // ids-ok: checks the stored JSON holds no row text
    expect(Object.keys(row!.value as object).sort()).toEqual(['credit', 'dateOrder', 'date', 'debit', 'description', 'invertSign', 'v'].sort());
  });

  it('is account-specific', async () => {
    await saveLayout(d, checking, manualMap());
    expect(await loadLayout(d, savings)).toBeNull();
    expect((await run(DEBIT_CREDIT, savings)).usedSaved).toBe(false);
  });

  it('still applies when the columns are reordered, and ignores capitals and spacing', async () => {
    await saveLayout(d, checking, manualMap());
    const r = await run(REORDERED, checking);
    expect(r.usedSaved).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ date: '2026-11-03', amountCents: -1200, payee: 'Coffee Shop' });
    const loose = applySavedLayout(layoutFromMapping(manualMap()), ['transaction  date', ' DETAILS', 'money out', 'Money In']);
    expect(loose.ok).toBe(true);
  });

  it('falls back to manual mapping, with a reason, when a column is missing or repeated', async () => {
    await saveLayout(d, checking, manualMap());
    const renamed = await run(SIGNED, checking);
    expect(renamed.usedSaved).toBe(false);
    expect(renamed.check).toMatchObject({ ok: false });
    expect((renamed.check as { reason: string }).reason).toMatch(/missing the "Transaction Date"/);
    const dup = applySavedLayout(layoutFromMapping(manualMap()), ['Transaction Date', 'Details', 'Money Out', 'Money In', 'Details']);
    expect(dup).toMatchObject({ ok: false });
    expect((dup as { reason: string }).reason).toMatch(/more than one "Details"/);
  });

  it('a new confirmed import replaces the old layout; malformed stored values count as nothing saved', async () => {
    await saveLayout(d, checking, manualMap());
    await saveLayout(d, checking, { ...detectMapping(['Date', 'Description', 'Amount']), invertSign: true });
    expect(await loadLayout(d, checking)).toMatchObject({ amount: 'Amount', invertSign: true });
    expect(readLayout({ v: 1, date: 'D' })).toBeNull();
    expect(readLayout('nope')).toBeNull();
    expect(readLayout({ v: 1, date: 'D', description: 'X', dateOrder: 'MDY', invertSign: false })).toBeNull(); // no amount column
  });

  it('the saved flip-signs choice is applied, never guessed', async () => {
    const card = 'Date,Description,Amount\n2026-11-01,Hardware Store,40.00\n';
    await saveLayout(d, checking, { ...detectMapping(['Date', 'Description', 'Amount']), invertSign: true });
    expect((await run(card, checking)).rows[0].amountCents).toBe(-4000);
    expect((await run(card, savings)).rows[0].amountCents).toBe(4000); // another account: nothing remembered, nothing flipped
  });

  it('deleting an account removes its remembered layout', async () => {
    await saveLayout(d, savings, manualMap());
    await saveLayout(d, checking, manualMap());
    await deleteAccountWithTransactions(d, savings);
    expect(await loadLayout(d, savings)).toBeNull();
    expect(await loadLayout(d, checking)).not.toBeNull();
  });
});

describe('R2.1 paste and upload are one pipeline', () => {
  it('give identical rows and identical duplicate results', async () => {
    const fromFile = await run(SIGNED, checking); // the file path hands its text to the same function
    const fromPaste = await run(SIGNED, checking);
    expect(fromPaste.classified).toEqual(fromFile.classified);
    await commitImport(d, checking, 'file.csv', fromFile.classified);
    const again = await run(SIGNED, checking);
    expect(again.classified.map((r) => r.cls)).toEqual(['duplicate', 'duplicate']);
  });

  it('reads spreadsheet-copied (tab separated) text and quoted commas', async () => {
    const tabs = 'Date\tDescription\tAmount\n2026-11-01\t"Hardware, Garden"\t-20.00\n';
    const r = await run(tabs, checking);
    expect(r.rows).toEqual([expect.objectContaining({ payee: 'Hardware, Garden', amountCents: -2000 })]);
  });

  it('debit and credit columns keep their signs (money out negative, money in positive)', async () => {
    const r = await run(DEBIT_CREDIT, checking, manualMap());
    expect(r.rows.map((x) => x.amountCents)).toEqual([-8542, 450000]);
  });

  it('explains empty, header-only and non-tabular input', () => {
    expect(parseTransactionText('   \n').problem).toMatch(/Nothing to read/);
    expect(parseTransactionText('Date,Description,Amount\n').problem).toMatch(/Only a header/);
    expect(parseTransactionText('just some words').problem).toMatch(/columns/);
  });

  it('undo works the same for a pasted import', async () => {
    const r = await run(SIGNED, checking);
    const batch = await commitImport(d, checking, 'Pasted transactions', r.classified);
    expect(await d.txns.count()).toBe(2);
    await undoBatch(d, batch.id!);
    expect(await d.txns.count()).toBe(0);
    expect(await d.importBatches.count()).toBe(0);
  });
});

describe('R2.1 backup', () => {
  it('the remembered layout survives backup and restore', async () => {
    await saveLayout(d, checking, manualMap());
    const backup = await exportAll(d);
    const fresh = new FinanceDB(`test-r21-restore-${n++}`);
    installTracking(fresh);
    await importAll(fresh, JSON.parse(JSON.stringify(backup)));
    expect(await loadLayout(fresh, checking)).toMatchObject({ date: 'Transaction Date', debit: 'Money Out', credit: 'Money In' });
  });
});
