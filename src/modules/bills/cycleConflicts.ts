/**
 * CONFLICT AND REVIEW DETECTION for billing-period facts (B2, B0 N9). PURE. It reads and reports; it never writes and NEVER resolves anything.
 * Every owner repair is a separate, previewed, guarded action (cycleRepair.ts).
 *
 * COMPLEMENTARY evidence is not a conflict. An invoice, a due-date correction and a payment declaration for one period are three different
 * kinds of fact that legitimately coexist. Only contradictory evidence (two different amounts, two different dates, a skip beside a payment)
 * and look-alikes (the same thing recorded twice) are reported. Records that agree are reported as duplicates, flagged but never deleted.
 *
 * Reported kinds (severity in brackets):
 *   invoice-amount [disagree]   two effective invoices for one period with different amounts
 *   invoice-duplicate [duplicate] two effective invoices with the same amount
 *   due-date [disagree]         two different actual due dates among the period's invoices and due-date records
 *   skip-payment [disagree]     a skip and a payment record for the same period (the payment counts, the skip is ignored)
 *   paid-amount [disagree]      two different amounts typed as paid outside Finance
 *   duplicate-record [duplicate] two identical skips, declarations, due dates, typed payments or credits
 *   invoice-number [duplicate]  one document number on two different periods of the same bill
 *   earlier-schedule [review]   records in a period no schedule produces (left behind by a schedule change)
 *   moved-arrival [review]      a record that arrived at a period whose records were moved elsewhere (for example from another device)
 *   missing-obligation [review] records whose bill is not here
 *   unreadable [review]         a record this version cannot read (an unknown type, damaged fields): kept exactly as saved, counted for nothing
 */
import { dueDateOf, isEffective, type CycleRecord, type FactBody } from './cycleModel';
import { scheduleSource, type ObligationRecord } from './model';
import { slotWords2 } from './schedule';
import { scheduleProduces } from './slots';

export type ConflictKind = 'invoice-amount' | 'invoice-duplicate' | 'due-date' | 'skip-payment' | 'paid-amount' | 'duplicate-record' | 'invoice-number' | 'earlier-schedule' | 'moved-arrival' | 'missing-obligation' | 'unreadable';
export type Severity = 'disagree' | 'duplicate' | 'review';
export type Repair = 'use-one' | 'different-bills' | 'leave' | 'remove' | 'move';

export interface Conflict {
  /** Stable text key: the same problem in the same records always has the same key. */
  key: string;
  kind: ConflictKind;
  severity: Severity;
  obligationId: number | null;
  slot: string | null;
  /** The records involved (ids), oldest first. */
  ids: number[];
  /** The records that may be chosen by "Use this one" (empty when that repair is not available). */
  candidates: number[];
  repairs: Repair[];
  /** Plain words, never an amount. */
  text: string;
  /** `move`: where the other records of this period went, when exactly one place. */
  target: string | null;
  /** The owner chose "Leave as is" and none of the records has changed since. */
  acknowledged: boolean;
}

type Eff = CycleRecord & { body: FactBody; obligationId: number; slot: string };

/** What an acknowledgement is remembered as: the problem plus the exact state (ids and update times) of its records. A changed record is a new problem. */
export const ackKey = (kind: ConflictKind, obligationId: number | null, slot: string | null, recs: CycleRecord[]) =>
  `bc|${kind}|${obligationId ?? ''}|${slot ?? ''}|${[...recs].sort((a, b) => a.id - b.id).map((r) => `${r.id}.${r.updatedAt}`).join(',')}`;

