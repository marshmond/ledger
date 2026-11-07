import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source guards for the B1 promises: the Bills module never writes Finance, never creates Tasks, Calendar events or billing-period records,
 * never sends data anywhere, and shows money only through the Hide-Amounts-aware helpers. They read the module's own source files, so a
 * future change that breaks a promise fails here at once. (Test files are excluded: they may read Finance to PROVE nothing changed.)
 */
const DIR = 'src/modules/bills';
const sources = readdirSync(DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'billsTestkit.ts')
  .map((f) => ({ f, text: readFileSync(join(DIR, f), 'utf8') }));
const scan = (re: RegExp) => sources.filter((s) => re.test(s.text)).map((s) => s.f);

describe('B1 guards: what the Bills module must never do', () => {
  it('there are source files to check', () => expect(sources.length).toBeGreaterThan(15));

  it('never writes a Finance table (it may only READ accounts, for the funding-account pointer)', () => {
    const FINANCE = 'accounts|txns|categories|categoryGroups|recurring|recurringLog|loans|loanRates|loanEvents|budgetTargets|assignments|payeeRules|importBatches|goals|settings';
    expect(scan(new RegExp(`\\.(${FINANCE})\\s*\\.\\s*(add|put|update|delete|bulkAdd|bulkPut|bulkDelete|clear|modify)\\b`))).toEqual([]);
    expect(scan(/\.(accounts)\s*\.\s*(toArray|get|where|filter)\b/).sort()).toEqual(['ObligationForm.tsx', 'ObligationPage.tsx']);
    expect(scan(/\.(txns|recurring|recurringLog|loans)\b/)).toEqual([]); // no other Finance table is even read
  });

  it('never imports the code that writes Finance, posts scheduled items, forecasts or imports', () => {
    expect(scan(/from '\.\.\/\.\.\/lib\/(schedule|forecast\w*|ledger|csvImport|loanLedger|loanSchedule|transfers|txnCreate|rules|budget\w*)'/)).toEqual([]);
    expect(scan(/from '\.\.\/ledger\//)).toEqual([]);
  });

  it('never creates a Task, a Calendar event, a due item, a link or a billing-period record', () => {
    expect(scan(/from '\.\.\/(tasks|calendar)\//)).toEqual([]);
    expect(scan(/\b(createTask|saveTask|createEvent|publishDueItem|completeTask)\b/)).toEqual([]);
    expect(scan(/shared\.links\.(add|remove)/)).toEqual([]);
    // the word "cycle" appears only where billing-period records are READ (the delete guard) or documented
    for (const s of sources) for (const line of s.text.split('\n')) if (/kind:\s*'cycle'|'cycle'\s*,\s*data|KIND_CYCLE/.test(line)) throw new Error(`${s.f} writes a cycle record: ${line}`);
    expect(scan(/rows\(d\)\.put\([^)]*cycle/)).toEqual([]);
  });

  it('contributes no due provider, Today card or Calendar layer in B1', () => {
    expect(scan(/dueProvider\s*:|todayCards\s*:|BILLS_ID|registerDueProvider/)).toEqual(['index.tsx'].filter(() => false));
    expect(scan(/from '\.\.\/\.\.\/core\/dueProvider'/)).toEqual(['records.ts']); // only `goTo`, to open a bill from a link
  });

  it('sends no data anywhere and writes no browser storage', () => {
    expect(scan(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/)).toEqual([]);
    expect(scan(/localStorage|sessionStorage|indexedDB/)).toEqual([]);
  });

  it('shows money only through the Hide-Amounts-aware helpers', () => {
    expect(scan(/formatCents\(/).sort()).toEqual(['BillsParts.tsx', 'quickAddDef.ts']); // quickAddDef masks it itself when Hide Amounts is on
    expect(scan(/toLocaleString|Intl\.NumberFormat|\$\{\(?[a-z.]*cents\s*\/\s*100/)).toEqual([]);
  });

  it('stores no account number, card number, password or access code field', () => {
    expect(scan(/\b(accountNumber|cardNumber|routingNumber|iban|cvv|passcode|loginPassword|accessCode)\b\s*[:?]/i)).toEqual([]);
  });

  it('uses no UTC "today" and no unbounded loops over damaged data (every loop in the readers is capped)', () => {
    expect(scan(/toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/)).toEqual([]);
    expect(scan(/while\s*\(true\)|for\s*\(;;\)/)).toEqual([]);
  });

  it('the shared date helper kept its old import path working and added only new names', async () => {
    const lib = readFileSync('src/lib/semimonthly.ts', 'utf8');
    const old = readFileSync('src/modules/services/semimonthly.ts', 'utf8');
    expect(old).toMatch(/export \* from '\.\.\/\.\.\/lib\/semimonthly'/);
    expect(old.split('\n').filter((l) => /^export (function|const|type|interface)/.test(l))).toEqual([]);
    for (const name of ['slotDate', 'semiDates', 'semiNext', 'semiProblem', 'readSlot', 'readSemi', 'canonicalSemi', 'describeSemi', 'slotWords']) expect(lib, name).toMatch(new RegExp(`export (function|const) ${name}\\b`));
    expect(lib).toMatch(/export function slotProblem/);
    expect(lib).toMatch(/export function monthSlotDates/);
  });
});
