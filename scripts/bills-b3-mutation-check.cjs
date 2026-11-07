/**
 * Bills B3 (and B3.0A / B3.0B) mutation checks. For each entry the production source is deliberately broken, the B3 tests are run, and the file is
 * restored. A mutation that no test notices is a GAP in the tests and is reported as SURVIVED.
 * Usage: node scripts/bills-b3-mutation-check.cjs [outputFile]      (ONLY=PY1 runs one entry)
 * The original files are read first and restored at the end and after every run, even if a run crashes.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'mutation-results-b3.txt');
const B = 'src/modules/bills/';
const PA = `${B}payments.ts`, AM = `${B}amounts.ts`, LA = `${B}labels.ts`, PE = `${B}periods.ts`, PL = `${B}paymentLinks.ts`, CD = `${B}cycleData.ts`, CF = `${B}cycleConflicts.ts`, RM = `${B}readModel.ts`, DP = `${B}dueProvider.ts`, TA = `${B}tasks.ts`, BS = `${B}billsSpend.ts`;
const VB = 'src/modules/calendar/layerVisibility.ts', LD = 'src/modules/ledger/dueProvider.ts';
const SO = 'src/modules/services/servicesOverview.ts', UW = 'src/modules/services/upcomingWindow.ts', OP = 'src/modules/services/OverviewParts.tsx';

/** [id, file, text to find (must exist exactly as written), replacement, what the break means] */
const MUTATIONS = [
  ['PY1 a repeated link is not flagged as a duplicate', PA, "else if (seen.has(key)) role = 'duplicate';", "else if (false) role = 'duplicate';", 'the same payment linked twice would look like two payments'],
  ['PY2 the net adds every link (no spend() rules)', PA, 'const netCents = s.totalCents;', 'const netCents = pieces.reduce((n, p) => n + (p.resolved.needsReview ? 0 : p.resolved.spendCents), 0);', 'a duplicate or a covered part would be counted twice'],
  ['PY3 a reversal is never detected', PA, 'reversed: live.length > 0 && netCents <= 0 && backCents > 0,', 'reversed: false,', 'a refunded payment would not be reported'],
  ['PY4 paid can go negative', PA, 'paidCents: Math.max(0, netCents)', 'paidCents: netCents', 'a refund larger than the payments would show negative paid and remaining above the bill'],
  ['PY5 Finance status is dropped', PA, 'status: t ? t.status : null', 'status: null', 'pending, cleared and reconciled would never be shown'],
  ['AM1 a typed amount is added to the Finance amount', AM, 'const paid = finance ? finance.paidCents : typed.length === 1 ? typed[0] : 0;', 'const paid = (finance ? finance.paidCents : 0) + (typed.length === 1 ? typed[0] : 0);', 'typed and Finance payments would be added together'],
  ['AM2 the typed amount left out is not reported', AM, 'typedLeftOut: finance ? typed : [],', 'typedLeftOut: [],', 'a typed payment would silently disappear from view'],
  ['AM3 a link is not payment evidence', AM, "x.body.fact === 'paid-in-full' || x.body.fact === 'payment-link');", "x.body.fact === 'paid-in-full');", 'a skip beside a Finance payment would hide the payment'],
  ['AM4 a stale link lets a typed amount stand in', AM, 'const finance = fin.linked ? fin : null;', 'const finance = fin.linked && fin.paidCents > 0 ? fin : null;', 'a typed amount would silently replace a link that no longer counts'],
  ['LB1 the "declared paid in full, Finance shows less" case is lost', LA, "if (i.fromFinance && i.declaredFull && !i.suspended && i.paid > 0 && i.owed !== null && (i.remaining ?? 0) > 0) return 'marked-paid-short';", '', 'the difference between a declaration and Finance would not be stated'],
  ['LB2 a suspended declaration is trusted', LA, "if (i.declared && i.suspended) return 'needs-review'; // P7 (B3)", '', 'a declaration would override live Finance evidence'],
  ['PE1 a declaration is never suspended', PE, 'const suspended = decl && !!fin && fin.paidCents <= 0 && (fin.counts.review > 0 || fin.reversed);', 'const suspended = false;', 'a deleted or reversed payment would not suspend a paid-in-full declaration'],
  ['PE2 the Finance lookup is dropped', PE, 'const amounts = deriveAmounts(effective, exp, lookup);', 'const amounts = deriveAmounts(effective, exp);', 'every linked payment would read as missing'],
  ['PL1 the same piece can be linked twice', PL, 'if (c.existing.some((x) => pieceKey(x.ref) === key)) return SAME_PIECE;', '', 'a repeat would be accepted silently'],
  ['PL2 a whole transaction beside its part is accepted', PL, 'const overlap = validateTxnRefs([...c.existing.map((x) => x.ref), c.ref]);', 'const overlap = null as string | null;', 'the same money could be linked twice in one period'],
  ['PL3 the typed-to-Finance switch needs no confirmation', PL, 'if (c.typed.length > 0 && !c.switchTyped) return SWITCH_NEEDED;', '', 'a typed payment would be set aside without asking'],
  ['PL4 a missing transaction can be linked', PL, 'const missing = checkNewRefs([c.ref], [], c.lookup);', 'const missing = null as string | null;', 'a deleted transaction or a transfer could be linked'],
  ['CD1 the typed payment is not set aside on the switch', CD, 'for (const t of typedToSetAside) {', 'for (const t of [] as typeof typedToSetAside) {', 'typed and Finance would both be live after a switch'],
  ['CD2 a typed amount can be added while linked', CD, 'input.body.cents !== null && effectiveLinks(inPeriod).length > 0) {', 'input.body.cents !== null && false) {', 'the one-source rule could be broken by typing'],
  ['CD3 replacing a link keeps the old one', CD, 'if (replaced) { await rec.capture(replaced.id, d); await rows(d).remove(replaced.id); }', 'if (replaced) { await rec.capture(replaced.id, d); }', 'a replaced payment would be counted too'],
  ['CD4 a payment link can be edited', CD, "if (c.body.fact === 'payment-link') throw new Error('A linked payment cannot be edited.", "if (false) throw new Error('A linked payment cannot be edited.", 'a link could be silently re-pointed'],
  ['CD5 the new reference is not read before the write', CD, '  }, extra);\n}\n\n/** Edits one existing fact', '  }, []);\n}\n\n/** Edits one existing fact', 'a good link would be refused as missing'],
  ['CF1 typed beside Finance is not reported', CF, 'if (links.length && typedPaid.length) add(', 'if (false) add(', 'conflicting evidence from two devices would go unnoticed'],
  ['CF2 a duplicated piece is not reported', CF, "for (const g of byPiece.values()) if (g.length > 1) add({ kind: 'payment-duplicate'", "for (const g of byPiece.values()) if (g.length > 99) add({ kind: 'payment-duplicate'", 'a payment linked twice would go unnoticed'],
  ['CF3 one piece on two periods is not reported', CF, 'if (periods.size < 2) continue;', 'continue;', 'a possible duplicate attribution would go unnoticed'],
  ['RM1 old periods are not scanned for payment problems', RM, 'recorded.set(ob.id, all.filter((p) => p.records.length > 0));', 'recorded.set(ob.id, all.filter((p) => p.records.length > 0 && p.timing.date !== null && p.timing.date >= win.from && p.timing.date <= win.to));', 'a stale link on an old period would be forgotten'],
  ['RM2 a changed payment is not reported', RM, 'if (f.counts.changed > 0) items.push(', 'if (false) items.push(', 'a payment edited in Finance would go unnoticed'],
  ['RM3 an upcoming partial payment is counted as needing action', RM, "if (loan || p.label !== 'partly-paid' || p.timing.class === 'upcoming') continue;", "if (loan || p.label !== 'partly-paid') continue;", 'Today would nag about a bill that is not due yet'],
  ['DP1 the Calendar layer ignores Finance payments', DP, 'periodsOf(ob, snap.cycles, q.today, { from: lo, to: hi }, { lookup })', 'periodsOf(ob, snap.cycles, q.today, { from: lo, to: hi }, {})', 'a bill paid by a linked payment would still show a Due marker'],
  ['TA1 the reminder planner ignores Finance payments', TA, "{ allRecorded: true, lookup });", '{ allRecorded: true });', 'a bill paid through Finance would keep (or get) a reminder Task'],
  ['BS1 a typed amount is counted beside links', BS, 'const manualCents = refs.length === 0 && typed.length === 1 ? typed[0] : null;', 'const manualCents = typed.length === 1 ? typed[0] : null;', 'the Bills total would add typed and Finance money'],
  ['BS2 a loan-tracked bill is counted', BS, '&& !isLoanExcluded(obs.get(c.obligationId)!.data)) by.set(', ') by.set(', 'loan payments would enter the recorded total'],
  ['BS3 shared pieces are not reported', BS, 'sharedPieces: s.sharedPieces.map((p) => ({ key: p.key, periods: p.recordIds })),', 'sharedPieces: [],', 'a duplicate attribution would not be flagged in the total'],
  ['VB1 Deselect all hides nothing', VB, "export const deselectAll = (): Visibility => ({ mode: 'only', shown: [] });", "export const deselectAll = (): Visibility => ({ mode: 'all-but', hidden: [] });", 'the owner could not show only Personal'],
  ['VB2 a chosen set shows every layer', VB, ': v.shown.includes(layerId));', ': true);', 'a new layer or a switched-off layer would appear in a chosen set'],
  ['VB3 an earlier hidden list is ignored', VB, "if (Array.isArray(v)) return { mode: 'all-but', hidden: ids(v) };", 'if (Array.isArray(v)) return ALL_ON;', 'every owner\'s existing choices would be lost'],
  ['VB4 switching everything on does not return to "all on"', VB, 'available.length > 0 && available.every((id) => set.has(id)) ? ALL_ON :', 'false ? ALL_ON :', 'new layers would never appear again by themselves'],
  ['VB5 unreadable saved text hides everything', VB, '  } catch { /* fall through */ }\n  return ALL_ON;', "  } catch { /* fall through */ }\n  return { mode: 'only', shown: [] };", 'a damaged preference would give an empty Calendar'],
  ['FH1 a scheduled item keeps its amount when hidden', LD, 'title: hide ? rule.payee : `${rule.payee} ${formatCents(Math.abs(rule.amountCents))}`,', 'title: `${rule.payee} ${formatCents(Math.abs(rule.amountCents))}`,', 'Hide Amounts would leak the amount in the Calendar title'],
  ['FH2 the calendar file loses the amount when hidden', LD, '...(hide ? { icsTitle: `${rule.payee} ${formatCents(Math.abs(rule.amountCents))}` } : {}),', '...(hide ? { icsTitle: rule.payee } : {}),', 'an exported file would silently change with a screen preference'],
  ['FH3 other Finance items keep their amount when hidden', LD, 'title: hide ? maskMoney(e.title) : e.title,', 'title: e.title,', 'a loan payment title would leak the amount'],
  ['SW1 the window ends a day early', SO, 'const windowEnd = addDays(today, upcomingDays);', 'const windowEnd = addDays(today, upcomingDays - 1);', 'a visit exactly N days away would be missing'],
  ['SW2 an open visit beyond the window is listed', SO, 'if (r.open && r.open.data.dueDate && r.open.data.dueDate <= windowEnd) {', 'if (r.open && r.open.data.dueDate) {', 'a narrow window would still list a far-off visit'],
  ['SW3 the default window is 90 days', UW, 'export const DEFAULT_UPCOMING_DAYS: UpcomingDays = 30;', 'export const DEFAULT_UPCOMING_DAYS: UpcomingDays = 90;', 'a fresh configuration would not show 30 days'],
  ['SW4 an invalid saved window is accepted', UW, '(UPCOMING_WINDOWS as readonly number[]).includes(n) ? (n as UpcomingDays) : DEFAULT_UPCOMING_DAYS', 'Number.isFinite(n) ? (n as UpcomingDays) : DEFAULT_UPCOMING_DAYS', 'a damaged preference would give a window nobody offered'],
  ['SW5 more visits than rows are cut silently', UW, 'const shown = all ? rows : rows.slice(0, UPCOMING_ROWS);', 'const shown = rows.slice(0, UPCOMING_ROWS);', 'a long window would hide visits with no way to see them'],
  ['SW6 the provider filter is ignored', UW, "return provider === 'all' ? rows : rows.filter((u) => String(u.providerContactId) === provider);", 'return rows;', 'the provider filter would stop working'],
];

