/**
 * RECORDED SPENDING ACROSS BILLS, HOUSEHOLD SERVICES AND HOME & ASSETS (B5). PURE: no database, no clock, nothing stored, nothing written to Finance or to any module.
 *
 * HOW IT IS BUILT (and what it does NOT do). It does not calculate money a second way and it does not edit, widen or replace any existing reader. It CALLS them, unchanged:
 *   - `householdSpend()` (S5) for Household Services + Home & Assets, including S4's `recorded-as` rule for typed amounts on one job;
 *   - `billsCostRecords()` + `billsRecordedPayments()` (B3) for Bills.
 * Both sit on H3's `spend()`, so each already counts a Finance piece (`pieceKey`) once, lets a counted whole transaction cover its parts, lowers the total by refunds and counts
 * a stale reference as nothing. This file adds ONE thing: a small merge of the two results, by `pieceKey`, so that a piece reached from more than one module counts once in the
 * household total, a whole in one module covers a part in another, and typed amounts are simply added (a typed amount is never matched to another by value, date, payee or contact).
 *
 * THE PRIMARY FIGURE is recorded spending: "each recorded payment once". It is NOT all household spending (rent, food and every other category sit outside these modules), never a
 * forecast, never a Finance Scheduled amount, never a Project figure, and never proof that a bank settled anything. Finance's own words (pending, cleared, reconciled) are shown
 * beside the figures and change none of them.
 *
 * ATTRIBUTION POLICY (B5, recorded as a decision). The household total is exact and counted once. The additive breakdown credits a counted piece to the ONE module whose records reach
 * it, or to "Shared between modules" when more than one module does. Nothing is credited by list order, title or amount. Every association is kept for explanation, so a shared
 * payment still appears in the history of each module that links it. Each module's own page-total (as that module shows it) is also returned, NON-ADDITIVE, with the reconciliation
 * that explains exactly why those three figures add to more than the household total.
 */
import type { TxnStatus } from '../../types';
import type { ResolvedRef, TxnLookup } from '../../lib/txnRef';
import { GROUP_LABEL, serviceGroup, type CountedPiece } from '../assets/spending';
import { householdSpend, type HouseholdInput, type HouseholdSpend, type Period } from '../services/householdSpend';
import { billsCostRecords, billsRecordedPayments, type BillCostRecord, type BillsRecordedPayments } from '../bills/billsSpend';
import { isEffective, type CycleRecord, type FactBody } from '../bills/cycleModel';
import { isLoanExcluded, TYPE_LABEL, type ObligationRecord } from '../bills/model';
import { slotStart, slotWords2 } from '../bills/schedule';
import { ATTRIBUTION_ORDER, HMOD_LABEL, HMOD_ORDER, hrefOfRecord, moduleOfRecord, type Attribution, type HMod, type ReviewClass } from './model';

export type { Period };

export interface AcrossInput {
  /** Household Services + Home & Assets, exactly as `householdSpend()` takes it. */
  household: HouseholdInput;
  obligations: ObligationRecord[];
  cycles: CycleRecord[];
  /** The live `bills-for` links (bill id to arrangement ids). Used only as evidence for a "possible duplicate" notice, never to change a total. */
  serviceLinks?: Map<number, number[]>;
}

export interface Association {
  module: HMod;
  recordId: string;
  /** The record's own title (a Bills period reads "Title, March 2026"). Never an amount. */
  title: string;
  href: string;
  /** `reference`: the record links this very piece. `covered-part`: it links a part of a transaction whose whole is counted, so the part is not added again. */
  via: 'reference' | 'covered-part';
}

