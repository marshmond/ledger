/**
 * Bills B2 mutation / fault-injection checks. For each entry the production source is deliberately broken, the Bills tests are run, and the file
 * is restored. A mutation that no test notices is a GAP in the tests and is reported as SURVIVED.
 * Usage: node scripts/bills-b2-mutation-check.cjs [outputFile]      (ONLY=T1 runs one entry)
 * The original files are copied first and restored at the end and after every run, even if a run crashes.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'mutation-results-b2.txt');
const B = 'src/modules/bills/';
const TI = `${B}timing.ts`, AM = `${B}amounts.ts`, LA = `${B}labels.ts`, PE = `${B}periods.ts`, CO = `${B}cycleConflicts.ts`, CD = `${B}cycleData.ts`, CR = `${B}cycleRepair.ts`, TA = `${B}tasks.ts`, RM = `${B}readModel.ts`, DP = `${B}dueProvider.ts`, DA = `${B}data.ts`, SC = `${B}schedule.ts`, UN = `${B}undo.ts`, CM = `${B}cycleModel.ts`;

/** [id, file, text to find (must exist exactly as written), replacement, what the break means] */
const MUTATIONS = [
  ['T1 "upcoming" starts one day too early', TI, "if (days >= SOON_DAYS + 1) return 'upcoming';", "if (days >= SOON_DAYS) return 'upcoming';", 'a bill due in exactly 7 days would not be "due soon"'],
  ['T2 "due today" hidden by "due soon"', TI, "if (days >= 1) return 'soon';", "if (days >= 0) return 'soon';", 'a bill due today would read as due soon'],
  ['T3 an unclear date is no longer checked first', TI, "if (unclear || days === null) return 'unclear';", "if (days === null) return 'unclear';", 'two different due dates would be hidden by one of them'],
  ['T4 days until a date is inverted', TI, 'daysBetween(date, today)', 'daysBetween(today, date)', 'every bill would read as past due or upcoming the wrong way round'],
  ['T5 conflicting due dates: the first wins', TI, "if (distinct.length > 1) return { date: nominal, source: 'conflict' };", "if (distinct.length > 1) return { date: distinct[0], source: 'due' };", 'Ledger would silently choose one of two dates'],
  ['A1 an unknown amount becomes zero', AM, "else { basis = 'unknown'; basisCents = null; }", "else { basis = 'unknown'; basisCents = 0; }", 'unknown would be treated as $0.00'],
  ['A2 two different invoices: the first wins', AM, "if (invoiceAmounts.length > 1) { basis = 'disagree'; basisCents = null; }", "if (invoiceAmounts.length > 1) { basis = 'billed'; basisCents = invoiceAmounts[0]; }", 'Ledger would silently choose one of two amounts'],
  ['A3 a credit counted as a payment', AM, 'const paidConflict = typed.length > 1;\n  const paid = typed.length === 1 ? typed[0] : 0;', 'const paidConflict = typed.length > 1;\n  const paid = (typed.length === 1 ? typed[0] : 0) + creditCents;', 'a credit would look like money paid'],
  ['A4 two different typed payments: the last wins', AM, 'const paidConflict = typed.length > 1;\n  const paid = typed.length === 1 ? typed[0] : 0;', 'const paidConflict = typed.length > 1;\n  const paid = typed.length >= 1 ? typed[typed.length - 1] : 0;', 'conflicting payments would count one of them'],
  ['A5 identical credits counted twice', AM, "distinct(bodies(facts, 'credit'), (c) => `${c.cents}|${c.note.trim().toLowerCase()}`)", "bodies(facts, 'credit')", 'a credit recorded twice would lower the amount owed twice'],
  ['A6 a $0.00 invoice treated as unknown', AM, "else if (invoiceAmounts.length === 1) { basis = 'billed'; basisCents = invoiceAmounts[0]; }", "else if (invoiceAmounts.length === 1 && invoiceAmounts[0] > 0) { basis = 'billed'; basisCents = invoiceAmounts[0]; }", 'a confirmed zero bill would be confused with unknown'],
  ['A7 an unknown remaining becomes zero', AM, 'remaining: owed === null ? null : Math.max(0, owed - paid),', 'remaining: owed === null ? 0 : Math.max(0, owed - paid),', 'unknown would be shown as nothing left to pay'],
  ['L1 "Overdue" without a recorded bill', LA, "return i.invoiceRecorded ? 'overdue' : 'not-confirmed'; // P13, P14", "return 'overdue'; // P13, P14", 'an unmatched bill would be called overdue'],
  ['L2 automatic payments can be overdue', LA, "if (i.how === 'auto') return i.timing", "if (false) return i.timing", 'an autopay would be called overdue and not "scheduled"'],
  ['L3 autopay grace edge moves a day', LA, 'i.days < -grace', 'i.days <= -grace', 'the grace period would end a day early'],
  ['L4 a skip hides a payment', LA, "if (i.skip && !evidence) return 'skipped'; // P1", "if (i.skip) return 'skipped'; // P1", 'a payment record would disappear behind a skip'],
  ['L5 "Paid" while an amount remains', LA, "return (i.remaining ?? 0) === 0 ? 'paid' : 'partly-paid'; // P3, P4", "return 'paid'; // P3, P4", 'a partly paid bill would read as paid'],
  ['L6 a confirmed zero bill falls through to a timing label', LA, "  if (i.owed === 0 && i.paid <= 0) return i.owedFromBill ? 'no-payment-due' : 'no-payment-expected'; // P2\n", '', 'a $0.00 bill would show as due or overdue'],
  ['L7 a declaration is ignored', LA, "  if (i.declared && !i.suspended) return 'marked-paid'; // P6\n", '', 'a paid-in-full declaration would not count'],
  ['P1 set-aside records still count', PE, 'const effective = recs.filter(isEffective) as Eff[];', 'const effective = recs.filter(isReadable) as Eff[];', 'a record set aside by a repair would still change the figures'],
  ['P2 a recorded due date is ignored for timing', PE, 'const timing = deriveTiming(dueDates, nominal, today);', 'const timing = deriveTiming([], nominal, today);', 'a corrected due date would not change timing'],
  ['K1 skip beside a payment not reported', CO, 'if (skips.length && pays.length) add(', 'if (false) add(', 'a skip that disagrees with a payment would go unnoticed'],
  ['K2 two different invoices not reported', CO, 'if (inv.length > 1) {', 'if (inv.length > 99) {', 'conflicting invoice amounts would go unnoticed'],
  ['K3 different due dates not reported', CO, 'if (new Set(dated.map((f) => dueDateOf(f.body))).size > 1) {', 'if (false) {', 'conflicting due dates would go unnoticed'],
  ['K4 "leave as is" survives a changed record', CO, '${r.id}.${r.updatedAt}', '${r.id}', 'a changed record would stay silenced'],
  ['K5 a missing bill is not reported', CO, "for (const [oid, recs] of orphans) add({ kind: 'missing-obligation'", "for (const [oid, recs] of []) add({ kind: 'missing-obligation'", 'records of a missing bill would be invisible'],
  ['K6 look-alike extra bills not reported', CO, "if (slots.size > 1 && g.some((f) => f.slot.startsWith('x')) && !numbered) add(", 'if (false) add(', 'an extra bill entered twice would go unnoticed'],
  ['Y1 a Task the owner moved counts as untouched', TA, "x.status === 'todo' && m.doOn !== null && x.dueDate === m.doOn && x.title === title", "x.status === 'todo' && m.doOn !== null && x.title === title", "an owner's moved Task would be removed when the bill ends"],
  ['Y2 a period holding records loses its reminder', TA, 'periods.filter((p) => p.open && (p.expected || p.records.length > 0)).map', 'periods.filter((p) => p.open && p.expected).map', 'a partly paid bill that is paused would lose the reminder for its balance'],
  ['Y3 every reminder of an inactive bill is retired', TA, 'if (keep) { plan.reused.push(t.id); continue; }', 'if (false) { plan.reused.push(t.id); continue; }', 'a still-expected final bill would lose its reminder'],
  ['Y4 the deadline choice is ignored', TA, 'deadlineTasks: !ob.noDeadlineTasks', 'deadlineTasks: true', 'deadline Tasks would return after the owner switched them off'],
  ['Y5 a deleted Task still blocks deleting the bill', DA, 'if (t && isLive(t)) taskLinks++; else deadTaskLinks++;', 'taskLinks++;', 'a ghost link would stop a bill with no history being deleted'],
  ['D1 a double press writes twice', CD, 'const again = mine.find((c) => c.op !== null && c.op === input.op);', 'const again = undefined as (typeof mine)[number] | undefined;', 'pressing twice would save two records'],
  ['D2 a second single-record fact is allowed', CD, 'if (SINGULAR.includes(input.body.fact) && mine.some((c) => c.slot === input.slot && isEffective(c) && c.body.fact === input.body.fact)) {', 'if (false) {', 'a period could get two invoices from one device'],
  ['D3 a stale edit is accepted', CD, 'if (c.updatedAt !== expectUpdatedAt) throw new Error(STALE);\n    if (body.fact !== c.body.fact)', 'if (body.fact !== c.body.fact)', 'a stale edit would overwrite a newer change'],
  ['D4 a period no schedule makes is accepted', CD, "if (!slot.startsWith('x') && scheduleProduces(scheduleSource(ob.data), slot) === null) return", "if (false) return", 'a fact could be recorded for a period that does not exist'],
  ['D5 a payment is accepted for a loan', CD, 'if (isLoanExcluded(ob.data) && PAYMENT.includes(body.fact)) return', 'if (false) return', 'a loan payment would be recorded outside Loans'],
  ['D6 finishing the wrong Task is accepted', CD, 'if (!open.some((t) => t.id === input.finishTaskId)) throw new Error(', 'if (false) throw new Error(', 'a different Task than the one previewed could be finished'],
  ['R1 "use the payment" sets the payment aside', CR, "if (c.kind === 'skip-payment') set = facts.filter((f) => f.body!.fact === 'skip');", "if (c.kind === 'skip-payment') set = facts.filter((f) => f.body!.fact !== 'skip');", 'a repair would hide the payment instead of the skip'],
  ['R2 a stale repair picks another conflict', CR, 'const c = findConflicts(obs, cycles).find((x) => x.key === input.key);\n    if (!c) throw new Error(STALE_REPAIR);', 'const c = findConflicts(obs, cycles).find((x) => x.key === input.key) ?? findConflicts(obs, cycles)[0];\n    if (!c) throw new Error(STALE_REPAIR);', 'a repair previewed earlier could be applied to different records'],
  ['R3 a move onto an occupied period is allowed', CR, 'if (at.target.some((r) => r.movedFrom !== from)) return', 'if (false) return', 'two periods could be merged silently'],
  ['R4 a stale move is accepted', CR, "if (JSON.stringify(snap([...source, ...target])) !== JSON.stringify([...input.expect].sort((a, b) => a.id - b.id))) throw new Error(STALE_REPAIR);", '', 'a move could ignore records added after the preview'],
  ['R5 a move forgets where records came from', CR, 'supersededBy: f.supersededBy, movedFrom: input.from }, f.body!) });\n    }\n    await ensureBillTasksIn(input.obligationId', 'supersededBy: f.supersededBy, movedFrom: f.movedFrom }, f.body!) });\n    }\n    await ensureBillTasksIn(input.obligationId', 'the audit trail of a move would be lost'],
  ['R6 a period with an unreadable record can be moved', CR, "if (at.source.some((r) => r.body === null)) return", 'if (false) return', 'a record this version cannot read could be moved unsafely'],
  ['X1 a second reminder Task is made', TA, 'if (here.length > 0) {', 'if (false) {', 'every press would add another reminder Task'],
  ['X2 autopay gets a Task by default', TA, 'payTask: ob.reminders?.payTask === true', 'payTask: ob.reminders?.payTask !== false', 'every automatic bill would flood Tasks'],
  ['X3 a Task the owner moved follows the due date', TA, 'if (m.due !== due && m.doOn !== null && here[0].data.dueDate === m.doOn) plan.reschedule', 'if (m.due !== due && m.doOn !== null) plan.reschedule', 'the owner\'s own change to a Task would be overwritten'],
  ['X4 an old unrecorded month gets a Task', TA, 'p.timing.date !== null && p.timing.date >= addDays(today, -PAY_LOOKBACK_DAYS)', 'p.timing.date !== null', 'a pile of old months would become reminders'],
  ['X5 an inactive bill makes Tasks', TA, "  if (d.status !== 'active') {\n    // never creates anything", "  if (false) {\n    // never creates anything", 'a paused or ended bill would keep making reminders'],
  ['X6 a passed deadline makes a Task', TA, 'if (!isActionDeadline(dl.kind) || dl.date < today) continue;', 'if (!isActionDeadline(dl.kind)) continue;', 'a deadline that already passed would become a Task'],
  ['V1 the attention window never ends', RM, 'export const ATTENTION_LOOKBACK_DAYS = 45;', 'export const ATTENTION_LOOKBACK_DAYS = 4500;', 'every old unrecorded month would pile up in the counts'],
  ['V2 past-due bills counted as cash needed', RM, '      if (days < 0) continue;\n      for (const w of wins)', '      for (const w of wins)', 'old bills would be added to the expected cash figures'],
  ['V3 an unknown amount counted as known', RM, 'if (p.amounts.remaining === null) { w.unknown.count++; continue; }', 'if (p.amounts.remaining === null) { w.known.count++; continue; }', 'unknown amounts would be counted as known bills'],
  ['V4 a finished Task is always "not confirmed"', RM, 'if (!settledByRecord(p)) items.push({ id: `fin-${k.id}`', 'if (true) items.push({ id: `fin-${k.id}`', 'a Task finished after the payment was recorded would still nag'],
  ['V5 acknowledged conflicts still counted', RM, '    if (c.acknowledged) continue;\n', '', '"leave as is" would not quiet the counts'],
  ['H1 the Calendar horizon is a month too long', DP, 'export const horizonEnd = (today: string) => addMonths(today, HORIZON_MONTHS);', 'export const horizonEnd = (today: string) => addMonths(today, HORIZON_MONTHS + 1);', 'the Calendar would show 13 months'],
  ['H2 a Task on a different day hides the due date', DP, "m.cycle === p.slot && t.data.dueDate === date; });\n        if (task) continue;", "m.cycle === p.slot; });\n        if (task) continue;", 'the due date would vanish from the Calendar whenever a reminder Task exists'],
  ['H3 automatic payments shown as overdue', DP, "if (late && ob.data.payment.how === 'auto') continue; // automatic payments are never shown as overdue here", '', 'an autopay past its date would appear as overdue'],
  ['H4 an amount in a Calendar title', DP, 'title: `Due: ${title}`', 'title: `Due: ${title} ${p.amounts.basisCents ?? \'\'}`', 'an amount would leak into Calendar text'],
  ['S1 recorded periods are not "applied" in a schedule change', SC, 'if (applied.length === 0 && recorded.length === 0) return', 'if (applied.length === 0) return', 'a schedule edit could re-attach facts to a different bill'],
  ['U1 Undo leaves the Task link behind', UN, 'for (const id of u.linksAdded ?? []) await links.remove(id);', '', 'taking back "Done, mark paid" would leave a dangling link'],
  ['M1 a damaged invoice amount is read as zero', CM, "if (!isCents(d.invoicedCents)) return bad('The billed amount');", "if (!isCents(d.invoicedCents)) return ok({ fact: 'invoice', invoicedCents: 0, invoiceDate: null, dueDate: null, invoiceNumber: '', nominal: null });", 'a damaged record would contribute a zero bill'],
  ['M2 an unknown fact type is dropped to a blank skip', CM, "    default:\n      return fail(", "    default:\n      if (typeof d.fact === 'string') return ok({ fact: 'skip', reason: '' });\n      return fail(", 'a record from a newer version would turn into a skip and suppress a bill'],
];

