import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FinanceDB } from '../../db';
import type { Link, RecordId } from '../../core/entities';
import type { RecurringRule } from '../../types';
import { applyServiceLink, assertBillsLink, billLinks, previewServiceLink } from './crossLinks';
import { newOp, recordFact } from './cycleData';
import { createObligation } from './data';
import { applyLifecycle, previewLifecycle, type LcAction } from './lifecycleData';
import { linkRule } from './scheduledLinkData';
import { runUndo } from './undo';
import { fresh, monthly, ob } from './billsTestkit';
import type { ObligationData } from './model';

/**
 * B4 pre-commit correction 2: the shared `links` table. Instead of trusting a text pattern for one spelling of a write, these tests (a) run every Bills action against a real
 * database and AUDIT every live link that touches Bills afterwards, (b) show that an unauthorized link type or path is rejected and an audit would flag a rogue row, and
 * (c) restrict which source files may even mention the table. Allowed, and nothing else: `bills-for` (bill to Services arrangement, written only by crossLinks.ts) and the
 * Tasks API's own `about` (Task to bill, written by that API when Bills asks it for a reminder Task).
 */
const TODAY = '2026-11-20';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const mk = (over: Partial<ObligationData> = {}): ObligationData => ob({ title: 'Streamly Premium', providerNameSnapshot: 'Streamly', type: 'subscription', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 1499, label: '' }], schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', payment: { how: 'auto', fundingAccountId: null }, reminders: { payTask: true, leadDays: 3 }, ...over }, TODAY);
const go = async (d: FinanceDB, id: number, a: LcAction) => { const p = await previewLifecycle(id, a, TODAY, money, d); if (p.problem) throw new Error(p.problem); return applyLifecycle(id, a, p.token, TODAY, d); };

/** Every live link that touches Bills, with what is wrong with it (nothing = allowed). */
export async function auditBillsLinks(d: FinanceDB): Promise<{ link: Link; problem: string }[]> {
  const out: { link: Link; problem: string }[] = [];
  const isOb = (m: string, id: RecordId) => m === 'bills' && /^obligation:\d+$/.test(String(id));
  for (const l of await d.links.toArray()) {
    if (l.deletedAt != null || (l.fromModule !== 'bills' && l.toModule !== 'bills')) continue;
    const tasksAbout = l.type === 'about' && l.fromModule === 'tasks' && isOb(l.toModule, l.toId);
    const billsFor = l.type === 'bills-for' && isOb(l.fromModule, l.fromId) && l.toModule === 'services' && /^arrangement:\d+$/.test(String(l.toId));
    if (!tasksAbout && !billsFor) out.push({ link: l, problem: `unexpected link type "${l.type}" ${l.fromModule} -> ${l.toModule}` });
  }
  return out;
}

