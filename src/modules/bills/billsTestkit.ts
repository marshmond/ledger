/**
 * Shared helpers for the Bills tests ONLY (never imported by the app). Date arithmetic here is deliberately independent of the code under
 * test: integer day counts (civil-from-days), no `Date`, no time zone. All names, providers and amounts used by tests are invented.
 */
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { blankObligation, type ObligationData } from './model';
import type { Schedule, ScheduleSource } from './schedule';

export const pad = (n: number) => String(n).padStart(2, '0');
export const dim = (y: number, m: number) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const dn = (s: string) => {
  let [y, m, d] = s.split('-').map(Number);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400, doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
};
export const fromDn = (n: number) => {
  const z = n + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp < 10 ? mp + 3 : mp - 9;
  return iso(yoe + era * 400 + (m <= 2 ? 1 : 0), m, d);
};
export const addD = (s: string, n: number) => fromDn(dn(s) + n);
/** 0 = Sunday */
export const dow = (s: string) => (((dn(s) + 4) % 7) + 7) % 7;
export const lastBiz = (y: number, m: number) => { let d = dim(y, m); while (dow(iso(y, m, d)) === 0 || dow(iso(y, m, d)) === 6) d--; return iso(y, m, d); };
export const monday = (s: string) => addD(s, -((dow(s) + 6) % 7));

/** A schedule source with sensible defaults; override what the test is about. */
export const src = (schedule: Schedule | null, over: Partial<ScheduleSource> = {}): ScheduleSource => ({
  schedule, scheduleHistory: [], trackingSince: '2000-01-01', pauses: [], status: 'active', endedOn: null, ...over,
});
export const monthly = (day: number, anchorMonth = '2026-01', every = 1, adjust: 'none' | 'previous' | 'next' = 'none'): Schedule => ({ kind: 'months', every, slot: { kind: 'day', day, adjust }, anchorMonth });

/** A valid obligation record body for tests. */
export const ob = (over: Partial<ObligationData> = {}, today = '2026-11-07'): ObligationData => blankObligation({
  title: 'Example Power Co', type: 'utility', need: 'essential', amountKind: 'fixed', prices: [{ from: today, cents: 9000, label: '' }],
  schedule: monthly(18, today.slice(0, 7)), trackingSince: today, payment: { how: 'manual', fundingAccountId: null }, ...over,
}, today);

