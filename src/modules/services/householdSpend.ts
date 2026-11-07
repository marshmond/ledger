/**
 * Household spending across Household Services AND Home & Assets (S5-B): "how much have we RECORDED paying, counting each payment once?"
 *
 * PURE and read-only. Nothing is stored, nothing is written to Finance, Projects, Home & Assets or Household Services, and there is no new financial
 * engine: the Finance piece rules are H3's `spend()` / `resolveRef` / `pieceKey` UNCHANGED (live Finance amounts, whole covers its parts, a piece counts
 * once however many records reach it, refunds lower the total, transfers and setup entries never count, stale/missing/changed-split references count 0
 * and are listed). This file only decides WHICH claims go into one aggregate, and explains the result.
 *
 * What it is: a deduplicated union of two modules' recorded payments. What it is NOT: the household's whole spending (rent, food, utilities and every
 * other category are outside both modules), an allocation (it never says which module "owns" a shared payment and never divides one), proof that a
 * service happened, or a Project figure (Project money is never read).
 *
 * Claims (S0 7.6). Every record yields claims: a PIECE claim per Finance reference (key = `pieceKey`), a TYPED claim per typed amount (no key), or nothing.
 *   - Piece claims are deduplicated by key across both modules, never by amount, date or payee. A whole transaction anywhere covers its parts everywhere.
 *   - Typed claims are NEVER matched by value. The only thing that makes two typed amounts one payment is an explicit, valid `recorded-as` link between
 *     a Household Services visit and a Home & Assets service record (S4). Such a visit and its record(s) are ONE payment event:
 *        - if any of them holds a Finance reference, every typed amount in the event is left out (listed);
 *        - otherwise the typed amount counts ONCE, from the visit (else from the lowest-numbered record), and a different typed amount is flagged.
 *     The event is decided on ALL the data and then dated by the claim that counts, so a period boundary can never make it count twice or not at all.
 *   - A missing, deleted or not-yet-synced `recorded-as` partner simply means no pair: each side then counts as the ordinary single record it is.
 *   - Unrelated records with identical typed amounts both count. A hint (never a total change) is raised only for the same day, same provider and same asset.
 *
 * Every claim ends in exactly one status (`included` counted, `merged` counted once through another claim, `covered` part of a counted whole,
 * `excluded` not added), and the `included` amounts add up to the household total. `reconciliation` explains how the household total differs from
 * the two module totals added together, derived claim by claim, not from an assumed formula.
 */
import { costRecords, sourceOf, spend, type CostRecord, type SpendSummary } from '../assets/spending';
import type { AssetRecord } from '../assets/model';
import type { ServiceRecord } from '../assets/service';
import type { TxnLookup } from '../../lib/txnRef';
import type { Link } from '../../core/entities';
import { isLive } from '../../core/store';
import type { ArrangementRecord } from './model';
import { payRecords } from './servicesSpend';
import { parseVisitRef, type VisitRecord } from './visitModel';

export type Mod = 'services' | 'home';
export const MODULE_LABEL: Record<Mod, string> = { services: 'Household Services', home: 'Home & Assets' };

export interface PairLink { visitId: number; serviceId: number }
export interface Period { from?: string; to?: string }

export interface HouseholdInput {
  assets: AssetRecord[];
  homeServices: ServiceRecord[];
  arrangements: ArrangementRecord[];
  visits: VisitRecord[];
  /** The live `recorded-as` links (S4): visit -> Home & Assets service record. */
  pairs: PairLink[];
  /** Asset ids each visit serves (its own links, else its arrangement's). Only used for the "may be the same job" hint. */
  visitAssets?: Map<number, number[]>;
}

