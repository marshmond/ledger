import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { makeTxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { createArrangement, loadArrangements, tasksOfArrangement } from './data';
import { blankArrangement } from './model';
import { setArrangementPayments, setVisitPayment } from './payments';
import { searchServicesData } from './searchSource';
import { attentionLines } from './todayCards';
import { loadVisits, logStandaloneVisit } from './visits';

/** Payment details belong on the Services detail screens only: never in search, Task titles, Today counts, or any network call. Invented data. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-paypriv-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';

describe('S3-B privacy', () => {
  it('amounts, payee names and typed payments never appear in search results, Task titles or the Today lines', async () => {
    const d = fresh();
    const weekly = { mode: 'fixed' as const, rule: { freq: 'weekly' as const, interval: 1, end: { type: 'never' as const } }, anchorDate: TODAY };
    const a = await createArrangement({ data: blankArrangement({ title: 'Pool service', cadence: weekly, expected: { basis: 'perVisit', cents: 987654 } }), provider: { name: 'Pat Pools' }, today: TODAY }, d);
    const t = (await d.txns.add({ accountId: 1, date: '2026-10-20', amountCents: -123456, payee: 'Secret Payee Co', memo: 'private memo', status: 'cleared', categoryId: 5 } as Txn)) as number;
    const v = (await logStandaloneVisit({ arrangementId: a.id, input: { status: 'completed', cancelledBy: null, date: '2026-10-20', title: 'Pool service', chargedCents: 555555, chargeKind: 'service' }, today: TODAY }, d)).visitId;
    await setVisitPayment(v, { source: 'finance', refs: [makeTxnRef((await d.txns.get(t))!)], manualCents: null }, null, d);
    const v2 = (await logStandaloneVisit({ arrangementId: a.id, input: { status: 'completed', cancelledBy: null, date: '2026-10-21', title: 'Second visit', chargedCents: null, chargeKind: null }, today: TODAY }, d)).visitId;
    await setVisitPayment(v2, { source: 'manual', refs: [], manualCents: 777777 }, null, d);
    await setArrangementPayments(a.id, [], null, d);
    const arrangements = await loadArrangements(d), visits = await loadVisits(d);
    const secrets = ['1234.56', '123456', '5555.55', '555555', '7777.77', '777777', '9876.54', 'Secret Payee', 'private memo'];
    const leaks = (text: string) => secrets.filter((s) => text.includes(s));
    for (const q of ['pool', 'pat', 'visit', 'secret', '1234', '7777', 'payee', 'private']) expect(leaks(JSON.stringify(searchServicesData(q, arrangements, 8, visits)))).toEqual([]);
    expect(searchServicesData('secret', arrangements, 8, visits)).toEqual([]);
    expect(searchServicesData('7777', arrangements, 8, visits).filter((r) => r.kind !== 'Page')).toEqual([]);
    const titles = (await tasksOfArrangement(a.id, d)).map((x) => x.data.title).join(' ');
    expect(leaks(titles)).toEqual([]);
    const lines = attentionLines({ unlogged: 2, duplicates: 1, needsSchedule: 1, needsReview: 1 } as never);
    expect(leaks(JSON.stringify(lines))).toEqual([]);
    expect(JSON.stringify(lines)).not.toMatch(/\$\d/);
  });

  it('no Services source file makes a network call, and none stores a bank, account or credential field', () => {
    const dir = __dirname;
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f));
    const src = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|EventSource/);
    // payment fields hold only references, whole cents and a source label: no account number, routing, card or login fields
    const model = readFileSync(join(dir, 'visitModel.ts'), 'utf8');
    expect(model).not.toMatch(/\b(accountNumber|routingNumber|iban|cardNumber|password|passcode|accessCode)\??\s*:/i); // as a field name
  });
});
