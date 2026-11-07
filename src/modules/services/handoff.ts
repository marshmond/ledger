/**
 * "Record maintenance in Home & Assets" (S4): a COMPLETED Household Services visit becomes ONE service record on an asset, only when the owner
 * reviews the prefilled Home & Assets form and presses Save. Nothing is created before that.
 *
 *  - Ownership stays split. The visit remains the Services record. The asset's durable maintenance history is the Home & Assets service record.
 *    The two are NOT kept in step: a later edit to one never rewrites the other (`handoffDivergence` only SHOWS differences).
 *  - The shared link `visit:<id> -> assets:service:<id>` of type `recorded-as` is the handoff identity and the duplicate guard. The service record and
 *    the link are written in ONE transaction, so there is never a record without its link or a link without its record.
 *  - A visit can be recorded once per target asset. Two devices that each record it offline both succeed (no engine can stop that); both records are
 *    kept and `duplicateHandoffs` raises a review notice. Nothing is merged or removed.
 *  - Money: Finance references may be copied (the same payment, same `pieceKey`; never a new expense). A typed amount (`paidManualCents`) is NOT copied
 *    unless the owner ticks a separate, warned box; `saveHandoff` refuses an equal typed cost that arrives without that tick.
 *  - Never created from a skipped or cancelled visit, from a payment, from a provider name or from notes. Never writes to Finance or Projects.
 */
import { db, type FinanceDB } from '../../db';
import type { Link } from '../../core/entities';
import { createStore, isLive, repo } from '../../core/store';
import { getAsset } from '../assets/data';
import { getService, insertService } from '../assets/serviceData';
import { asService, parseServiceRef, serviceRefId, SERVICE_KIND, type ServiceData, type ServiceRecord } from '../assets/service';
import { newRefsProblem } from '../../lib/txnLookup';
import { pieceKey } from '../../lib/txnRef';
import { isSafeUrl, notesWarning } from './model';
import { getVisit, visitAssetIds } from './visits';
import { hasPaymentConflict, visitRef, type VisitRecord } from './visitModel';
import { linkedAssetIds } from './data';

export const RECORDED_AS = 'recorded-as';

/** Thrown when this visit was already recorded against this asset. `serviceId` lets the screen open the existing record. */
export class HandoffExistsError extends Error {
  constructor(public serviceId: number, public assetId: number) { super('This visit was already recorded in Home & Assets for that asset.'); this.name = 'HandoffExistsError'; }
}

const isRecordedAs = (l: Link, visitId: number) => l.type === RECORDED_AS && l.fromModule === 'services' && l.fromId === `visit:${visitId}` && l.toModule === 'assets' && parseServiceRef(l.toId) !== null;

export interface Handoff { linkId: number; serviceId: number; /** null: the service record was deleted or has not reached this device */ service: ServiceRecord | null }

/** Every `recorded-as` handoff of a visit: live links only, each with its service record (or null when that record is gone). */
export async function handoffsOfVisit(visitId: number, d: FinanceDB = db): Promise<Handoff[]> {
  const links = (await createStore(d).shared.links.linkedTo(visitRef(visitId))).filter((l) => isRecordedAs(l, visitId));
  const out: Handoff[] = [];
  for (const l of links) { const sid = parseServiceRef(l.toId)!; out.push({ linkId: l.id as number, serviceId: sid, service: (await getService(sid, d)) ?? null }); }
  return out.sort((a, b) => a.serviceId - b.serviceId);
}

/** The visits that were recorded as this service record (normally one). Links to a visit that is gone are skipped. */
export async function visitsOfServiceRecord(serviceId: number, d: FinanceDB = db): Promise<{ visitId: number; visit: VisitRecord | null }[]> {
  const links = (await createStore(d).shared.links.linkedTo({ module: 'assets', id: serviceRefId(serviceId) })).filter((l) => l.type === RECORDED_AS && l.fromModule === 'services' && l.toId === serviceRefId(serviceId));
  const out: { visitId: number; visit: VisitRecord | null }[] = [];
  for (const l of links) { const m = /^visit:(\d+)$/.exec(String(l.fromId)); if (m) out.push({ visitId: Number(m[1]), visit: (await getVisit(Number(m[1]), d)) ?? null }); }
  return out;
}

