/**
 * Household finances (B5) mutation checks. For each entry the production source is deliberately broken, the B5 tests (and the earlier guards they build on) are run,
 * and the file is restored. A mutation that no test notices is a GAP in the tests and is reported as SURVIVED.
 * Usage: node scripts/household-b5-mutation-check.cjs [outputFile]      (ONLY=M1 runs one entry, START=M5 resumes from one)
 * The original files are read first and restored at the end and after every run, even if a run crashes.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'mutation-results-b5.txt');
const H = 'src/modules/household/';
const US = `${H}unionSpend.ts`, CM = `${H}commitments.ts`, OV = `${H}overview.ts`, RB = `${H}relatedBill.ts`, PT = `${H}Parts.tsx`, OP = `${H}OverviewPage.tsx`;
const SP = 'src/modules/assets/spending.ts', BS = 'src/modules/bills/billsSpend.ts', HS = 'src/modules/services/householdSpend.ts', BM = 'src/modules/bills/model.ts';

/** [id, file, text to find (must exist exactly as written), replacement, the invariant it breaks] */
const MUTATIONS = [
  // ---- the union: each payment once ----
  ['M1 a Finance piece reached by two readers is counted twice', US, 'acc.set(p.key, a);\n    for (const id of p.recordIds)', "acc.set(p.key + '#' + acc.size, a);\n    for (const id of p.recordIds)", 'a payment linked from Bills and Services would be counted once for each'],
  ['M2 a whole transaction is counted beside its part (no cover across readers)', US, 'if (a.resolved.ref.splitIndex === undefined || !wholeTxns.has(a.resolved.ref.txnId)) continue;', 'continue;', 'a whole and its part would both be added'],
  ['M3 a refund is ignored', US, 'const financeCents = pieces.reduce((n, p) => n + p.cents, 0);', 'const financeCents = pieces.reduce((n, p) => n + Math.max(p.cents, 0), 0);', 'money back would not lower the total'],
  ['M4 a typed amount set aside by a Finance link is counted anyway', US, 'cents: t.cents!, authoritative: false, date: t.paidOn', 'cents: t.cents!, authoritative: true, date: t.paidOn', 'a typed payment would be added over the Finance payment for the same period'],
  ['M5 typed amounts of equal size in different modules are merged by value', US, '// ---- totals (each one a sum of the lists above, so every total can be reproduced) ----', "{ const amts = new Set<number>(); for (const t of typed) { if (t.authoritative) { if (amts.has(t.cents)) t.authoritative = false; amts.add(t.cents); } } }\n  // ---- totals (each one a sum of the lists above, so every total can be reproduced) ----", 'two real payments of the same size would become one'],
  ['M6 a payment shared by modules is credited to whichever module comes first', US, "const attribution: Attribution = sharedAcrossModules ? 'shared' : modules[0];", 'const attribution: Attribution = modules[0];', 'the breakdown would hide that a payment is shared and credit it by list order'],
  ['M7 stale evidence never makes the figure "not reconciled"', US, 'if (nStale) caveats.push(', 'if (false) caveats.push(', 'a total would look reconciled while a linked payment counts nothing'],
  ['M8 two different typed Bills amounts are not reported', US, 'if (amounts.length > 1) { billsTypedDisputed++;', 'if (false) { billsTypedDisputed++;', 'disputed typed amounts would pass without a word'],
  ['M9 a possible duplicate needs no evidence of a relationship', US, 'if (!sameProvider && !viaLink) continue;', '', 'any two payments with the same amount and date would be reported as possible duplicates'],
  // ---- commitments ----
  ['M10 an unknown service visit amount becomes a known $0', CM, "cents: null, certainty: 'unknown', note: 'A visit is expected", "cents: 0, certainty: 'known', note: 'A visit is expected", 'an unknown amount would be shown and added as nothing'],
  ['M11 a folded service row is still added to the totals', CM, 'for (const r of rows) if (r.foldedInto === null) addRow(t, r.cents, r.certainty);', 'for (const r of rows) addRow(t, r.cents, r.certainty);', 'a bill and its linked service would be counted twice'],
  ['M12 a linked pair is folded whenever amounts are known (equality ignored)', CM, 'if (bill.cents === svc.cents) return { status:', 'if (true) return { status:', 'a genuine extra charge would be swallowed by the bill'],
  ['M13 linked records are never folded', CM, "if (d.status === 'folded') for (const r of rows) if (r.module === 'services' && r.sourceId === a) r.foldedInto = `bill:${b}`;", '', 'a bill and its linked service would be counted twice'],
  ['M14 a window includes one day too many', CM, 'if (d < 0 || d > days) continue;', 'if (d < 0 || d > days + 1) continue;', 'a payment 8 days away would be in the 7-day window'],
  ['M15 the twelve months run one day past the Bills window', CM, 'const twelveEnd = bills.window.to;', 'const twelveEnd = addDays(bills.window.to, 1);', 'Bills and Services would be summed over different windows'],
  ['M16 a confirmed cancellation no longer stops expected bills', BM, "const cut = d.status === 'active' ? d.lc?.cutoffOn ?? null : null;", 'const cut = null;', 'a cancelled subscription would be projected indefinitely'],
  // ---- loading, privacy, boundaries ----
  ['M17 the load writes to Finance', OV, 'const lookup = lookupOfMap(new Map([...bills.financeTxns, ...extra]));', "const lookup = lookupOfMap(new Map([...bills.financeTxns, ...extra]));\n  await d.txns.toCollection().modify((t) => { t.memo = 'touched'; });", 'reading the dashboard would change a Finance transaction'],
  ['M18 a failed second Finance read is replaced by an empty result', OV, 'const extra = await loadTxnMap(refs.filter((r) => !bills.financeTxns.has(r.txnId)), d);', 'const extra = await loadTxnMap(refs.filter((r) => !bills.financeTxns.has(r.txnId)), d).catch(() => new Map());', 'a partial total would look complete'],
  ['M19 a dashboard control changes the Calendar layer choice', OP, "const [period, setPeriod] = useState('last12');", "const [period, setPeriod0] = useState('last12'); const setPeriod = (p: string) => { localStorage.setItem('calendar-hidden-layers', '[]'); setPeriod0(p); };", 'a dashboard filter would change what the Calendar shows'],
  ['M20 an amount ignores Hide Amounts', PT, '<strong className="hh-amt">{money(c)}</strong>', '<strong className="hh-amt">{formatCents(c)}</strong>', 'amounts would show while Hide Amounts is on'],
  ['M21 the related bill is found by provider name instead of the link', RB, 'const ids = [...(await billsLinkedTo(arrangementId, d))].sort((a, b) => a - b);', "const ids = [...new Set([...(await billsLinkedTo(arrangementId, d)), ...(await (await import('../bills/data')).loadObligations(d)).filter((o) => o.data.providerNameSnapshot.length > 0).map((o) => o.id)])].sort((a, b) => a - b);", 'a bill would be shown as related to an arrangement because of a similar name'],
  // ---- the existing readers the golden master protects ----
  ['G4 resolveRef(): a restructured split is treated as unchanged (a stale reference counts as live)', 'src/lib/txnRef.ts', 'const same = ref.fp.splitCount === parts.length && ref.fp.amountCents === part.amountCents && ref.fp.categoryId === part.categoryId;', 'const same = true;', 'a stale split reference would be counted as if it were still the linked part'],
  ['G1 spend(): a part is counted beside its whole', SP, 'if (x.ref.splitIndex !== undefined && wholeCounted.has(x.ref.txnId)) { s.coveredParts.push(item); continue; }', '', 'a whole transaction and its part would both count'],
  ['G2 Bills: a typed amount counts beside Finance links in one period', BS, 'const manualCents = refs.length === 0 && typed.length === 1 ? typed[0] : null;', 'const manualCents = typed.length === 1 ? typed[0] : null;', 'a typed payment would be added over the Finance payment (and both sources would be kept)'],
  // (the replacement keeps the code valid, so a catch is a real test failure and never a file that merely fails to parse)
  ['G3 householdSpend(): typed amounts on a linked job count beside a Finance payment', HS, "if (hasFinance) for (const c of cands) ev.leftOut.push({ id: c.cost.id, cents: c.typed!, why: 'finance' });", "if (false) for (const c of cands) ev.leftOut.push({ id: c.cost.id, cents: c.typed!, why: 'finance' });", 'a typed amount would double the Finance payment for the same job'],
];