/** One counted Finance piece, with everything that explains why it counts exactly once. */
export interface PieceTrace {
  key: string;
  txnId: number;
  /** The split part this piece stands for, or null for the whole transaction. */
  part: number | null;
  /** The LIVE spending in cents (positive = money out, negative = money back). */
  cents: number;
  date: string | null;
  /** Finance's own word for the transaction (owner-marked; NOT proof of bank settlement). */
  status: TxnStatus | null;
  /** The transaction changed in Finance since it was linked (the live amount is used). */
  changed: boolean;
  associations: Association[];
  modules: HMod[];
  attribution: Attribution;
  sharedAcrossModules: boolean;
  /** More than one record (in any module) reaches it. */
  multipleRecords: boolean;
  category: string;
  /** Plain words, no amounts: why this piece is in the total once. */
  why: string;
}

export interface TypedTrace {
  module: HMod;
  recordId: string;
  title: string;
  href: string;
  cents: number;
  /** True when the amount is in the total. False when it is kept and shown but set aside (a Finance payment covers the same job or period). */
  authoritative: boolean;
  date: string | null;
  category: string;
  note: string;
}

export interface UnionReview {
  id: string;
  class: ReviewClass;
  kind: 'shared-across' | 'shared-within' | 'whole-and-part' | 'stale' | 'changed' | 'typed-set-aside' | 'typed-differs' | 'possible-duplicate' | 'amount-unknown' | 'typed-disputed';
  /** Plain words. Never an amount (Hide Amounts has nothing to hide here). */
  text: string;
  records: { module: HMod; recordId: string; title: string; href: string }[];
  pieceKey?: string;
}

export interface RecordedAcrossModules {
  period: Period;
  /** Net recorded spending: Finance pieces (each once, refunds subtracted) plus authoritative typed amounts. May be negative when money back exceeds payments. */
  totalCents: number;
  financeCents: number;
  typedCents: number;
  /** Money out and money back among the counted Finance pieces (both positive numbers). financeCents = paidOutCents - moneyBackCents. */
  paidOutCents: number;
  moneyBackCents: number;
  /** ADDITIVE: adds to totalCents exactly. A piece reached by several modules is under `shared`. */
  byAttribution: Record<Attribution, number>;
  /** ADDITIVE: adds to totalCents exactly. */
  byCategory: { category: string; cents: number }[];
  /** NON-ADDITIVE: each module's own total as that module's page shows it. They add to MORE than totalCents when a payment is shared; `reconciliation` says why. */
  moduleOwnCents: Record<HMod, number>;
  pieces: PieceTrace[];
  typed: TypedTrace[];
  /** The counted pieces by Finance's own word. These are Finance's owner-maintained marks, never bank settlement. */
  statusCents: { pending: number; cleared: number; reconciled: number; other: number };
  review: UnionReview[];
  unknown: { homeWork: number; completedVisits: number; billsAmountUnknown: number; billsTypedDisputed: number };
  reconciliation: {
    /** The three module totals added together (what you get by adding the three module pages). */
    simpleSumCents: number;
    differenceCents: number;
    /** Services + Home & Assets: S5's own explanation of its difference. */
    withinServicesHomeCents: number;
    /** A payment Bills counts that Services or Home & Assets also count (counted once at household level). */
    alsoInBillsCents: number;
    /** A part one aggregate counts that a whole in the other covers. */
    coveredAcrossBillsCents: number;
    /** within + alsoInBills + coveredAcross = difference. */
    explainsDifference: boolean;
  };
  /** Every counted piece and authoritative typed amount adds up to the total. This is the reproducible check the screen shows. */
  proof: { piecesCents: number; typedCents: number; sumCents: number; reconciles: boolean };
  /** The figure is NOT presented as fully reconciled when this lists anything. Words only. */
  caveats: string[];
  reconciled: boolean;
  /** The existing readers' own results, kept so a caller can compare them. Nothing is recomputed from them. */
  parts: { household: HouseholdSpend; bills: BillsRecordedPayments };
}

const hasPeriod = (p?: Period) => !!p && (!!p.from || !!p.to);
const inP = (d: string | null | undefined, p?: Period) => !!d && (!p || ((!p.from || d >= p.from) && (!p.to || d <= p.to)));
type Eff = CycleRecord & { body: FactBody; obligationId: number; slot: string };
const dayDiff = (a: string, b: string) => Math.abs(Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000));
export const DUPLICATE_DAYS = 7;

