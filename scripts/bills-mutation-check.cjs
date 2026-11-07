/**
 * Bills B1 mutation / fault-injection checks. For each entry the production source is deliberately broken, the Bills tests (and the shared
 * date-helper tests) are run, and the file is restored. A mutation that no test notices is a GAP in the tests and is reported as SURVIVED.
 * Usage: node scripts/bills-mutation-check.cjs [outputFile]
 * The original files are copied first and restored at the end and after every run, even if a run crashes.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'mutation-results.txt');
const S = 'src/modules/bills/schedule.ts', L = 'src/lib/semimonthly.ts', M = 'src/modules/bills/model.ts', U = 'src/modules/bills/undo.ts', D = 'src/modules/bills/data.ts', C = 'src/modules/bills/commitments.ts', Q = 'src/modules/bills/quickAddDef.ts', V = 'src/modules/bills/views.ts';

/** [id, file, text to find (must exist exactly as written), replacement, what the break means] */
const MUTATIONS = [
  ['R1 tracking start ignored', S, 'const floor = from > ob.trackingSince ? from : ob.trackingSince;', 'const floor = from;', 'a new bill would show a pile of past dates'],
  ['R2 pause end becomes inclusive', S, 'date >= p.from && (p.to === null || date < p.to)', 'date >= p.from && (p.to === null || date <= p.to)', 'the first day expected again would be skipped'],
  ['R3 end date ignored', S, "const ceil = ob.status === 'ended' && ob.endedOn && ob.endedOn < to ? ob.endedOn : to;", 'const ceil = to;', 'an ended bill would keep producing dates'],
  ['R4 paused with no open pause no longer fails closed', S, "if (ob.status === 'paused' && !openPause) continue;", '', 'a paused bill would produce dates'],
  ['R5 revision segments overlap', S, 'lo = addDays(h.until, 1); }', 'lo = h.until; }', 'two schedules would both claim the change day'],
  ['R6 twice-monthly slots not in rank order', S, 'const { a, b } = canonicalSemi(s.semi);\n  const out', 'const { a, b } = s.semi;\n  const out', 'a and b could swap with the order the days were entered'],
  ['R7 week slot uses the Sunday', S, '-((dayOfWeek(iso) + 6) % 7)', '-(dayOfWeek(iso) % 7)', 'weekly slots would not be Mondays'],
  ['R8 months before the anchor produced', L, 'date <= to && month >= anchorMonth', 'date <= to', 'dates before the first bill month would appear'],
  ['R9 schedule-change collision check off', S, 'const clash = mine.find((e) => claimed.has(e.slot));', 'const clash = undefined as { slot: string; nominal: string } | undefined;', 'a mid-month change could double a billing period'],
  ['R10 unsupported status no longer fails closed', S, "if (ob.status === 'unsupported' || from > to) return [];", 'if (from > to) return [];', 'an unknown status would produce dates'],
  ['R11 ended with no end date no longer fails closed', S, "if (ob.status === 'ended' && !ob.endedOn) return [];", '', 'an ended bill with no date would produce dates'],
  ['R12 weekend-crossing check off for one slot', L, "if (monthOf(d) !== month) {\n        return `${slotWords(slot)} would land outside its own month in some years (for example ${monthLabel(month)}, where it would fall on ${d}). That would put one bill", "if (false) {\n        return `${slotWords(slot)} would land outside its own month in some years (for example ${monthLabel(month)}, where it would fall on ${d}). That would put one bill", 'a date could leave its month and break the period identity'],
  ['R13 every-N-months steps one month', L, 'if (date >= from && date <= to && month >= anchorMonth) out.push({ month, date });\n    for (let k = 0; k < step; k++) month = nextMonth(month);', 'if (date >= from && date <= to && month >= anchorMonth) out.push({ month, date });\n    month = nextMonth(month);', 'quarterly and yearly bills would repeat monthly'],
  ['M1 unknown amount becomes zero', M, "if (d.amountKind === 'unknown') return { cents: null, basis: 'unknown' };", "if (d.amountKind === 'unknown') return { cents: 0, basis: 'unknown' };", 'unknown would be treated as $0.00'],
  ['M2 unreadable values not written back', M, 'for (const [k, v] of Object.entries(rawKept)) out[k] = v; // exactly as found', '', 'an ordinary edit would erase a value this build cannot read'],
  ['M3 an edit keeps the old raw value', M, 'rawKept: without(d.rawKept, Object.keys(patch))', 'rawKept: d.rawKept', 'a deliberate change would be overwritten by the old raw value'],
  ['M4 price in force picks the first step', M, 'if (p.from <= date) hit = p;', 'if (p.from <= date && !hit) hit = p;', 'a price increase would never apply'],
  ['M5 paid-through-loan not excluded', M, 'd.type === \'loan\' || d.loanId !== null || d.paidThroughLoan', "d.type === 'loan' || d.loanId !== null", 'loan escrow would be counted twice'],
  ['M6 unknown top-level fields dropped on write', M, 'const out: Record<string, unknown> = {\n    ...rest,', 'const out: Record<string, unknown> = {\n    title: rest.title, type: rest.type, need: rest.need, status: rest.status, amountKind: rest.amountKind, trackingSince: rest.trackingSince,', 'future fields would be lost on every edit'],
  ['U1 Undo guard never refuses', U, 'if (fingerprint(await d.moduleRecords.get(id)) !== u.sealed[id]) throw new UndoRefused();', '', 'Undo would overwrite another device\'s change'],
  ['U2 Undo of an add leaves the record', U, 'if (before === null) { await rows.remove(id); continue; }', 'if (before === null) { continue; }', 'Undo of an add would do nothing'],
  ['U3 Undo accepts an unsealed action', U, 'if (!u.sealed) throw new UndoRefused(UNDO_UNVERIFIED);', 'if (!u.sealed) return;', 'an unverifiable Undo would be trusted'],
  ['D1 lifecycle ignores a record changed since the preview', D, 'if (input.expect !== null && ob.updatedAt !== input.expect) throw', 'if (false) throw', 'a stale preview could be applied'],
  ['D2 delete ignores history', D, 'allowed: reasons.length === 0,', 'allowed: true,', 'a bill with history could be deleted'],
  ['D3 ending leaves a pause open', D, "const pauses = ob.pauses.map((p) => (p.to === null ? { ...p, to: addDays(date, 1) < p.from ? p.from : addDays(date, 1) } : p));", 'const pauses = ob.pauses;', 'a reopened bill would still be paused'],
  ['D4 reopen keeps no gap', D, 'const pauses = date > gapFrom ? [...ob.pauses, { from: gapFrom, to: date }] : ob.pauses;', 'const pauses = ob.pauses;', 'reopening would produce a pile of missed dates'],
  ['D5 resume does not close the pause', D, 'const pauses = ob.pauses.map((p, i) => (i === open ? { ...p, to: date < p.from ? p.from : date } : p));', 'const pauses = ob.pauses;', 'a resumed bill would stay paused'],
  ['D6 edit ignores a record changed since the form opened', D, 'if (expectUpdatedAt !== null && cur.updatedAt !== expectUpdatedAt) throw new Error(\'This record was changed (maybe on another device) since you opened it. Close this, look again and redo your change. Nothing was changed.\');\n    let data', 'let data', 'a stale edit would overwrite a newer change'],
  ['D7 contact lookup creates a duplicate', D, 'const { id, created } = await findOrCreateContact(d, { name, phone: input.phone, email: input.email, relationship: input.relationship });', 'const id = await d.contacts.add({ name } as never) as number; const created = true;', 'every bill would create a second Contact'],
  ['C1 12-month window counts 13', C, 'addDays(addMonths(today, 12), -1)', 'addMonths(today, 12)', 'a monthly bill would count 13 times'],
  ['C2 loans counted in totals', C, 'if (isLoanExcluded(d)) { out.loanExcluded++; continue; }', '', 'a mortgage would be counted in the figures'],
  ['C3 estimated amounts counted as known', C, "else if (a.basis === 'fixed') { line.knownCents += a.cents; knownPeriods++; }", 'else if (true) { line.knownCents += a.cents; knownPeriods++; }', 'estimates would be shown as known'],
  ['Q1 Quick Add takes over the Finance prefix', Q, "prefix: 'bs',", "prefix: 'b',", 'typing b would no longer add a Finance scheduled payment'],
  ['V1 loans appear in upcoming dates', V, 'if (isLoanExcluded(d)) continue; // loans are left out', 'if (false) continue; // loans are left out', 'a loan would appear as an upcoming bill'],
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
    const r = spawnSync('npx', ['vitest', 'run', 'src/modules/bills', 'src/lib/semimonthly.shared.test.ts', '--reporter=dot'], { cwd: root, shell: true, encoding: 'utf8', timeout: 280000 });
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