// ---- databases and two-device sync (same set-up the Services sync tests use) ----
let n = 0;
export const fresh = (tag = 'bills') => { const d = new FinanceDB(`test-${tag}-${n++}`); installTracking(d); return d; };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function remoteStore() {
  const r = {
    puts: 0, file: null as RemoteFile | null,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
  };
  return r satisfies RemoteStore;
}
export const devices = () => {
  const remote = remoteStore();
  const mk = () => { const d = fresh('bsync'); return { d, engine: new SyncEngine(d, dexieMeta(`bills-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
export type Dev = ReturnType<typeof devices>['A'];
export const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };

/** Every table that is NOT one of the six shared stores (so: every Finance table), as text, to prove an operation changed none of them. */
export async function financeSnapshot(d: FinanceDB, keepStamps = true): Promise<string> {
  const shared = ['contacts', 'tags', 'attachments', 'links', 'dueItems', 'moduleRecords'];
  const out: Record<string, unknown> = {};
  for (const t of d.tables) if (!shared.includes(t.name)) out[t.name] = (await t.toArray()).map((r) => { if (keepStamps) return r; const { updatedAt: _u, ...rest } = r as unknown as Record<string, unknown>; void _u; return rest; });
  return JSON.stringify(out);
}

// ---- B2: building billing-period facts and obligations by hand ----
import type { ModuleRecord } from '../../core/entities';
import { bodyFields, readCycle, type CycleRecord, type FactBody } from './cycleModel';
import type { ObligationRecord } from './model';

/** A fact record as the reader sees it, built from a body (ids and times are chosen by the test). */
export const fact = (obligationId: number, slot: string, body: FactBody, id: number, t = id, extra: Record<string, unknown> = {}): CycleRecord =>
  readCycle({ id, module: 'bills', kind: 'cycle', data: { obligationId, slot, ...bodyFields(body), ...extra }, createdAt: t, updatedAt: t, deletedAt: null } as ModuleRecord);
/** A raw stored record (to test damaged and unknown data). */
export const rawFact = (id: number, data: Record<string, unknown>, t = id): CycleRecord => readCycle({ id, module: 'bills', kind: 'cycle', data, createdAt: t, updatedAt: t, deletedAt: null } as ModuleRecord);
export const obRec = (id: number, over: Partial<ObligationData> = {}, today = '2026-11-07'): ObligationRecord => ({ id, createdAt: 1, updatedAt: 1, data: ob(over, today) });
export const inv = (cents: number, over: Partial<Extract<FactBody, { fact: 'invoice' }>> = {}): FactBody => ({ fact: 'invoice', invoicedCents: cents, invoiceDate: null, dueDate: null, invoiceNumber: '', nominal: null, ...over });
export const dueOn = (dueDate: string): FactBody => ({ fact: 'due-date', dueDate });
export const paidOut = (paidOn: string, cents: number | null): FactBody => ({ fact: 'paid-outside', paidOn, cents });
export const paidFull = (on: string | null = null): FactBody => ({ fact: 'paid-in-full', on });
export const skipF = (reason = ''): FactBody => ({ fact: 'skip', reason });
export const creditF = (cents: number, note = ''): FactBody => ({ fact: 'credit', cents, note });

// ---- B4: building lifecycle records by hand ----
import { LC_KIND, newLcData, readLifecycle, type LcBody, type LcRecord } from './lifecycleModel';
import { lifecycleView, type LifecycleView } from './lifecycleState';
import { withLifecycle } from './lifecycleRead';

/** A lifecycle record as the reader sees it (ids and times are chosen by the test; `link` sets what it replaces, targets and saw). */
export const lcRec = (id: number, obligationId: number, body: LcBody, link: { replaces?: number[]; targets?: number[]; seen?: number[] } = {}, t = id): LcRecord =>
  readLifecycle({ id, module: 'bills', kind: LC_KIND, data: newLcData(obligationId, body, link), createdAt: t, updatedAt: t, deletedAt: null } as ModuleRecord);
export const rawLc = (id: number, data: Record<string, unknown>, t = id): LcRecord => readLifecycle({ id, module: 'bills', kind: LC_KIND, data, createdAt: t, updatedAt: t, deletedAt: null } as ModuleRecord);
export const lcView = (records: LcRecord[], prices: ObligationData['prices'] = [], obligationId = 1): LifecycleView => lifecycleView({ obligationId, baselinePrices: prices, records });
/** An obligation record carrying its lifecycle view, as the loaders deliver it. */
export const obWith = (id: number, records: LcRecord[], over: Partial<ObligationData> = {}, today = '2026-11-07'): ObligationRecord => withLifecycle([obRec(id, over, today)], records)[0];

export const confirmBody = (effectiveOn: string, confirmedOn = effectiveOn, over: Partial<Extract<LcBody, { fact: 'cancel-confirm' }>> = {}): LcBody => ({ fact: 'cancel-confirm', confirmedOn, effectiveOn, providerRef: '', finalCharge: 'unknown', finalChargeCents: null, refundCents: null, accessUntil: null, note: '', ...over });
export const requestBody = (requestedOn: string, over: Partial<Extract<LcBody, { fact: 'cancel-request' }>> = {}): LcBody => ({ fact: 'cancel-request', requestedOn, requestedEffectiveOn: null, method: 'website', ref: '', awaiting: true, note: '', ...over });
export const stepBody = (from: string, cents: number | null, over: Partial<Extract<LcBody, { fact: 'price-step' }>> = {}): LcBody => ({ fact: 'price-step', from, until: null, cents, status: cents === null ? 'unknown' : 'fixed', label: '', source: 'owner', note: '', ...over });
export const renewalBody = (renewalDate: string, over: Partial<Extract<LcBody, { fact: 'renewal' }>> = {}): LcBody => ({ fact: 'renewal', renewalDate, cadence: 'annual', auto: true, noticeDays: null, noticeByDate: null, changes: 'unknown', confirmed: true, note: '', ...over });
export const trialBody = (endsOn: string, over: Partial<Extract<LcBody, { fact: 'trial' }>> = {}): LcBody => ({ fact: 'trial', startsOn: null, endsOn, paymentOnFile: 'unknown', conversion: 'unknown', convertsToCents: null, cadence: 'unknown', mustCancel: false, noticeBy: null, note: '', ...over });