interface TypedFact { oid: number; slot: string; paidOn: string; cents: number | null }

/** Every effective typed outside-Finance payment fact of a bill that counts (a bill that is not here, or that Loans owns, is left out, as `billsCostRecords` leaves it out). */
function typedFacts(obligations: ObligationRecord[], cycles: CycleRecord[]): TypedFact[] {
  const ok = new Set(obligations.filter((o) => !isLoanExcluded(o.data)).map((o) => o.id));
  const out: TypedFact[] = [];
  for (const c of cycles) {
    if (!isEffective(c)) continue;
    const e = c as Eff;
    if (e.obligationId === null || !ok.has(e.obligationId) || e.body.fact !== 'paid-outside') continue;
    out.push({ oid: e.obligationId, slot: e.slot, paidOn: e.body.paidOn, cents: e.body.cents });
  }
  return out;
}

/** The Bills record narrowed to a period, the same way S5 narrows its own: Finance references by the LIVE transaction day, a typed amount by its own date. */
function narrowBill(r: BillCostRecord, typed: Map<string, TypedFact[]>, lookup: TxnLookup, p?: Period): BillCostRecord | null {
  if (!hasPeriod(p)) return r;
  const slotDay = slotStart(r.slot);
  if (r.refs.length) {
    const kept = r.refs.filter((x) => inP(lookup(x.txnId)?.date || x.snapshot.date || slotDay, p));
    return kept.length ? { ...r, refs: kept, manualCents: null } : null;
  }
  const d = (typed.get(`${r.obligationId}|${r.slot}`) ?? []).filter((t) => t.cents !== null && t.cents > 0).map((t) => t.paidOn).sort()[0] ?? slotDay;
  return inP(d, p) ? r : null;
}

interface Acc { key: string; resolved: ResolvedRef; cents: number; assoc: Map<string, Association> }