/** Live service records of a visit grouped by asset where more than one exists: the duplicate-handoff review condition. Pure. */
export function duplicateHandoffs(h: Handoff[]): { assetId: number; serviceIds: number[] }[] {
  const by = new Map<number, number[]>();
  for (const x of h) if (x.service) by.set(x.service.data.assetId, [...(by.get(x.service.data.assetId) ?? []), x.serviceId]);
  return [...by.entries()].filter(([, ids]) => ids.length > 1).map(([assetId, serviceIds]) => ({ assetId, serviceIds: serviceIds.sort((a, b) => a - b) }));
}

// ---- eligibility (pure) ----

export interface Eligibility { ok: boolean; reason: string | null }
/**
 * Only a visit whose outcome is `completed` can be offered. A skipped or cancelled visit is never maintenance, even when a fee was charged or paid.
 * (Which ASSET it concerns is separate: it is chosen by the owner, see `handoffTargets`.)
 */
export function handoffEligibility(v: VisitRecord): Eligibility {
  if (v.data.status === 'completed') return v.data.date ? { ok: true, reason: null } : { ok: false, reason: 'This visit has no readable date.' };
  if (v.data.status === 'unsupported') return { ok: false, reason: 'This visit has an outcome this version does not understand. Review it first.' };
  return { ok: false, reason: `Only a completed visit can be recorded as maintenance. This one was ${v.data.status}, and a fee or payment does not change that.` };
}

/** The assets the visit is already linked to (its own links), as the starting suggestions. Never guessed from names, notes or payments. */
export async function handoffTargets(visit: VisitRecord, d: FinanceDB = db): Promise<number[]> {
  const own = await visitAssetIds(visit.id, d);
  if (own.length) return own;
  return visit.data.arrangementId !== null ? linkedAssetIds(visit.data.arrangementId, d) : [];
}

// ---- the prefill ----

export interface Prefill {
  visitId: number;
  title: string;
  date: string;
  /** Always 'maintenance'. The visit has no kind and Ledger does not guess one: the owner may change it in the form. */
  kind: 'maintenance';
  providerContactId: number | null;
  notes: string;
  /** Why the notes were not copied, or null. */
  notesNote: string | null;
  refs: { label: string; url?: string; note?: string }[];
  txnRefs: ServiceData['txnRefs'];
  /** The typed amount on the visit, offered as an UNCHECKED, warned choice. null when there is none or the visit also has Finance links. */
  manualCents: number | null;
  /** The visit has both Finance links and a typed amount (an old or inconsistent record): references win, the typed amount is not offered. */
  paymentConflict: boolean;
}

/**
 * What the form starts with. Pure. Notes are copied only when they do not look like they hold a code, password or account number; document links are
 * copied only when they are safe web links that fit Home & Assets' own limits. Nothing is invented.
 */
export function buildPrefill(v: VisitRecord): Prefill {
  const warn = notesWarning(v.data.notes);
  const copyNotes = v.data.notes && !warn && v.data.notes.length <= 5000;
  const refs = v.data.refs.filter((r) => r.label.length <= 80 && (r.note?.length ?? 0) <= 200 && (!r.url || (r.url.length <= 500 && isSafeUrl(r.url))));
  const conflict = hasPaymentConflict(v.data);
  return {
    visitId: v.id, title: v.data.title.slice(0, 160), date: v.data.date, kind: 'maintenance', providerContactId: v.data.providerContactId,
    notes: copyNotes ? v.data.notes : '', notesNote: v.data.notes && !copyNotes ? 'The visit notes were not copied because they may hold a code, password or account number. Add what you need by hand.' : null,
    refs, txnRefs: v.data.txnRefs, manualCents: !conflict && v.data.paidManualCents !== null ? v.data.paidManualCents : null, paymentConflict: conflict,
  };
}