/** Live `recorded-as` links as pairs. Links with unreadable ends are ignored. Pure. */
export function pairsFromLinks(links: Link[]): PairLink[] {
  const out: PairLink[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (l.type !== 'recorded-as' || l.fromModule !== 'services' || l.toModule !== 'assets' || !isLive(l)) continue;
    const v = parseVisitRef(l.fromId);
    const m = /^service:(\d+)$/.exec(String(l.toId));
    if (v === null || !m) continue;
    const k = `${v}:${m[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ visitId: v, serviceId: Number(m[1]) });
  }
  return out.sort((a, b) => a.visitId - b.visitId || a.serviceId - b.serviceId);
}

// ---- records ----

type RecKind = 'visit' | 'arrangement' | 'purchase' | 'work';
interface Rec {
  cost: CostRecord<Mod>;
  mod: Mod;
  kind: RecKind;
  /** The record's own date: a typed amount counts by it. Null = undated. */
  date: string | null;
  /** The number in the id: visit id, arrangement id, asset id or service-record id. */
  sourceId: number;
  /** The typed amount before any event decision (null when there is none, or when references are present: references win). */
  typed: number | null;
}

export type SourceRef = { type: 'visit' | 'arrangement' | 'asset' | 'service'; id: number; assetId?: number };

const recSource = (r: Rec): SourceRef => (r.kind === 'visit' ? { type: 'visit', id: r.sourceId } : r.kind === 'arrangement' ? { type: 'arrangement', id: r.sourceId } : r.kind === 'purchase' ? { type: 'asset', id: r.sourceId } : { type: 'service', id: r.sourceId, assetId: r.cost.assetId });

function buildRecs(input: HouseholdInput): Rec[] {
  const out: Rec[] = [];
  for (const p of payRecords(input.arrangements, input.visits)) {
    const cost: CostRecord<Mod> = { id: p.id, assetId: p.arrangementId ?? 0, group: 'services', title: p.title, manualCents: p.refs.length ? null : p.manualCents, refs: p.refs };
    out.push({ cost, mod: 'services', kind: p.level, date: p.date || null, sourceId: Number(p.id.split(':')[1]), typed: p.refs.length ? null : p.manualCents });
  }
  const assetById = new Map(input.assets.map((a) => [a.id, a]));
  const serviceById = new Map(input.homeServices.map((s) => [`service:${s.id}`, s]));
  for (const c of costRecords(input.assets, input.homeServices)) {
    const isService = c.id.startsWith('service:');
    const date = isService ? serviceById.get(c.id)?.data.date || null : assetById.get(c.assetId)?.data.purchaseDate || null;
    out.push({
      cost: { ...c, group: 'home' } as CostRecord<Mod>, mod: 'home', kind: isService ? 'work' : 'purchase', date, sourceId: Number(c.id.split(':')[1]), typed: c.refs.length ? null : c.manualCents,
    });
  }
  return out;
}

// ---- payment events (visit + its recorded-as records) ----

interface EventInfo {
  /** Every record id in the event that carries a payment claim, plus the (possibly payment-free) ids that belong to it. */
  members: string[];
  hasFinance: boolean;
  /** The record whose typed amount counts, if any. */
  owner: string | null;
  /** Typed amounts that are left out, with the record that holds them. */
  leftOut: { id: string; cents: number; why: 'finance' | 'counted-once' }[];
  differs: boolean;
  /** At least one record in the event carries some payment claim. */
  hasAnyPayment: boolean;
}

function buildEvents(input: HouseholdInput, recs: Rec[]) {
  const liveServices = new Set(costRecords(input.assets, input.homeServices).filter((c) => c.id.startsWith('service:')).map((c) => c.id));
  const visitIds = new Set(input.visits.map((v) => v.id));
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; let c = x; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  const add = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a: string, b: string) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra); };
  let dangling = 0;
  for (const p of input.pairs) {
    const s = `service:${p.serviceId}`;
    if (!visitIds.has(p.visitId) || !liveServices.has(s)) { dangling++; continue; }
    union(`visit:${p.visitId}`, s);
  }
  const byId = new Map(recs.map((r) => [r.cost.id, r]));
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  const events: EventInfo[] = [];
  const eventOf = new Map<string, EventInfo>();
  for (const members of [...groups.values()].map((g) => g.sort())) {
    const rs = members.map((id) => byId.get(id)).filter((r): r is Rec => !!r);
    const hasFinance = rs.some((r) => r.cost.refs.length > 0);
    // visits first (lowest id), then records (lowest id): the visit's typed amount is the one that counts
    const cands = rs.filter((r) => r.typed !== null).sort((a, b) => (a.kind === 'visit' ? 0 : 1) - (b.kind === 'visit' ? 0 : 1) || a.sourceId - b.sourceId);
    const ev: EventInfo = { members, hasFinance, owner: null, leftOut: [], differs: false, hasAnyPayment: rs.some((r) => r.cost.refs.length > 0 || r.typed !== null) };
    if (hasFinance) for (const c of cands) ev.leftOut.push({ id: c.cost.id, cents: c.typed!, why: 'finance' });
    else if (cands.length) {
      ev.owner = cands[0].cost.id;
      for (const c of cands.slice(1)) { ev.leftOut.push({ id: c.cost.id, cents: c.typed!, why: 'counted-once' }); if (c.typed !== cands[0].typed) ev.differs = true; }
    }
    events.push(ev);
    for (const m of members) eventOf.set(m, ev);
  }
  return { events, eventOf, dangling };
}

// ---- period ----

const inP = (d: string | null | undefined, p?: Period) => !!d && (!p || ((!p.from || d >= p.from) && (!p.to || d <= p.to)));
const hasPeriod = (p?: Period) => !!p && (!!p.from || !!p.to);

/** A record's slice of a period: Finance references by the day of the LIVE transaction (else the snapshot day, else the record's day); a typed amount by its record's day (undated: never in a period). */
function narrow(r: CostRecord<Mod>, date: string | null, lookup: TxnLookup, p?: Period): CostRecord<Mod> | null {
  if (!hasPeriod(p)) return r;
  if (r.refs.length) {
    const kept = r.refs.filter((x) => inP(lookup(x.txnId)?.date || x.snapshot.date || date, p));
    return kept.length ? { ...r, refs: kept, manualCents: null } : null;
  }
  return inP(date, p) ? r : null;
}

// ---- output ----

export type ClaimStatus = 'included' | 'merged' | 'covered' | 'excluded';
export interface Claim {
  recordId: string;
  module: Mod;
  title: string;
  source: SourceRef;
  kind: 'finance' | 'typed';
  /** The piece key (Finance claims). */
  key?: string;
  /** Finance: the live amount (negative = money back; 0 when it needs review). Typed: the typed amount. */
  cents: number;
  status: ClaimStatus;
  /** Plain words. Always present for anything but a plain `included` claim. */
  reason: string;
}

export type ReviewKind = 'finance-reference' | 'typed-differs' | 'typed-left-out' | 'same-job-hint' | 'changed' | 'dangling-pair';
export interface ReviewCondition { kind: ReviewKind; text: string; recordIds: string[]; sources: SourceRef[] }

export interface HouseholdSpend {
  period: Period;
  /** Each recorded payment once, across both modules. */
  totalCents: number;
  financeCents: number;
  typedCents: number;
  servicesCents: number;
  homeCents: number;
  /** Live amounts of Finance pieces that BOTH modules reach (counted once at household level). Never an allocation. */
  linkedInBothCents: number;
  /** Pieces counted in the household total, with who reaches them. */
  pieces: { key: string; cents: number; modules: Mod[]; recordIds: string[] }[];
  claims: Claim[];
  review: ReviewCondition[];
  /** Records with no cost or payment recorded. Unknown is never $0, and a completed visit with no payment is not "unpaid". */
  unknown: { homeWork: number; completedVisits: number };
  reconciliation: {
    /** Services total + Home & Assets total, as the two module pages show them. */
    simpleSumCents: number;
    differenceCents: number;
    /** Payments both modules count, which the household counts once. */
    overlapBothCents: number;
    /** Parts the module pages count that the household total covers by a whole transaction. */
    coveredAcrossCents: number;
    /** Typed amounts on linked records that the household does not add again. */
    typedNotAddedCents: number;
    /** Included claims add up to the household total. */
    reconciles: boolean;
    /** overlap + covered + typed = difference. */
    explainsDifference: boolean;
  };
  counts: { included: number; merged: number; covered: number; excluded: number };
  /** Pieces counted that Finance also attributes to a Project (context only; Project money is never added or read). */
  projectTaggedPieces: number;
  summary: SpendSummary<Mod>;
}

const money = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;

/** Piece claims' module set: the records that reach it. */
const modOf = (id: string): Mod => (id.startsWith('visit:') || id.startsWith('arrangement:') ? 'services' : 'home');

export function householdSpend(input: HouseholdInput, lookup: TxnLookup, period: Period = {}): HouseholdSpend {
  const recs = buildRecs(input);
  const { eventOf, dangling } = buildEvents(input, recs);
  const byId = new Map(recs.map((r) => [r.cost.id, r]));

  // The union: typed amounts that an event leaves out are removed BEFORE the period is applied (decided on all the data), and a record whose
  // only payment was such a typed amount drops out entirely (it must not be reported as "no cost recorded"). A record with Finance references
  // never had a typed amount in the first place (references win), so it needs no change.
  const leftOut = new Set<string>();
  for (const ev of new Set(eventOf.values())) for (const l of ev.leftOut) leftOut.add(l.id);
  const unionRecs: CostRecord<Mod>[] = [];
  for (const r of recs) {
    if (leftOut.has(r.cost.id) && r.typed !== null && !r.cost.refs.length) continue;
    const n = narrow(r.cost, r.date, lookup, period);
    if (n) unionRecs.push(n);
  }
  const summary = spend<Mod>(unionRecs, lookup, ['services', 'home']);

  // The two module totals, exactly as each module counts its own records (typed amounts untouched).
  const modTotals = {} as Record<Mod, SpendSummary<Mod>>;
  for (const m of ['services', 'home'] as Mod[]) {
    modTotals[m] = spend<Mod>(recs.filter((r) => r.mod === m).map((r) => narrow(r.cost, r.date, lookup, period)).filter((x): x is CostRecord<Mod> => !!x), lookup, ['services', 'home']);
  }

  // ---- claims, taken straight from what spend() reported ----
  const claims: Claim[] = [];
  const meta = (id: string) => byId.get(id)!;
  const mk = (id: string, c: Omit<Claim, 'recordId' | 'module' | 'title' | 'source'>): Claim => ({ recordId: id, module: modOf(id), title: meta(id).cost.title, source: recSource(meta(id)), ...c });
  const piecesOut: HouseholdSpend['pieces'] = [];
  const coveredTxn = new Map<number, Set<Mod>>();
  for (const it of summary.coveredParts) {
    claims.push(mk(it.recordId, { kind: 'finance', key: it.resolved.key, cents: it.resolved.spendCents, status: 'covered', reason: `Part of a transaction whose whole amount is also linked (${money(it.resolved.spendCents)}). The whole counts, so this part is not added again.` }));
    const set = coveredTxn.get(it.resolved.ref.txnId) ?? new Set<Mod>();
    set.add(modOf(it.recordId));
    coveredTxn.set(it.resolved.ref.txnId, set);
  }
  let linkedInBoth = 0;
  let projectTagged = 0;
  for (const p of summary.pieces) {
    const modules = new Set<Mod>(p.recordIds.map(modOf));
    for (const m of coveredTxn.get(p.resolved.ref.txnId) ?? []) modules.add(m);
    if (modules.size > 1) linkedInBoth += p.spendCents;
    const t = p.resolved.txn;
    const tagged = p.resolved.ref.splitIndex !== undefined ? t?.splits?.[p.resolved.ref.splitIndex]?.project?.projectId ?? t?.project?.projectId : t?.project?.projectId;
    if (tagged !== undefined) projectTagged++;
    piecesOut.push({ key: p.key, cents: p.spendCents, modules: [...modules].sort(), recordIds: p.recordIds });
    p.recordIds.forEach((id, i) => {
      const also = p.recordIds.length > 1 ? ` Linked on ${p.recordIds.length} records (${p.recordIds.map((x) => meta(x).cost.title).join('; ')}); the money is counted once and is not divided.` : '';
      claims.push(mk(id, { kind: 'finance', key: p.key, cents: p.spendCents, status: i === 0 ? 'included' : 'merged', reason: i === 0 ? also.trim() : `Same payment as ${meta(p.recordIds[0]).cost.title}; counted once there.` }));
    });
  }
  for (const it of summary.review) {
    claims.push(mk(it.recordId, { kind: 'finance', key: it.resolved.key, cents: 0, status: 'excluded', reason: `${it.resolved.note || 'This linked payment needs review.'}` }));
  }
  // typed claims: those in the union count; those left out are listed with the record that holds them
  for (const r of unionRecs) {
    if (sourceOf(r) === 'manual') claims.push(mk(r.id, { kind: 'typed', cents: r.manualCents!, status: 'included', reason: 'Entered by you as paid outside Finance (not checked against Finance).' }));
  }
  const typedNotAdded: Claim[] = [];
  for (const ev of new Set(eventOf.values())) {
    for (const l of ev.leftOut) {
      const r = meta(l.id);
      if (hasPeriod(period) && !inP(r.date, period)) continue;
      const c = mk(l.id, {
        kind: 'typed', cents: l.cents, status: 'excluded',
        reason: l.why === 'finance'
          ? 'Not added: this visit and its Home & Assets record are linked as one job and a Finance payment is linked, so the typed amount would count the same money twice.'
          : 'Not added: this visit and its Home & Assets record are linked as one job, so the typed amount is counted once (from the visit).',
      });
      typedNotAdded.push(c);
      claims.push(c);
    }
  }
  claims.sort((a, b) => a.recordId.localeCompare(b.recordId) || (a.key ?? '').localeCompare(b.key ?? '') || a.status.localeCompare(b.status));

  // ---- review conditions ----
  const review: ReviewCondition[] = [];
  const srcs = (ids: string[]) => ids.map((id) => recSource(meta(id)));
  for (const it of summary.review) review.push({ kind: 'finance-reference', text: `${it.title}: ${it.resolved.note}`, recordIds: [it.recordId], sources: srcs([it.recordId]) });
  for (const it of summary.changed) review.push({ kind: 'changed', text: `${it.title}: ${it.resolved.note} (the current Finance amount is used).`, recordIds: [it.recordId], sources: srcs([it.recordId]) });
  for (const ev of new Set(eventOf.values())) {
    if (ev.differs && ev.owner) {
      const ids = [ev.owner, ...ev.leftOut.map((l) => l.id)];
      review.push({ kind: 'typed-differs', text: `A visit and its linked Home & Assets record carry different typed amounts. Only the visit's ${money(meta(ev.owner).typed!)} is counted. Check both.`, recordIds: ids, sources: srcs(ids) });
    }
    const finLeft = ev.leftOut.filter((l) => l.why === 'finance');
    if (finLeft.length) review.push({ kind: 'typed-left-out', text: `A typed amount on a linked visit or record is not added because a Finance payment is linked on the same job. Remove the typed amount to clear this.`, recordIds: finLeft.map((l) => l.id), sources: srcs(finLeft.map((l) => l.id)) });
  }
  if (dangling > 0) review.push({ kind: 'dangling-pair', text: `${dangling} link${dangling === 1 ? '' : 's'} between a visit and a Home & Assets record point at something that is not on this device. Each side is counted on its own until it arrives.`, recordIds: [], sources: [] });

  // "These two may describe the same job": same day, same provider, same asset, typed amounts on both, not linked. A hint only; it never changes a total.
  const pairedVisits = new Set(input.pairs.map((p) => p.visitId));
  const pairedServices = new Set(input.pairs.map((p) => p.serviceId));
  const typedServices = input.homeServices.filter((s) => !pairedServices.has(s.id) && s.data.costCents !== null && !s.data.txnRefs.length && s.data.date && s.data.providerContactId !== null);
  const hinted = new Set<string>();
  // indexed by day and provider, so the hint costs one look-up per visit and not one comparison per pair of records
  const sameDayProvider = new Map<string, ServiceRecord[]>();
  for (const sv of typedServices) { const k = `${sv.data.date}|${sv.data.providerContactId}`; sameDayProvider.set(k, [...(sameDayProvider.get(k) ?? []), sv]); }
  for (const v of input.visits) {
    if (v.data.status !== 'completed' || pairedVisits.has(v.id) || v.data.paidManualCents === null || v.data.txnRefs.length || !v.data.date || v.data.providerContactId === null) continue;
    const assets = new Set(input.visitAssets?.get(v.id) ?? []);
    for (const s of sameDayProvider.get(`${v.data.date}|${v.data.providerContactId}`) ?? []) {
      if (!assets.has(s.data.assetId)) continue;
      const k = `${v.id}:${s.id}`;
      if (hinted.has(k) || !byId.has(`visit:${v.id}`) || !byId.has(`service:${s.id}`)) continue;
      hinted.add(k);
      review.push({ kind: 'same-job-hint', text: `A visit and a Home & Assets record share a day, a provider and an asset and each hold a typed amount. They may describe the same job. Both are counted until you link them.`, recordIds: [`visit:${v.id}`, `service:${s.id}`], sources: srcs([`visit:${v.id}`, `service:${s.id}`]) });
    }
  }

  // ---- unknown (never $0) ----
  const inWin = (d: string | null) => !hasPeriod(period) || inP(d, period);
  let homeWork = 0;
  // summary.unknown is already narrowed to the period; a record whose visit or partner carries a payment is not unknown
  for (const u of summary.unknown) if (!eventOf.get(u.recordId)?.hasAnyPayment) homeWork++;
  let completedVisits = 0;
  for (const v of input.visits) {
    if (v.data.status !== 'completed' || v.data.txnRefs.length || v.data.paidManualCents !== null || !inWin(v.data.date || null)) continue;
    if (!eventOf.get(`visit:${v.id}`)?.hasAnyPayment) completedVisits++;
  }

  // ---- reconciliation, derived from the claims ----
  const unionKeys = new Map(summary.pieces.map((p) => [p.key, p.spendCents]));
  let overlapBoth = 0, coveredAcross = 0;
  const counted = [...modTotals.services.pieces, ...modTotals.home.pieces];
  const byKeyCount = new Map<string, number>();
  for (const p of counted) {
    if (unionKeys.has(p.key)) byKeyCount.set(p.key, (byKeyCount.get(p.key) ?? 0) + 1);
    else coveredAcross += p.spendCents;
  }
  for (const [k, n] of byKeyCount) overlapBoth += (n - 1) * unionKeys.get(k)!;
  const typedNotAddedCents = typedNotAdded.reduce((t, c) => {
    // only typed amounts that a module page counts (a record with references never counted its typed amount) change the difference
    const r = meta(c.recordId);
    return r.typed !== null && (!hasPeriod(period) || inP(r.date, period)) ? t + c.cents : t;
  }, 0);
  const simpleSum = modTotals.services.totalCents + modTotals.home.totalCents;
  const included = claims.filter((c) => c.status === 'included').reduce((t, c) => t + c.cents, 0);
  const counts = { included: 0, merged: 0, covered: 0, excluded: 0 };
  for (const c of claims) counts[c.status]++;

  return {
    period, totalCents: summary.totalCents, financeCents: summary.financeCents, typedCents: summary.manualCents,
    servicesCents: modTotals.services.totalCents, homeCents: modTotals.home.totalCents, linkedInBothCents: linkedInBoth,
    pieces: piecesOut, claims, review, unknown: { homeWork, completedVisits },
    reconciliation: {
      simpleSumCents: simpleSum, differenceCents: simpleSum - summary.totalCents, overlapBothCents: overlapBoth, coveredAcrossCents: coveredAcross, typedNotAddedCents,
      reconciles: included === summary.totalCents, explainsDifference: overlapBoth + coveredAcross + typedNotAddedCents === simpleSum - summary.totalCents,
    },
    counts, projectTaggedPieces: projectTagged, summary,
  };
}
