/**
 * Bills B4 mutation checks. For each entry the production source is deliberately broken, the B4 tests (and the Bills guard tests) are run, and the file is
 * restored. A mutation that no test notices is a GAP in the tests and is reported as SURVIVED.
 * Usage: node scripts/bills-b4-mutation-check.cjs [outputFile]      (ONLY=C1 runs one entry, START=C5 resumes from one)
 * The original files are read first and restored at the end and after every run, even if a run crashes.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'mutation-results-b4.txt');
const B = 'src/modules/bills/';
const LS = `${B}lifecycleState.ts`, LC = `${B}lifecycleCharges.ts`, LD = `${B}lifecycleData.ts`, LR = `${B}lifecycleRead.ts`, MD = `${B}model.ts`, PE = `${B}periods.ts`, TK = `${B}tasks.ts`, DP = `${B}dueProvider.ts`, UN = `${B}undo.ts`, RM = `${B}readModel.ts`;

/** [id, file, text to find (must exist exactly as written), replacement, what the break means] */
const MUTATIONS = [
  // ---- request, confirmation, effective date ----
  ['C1 a request alone sets the cancellation date', LS, 'effectiveOn: confirm ? confirm.body.effectiveOn : null,', 'effectiveOn: confirm ? confirm.body.effectiveOn : (requests[0] ? requests[0].body.requestedOn : null),', 'a request would stop expected bills as if the provider had confirmed'],
  ['C2 a confirmation is not shown as a confirmation', LS, "else if (c.confirm && ob.status !== 'ended') out.push({ id: 'cancel-confirmed'", "else if (false) out.push({ id: 'cancel-confirmed'", 'a confirmed cancellation would read as a mere request or nothing'],
  ['C3 the effective date is ignored by the expected-dates reader', MD, "const cut = d.status === 'active' ? d.lc?.cutoffOn ?? null : null;", 'const cut = null;', 'bills would keep being expected after a confirmed cancellation'],
  ['C4 the confirmation date is used instead of the effective date', LS, 'const effDates = [...new Set(confirms.map((c) => c.body.effectiveOn))];', 'const effDates = [...new Set(confirms.map((c) => c.body.confirmedOn))];', 'service would be treated as ending the day the provider replied'],
  ['C5 two different effective dates are not flagged', LS, "if (effDates.length > 1) add('confirm-dates'", "if (false) add('confirm-dates'", 'one of two disagreeing dates would be used silently'],
  ['C6 a withdrawal does not negate what it targets', LS, 'for (const n of negators) for (const t of n.targets) negated.add(t);', '', 'a withdrawn cancellation would still stop expected bills'],
  ['C7 a withdrawal and an unseen confirmation are not flagged', LS, 'if (!negated.has(c.id) && concurrent(n, c)) add(', 'if (false) add(', 'a withdrawal and a confirmation from devices that did not see each other would be silently ordered'],
  ['C8 a "replacement" with an earlier id counts', LS, 'if (ids.has(x) && r.id > x && !replaced.has(x))', 'if (ids.has(x) && !replaced.has(x))', 'two records could replace each other and both vanish'],
  // ---- prices ----
  ['P1 two prices from one day: one is silently chosen', LS, 'if (kinds.length > 1) {', 'if (kinds.length > 99) {', 'a disputed price would be used as if it were agreed'],
  ['P2 an overlapping price is silently used', LS, 'if (b !== a && b.from > a.from && b.from <= a.until && !overlapped.has(b.from)) {', 'if (false) {', 'a price starting inside another price\'s range would win silently'],
  ['P3 an unknown price becomes zero', MD, 'return { cents: step?.cents ?? null, basis:', 'return { cents: step?.cents ?? 0, basis:', 'an unknown price would be shown as free'],
  ['P4 a recorded invoice is overwritten by the expected price', PE, 'const amounts = deriveAmounts(effective, exp, lookup);', "const amounts = deriveAmounts(effective.filter((f) => f.body.fact !== 'invoice'), exp, lookup);", 'a new price would change what an old bill says'],
  ['P5 after an explicit end date the old price carries on', LS, 'if (!steps.some((s) => s.from > r.from && s.from <= next)) {', 'if (false) {', 'a price with an end date would be carried forward as if it had none'],
  ['H1 a cancellation hides a period that holds a recorded bill or payment', PE, 'if (inWindow || (opts.allRecorded && records.length > 0)) out.push(p);', 'if (inWindow || (opts.allRecorded && records.length > 0 && p.expected)) out.push(p);', 'a final invoice or posted payment after the effective date would disappear from view'],
  ['E1 the effective day itself is not yet "effective" (a date boundary off by one)', LS, "c.confirm && c.confirm.body.effectiveOn <= today && ob.status !== 'ended'", "c.confirm && c.confirm.body.effectiveOn < today && ob.status !== 'ended'", 'the state would read "confirmed" on the very day it takes effect'],
  ['E2 an owner-edited reminder Task is treated as untouched and removed', TK, "return x.status === 'todo' && m.doOn !== null", "return true || x.status === 'todo' && m.doOn !== null", 'a Task the owner changed would be silently removed'],
  ['L1 the Services link writer stops checking what it writes', B + 'crossLinks.ts', '      assertBillsLink(row);\n', '', 'an unauthorized relationship could be written'],
  // ---- renewals, trials, Tasks, Calendar ----
  ['R1 a passed renewal date is treated as handled', LS, 'const done = v.renewal.outcomes.some((o) => o.body.forDate === ren.date);', 'const done = true;', 'an unconfirmed renewal would stop asking, as if it had been confirmed'],
  ['R2 the renewal review item never appears', RM, "const done = lc.renewal.outcomes.some((o) => o.body.forDate === rf.renewalDate) || lc.acked.has(ackKeyRenewal(rf.renewalDate));", 'const done = true;', 'a renewal that may not have happened would never be raised'],
  ['T1 a second follow-up Task is made while one is open', TK, "if ((await loadBillTasks(d)).some((t) => { const m = markersOf(t); return m && m.obligation === obligationId && m.purpose === 'followup' && open(t); })) return null;", '', 'recording two requests would pile up Tasks'],
  ['T2 a trial that ends on the cancel-by day makes two Tasks', LS, ".filter((d) => !(d.kind === 'notice' && out.some((o) => o.kind === 'trial' && o.date === d.date && o.action)))", '', 'one action would get two reminders'],
  ['K1 a Bills marker is hidden for any kind of Services date', DP, "...(dl.kind === 'notice' || dl.kind === 'renewal' ? coverFor(dl.kind, dl.date) : {}),", "...coverFor('notice', dl.date),", 'a trial or other marker could be left out because of a Services link'],
  // ---- after-cancellation checks ----
  ['A1 a charge after the cancellation is not reported', LC, 'if (!c.offsetBy && !c.expectedFinal && c.elsewhere.length === 0) counted.push(c);', '', 'a possible charge after cancellation would go unnoticed'],
  ['A2 a refund of the wrong size offsets a charge', LC, 'if (usable.reduce((n, r) => n + (left.get(r.key) ?? 0), 0) >= c.cents) {', 'if (usable.length > 0) {', 'a small refund would hide a larger charge'],
  ['A3 a charge before the effective date is counted', LC, 't.id === undefined || t.date <= effectiveOn ||', 't.id === undefined ||', 'ordinary payments before the cancellation would be flagged'],
  // ---- records, writers, Finance, undo ----
  ['W1 an unreadable lifecycle record is dropped on read', LR, '.filter(isLive).map((r: ModuleRecord) => readLifecycle(r));', '.filter(isLive).map((r: ModuleRecord) => readLifecycle(r)).filter((r) => r.body !== null);', 'a record from a newer version would vanish from view'],
  ['W2 a stale preview is applied', LD, 'if (`${ob.updatedAt}|${lcToken(records)}` !== token) throw new Error(STALE);', '', 'a decision made on out-of-date evidence would be written'],
  ['W3 an action writes to a Finance Scheduled rule', LD, '    if (hooks.afterWrite) await hooks.afterWrite(d); // a test seam: throwing here must roll everything back', '    if (hooks.afterWrite) await hooks.afterWrite(d);\n    await d.recurring.update(1, { active: false });', 'Finance would be changed by a lifecycle record'],
  ['W4 the lifecycle view is written into the bill', MD, "void _lc; // B4: the lifecycle view is derived from other records and is never written into the obligation", "if (_lc) (rest as Record<string, unknown>).lc = _lc;", 'derived evidence would be copied into the whole-record last-writer-wins bill'],
  ['U1 Undo of an unlink restores a duplicate link', UN, 'l.toModule === row.toModule && l.toId === row.toId && l.type === row.type)) throw new UndoRefused();', 'false)) throw new UndoRefused();', 'Undo would duplicate a relationship someone re-created'],
];

