/**
 * Bills B3.1 mutation checks. For each entry the production source is deliberately broken, the B3.1 tests are run, and the file is restored. A mutation
 * that no test notices is a GAP in the tests and is reported as SURVIVED.
 * Usage: node scripts/bills-b31-mutation-check.cjs [outputFile]      (ONLY=SG1 runs one entry, START=DS1 resumes from one)
 * The original files are read first and restored at the end and after every run, even if a run crashes.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'mutation-results-b31.txt');
const B = 'src/modules/bills/';
const SG = `${B}suggest.ts`, PM = `${B}payeeMatch.ts`, DS = `${B}discovery.ts`, SL = `${B}scheduledLink.ts`, CP = `${B}dueProvider.ts`, CD = `${B}cycleData.ts`;
const DD = `${B}discoveryData.ts`, SD = `${B}scheduledLinkData.ts`, RM = `${B}readModel.ts`, MC = 'src/modules/calendar/markerCoordination.ts';

/** [id, file, text to find (must exist exactly as written), replacement, what the break means] */
const MUTATIONS = [
  // ---- match suggestions ----
  ['SG1 a payment is suggested on amount and date alone', SG, 'if (!identity) continue;', '', 'a different provider with the same amount would be suggested'],
  ['SG2 a reliable amount that does not match no longer leaves a payment out', SG, "if (!rule && (amt.kind === 'differs')) continue;", '', 'a payment of the wrong amount would be suggested for a fixed bill'],
  ['SG3 a rejected, unchanged payment is suggested again', SG, "if (state === 'ok') continue; // rejected for this period and unchanged: it stays out", '', '"Not this payment" would not stick'],
  ['SG4 a rejection applies to every period of the bill', SG, "c.obligationId === ob.id && c.slot === p.slot && c.body.fact === 'suggestion-reject'", "c.obligationId === ob.id && c.body.fact === 'suggestion-reject'", 'rejecting November would hide the payee in December'],
  ['SG5 a payment already linked to this period is offered again', SG, 'if (here.some((l) => overlaps(l.ref, piece.ref))) continue;', '', 'the same payment could be linked twice'],
  ['SG6 a payment linked elsewhere is recommended like any other', SG, 'const suggestions = cand.filter((s) => !isElsewhere(s)).sort(order).slice(0, MAX_SUGGESTIONS);', 'const suggestions = cand.sort(order).slice(0, MAX_SUGGESTIONS);', 'a shared payment would be an ordinary recommendation'],
  ['SG7 a skipped Scheduled item counts as a posted payment', SG, "l.action !== 'posted' || ", '', 'a skipped item would become payment evidence'],
  ['SG8 a rule the bill does not link counts as evidence', SG, 'if (rule.id === undefined || !ob.data.scheduledRuleIds.includes(rule.id)) continue;', 'if (rule.id === undefined) continue;', 'an unrelated rule would vouch for a payment'],
  ['SG9 money coming back is suggested as a payment', SG, 'if (t.amountCents < 0 && !setupPart) {', 'if (!setupPart) {', 'a refund would be offered as a payment'],
  ['SG10 a transfer is suggested as a payment', SG, 'if (t.id === undefined || !isSpendingTxn(t)) return [];', 'if (t.id === undefined) return [];', 'a transfer or setup entry would be offered'],
  ['SG11 "strong" without a reliable amount', SG, "else if (payee.kind === 'exact' && Math.abs(days) <= 3 && reliable && (amt.kind === 'match' || amt.kind === 'range')) tier = 'strong';", "else if (payee.kind === 'exact' && Math.abs(days) <= 3) tier = 'strong';", 'a variable bill would get "looks like the payment" on payee and date alone'],
  ['SG12 the date window is ignored', SG, 'if (!inWindow && !rule) continue;', '', 'a payment months away would be suggested'],
  ['SG13 a changed suggestion passes the stale check', SG, "    case 'changed': return 'That payment changed in Finance (its amount, date or payee) since it was suggested. Nothing was changed. Look at the suggestions again.';", "    case 'changed': return null;", 'a payment edited while the owner was reading would be linked'],
  ['SG14 a refund after the payment is not noted', SG, 'if (refund) {', 'if (refund && false) {', 'a reversed payment would be suggested without a warning'],
  ['SG15 a weak payee resemblance needs no amount', SG, "if (!rule && payee.kind === 'partial' && amt.kind !== 'match') continue;", '', 'a vaguely similar payee would be suggested on a date alone'],
  ['SG16 a Scheduled date that passed counts as a posted payment', SG, 'const dates = occurrencesBetween(rule, addDays(due, -14), addDays(due, 14));', 'const dates = occurrencesBetween(rule, addDays(due, -14), addDays(due, 14)); for (const dt of dates) for (const t of input.transactions) if (t.date === dt && t.id !== undefined && !postedFrom.has(t.id)) postedFrom.set(t.id, { ruleId: rule.id, scheduledDate: dt });', 'a Scheduled date that passed would be read as a payment'],
  ['PM1 industry words count as a shared payee word', PM, "const GENERIC = new Set(['power',", "const GENERIC = new Set(['zzz-none',", 'two providers sharing "power" would look alike'],
  ['PM2 an approved payee word is not trusted', PM, "const words = n.via === 'hint' ? trusted : significant;", 'const words = significant;', 'a payee word the owner approved would stop working when it is an industry word'],
  // ---- discovery ----
  ['DS1 income is not excluded from discovery', DS, 't.id === undefined || t.transferTxnId || t.amountCents >= 0 || !t.payee.trim()', 't.id === undefined || t.transferTxnId || !t.payee.trim()', 'a regular paycheck would be suggested as a bill'],
  ['DS2 transfers are not excluded from discovery', DS, 't.id === undefined || t.transferTxnId || t.amountCents >= 0', 't.id === undefined || t.amountCents >= 0', 'a monthly transfer to savings would be suggested as a bill'],
  ['DS3 duplicated entries count as separate occurrences', DS, 'if ((ext && seen.has(ext)) || dayKey.has(dk)) {', 'if (false) {', 'a duplicated import would double the evidence'],
  ['DS4 two payments are given a cadence', DS, "const cand = build(norm, list, 'more-info', null, false);", "const cand = build(norm, list, 'more-info', kind, false);", 'two payments would be called monthly'],
  ['DS5 a bill the owner ended is suggested again', DS, "if (!existing && ended.some((o) => matches(o).kind === 'exact')) {", 'if (false) {', 'old payments would make an ended bill look newly active'],
  ['DS6 a loan payment is suggested as a bill', DS, "if (LOAN_LIKE.test(payee) || guessType(payee) === 'loan') {", 'if (false) {', 'a mortgage would be offered as a bill'],
  ['DS7 "dismiss for now" never expires', DS, "(d.decision === 'dismissed' && addDays(d.on, SNOOZE_DAYS) <= today)", 'false', 'a postponed suggestion would be hidden for ever'],
  ['DS8 a materially changed pattern never resurfaces', DS, 'const resurfaced = materialChange(d.snap, cand) ||', 'const resurfaced = false ||', '"not recurring" would hide a changed pattern for ever'],
  ['DS9 every pattern is "strong"', DS, "const tier: CandidateTier = allIn && ((!g.varies && n >= 4) || (g.varies && n >= 6)) ? 'strong' : 'possible';", "const tier: CandidateTier = 'strong';", 'three payments would read as a strong pattern'],
  ['DS10 a payee an existing bill covers is still a new suggestion', DS, "if (cand.existing) { cand.state = 'tracked'; continue; }", 'if (cand.existing) { continue; }', 'bills you already track would be suggested again'],
  ['DS11 a "tracked" choice still hides after its bill ended', DS, 'const ob = d.obligationId !== null ? inForce.find((o) => o.id === d.obligationId) ?? null : null;', 'const ob = d.obligationId !== null ? live.find((o) => o.id === d.obligationId) ?? null : null;', 'a choice about a bill that ended would hide the suggestion for ever'],
  ['DS12 the OLDEST decision wins', DS, 'b.on.localeCompare(a.on) || b.id - a.id', 'a.on.localeCompare(b.on) || a.id - b.id', 'a later change of mind would be ignored'],
  ['DS13 the detector is bypassed: irregular amounts accepted', DS, "if (!list || !DETECTED.includes(g.frequency)) continue;", "if (!list) continue;", 'an unsupported frequency would be listed'],
  // ---- Finance Scheduled link ----
  ['SL1 an income rule can be linked', SL, "if (kind === 'income') return none(", 'if (false) return none(', 'scheduled income would be linked to a bill'],
  ['SL2 a transfer rule can be linked', SL, "if (kind === 'transfer') return none(", 'if (false) return none(', 'a scheduled transfer would be linked to a bill'],
  ['SL3 a rule another bill holds can be linked', SL, 'if (holders.length > 0) return none(', 'if (false) return none(', 'one rule could feed two bills'],
  ['SL4 a missing rule can be linked', SL, "if (!rule) return none('That Finance scheduled payment is not on this device", "if (false) return none('That Finance scheduled payment is not on this device", 'a pointer to nothing would be created'],
  ['SL5 two bills holding one rule are not reported', SL, 'if (holders.length < 2) continue;', 'continue;', 'a conflict from two offline devices would go unnoticed'],
  ['SL6 an ended bill counts as holding a rule', SL, "if (o.data.status === 'ended') continue;\n    for (const id of o.data.scheduledRuleIds)", 'for (const id of o.data.scheduledRuleIds)', 'a replaced bill would block its successor and raise a false conflict'],
  ['SL7 a price that starts later raises an alarm', SL, "kind: 'amount-later-price', level: 'info'", "kind: 'amount-later-price', level: 'check'", 'an introductory price would look like a problem'],
  ['SL8 an amount disagreement is never reported', SL, "else notes.push({ kind: 'amount', level: 'check',", "else void ({ kind: 'amount', level: 'check',", 'a $120 bill with a $115 schedule would be silent'],
  ['SL9 a deleted rule is not reported', SL, "if (!rule) return [{ kind: 'missing', level: 'check' }];", 'if (!rule) return [];', 'a vanished instruction would be silent'],
  ['SL10 a few days between the dates is an alarm', SL, "level: apart <= 5 ? 'info' : 'check'", "level: 'check'", 'normal differences would alarm the owner'],
  ['SL11 a biweekly rule becomes a weekly bill', SL, "case 'biweekly': s = { kind: 'weeks', every: 2,", "case 'biweekly': s = { kind: 'weeks', every: 1,", 'a recurrence would be silently substituted'],
  ['SL12 an ended bill with an active rule is not reported', SL, "if (live) notes.push({ kind: 'bill-ended', level: 'check' });", '', 'a Scheduled payment that should have stopped would be unnoticed'],
  // ---- Calendar coordination ----
  ['CP1 a marker is covered although the dates differ', CP, 'if (!occurrencesBetween(r, date, date).includes(date)) continue;', '', 'a payment-action date would hide a due date'],
  ['CP2 a marker is covered after the Finance item was approved', CP, 'if (sched.log.some((l) => l.ruleId === id && l.date === date)) continue;', '', 'an approved posting would hide the bill\'s own marker'],
  ['CP3 a marker is covered despite an unresolved disagreement', CP, 'if (driftUnresolved(scheduleDrift(ob.data, r, sched.log, today))) continue;', '', 'a disagreement between bill and rule would be hidden'],
  ['CP4 an inactive or income rule covers a marker', CP, "if (!r || ruleKind(r) !== 'spending' || !ruleLive(r, today)) continue;", 'if (!r) continue;', 'a switched-off rule would hide the bill'],
  ['MC1 a covered marker is hidden even when the Finance marker is not shown', MC, 'return items.filter((i) => !(i.source?.coveredBy && covering.has(i.source.coveredBy)));', 'return items.filter((i) => !i.source?.coveredBy);', 'turning the Finance layer off would make the payment disappear'],
  ['MC2 a covered item covers another', MC, "if (i.source && i.source.status === 'open' && !i.source.coveredBy) covering.add(i.source.id);", "if (i.source && i.source.status === 'open') covering.add(i.source.id);", 'a chain could hide everything'],
  ['MC3 a finished item counts as covering', MC, "i.source && i.source.status === 'open' && !i.source.coveredBy", 'i.source && !i.source.coveredBy', 'a handled marker would hide an open one'],
  // ---- writes ----
  ['CD6 rejecting the same piece twice writes twice', CD, "const same = mine.find((c) => c.slot === input.slot && isEffective(c) && c.body.fact === 'suggestion-reject' && pieceKey(c.body.ref) === pieceKey(input.ref));", 'const same = undefined as (typeof mine)[number] | undefined;', 'a double press would store two rejections'],
  ['CD7 a repeated operation id writes again', CD, 'const again = mine.find((c) => c.op !== null && c.op === input.op);\n    if (again) return { id: again.id, reused: true, undo: { rows: [], sealed: {} } };\n    const same', 'const same', 'a double submit would store two records'],
  ['CD8 reconsidering ignores a stale record', CD, "if (!c || c.body === null || c.body.fact !== 'suggestion-reject') throw new Error('That rejection can no longer be changed here. Nothing was changed.');\n    if (c.updatedAt !== expectUpdatedAt) throw new Error(STALE);", "if (!c || c.body === null || c.body.fact !== 'suggestion-reject') throw new Error('That rejection can no longer be changed here. Nothing was changed.');", 'a change made on another device would be overwritten'],
  ['CD10 a rejection can be edited', CD, "if (c.body.fact === 'suggestion-reject') throw new Error('A rejection cannot be edited.", "if (false) throw new Error('A rejection cannot be edited.", 'a rejection could be silently re-pointed'],
  ['DD1 a repeated choice records twice', DD, 'if (again) return { id: again.id as number, reused: true, undo: { rows: [], sealed: {} } };', '', 'a double press would store two choices'],
  ['DD2 creating from a seed skips the rule check', DD, 'if (check.problem) throw new Error(check.problem);', '', 'a bill could be created pointing at income, a transfer or a rule another bill holds'],
  ['DD3 a bill made from a suggestion is not recorded as tracked', DD, "if (input.from) await writeDecisionIn({ key: input.from.key, decision: 'tracked'", "if (false as boolean) await writeDecisionIn({ key: input.from.key, decision: 'tracked'", 'the suggestion would come back after it was made a bill'],
  ['DD4 a repeated press makes a second bill', DD, "      reused = true;\n      return { id: ob, contactCreated: false, contactId: null, taskIds: [], undo: { rows: [], sealed: {} } };", '      return null;', 'a double submit would create two bills'],
  ['DD5 "link to an existing bill" edits the bill without consent', DD, 'if (hint && !ob.data.payeeHints.includes(hint)) {', 'if (!ob.data.payeeHints.includes(hint)) {', 'declining the checkbox would still edit the bill'],
  ['DD6 a damaged review choice is trusted', DD, '!KINDS.includes(d.decision as DecisionKind) || ', '', 'an unknown choice would hide a suggestion'],
  ['SD1 linking skips the rule check', SD, 'if (check.problem) throw new Error(check.problem);', '', 'income, transfers and held rules could be linked'],
  ['SD2 linking ignores a stale form', SD, 'if (input.expect !== null && ob.updatedAt !== input.expect) throw new Error(STALE);', '', 'a change on another device would be overwritten'],
  ['SD3 an ended bill can be linked', SD, "ob.data.status === 'ended' ? 'An ended bill cannot be linked", "false ? 'An ended bill cannot be linked", 'a finished bill would take a Scheduled link'],
  ['SD4 "keep it here" also unlinks the keeper', SD, 'const others = holders.filter((h) => h.id !== input.keepId);', 'const others = holders;', 'the bill the owner chose would lose the link too'],
  ['SD5 unlinking a rule that is not linked is accepted', SD, "if (!ob.data.scheduledRuleIds.includes(input.ruleId)) throw new Error('That scheduled payment is not linked to this bill", "if (false) throw new Error('That scheduled payment is not linked to this bill", 'a repeated press would be a silent no-op write'],
  ['RM4 a shared rule is never counted', RM, 'for (const c of ruleLinkConflicts(x.snap.obligations)) {', 'for (const c of [] as ReturnType<typeof ruleLinkConflicts>) {', 'Today and Needs review would never mention it'],
];

const TESTS = ['src/modules/bills/b31-', 'src/modules/bills/b31x-', 'src/modules/bills/guards.test.ts', 'src/modules/bills/b3-spend.test.ts'];
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
    put(abs, original.replace(normalized, repl));
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