const sortKeys = (o: object) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export function findConflicts(obligations: ObligationRecord[], cycles: CycleRecord[]): Conflict[] {
  const obById = new Map(obligations.map((o) => [o.id, o]));
  const out: Conflict[] = [];
  const add = (c: Omit<Conflict, 'key' | 'acknowledged' | 'candidates' | 'target'> & { recs: CycleRecord[]; candidates?: number[]; target?: string | null }) => {
    const { recs, ...rest } = c;
    const ob = c.obligationId === null ? undefined : obById.get(c.obligationId);
    const k = ackKey(c.kind, c.obligationId, c.slot, recs);
    out.push({ ...rest, candidates: c.candidates ?? [], target: c.target ?? null, key: k, ids: recs.map((r) => r.id).sort((a, b) => a - b), acknowledged: !!ob && ob.data.acknowledged.includes(k) });
  };

  // unreadable records (kept exactly as saved)
  for (const c of cycles) if (c.body === null) add({ kind: 'unreadable', severity: 'review', obligationId: c.obligationId, slot: c.slot, ids: [], recs: [c], repairs: [], text: c.problem ?? 'This record cannot be read by this version.' });

  const readable = cycles.filter(isEffective) as Eff[];
  const bySlot = new Map<string, Eff[]>();
  for (const f of readable) bySlot.set(`${f.obligationId}|${f.slot}`, [...(bySlot.get(`${f.obligationId}|${f.slot}`) ?? []), f]);

  // records whose bill is not here
  const orphans = new Map<number, Eff[]>();
  for (const f of readable) if (!obById.has(f.obligationId)) orphans.set(f.obligationId, [...(orphans.get(f.obligationId) ?? []), f]);
  for (const [oid, recs] of orphans) add({ kind: 'missing-obligation', severity: 'review', obligationId: oid, slot: null, ids: [], recs, repairs: ['remove'], text: `${recs.length} billing-period record${recs.length === 1 ? ' belongs' : 's belong'} to a bill that is not on this device (it may have been deleted on another device, or not synced yet). Nothing was deleted.` });

  // facts moved out of a period, per bill: where they went
  const movedOut = new Map<string, Set<string>>();
  for (const c of cycles) if (c.body !== null && c.movedFrom && c.obligationId !== null && c.slot) { const k = `${c.obligationId}|${c.movedFrom}`; movedOut.set(k, new Set([...(movedOut.get(k) ?? []), c.slot])); }

  for (const [key, facts] of bySlot) {
    const [oidStr, slot] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
    const oid = Number(oidStr);
    const ob = obById.get(oid);
    if (!ob) continue;
    const words = slotWords2(slot);
    const of = <F extends FactBody['fact']>(f: F) => facts.filter((x) => x.body.fact === f) as (Eff & { body: Extract<FactBody, { fact: F }> })[];

    // two invoices
    const inv = of('invoice');
    if (inv.length > 1) {
      const amounts = new Set(inv.map((i) => i.body.invoicedCents));
      add(amounts.size > 1
        ? { kind: 'invoice-amount', severity: 'disagree', obligationId: oid, slot, ids: [], recs: inv, candidates: inv.map((i) => i.id), repairs: ['use-one', 'different-bills', 'leave'], text: `Two bills with different amounts are recorded for ${words}. The amount owed is not known until you choose.` }
        : { kind: 'invoice-duplicate', severity: 'duplicate', obligationId: oid, slot, ids: [], recs: inv, candidates: inv.map((i) => i.id), repairs: ['use-one', 'different-bills', 'leave'], text: `The same bill looks to be recorded twice for ${words}. Nothing was deleted.` });
    }

    // different actual due dates
    const dated = facts.filter((f) => dueDateOf(f.body) !== null);
    if (new Set(dated.map((f) => dueDateOf(f.body))).size > 1) {
      // an invoice carries its own date, so only a plain due-date record can be set aside; choosing a due-date record is possible when everything else is also one
      const candidates = dated.filter((c) => dated.every((o) => o === c || dueDateOf(o.body) === dueDateOf(c.body) || o.body.fact === 'due-date')).map((c) => c.id);
      add({ kind: 'due-date', severity: 'disagree', obligationId: oid, slot, ids: [], recs: dated, candidates, repairs: candidates.length ? ['use-one', 'leave'] : ['leave'], text: `Different due dates are recorded for ${words}. Its timing reads "Due date unclear" until you choose${candidates.length ? '' : ' (edit the bill itself to change the date it carries)'}.` });
    }

    // a skip beside a payment
    const skips = of('skip');
    const pays = facts.filter((f) => f.body.fact === 'paid-outside' || f.body.fact === 'paid-in-full');
    if (skips.length && pays.length) add({ kind: 'skip-payment', severity: 'disagree', obligationId: oid, slot, ids: [], recs: [...skips, ...pays], candidates: pays.map((p) => p.id), repairs: ['use-one', 'leave'], text: `${words} is recorded as not billed and also as paid. The payment still counts; the skip is ignored until you choose.` });

    // two different typed paid amounts
    const typed = of('paid-outside').filter((p) => p.body.cents !== null && p.body.cents > 0);
    if (new Set(typed.map((p) => p.body.cents)).size > 1) add({ kind: 'paid-amount', severity: 'disagree', obligationId: oid, slot, ids: [], recs: typed, candidates: typed.map((p) => p.id), repairs: ['use-one', 'leave'], text: `Two different amounts are recorded as paid outside Finance for ${words}. Neither is counted until you choose.` });

    // identical records, recorded twice (look-alikes: flagged, never deleted)
    for (const f of ['skip', 'paid-in-full', 'paid-outside', 'due-date', 'credit'] as const) {
      const list = of(f);
      const groups = new Map<string, typeof list>();
      for (const r of list) { const k = JSON.stringify(sortKeys(f === 'credit' ? { ...r.body, note: (r.body as { note: string }).note.trim().toLowerCase() } : r.body)); groups.set(k, [...(groups.get(k) ?? []), r]); }
      for (const g of groups.values()) if (g.length > 1) add({ kind: 'duplicate-record', severity: 'duplicate', obligationId: oid, slot, ids: [], recs: g, candidates: g.map((r) => r.id), repairs: ['use-one', 'leave'], text: `The same "${f === 'skip' ? 'not billed' : f === 'paid-in-full' ? 'paid in full' : f === 'paid-outside' ? 'paid outside Finance' : f === 'due-date' ? 'due date' : 'credit'}" record appears twice for ${words}. It is counted once. Nothing was deleted.` });
    }

    // a period no schedule produces
    if (!slot.startsWith('x') && scheduleProduces(scheduleSource(ob.data), slot) === null) {
      add({ kind: 'earlier-schedule', severity: 'review', obligationId: oid, slot, ids: [], recs: facts, repairs: ['move', 'leave'], text: `${words} has records, but no schedule of this bill produces that period any more (the schedule changed). The records are kept and still count; they are not shown as an expected bill. You can move them to a current period.` });
    }

    // a record that arrived at a period whose records were moved elsewhere
    const targets = movedOut.get(`${oid}|${slot}`);
    if (targets) {
      const arrivals = facts.filter((f) => f.movedFrom !== slot);
      if (arrivals.length) add({ kind: 'moved-arrival', severity: 'review', obligationId: oid, slot, ids: [], recs: arrivals, repairs: targets.size === 1 ? ['move', 'leave'] : ['leave'], target: targets.size === 1 ? [...targets][0] : null, text: `${arrivals.length} record${arrivals.length === 1 ? ' was' : 's were'} added to ${words} after the records of that period were moved to another period (perhaps from another device). They have not been moved or merged; look and choose.` });
    }
  }

  // one document number on two different periods
  const byNumber = new Map<string, Eff[]>();
  for (const f of readable) if (f.body.fact === 'invoice' && f.body.invoiceNumber.trim() && obById.has(f.obligationId)) { const k = `${f.obligationId}|${f.body.invoiceNumber.trim().toLowerCase()}`; byNumber.set(k, [...(byNumber.get(k) ?? []), f]); }
  for (const g of byNumber.values()) if (new Set(g.map((f) => f.slot)).size > 1) add({ kind: 'invoice-number', severity: 'duplicate', obligationId: g[0].obligationId, slot: null, ids: [], recs: g, candidates: g.map((f) => f.id), repairs: ['use-one', 'leave'], text: 'One document number is recorded on more than one billing period of the same bill. It may be the same bill entered twice.' });

  // look-alike EXTRA bills: the same amount and the same bill date on different periods, at least one of them an extra bill (flagged, never rejected)
  const byLook = new Map<string, Eff[]>();
  for (const f of readable) if (f.body.fact === 'invoice' && f.body.invoiceDate && obById.has(f.obligationId)) { const k = `${f.obligationId}|${f.body.invoicedCents}|${f.body.invoiceDate}`; byLook.set(k, [...(byLook.get(k) ?? []), f]); }
  for (const g of byLook.values()) {
    const slots = new Set(g.map((f) => f.slot));
    const numbered = g.length > 0 && g.every((f) => (f.body as { invoiceNumber: string }).invoiceNumber.trim() !== '') && new Set(g.map((f) => (f.body as { invoiceNumber: string }).invoiceNumber.trim().toLowerCase())).size === g.length;
    if (slots.size > 1 && g.some((f) => f.slot.startsWith('x')) && !numbered) add({ kind: 'invoice-number', severity: 'duplicate', obligationId: g[0].obligationId, slot: null, ids: [], recs: g, candidates: g.map((f) => f.id), repairs: ['use-one', 'leave'], text: 'Two extra bills have the same amount and the same bill date. They may be the same bill entered twice. Nothing was rejected or deleted.' });
  }

  return out.sort((a, b) => (a.obligationId ?? 0) - (b.obligationId ?? 0) || (a.slot ?? '').localeCompare(b.slot ?? '') || a.kind.localeCompare(b.kind));
}