const TESTS = ['src/modules/bills/b4-', 'src/modules/bills/guards.test.ts', 'src/modules/bills/b3-spend.test.ts', 'src/modules/bills/b31-guards.test.ts', 'src/modules/bills/b2-'];
const results = [];
let started = false;
const backups = new Map();
const files = [...new Set(MUTATIONS.map((m) => m[1]))];
for (const f of files) backups.set(f, fs.readFileSync(path.join(root, f), 'utf8'));
/** Windows can refuse a write for a moment (another process holds the file): retry, never give up on a restore. */
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
    const normalized = original.includes('\r\n') ? find.replace(/\n/g, '\r\n') : find;
    const repl = original.includes('\r\n') ? replace.replace(/\n/g, '\r\n') : replace;
    if (!original.includes(normalized)) { results.push(`${id} | NOT APPLIED (text not found) | ${meaning}`); fs.writeFileSync(out, results.join('\n') + '\n'); continue; }
    put(abs, original.replace(normalized, () => repl));
    const r = spawnSync('npx', ['vitest', 'run', ...TESTS, '--reporter=dot'], { cwd: root, shell: true, encoding: 'utf8', timeout: 280000 });
    put(abs, original);
    const text = `${r.stdout}\n${r.stderr}`;
    const failed = /Tests\s+(?:(\d+) failed)/.exec(text);
    const suiteFail = /Test Files\s+(\d+) failed/.exec(text);
    const status = failed || suiteFail ? `CAUGHT (${failed ? failed[1] : '0'} tests failed${suiteFail ? `, ${suiteFail[1]} files failed` : ''})` : (/Tests\s+\d+ passed/.test(text) ? 'SURVIVED (all tests passed)' : 'UNKNOWN (no test summary)');
    results.push(`${id} | ${status} | ${meaning}`);
    fs.writeFileSync(out, results.join('\n') + '\n');
  }
} finally {
  restore();
  fs.writeFileSync(out, results.join('\n') + '\nDONE\n');
}