const TESTS = ['src/modules/bills/b3-', 'src/modules/bills/guards.test.ts', 'src/modules/calendar/layerVisibility', 'src/modules/ledger/dueProviderHide', 'src/modules/services/b30a'];
const results = [];
let started = false;
const backups = new Map();
const files = [...new Set(MUTATIONS.map((m) => m[1]))];
for (const f of files) backups.set(f, fs.readFileSync(path.join(root, f), 'utf8'));
/** Windows can refuse a write for a moment (another process holds the file): retry, never give up on a restore. */
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const put = (abs, text) => { for (let i = 0; i < 40; i++) { try { fs.writeFileSync(abs, text); if (fs.readFileSync(abs, 'utf8') === text) return; } catch (e) { if (i === 39) throw e; } sleepMs(250); } throw new Error('could not write ' + abs); };
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
    const status = failed || suiteFail ? `CAUGHT (${failed ? failed[1] : '0'} tests failed${suiteFail ? `, ${suiteFail[1]} files failed` : ''})` : (/Tests\s+\d+ passed/.test(text) ? 'SURVIVED (all tests passed: a GAP)' : 'UNKNOWN (no test summary)');
    results.push(`${id} | ${status} | ${meaning}`);
    fs.writeFileSync(out, results.join('\n') + '\n');
  }
} finally {
  restore();
  fs.writeFileSync(out, results.join('\n') + '\nDONE\n');
}