const results = [];
const backups = new Map();
const files = [...new Set(MUTATIONS.map((m) => m[1]))];
for (const f of files) backups.set(f, fs.readFileSync(path.join(root, f), 'utf8'));
const restore = () => { for (const [f, text] of backups) fs.writeFileSync(path.join(root, f), text); };
process.on('SIGINT', () => { restore(); process.exit(1); });

try {
  for (const [id, file, find, replace, meaning] of MUTATIONS) {
    if (process.env.ONLY && !id.startsWith(process.env.ONLY + ' ')) continue;
    const abs = path.join(root, file);
    const original = backups.get(file);
    const normalized = original.includes('\r\n') ? find.replace(/\n/g, '\r\n') : find;
    const repl = original.includes('\r\n') ? replace.replace(/\n/g, '\r\n') : replace;
    if (!original.includes(normalized)) { results.push(`${id} | NOT APPLIED (text not found) | ${meaning}`); continue; }
    fs.writeFileSync(abs, original.replace(normalized, repl));
    const r = spawnSync('npx', ['vitest', 'run', 'src/modules/bills/b2-', 'src/modules/bills/guards.test.ts', 'src/modules/bills/hooks.test.ts', '--reporter=dot'], { cwd: root, shell: true, encoding: 'utf8', timeout: 280000 });
    fs.writeFileSync(abs, original);
    const text = `${r.stdout}\n${r.stderr}`;
    const failed = /Tests\s+(?:(\d+) failed)/.exec(text);
    const suiteFail = /Test Files\s+(\d+) failed/.exec(text);
    const status = failed || suiteFail ? `CAUGHT (${failed ? failed[1] : '0'} tests failed${suiteFail ? `, ${suiteFail[1]} files failed` : ''})` : (/Tests\s+\d+ passed/.test(text) ? 'SURVIVED (all tests passed)' : 'UNCLEAR');
    results.push(`${id} | ${status} | ${meaning}`);
    fs.writeFileSync(out, results.join('\n') + '\n');
  }
} finally {
  restore();
  fs.writeFileSync(out, results.join('\n') + '\nDONE\n');
}