export function recordedAcrossModules(input: AcrossInput, lookup: TxnLookup, period: Period = {}): RecordedAcrossModules {
  // ---- the two existing readers, unchanged ----
  const sh = householdSpend(input.household, lookup, period);
  const typedAll = typedFacts(input.obligations, input.cycles);
  const typedBy = new Map<string, TypedFact[]>();
  for (const t of typedAll) typedBy.set(`${t.oid}|${t.slot}`, [...(typedBy.get(`${t.oid}|${t.slot}`) ?? []), t]);
  const bAll = billsCostRecords(input.obligations, input.cycles);
  const bRecs = bAll.map((r) => narrowBill(r, typedBy, lookup, period)).filter((r): r is BillCostRecord => !!r);
  const bp = billsRecordedPayments(bRecs, lookup);
  const bById = new Map(bRecs.map((r) => [r.id, r]));
  const hh = input.household;
  const serviceById = new Map(hh.homeServices.map((s) => [s.id, s]));

  // ---- names and addresses of the records behind every claim ----
  const info = new Map<string, { title: string; href: string }>();
  for (const c of sh.claims) info.set(c.recordId, { title: c.title, href: hrefOfRecord(c.recordId, c.source.assetId) });
  for (const r of bRecs) info.set(r.id, { title: `${r.title}, ${slotWords2(r.slot)}`, href: hrefOfRecord(r.id) });
  const mk = (recordId: string, via: Association['via']): Association => ({ module: moduleOfRecord(recordId), recordId, title: info.get(recordId)?.title ?? recordId, href: info.get(recordId)?.href ?? hrefOfRecord(recordId), via });
  const byAssoc = (a: Association, b: Association) => HMOD_ORDER.indexOf(a.module) - HMOD_ORDER.indexOf(b.module) || a.recordId.localeCompare(b.recordId, 'en', { numeric: true }) || a.via.localeCompare(b.via);

  // ---- the merge: one entry per Finance piece, across both results ----
  const acc = new Map<string, Acc>();
  const take = (p: CountedPiece<string>) => {
    const a = acc.get(p.key) ?? { key: p.key, resolved: p.resolved, cents: p.spendCents, assoc: new Map<string, Association>() };
    acc.set(p.key, a);
    for (const id of p.recordIds) a.assoc.set(`${id}|reference`, mk(id, 'reference'));
  };
  sh.summary.pieces.forEach(take);
  bp.summary.pieces.forEach(take);
  const shKeys = new Set(sh.summary.pieces.map((p) => p.key));
  let alsoInBills = 0;
  for (const p of bp.summary.pieces) if (shKeys.has(p.key)) alsoInBills += p.spendCents;
  // a part covered by a whole INSIDE one reader keeps its association on that whole
  for (const s of [sh.summary, bp.summary]) {
    for (const it of s.coveredParts) acc.get(`${it.resolved.ref.txnId}:w`)?.assoc.set(`${it.recordId}|covered-part`, mk(it.recordId, 'covered-part'));
  }
  // a part one reader counts whose WHOLE the other counts is covered across the two (whole covers its parts everywhere)
  const wholeTxns = new Set([...acc.values()].filter((a) => a.resolved.ref.splitIndex === undefined).map((a) => a.resolved.ref.txnId));
  let coveredAcross = 0;
  for (const [k, a] of [...acc]) {
    if (a.resolved.ref.splitIndex === undefined || !wholeTxns.has(a.resolved.ref.txnId)) continue;
    const whole = acc.get(`${a.resolved.ref.txnId}:w`)!;
    for (const v of a.assoc.values()) whole.assoc.set(`${v.recordId}|covered-part`, { ...v, via: 'covered-part' });
    coveredAcross += a.cents;
    acc.delete(k);
  }

  // ---- categories (each is a label the owner already knows from the module) ----
  const categoryOf = (recordId: string): string => {
    const m = moduleOfRecord(recordId);
    if (m === 'bills') { const g = bById.get(recordId)?.group; return `Bills: ${g ? TYPE_LABEL[g] : 'Other'}`; }
    if (m === 'services') return 'Household Services';
    if (recordId.startsWith('service:')) { const s = serviceById.get(Number(recordId.slice(8))); return `Home & Assets: ${GROUP_LABEL[s ? serviceGroup(s.data.kind) : 'other']}`; }
    return `Home & Assets: ${GROUP_LABEL.acquisition}`;
  };
  const SHARED_CATEGORY = 'Shared between modules';

  const pieces: PieceTrace[] = [...acc.values()].map((a) => {
    const associations = [...a.assoc.values()].sort(byAssoc);
    const modules = HMOD_ORDER.filter((m) => associations.some((x) => x.module === m));
    const refs = associations.filter((x) => x.via === 'reference');
    const covered = associations.filter((x) => x.via === 'covered-part');
    const sharedAcrossModules = modules.length > 1;
    const attribution: Attribution = sharedAcrossModules ? 'shared' : modules[0];
    const why = [
      sharedAcrossModules
        ? `Counted once in the household total. It is linked from ${modules.map((m) => HMOD_LABEL[m]).join(' and ')}; the money is not divided between them.`
        : refs.length + covered.length > 1 ? `Counted once even though ${refs.length + covered.length} records in ${HMOD_LABEL[modules[0]]} link it.` : `Counted once: linked from one record in ${HMOD_LABEL[modules[0]]}.`,
      covered.length ? `The whole transaction counts; ${covered.length === 1 ? 'a linked part of it is' : `${covered.length} linked parts of it are`} covered by it and not added again.` : '',
    ].filter(Boolean).join(' ');
    return {
      key: a.key, txnId: a.resolved.ref.txnId, part: a.resolved.ref.splitIndex ?? null, cents: a.cents, date: a.resolved.txn?.date ?? null, status: a.resolved.txn?.status ?? null, changed: a.resolved.state === 'changed',
      associations, modules, attribution, sharedAcrossModules, multipleRecords: refs.length + covered.length > 1, category: sharedAcrossModules ? SHARED_CATEGORY : categoryOf((refs[0] ?? associations[0]).recordId), why,
    };
  }).sort((x, y) => x.txnId - y.txnId || (x.part ?? -1) - (y.part ?? -1));

  // ---- typed outside-Finance amounts, with those that are kept but set aside ----
  const typed: TypedTrace[] = [];
  const dateOfRecord = (recordId: string): string | null => {
    const [kind, a] = recordId.split(':');
    if (kind === 'visit') return hh.visits.find((v) => v.id === Number(a))?.data.date || null;
    if (kind === 'service') return serviceById.get(Number(a))?.data.date || null;
    if (kind === 'asset') return hh.assets.find((x) => x.id === Number(a))?.data.purchaseDate || null;
    return null;
  };
  for (const c of sh.claims) {
    if (c.kind !== 'typed') continue;
    const authoritative = c.status === 'included';
    typed.push({ module: c.module === 'services' ? 'services' : 'home', recordId: c.recordId, title: c.title, href: hrefOfRecord(c.recordId, c.source.assetId), cents: c.cents, authoritative, date: dateOfRecord(c.recordId), category: categoryOf(c.recordId), note: authoritative ? 'Entered by you as paid outside Finance. It is not checked against Finance.' : c.reason });
  }
  for (const r of bRecs) {
    if (r.refs.length === 0 && r.manualCents !== null) {
      const d = (typedBy.get(`${r.obligationId}|${r.slot}`) ?? []).filter((t) => t.cents !== null && t.cents > 0).map((t) => t.paidOn).sort()[0] ?? null;
      typed.push({ module: 'bills', recordId: r.id, title: info.get(r.id)!.title, href: hrefOfRecord(r.id), cents: r.manualCents, authoritative: true, date: d, category: categoryOf(r.id), note: 'Entered by you as paid outside Finance. It is not checked against Finance.' });
    } else if (r.refs.length > 0) {
      const set = (typedBy.get(`${r.obligationId}|${r.slot}`) ?? []).filter((t) => t.cents !== null && t.cents > 0 && (!hasPeriod(period) || inP(t.paidOn, period)));
      for (const t of set) typed.push({ module: 'bills', recordId: r.id, title: info.get(r.id)!.title, href: hrefOfRecord(r.id), cents: t.cents!, authoritative: false, date: t.paidOn, category: categoryOf(r.id), note: 'Kept as evidence but not counted: a Finance payment is linked for this billing period, so the Finance payment is the money source.' });
    }
  }
  typed.sort((x, y) => HMOD_ORDER.indexOf(x.module) - HMOD_ORDER.indexOf(y.module) || x.recordId.localeCompare(y.recordId, 'en', { numeric: true }) || x.cents - y.cents || Number(y.authoritative) - Number(x.authoritative));

  // ---- totals (each one a sum of the lists above, so every total can be reproduced) ----
  const financeCents = pieces.reduce((n, p) => n + p.cents, 0);
  const typedCents = typed.filter((t) => t.authoritative).reduce((n, t) => n + t.cents, 0);
  const totalCents = financeCents + typedCents;
  const byAttribution = Object.fromEntries(ATTRIBUTION_ORDER.map((a) => [a, 0])) as Record<Attribution, number>;
  for (const p of pieces) byAttribution[p.attribution] += p.cents;
  for (const t of typed) if (t.authoritative) byAttribution[t.module] += t.cents;
  const cat = new Map<string, number>();
  for (const p of pieces) cat.set(p.category, (cat.get(p.category) ?? 0) + p.cents);
  for (const t of typed) if (t.authoritative) cat.set(t.category, (cat.get(t.category) ?? 0) + t.cents);
  const byCategory = [...cat].map(([category, cents]) => ({ category, cents })).sort((a, b) => (a.category === SHARED_CATEGORY ? 1 : 0) - (b.category === SHARED_CATEGORY ? 1 : 0) || a.category.localeCompare(b.category));
  const statusCents = { pending: 0, cleared: 0, reconciled: 0, other: 0 };
  for (const p of pieces) statusCents[p.status === 'pending' || p.status === 'cleared' || p.status === 'reconciled' ? p.status : 'other'] += p.cents;
  const moduleOwnCents: Record<HMod, number> = { bills: bp.totalCents, services: sh.servicesCents, home: sh.homeCents };
  const simpleSumCents = moduleOwnCents.bills + moduleOwnCents.services + moduleOwnCents.home;

  // ---- unknown and disputed Bills payments (never turned into zero) ----
  const pk = new Map<string, TypedFact[]>();
  for (const t of typedAll) if (!hasPeriod(period) || inP(t.paidOn, period)) pk.set(`${t.oid}|${t.slot}`, [...(pk.get(`${t.oid}|${t.slot}`) ?? []), t]);
  const linkedPeriods = new Set(bAll.filter((r) => r.refs.length > 0).map((r) => `${r.obligationId}|${r.slot}`));
  const obTitle = new Map(input.obligations.map((o) => [o.id, o.data.title]));
  const billsReview: UnionReview[] = [];
  let billsAmountUnknown = 0, billsTypedDisputed = 0;
  for (const [k, facts] of [...pk].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
    if (linkedPeriods.has(k)) continue;
    const [oid, slot] = [Number(k.slice(0, k.indexOf('|'))), k.slice(k.indexOf('|') + 1)];
    const amounts = [...new Set(facts.flatMap((f) => (f.cents !== null && f.cents > 0 ? [f.cents] : [])))];
    const rec = { module: 'bills' as HMod, recordId: `bill:${oid}:${slot}`, title: `${obTitle.get(oid) ?? 'A bill'}, ${slotWords2(slot)}`, href: hrefOfRecord(`bill:${oid}`) };
    if (amounts.length > 1) { billsTypedDisputed++; billsReview.push({ id: `disputed:${k}`, class: 'missing-evidence', kind: 'typed-disputed', text: `${rec.title}: two different amounts were typed as paid outside Finance. Neither is counted until you choose one.`, records: [rec] }); }
    else if (amounts.length === 0 && facts.some((f) => f.cents === null)) { billsAmountUnknown++; billsReview.push({ id: `unknown:${k}`, class: 'missing-evidence', kind: 'amount-unknown', text: `${rec.title}: marked paid outside Finance with no amount. It is counted as unknown, not as nothing.`, records: [rec] }); }
  }

  // ---- review items: each says what KIND of thing it is (sharing is not a duplicate) ----
  const review: UnionReview[] = [];
  const asRec = (a: Association) => ({ module: a.module, recordId: a.recordId, title: a.title, href: a.href });
  for (const p of pieces) {
    const recs = p.associations.map(asRec);
    if (p.sharedAcrossModules) review.push({ id: `shared:${p.key}`, class: 'informational', kind: 'shared-across', text: `One payment is linked from ${p.modules.map((m) => HMOD_LABEL[m]).join(' and ')}. It is counted once in the household total and is not divided.`, records: recs, pieceKey: p.key });
    else if (p.multipleRecords && !p.associations.some((x) => x.via === 'covered-part')) review.push({ id: `shared:${p.key}`, class: 'informational', kind: 'shared-within', text: `One payment supports ${p.associations.length} records in ${HMOD_LABEL[p.modules[0]]}. It is counted once.`, records: recs, pieceKey: p.key });
    if (p.associations.some((x) => x.via === 'covered-part')) review.push({ id: `whole:${p.key}`, class: 'informational', kind: 'whole-and-part', text: 'A whole transaction and one of its parts are both linked. The whole counts once and the part is covered by it.', records: recs, pieceKey: p.key });
    if (p.changed) review.push({ id: `changed:${p.key}`, class: 'informational', kind: 'changed', text: 'A linked transaction changed in Finance since it was linked. The current Finance amount is the one counted.', records: recs, pieceKey: p.key });
  }
  const STALE: Record<string, string> = {
    missing: 'is not in Finance (deleted, or not on this device yet). It counts nothing until you pick the payment again.',
    'split-changed': 'points at a part of a split transaction that no longer matches what was linked. It counts nothing until you pick the part again.',
    'not-spending': 'is now a transfer or a setup entry, which is not spending. It counts nothing.',
  };
  const countedKeys = new Set(pieces.map((p) => p.key));
  const stale = [...sh.summary.review.map((r) => ({ recordId: r.recordId, resolved: r.resolved })), ...bp.summary.review.map((r) => ({ recordId: r.recordId, resolved: r.resolved }))];
  const staleSeen = new Set<string>();
  for (const s of stale.sort((a, b) => a.recordId.localeCompare(b.recordId, 'en', { numeric: true }) || a.resolved.key.localeCompare(b.resolved.key))) {
    const id = `stale:${s.recordId}:${s.resolved.key}`;
    if (staleSeen.has(id)) continue;
    staleSeen.add(id);
    const via = countedKeys.has(s.resolved.key) ? ' The same payment is counted through another record that still links it.' : '';
    review.push({ id, class: 'missing-evidence', kind: 'stale', text: `${mk(s.recordId, 'reference').title}: a linked payment ${STALE[s.resolved.state] ?? 'needs review.'}${via}`, records: [asRec(mk(s.recordId, 'reference'))], pieceKey: s.resolved.key });
  }
  for (const r of sh.review) {
    if (r.kind === 'typed-left-out') review.push({ id: `setaside:${r.recordIds.join(',')}`, class: 'confirmed-duplicate', kind: 'typed-set-aside', text: 'A typed amount on a visit or record you linked as one job is not added, because a Finance payment is linked on the same job.', records: r.recordIds.map((id) => asRec(mk(id, 'reference'))) });
    if (r.kind === 'typed-differs') review.push({ id: `differs:${r.recordIds.join(',')}`, class: 'confirmed-duplicate', kind: 'typed-differs', text: 'A visit and its linked Home & Assets record carry different typed amounts. Only the visit\'s amount is counted. Check both.', records: r.recordIds.map((id) => asRec(mk(id, 'reference'))) });
  }
  for (const t of typed) if (!t.authoritative && t.module === 'bills') review.push({ id: `setaside:${t.recordId}:${t.cents}`, class: 'possible-duplicate', kind: 'typed-set-aside', text: `${t.title}: a typed outside-Finance payment and a Finance payment are both recorded for this period. Only the Finance payment is counted.`, records: [{ module: t.module, recordId: t.recordId, title: t.title, href: t.href }] });
  review.push(...billsReview);

  // possible duplicates ACROSS modules: a typed amount in one module and a Finance payment in another with the same amount, close dates and an explicit relationship.
  // A hint only. It proves nothing and changes no total.
  const providerOf = (recordId: string): number | null => {
    const [kind, a] = recordId.split(':');
    if (kind === 'visit') return hh.visits.find((v) => v.id === Number(a))?.data.providerContactId ?? null;
    if (kind === 'arrangement') return hh.arrangements.find((x) => x.id === Number(a))?.data.providerContactId ?? null;
    if (kind === 'service') return serviceById.get(Number(a))?.data.providerContactId ?? null;
    if (kind === 'bill') return input.obligations.find((o) => o.id === Number(a))?.data.providerContactId ?? null;
    return null;
  };
  const arrangementOf = (recordId: string): number | null => {
    const [kind, a] = recordId.split(':');
    if (kind === 'visit') return hh.visits.find((v) => v.id === Number(a))?.data.arrangementId ?? null;
    if (kind === 'arrangement') return Number(a);
    return null;
  };
  const billOf = (recordId: string): number | null => (recordId.startsWith('bill:') ? Number(recordId.split(':')[1]) : null);
  const linked = (x: string, y: string): boolean => {
    for (const [a, b] of [[x, y], [y, x]]) { const bill = billOf(a), arr = arrangementOf(b); if (bill !== null && arr !== null && (input.serviceLinks?.get(bill) ?? []).includes(arr)) return true; }
    return false;
  };
  for (const t of typed) {
    if (!t.authoritative || t.date === null || t.cents <= 0) continue;
    for (const p of pieces) {
      if (p.date === null || p.cents !== t.cents || p.modules.includes(t.module) || dayDiff(p.date, t.date) > DUPLICATE_DAYS) continue;
      const refs = p.associations.filter((x) => x.via === 'reference');
      const sameProvider = providerOf(t.recordId) !== null && refs.some((x) => providerOf(x.recordId) === providerOf(t.recordId));
      const viaLink = refs.some((x) => linked(t.recordId, x.recordId));
      if (!sameProvider && !viaLink) continue;
      review.push({
        id: `maybe:${t.recordId}:${p.key}`, class: 'possible-duplicate', kind: 'possible-duplicate',
        text: `${t.title} (typed, ${HMOD_LABEL[t.module]}) and a Finance payment linked from ${p.modules.map((m) => HMOD_LABEL[m]).join(' and ')} have the same amount, dates within ${DUPLICATE_DAYS} days and ${sameProvider ? 'the same provider' : 'a "bills for" link'}. They may be the same payment. Both are counted until you decide.`,
        records: [{ module: t.module, recordId: t.recordId, title: t.title, href: t.href }, ...refs.map(asRec)], pieceKey: p.key,
      });
    }
  }
  review.sort((a, b) => a.class.localeCompare(b.class) || a.id.localeCompare(b.id, 'en', { numeric: true }));

  // ---- the figure is not called reconciled while something material is unresolved ----
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  const caveats: string[] = [];
  const nStale = review.filter((r) => r.kind === 'stale').length;
  const nMaybe = review.filter((r) => r.kind === 'possible-duplicate').length;
  if (nStale) caveats.push(`${n(nStale, 'linked payment needs', 'linked payments need')} review and count nothing until fixed`);
  if (nMaybe) caveats.push(`${n(nMaybe, 'payment may be', 'payments may be')} recorded twice (once typed, once from Finance); both are counted`);
  if (billsTypedDisputed) caveats.push(`${n(billsTypedDisputed, 'billing period has', 'billing periods have')} two different typed amounts; neither is counted`);
  if (billsAmountUnknown) caveats.push(`${n(billsAmountUnknown, 'payment was', 'payments were')} marked paid with no amount; ${billsAmountUnknown === 1 ? 'it is' : 'they are'} not in the total`);

  const piecesCents = financeCents;
  return {
    period, totalCents, financeCents, typedCents,
    paidOutCents: pieces.reduce((t, p) => t + (p.cents > 0 ? p.cents : 0), 0), moneyBackCents: pieces.reduce((t, p) => t + (p.cents < 0 ? -p.cents : 0), 0),
    byAttribution, byCategory, moduleOwnCents, pieces, typed, statusCents, review,
    unknown: { homeWork: sh.unknown.homeWork, completedVisits: sh.unknown.completedVisits, billsAmountUnknown, billsTypedDisputed },
    reconciliation: {
      simpleSumCents, differenceCents: simpleSumCents - totalCents, withinServicesHomeCents: sh.reconciliation.differenceCents, alsoInBillsCents: alsoInBills, coveredAcrossBillsCents: coveredAcross,
      explainsDifference: sh.reconciliation.differenceCents + alsoInBills + coveredAcross === simpleSumCents - totalCents,
    },
    proof: { piecesCents, typedCents, sumCents: piecesCents + typedCents, reconciles: piecesCents + typedCents === totalCents },
    caveats, reconciled: caveats.length === 0, parts: { household: sh, bills: bp },
  };
}