// ---- the save ----

export interface HandoffRequest {
  visitId: number;
  assetId: number;
  /** What the owner reviewed in the form. `assetId`, the Task fields and the Project are forced by this function. */
  data: ServiceData;
  today: string;
  /** The owner ticked "also copy the typed amount". Without it a cost equal to the visit's typed amount is refused. */
  confirmManualCopy?: boolean;
}
export interface HandoffResult { serviceId: number; linkId: number; visitId: number; assetId: number }

/**
 * Saves the Home & Assets service record AND the `recorded-as` link in ONE transaction. Re-reads the visit and the asset first and refuses (writing
 * nothing) when the visit is gone or no longer completed, the asset is gone or archived, or this visit was already recorded for this asset
 * (`HandoffExistsError`). Two overlapping calls: the second finds the first's link and stops. A failure in either write rolls both back.
 */
export async function saveHandoff(req: HandoffRequest, d: FinanceDB = db): Promise<HandoffResult> {
  // Finance references are validated against the live transactions first (read-only), exactly as Home & Assets does for its own saves.
  const refProblem = await newRefsProblem(req.data.txnRefs, [], d);
  return d.transaction('rw', d.moduleRecords, d.links, d.contacts, async () => {
    const visit = await getVisit(req.visitId, d);
    if (!visit) throw new Error('That visit no longer exists. Nothing was saved.');
    const elig = handoffEligibility(visit);
    if (!elig.ok) throw new Error(`${elig.reason} Nothing was saved.`);
    if (!(await getAsset(req.assetId, d))) throw new Error('That asset no longer exists. Nothing was saved.');
    if (visit.data.paidManualCents !== null && !hasPaymentConflict(visit.data) && req.data.costCents === visit.data.paidManualCents && req.data.txnRefs.length === 0 && !req.confirmManualCopy) {
      throw new Error('The typed amount from the visit was not confirmed for copying, so nothing was saved. Leave the cost blank, or tick the box that copies it.');
    }
    const existing = await handoffsOfVisit(visit.id, d);
    const same = existing.find((h) => h.service && h.service.data.assetId === req.assetId);
    if (same) throw new HandoffExistsError(same.serviceId, req.assetId);
    // A link to a service record that was DELETED (for this asset) is a dead handoff: it does not block, and it is removed so the visit shows one
    // state. A link to a record that is simply not on this device yet is left alone (the record may still arrive).
    const linkRepo = repo<Link>(d.links);
    for (const h of existing) {
      if (h.service) continue;
      const raw = await d.moduleRecords.get(h.serviceId);
      if (raw && raw.kind === SERVICE_KIND && !isLive(raw) && asService(raw).data.assetId === req.assetId) await linkRepo.remove(h.linkId);
    }
    const serviceId = await insertService({ ...req.data, assetId: req.assetId, taskId: null, taskTitleSnapshot: '', projectId: null }, d, req.today, refProblem);
    const linkId = await createStore(d).shared.links.add(visitRef(visit.id), { module: 'assets', id: serviceRefId(serviceId) }, RECORDED_AS);
    return { serviceId, linkId, visitId: visit.id, assetId: req.assetId };
  });
}

// ---- divergence (show, never sync) ----

/** Plain-words differences between a visit and the service record made from it. Pure. Empty when they agree on the things that matter. */
export function handoffDivergence(v: VisitRecord, s: ServiceRecord): string[] {
  const out: string[] = [];
  if (v.data.date && s.data.date && v.data.date !== s.data.date) out.push('The dates differ.');
  const a = new Set(v.data.txnRefs.map(pieceKey)), b = new Set(s.data.txnRefs.map(pieceKey));
  if (a.size !== b.size || [...a].some((k) => !b.has(k))) out.push('The linked Finance payments differ.');
  if (v.data.paidManualCents !== null && s.data.costCents !== null && s.data.txnRefs.length === 0 && v.data.txnRefs.length === 0 && v.data.paidManualCents !== s.data.costCents) out.push('The typed amounts differ.');
  return out;
}