describe('B4 shared links: behaviour against the real database', () => {
  it('after every kind of Bills action the only links touching Bills are Task "about" links and "bills-for"; the audit finds nothing else', async () => {
    const d = fresh('b4links');
    const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const rule = (await d.recurring.add({ accountId: acct, payee: 'Streamly Premium', amountCents: -1499, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-12', active: true } as RecurringRule)) as number;
    const id = (await createObligation({ data: mk(), provider: { name: 'Streamly' }, today: TODAY }, d)).id;
    const other = (await createObligation({ data: mk({ title: 'Cleaning payment' }), today: TODAY }, d)).id;
    await d.moduleRecords.add({ id: 880001, module: 'services', kind: 'arrangement', data: { title: 'House cleaners', status: 'active' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    // Tasks (through the Tasks API), lifecycle actions, billing facts, the Scheduled pointer, the Services link, Undo
    await go(d, id, { type: 'trial', startsOn: null, endsOn: '2026-12-01', paymentOnFile: 'yes', conversion: 'auto', convertsToCents: 1499, cadence: 'monthly', mustCancel: true, noticeBy: '2026-11-28', note: '', makePrices: true });
    await go(d, id, { type: 'renewal', renewalDate: '2027-04-15', cadence: 'annual', auto: false, noticeDays: 30, noticeByDate: null, changes: 'unknown', confirmed: true, note: '' });
    await go(d, id, { type: 'cancel-request', requestedOn: '2026-11-18', requestedEffectiveOn: null, method: 'website', ref: '', awaiting: true, note: '', followUpOn: '2026-11-27' });
    const confirm = await go(d, id, { type: 'cancel-confirm', confirmedOn: '2026-11-19', effectiveOn: '2026-12-31', providerRef: '', finalCharge: 'unknown', finalChargeCents: null, refundCents: null, accessUntil: null, note: '' });
    await recordFact({ obligationId: id, slot: 'm2026-11', body: { fact: 'invoice', invoicedCents: 1499, invoiceDate: null, dueDate: null, invoiceNumber: '', nominal: null }, op: newOp(), today: TODAY }, d);
    await linkRule({ obligationId: other, ruleId: rule, expect: null, today: TODAY }, d);
    const sp = await previewServiceLink(id, 880001, 'linked', d);
    await applyServiceLink(id, 880001, 'linked', sp.token, TODAY, d);
    await runUndo(confirm.undo, () => undefined, d); // a refused or a successful Undo: either way nothing foreign is written
    const up = await previewServiceLink(id, 880001, 'unlinked', d);
    const unlinked = await applyServiceLink(id, 880001, 'unlinked', up.token, TODAY, d);
    expect(await runUndo(unlinked.undo, () => undefined, d)).toBe(true); // restores exactly the link it removed
    const live = (await d.links.toArray()).filter((l) => l.deletedAt == null && (l.fromModule === 'bills' || l.toModule === 'bills'));
    expect(live.length).toBeGreaterThan(1);
    expect([...new Set(live.map((l) => l.type))].sort()).toEqual(['about', 'bills-for']);
    expect(await auditBillsLinks(d)).toEqual([]);
    expect((await billLinks(id, d)).map((l) => l.arrangementId)).toEqual([880001]);
  });

  it('NEGATIVE: an audit flags a rogue link of an unauthorized type or path (so a new wrapper or spelling cannot slip one in unseen)', async () => {
    const d = fresh('b4rogue');
    const id = (await createObligation({ data: mk(), today: TODAY }, d)).id;
    await d.links.add({ fromModule: 'bills', fromId: `obligation:${id}`, toModule: 'assets', toId: 'asset:1', type: 'serves', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.links.add({ fromModule: 'bills', fromId: `obligation:${id}`, toModule: 'services', toId: 'visit:3', type: 'bills-for', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.links.add({ fromModule: 'projects', fromId: 'project:1', toModule: 'bills', toId: `obligation:${id}`, type: 'involves', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const bad = await auditBillsLinks(d);
    expect(bad.map((b) => b.link.type).sort()).toEqual(['bills-for', 'involves', 'serves']);
  });

  it('NEGATIVE: the writer itself rejects any other type, module or malformed id, and a failed write leaves no link and no audit record', () => {
    const base = { fromModule: 'bills', fromId: 'obligation:5', toModule: 'services', toId: 'arrangement:9', type: 'bills-for' };
    expect(() => assertBillsLink(base)).not.toThrow();
    for (const bad of [{ type: 'serves' }, { type: 'about' }, { toModule: 'assets' }, { toId: 'visit:9' }, { toId: 'arrangement:x' }, { fromModule: 'tasks' }, { fromId: 'cycle:5' }]) expect(() => assertBillsLink({ ...base, ...bad }), JSON.stringify(bad)).toThrow(/Bills may only link a bill to a Household Services arrangement/);
  });

  it('NEGATIVE: linking to something that is not an arrangement (a Services VISIT row, a missing id, an ended record of another module) is refused and writes nothing', async () => {
    const d = fresh('b4notarr');
    const id = (await createObligation({ data: mk(), today: TODAY }, d)).id;
    await d.moduleRecords.add({ id: 880005, module: 'services', kind: 'visit', data: { arrangementId: 880001 }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.moduleRecords.add({ id: 880006, module: 'assets', kind: 'asset', data: { name: 'Fridge' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    for (const target of [880005, 880006, 999999]) expect((await previewServiceLink(id, target, 'linked', d)).problem).toMatch(/not here/);
    expect((await d.links.toArray()).filter((l) => l.type === 'bills-for')).toEqual([]); // (the one Task link is the reminder Task the Tasks API made for the bill)
  });

  it('the link and its audit record are ONE transaction: a failure after the writes leaves neither', async () => {
    const d = fresh('b4tx');
    const id = (await createObligation({ data: mk({ reminders: null }), today: TODAY }, d)).id;
    await d.moduleRecords.add({ id: 880001, module: 'services', kind: 'arrangement', data: { title: 'House cleaners', status: 'active' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const p = await previewServiceLink(id, 880001, 'linked', d);
    await expect(applyServiceLink(id, 880001, 'linked', p.token, TODAY, d, { afterWrite: async () => { throw new Error('boom'); } })).rejects.toThrow('boom');
    expect((await d.links.toArray()).filter((l) => l.deletedAt == null)).toEqual([]);
    expect((await d.moduleRecords.where('[module+kind]').equals(['bills', 'lifecycle']).toArray()).length).toBe(0);
  });
});

describe('B4 shared links: which source files may touch the links table at all', () => {
  const DIR = 'src/modules/bills';
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const sources = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'billsTestkit.ts').map((f) => ({ f, c: code(readFileSync(join(DIR, f), 'utf8')) }));
  const scan = (re: RegExp) => sources.filter((s) => re.test(s.c)).map((s) => s.f).sort();
  const TABLE = /(?<=[\w)\]])\.links\s*(\.\s*(where|get|add|put|bulk\w*|delete|update|clear|modify|filter|toArray|count|orderBy)\b|[,\]);])|\bshared\s*\.\s*links\b/;
  const WRAPPED = /repo\s*(<[^>]*>)?\s*\(\s*[\w.]*links\b/;

  it('NEGATIVE: the patterns catch other spellings of a link write (a differently named handle, a wrapper, an alias, the shared store), and ignore a mere property called links', () => {
    for (const sample of ['await db.links.add(x)', 'await database.links.put(x)', 'const r = repo<Link>(store.links);', 'createStore(d).shared.links.add(a, b, "x")', 'const t = d.links;', 'await this.d.links.bulkPut(rows)']) expect(TABLE.test(sample) || WRAPPED.test(sample), sample).toBe(true);
    for (const sample of ['const n = extra.links.length;', 'extra.links.map((l) => l.id)', 'const all = [...links];', 'payments(links: LinkFact[])']) expect(TABLE.test(sample) || WRAPPED.test(sample), sample).toBe(false);
  });

  it('only five files reference the links table (as a table, a store or a transaction scope); a sixth fails here whatever it calls the wrapper', () => {
    // the table itself (a method called on it, or handed over in a list or a wrapper), or the shared links store; NOT a property that merely happens to be named links
    expect(scan(TABLE)).toEqual(['crossLinks.ts', 'cycleData.ts', 'data.ts', 'tasks.ts', 'undo.ts']);
  });

  it('of those, only crossLinks.ts and undo.ts can WRITE: no other file wraps the table in a repository, aliases it, or calls a write on it', () => {
    expect(scan(WRAPPED)).toEqual(['crossLinks.ts', 'undo.ts']);
    expect(scan(/=\s*[\w.()]*\.links\s*;|=\s*[\w.()]*shared\.links\b/)).toEqual([]); // no aliasing of the table or the shared links store
    expect(scan(/\.links\s*\.\s*(add|put|bulkAdd|bulkPut|delete|bulkDelete|update|clear|modify|remove|restore)\b/)).toEqual([]);
    expect(scan(/\bcreateStore\b/)).toEqual(['data.ts', 'quickAddDef.ts']); // data.ts: the read-only `linkedTo` when deciding whether a bill can be deleted; quickAddDef.ts never touches links (the first test)
    expect(/\.(add|remove|restore|put)\s*\(/.test(code(readFileSync(join(DIR, 'data.ts'), 'utf8')).match(/createStore\(d\)[^;]*;/g)?.join(' ') ?? '')).toBe(false);
  });

  it('the Tasks API is the only way a Task link is made: the two files that read Task links add none themselves', () => {
    for (const f of ['tasks.ts', 'cycleData.ts', 'data.ts']) expect(/\blinks\.(add|put)\b|\blinkRepo\b|\blinkedTo\b[^;]*\.(add|put)/.test(sources.find((s) => s.f === f)!.c), f).toBe(false);
  });

  it('the one writer checks the link before it writes it (the assertion comes first, in the same transaction)', () => {
    const c = sources.find((s) => s.f === 'crossLinks.ts')!.c;
    expect(c.indexOf('assertBillsLink(row)')).toBeGreaterThan(0);
    expect(c.indexOf('assertBillsLink(row)')).toBeLessThan(c.indexOf('links.put(row)'));
    expect([...c.matchAll(/links\.put\(/g)].length).toBe(1);
  });

  it('the Scheduled-rule association stays an obligation field (`scheduledRuleIds`), not a link', () => {
    expect(scan(/scheduledRuleIds[^;\n]*links|links[^;\n]*scheduledRuleIds/)).toEqual([]);
  });
});