const TESTS = ['src/modules/household/'];
const results = [];
let started = false;
const backups = new Map();
const files = [...new Set(MUTATIONS.map((m) => m[1]))];
for (const f of files) backups.set(f, fs.readFileSync(path.join(root, f), 'utf8'));
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const put = (abs, text) => { for (let i = 0; i < 40; i++) { try { fs.writeFileSync(abs, text); if (fs.readFileSync(abs, 'utf8') === text) return; } catch (e) { if (i === 39) throw e; } sleepMs(250); } };
const restore = () => { for (const [f, text] of backups) { try { put(path.join(root, f), text); } catch (e) { console.error('RESTORE FAILED for ' + f + ': ' + e.message); } } };
process.on('SIGINT', () => { restore(); process.exit(1); });

try {
  for (const [id, file, find, replace, meaning] of MUTATIONS) {
    if (process.env.ONLY && !id.startsWith(process.env.ONLY + ' ')) continue;
    if (process.env.START && !started) { if (!id.startsWith(process.env.START + ' ')) continue; started = true; }
    const abs = path.join(root, file);
    const original = backups.get(file);
    const crlf = original.includes('\r\n');
    const normalized = crlf ? find.replace(/\n/g, '\r\n') : find;
    const repl = crlf ? replace.replace(/\n/g, '\r\n') : replace;
    if (!original.includes(normalized)) { results.push(`${id} | NOT APPLIED (text not found) | ${meaning}`); fs.writeFileSync(out, results.join('\n') + '\n'); continue; }
    put(abs, original.replace(normalized, () => repl));
    const r = spawnSync('npx', ['vitest', 'run', ...TESTS, '--reporter=dot'], { cwd: root, shell: true, encoding: 'utf8', timeout: 280000 });
    put(abs, original);
    const text = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
    const failed = /Tests\s+(?:(\d+) failed)/.exec(text);
    const suiteFail = /Test Files\s+(\d+) failed/.exec(text);
    const names = [...new Set([...text.matchAll(/FAIL\s+src\/modules\/household\/([\w.-]+\.test\.ts)/g)].map((m) => m[1]))].join(', ');
    const status = failed || suiteFail ? `CAUGHT (${failed ? failed[1] : '0'} tests failed${suiteFail ? `, ${suiteFail[1]} files failed` : ''}; ${names || 'see run'})` : (/Tests\s+\d+ passed/.test(text) ? 'SURVIVED (all tests passed)' : 'UNKNOWN (no test summary)');
    results.push(`${id} | ${status} | ${meaning}`);
    fs.writeFileSync(out, results.join('\n') + '\n');
  }
} finally {
  restore();
  fs.writeFileSync(out, results.join('\n') + '\nDONE\n');
}
