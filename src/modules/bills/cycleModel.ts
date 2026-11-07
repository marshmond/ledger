/**
 * Billing-period FACT records (B2). Each `cycle` record in the shared `moduleRecords` table (module 'bills', kind 'cycle') is ONE fact about ONE
 * billing period of ONE obligation. Facts are added, never merged, so two devices that each record something about the same period add two
 * separate records and neither overwrites the other (B0 3.4, 10.4). Sync, backup and restore already carry them.
 *
 *   obligationId  the bill this is about (a whole number)
 *   slot          the period's immutable identity (`m2026-12`, `s2026-12a`, `w2026-12-07`, `x<id>`), see schedule.ts. NEVER a date.
 *   fact          invoice | due-date | paid-outside | paid-in-full | skip | credit
 *   op            an id made when a form was opened, so a double press saves once
 *   supersededBy  the id of the record that replaced this one after an owner repair. A superseded fact stays visible as history and is
 *                 excluded from every figure.
 *   movedFrom     the slot the fact was moved out of by the explicit "Move to another billing period" action
 *
 * READING IS DEFENSIVE AND LOSSLESS. `readCycle` never throws and never invents. A record whose fact type this version does not know, or
 * whose fields are damaged, comes back with `body: null` and a plain reason: it is shown as "needs review", counts for nothing, hides no
 * expected bill, and is never rewritten by this module. Fields this version does not know at all are carried through every edit.
 *
 * MONEY: whole cents. `invoicedCents: 0` is a CONFIRMED zero-dollar bill; a missing amount is never zero. A `paid-outside` with no amount is a
 * declaration only and never creates a monetary amount. A credit lowers what is owed and is never a payment. No Finance data is read here.
 */
import type { ModuleRecord } from '../../core/entities';
import { MODULE } from './model';
import { parseSlot, type ParsedSlot } from './schedule';
import { isCents, isDate, isInt, str, tidy } from './util';

export const CYCLE_KIND = 'cycle';
export const cycleRefId = (id: number) => `cycle:${id}`;

export const FACTS = ['invoice', 'due-date', 'paid-outside', 'paid-in-full', 'skip', 'credit'] as const;
export type FactType = (typeof FACTS)[number];
export const FACT_LABEL: Record<FactType, string> = {
  invoice: 'Bill (invoice)', 'due-date': 'Due date', 'paid-outside': 'Paid outside Finance', 'paid-in-full': 'Marked paid in full', skip: 'Not billed (skipped)', credit: 'Provider credit',
};

export type FactBody =
  | { fact: 'invoice'; invoicedCents: number; invoiceDate: string | null; dueDate: string | null; invoiceNumber: string; nominal: string | null }
  | { fact: 'due-date'; dueDate: string }
  | { fact: 'paid-outside'; paidOn: string; cents: number | null }
  | { fact: 'paid-in-full'; on: string | null }
  | { fact: 'skip'; reason: string }
  | { fact: 'credit'; cents: number; note: string };

/** A fact record as read. `body` is null when this version cannot read it (then `problem` says why). */
export interface CycleRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  obligationId: number | null;
  slot: string | null;
  parsed: ParsedSlot | null;
  /** The raw `fact` name as stored (shown for an unreadable one). */
  factName: string;
  body: FactBody | null;
  op: string | null;
  supersededBy: number | null;
  movedFrom: string | null;
  problem: string | null;
  /** Everything stored, exactly as found (unknown fields included): what an ordinary write keeps. */
  raw: Record<string, unknown>;
}

const KNOWN = new Set(['obligationId', 'slot', 'fact', 'op', 'supersededBy', 'movedFrom', 'invoicedCents', 'invoiceDate', 'dueDate', 'invoiceNumber', 'nominal', 'paidOn', 'cents', 'on', 'reason', 'note']);
const present = (v: unknown) => v !== undefined && v !== null;
const optDate = (v: unknown): string | null | 'bad' => (!present(v) ? null : isDate(v) ? v : 'bad');

/** Reads one stored fact record. Never throws. */
export function readCycle(r: ModuleRecord): CycleRecord {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const base = { id: r.id as number, createdAt: r.createdAt, updatedAt: r.updatedAt, raw: d, factName: typeof d.fact === 'string' ? d.fact : '' };
  const fail = (problem: string, extra: Partial<CycleRecord> = {}): CycleRecord => ({
    ...base, obligationId: isInt(d.obligationId) && d.obligationId > 0 ? d.obligationId : null, slot: typeof d.slot === 'string' ? d.slot : null, parsed: parseSlot(d.slot),
    body: null, op: typeof d.op === 'string' ? d.op : null, supersededBy: null, movedFrom: null, problem, ...extra,
  });
  if (!isInt(d.obligationId) || d.obligationId <= 0) return fail('It does not say which bill it belongs to.');
  const parsed = parseSlot(d.slot);
  if (!parsed) return fail('Its billing period is not one this version understands.');
  if (present(d.supersededBy) && !(isInt(d.supersededBy) && d.supersededBy > 0)) return fail('A repair mark on it cannot be read.');
  if (present(d.movedFrom) && !parseSlot(d.movedFrom)) return fail('A move mark on it cannot be read.');
  if (present(d.op) && typeof d.op !== 'string') return fail('An internal mark on it cannot be read.');
  const common = {
    ...base, obligationId: d.obligationId, slot: d.slot as string, parsed, op: typeof d.op === 'string' ? d.op : null,
    supersededBy: present(d.supersededBy) ? (d.supersededBy as number) : null, movedFrom: present(d.movedFrom) ? (d.movedFrom as string) : null, problem: null,
  };
  const ok = (body: FactBody): CycleRecord => ({ ...common, body });
  const bad = (what: string) => fail(`${what} cannot be read, so this record is not counted.`);
  switch (d.fact) {
    case 'invoice': {
      if (!isCents(d.invoicedCents)) return bad('The billed amount');
      const invoiceDate = optDate(d.invoiceDate), dueDate = optDate(d.dueDate), nominal = optDate(d.nominal);
      if (invoiceDate === 'bad' || dueDate === 'bad' || nominal === 'bad') return bad('A date');
      if (present(d.invoiceNumber) && typeof d.invoiceNumber !== 'string') return bad('The document number');
      return ok({ fact: 'invoice', invoicedCents: d.invoicedCents, invoiceDate, dueDate, invoiceNumber: str(d.invoiceNumber), nominal });
    }
    case 'due-date':
      return isDate(d.dueDate) ? ok({ fact: 'due-date', dueDate: d.dueDate }) : bad('The due date');
    case 'paid-outside': {
      if (!isDate(d.paidOn)) return bad('The payment date');
      if (present(d.cents) && !isCents(d.cents)) return bad('The paid amount');
      return ok({ fact: 'paid-outside', paidOn: d.paidOn, cents: present(d.cents) ? (d.cents as number) : null });
    }
    case 'paid-in-full': {
      const on = optDate(d.on);
      return on === 'bad' ? bad('The date') : ok({ fact: 'paid-in-full', on });
    }
    case 'skip':
      return present(d.reason) && typeof d.reason !== 'string' ? bad('The reason') : ok({ fact: 'skip', reason: str(d.reason) });
    case 'credit':
      if (!isCents(d.cents)) return bad('The credit amount');
      if (present(d.note) && typeof d.note !== 'string') return bad('The note');
      return ok({ fact: 'credit', cents: d.cents, note: str(d.note) });
    default:
      return fail(typeof d.fact === 'string' && d.fact ? `Its type ("${d.fact}") is not one this version of Ledger understands. It is kept exactly as saved.` : 'Its type is missing.');
  }
}

/** True when this record counts: readable and not superseded. */
export const isEffective = (c: CycleRecord): c is CycleRecord & { body: FactBody; obligationId: number; slot: string } => c.body !== null && c.supersededBy === null;
export const isReadable = (c: CycleRecord): c is CycleRecord & { body: FactBody; obligationId: number; slot: string } => c.body !== null;

/** The due date a fact carries, if any. */
export const dueDateOf = (b: FactBody): string | null => (b.fact === 'invoice' ? b.dueDate : b.fact === 'due-date' ? b.dueDate : null);

/** The stored form of a body (what the form wrote), merged over the unknown fields already on the record. */
export function bodyFields(b: FactBody): Record<string, unknown> {
  switch (b.fact) {
    case 'invoice': return { fact: 'invoice', invoicedCents: b.invoicedCents, ...(b.invoiceDate ? { invoiceDate: b.invoiceDate } : {}), ...(b.dueDate ? { dueDate: b.dueDate } : {}), ...(b.invoiceNumber ? { invoiceNumber: b.invoiceNumber } : {}), ...(b.nominal ? { nominal: b.nominal } : {}) };
    case 'due-date': return { fact: 'due-date', dueDate: b.dueDate };
    case 'paid-outside': return { fact: 'paid-outside', paidOn: b.paidOn, ...(b.cents !== null ? { cents: b.cents } : {}) };
    case 'paid-in-full': return { fact: 'paid-in-full', ...(b.on ? { on: b.on } : {}) };
    case 'skip': return { fact: 'skip', ...(b.reason ? { reason: b.reason } : {}) };
    case 'credit': return { fact: 'credit', cents: b.cents, ...(b.note ? { note: b.note } : {}) };
  }
}

/** The whole row data to store for a record: unknown fields kept exactly, the known ones from `next`. */
export function storedCycle(c: { raw: Record<string, unknown>; obligationId: number; slot: string; op: string | null; supersededBy: number | null; movedFrom: string | null }, body: FactBody): Record<string, unknown> {
  const unknown = Object.fromEntries(Object.entries(c.raw).filter(([k, v]) => !KNOWN.has(k) && v !== undefined));
  return {
    ...unknown, obligationId: c.obligationId, slot: c.slot, ...bodyFields(body),
    ...(c.op ? { op: c.op } : {}), ...(c.supersededBy !== null ? { supersededBy: c.supersededBy } : {}), ...(c.movedFrom ? { movedFrom: c.movedFrom } : {}),
  };
}

/** Owner-typed text, cleaned and bounded. */
export const cleanText = (s: string, max: number) => tidy(s).slice(0, max);

/** A plain-words problem with a body about to be saved, or null. Strict. */
export function validateBody(b: FactBody): string | null {
  switch (b.fact) {
    case 'invoice':
      if (!isCents(b.invoicedCents)) return 'The billed amount is not valid. Use whole cents; $0.00 is allowed when the bill really is zero.';
      if ((b.invoiceDate && !isDate(b.invoiceDate)) || (b.dueDate && !isDate(b.dueDate))) return 'A date is not a real date.';
      if (b.invoiceDate && b.dueDate && b.dueDate < b.invoiceDate) return 'The due date is before the bill date.';
      if (b.invoiceNumber.length > 40) return 'The document number is too long (at most 40 characters). Do not enter an account number.';
      return null;
    case 'due-date': return isDate(b.dueDate) ? null : 'Pick a real due date.';
    case 'paid-outside':
      if (!isDate(b.paidOn)) return 'Pick the date it was paid.';
      if (b.cents !== null && (!isCents(b.cents) || b.cents <= 0)) return 'Enter an amount above $0.00, or leave it empty if you do not know it.';
      return null;
    case 'paid-in-full': return b.on && !isDate(b.on) ? 'The date is not a real date.' : null;
    case 'skip': return b.reason.length > 200 ? 'The reason is too long.' : null;
    case 'credit':
      if (!isCents(b.cents) || b.cents <= 0) return 'Enter the credit amount, above $0.00.';
      return b.note.length > 200 ? 'The note is too long.' : null;
  }
}

/** A short plain-words line for one fact, never with an amount unless `money` is given. Used in lists. */
export function factWords(b: FactBody, money: (c: number) => string): string {
  switch (b.fact) {
    case 'invoice': return `Billed ${money(b.invoicedCents)}${b.dueDate ? `, due ${b.dueDate}` : ''}${b.invoiceDate ? `, dated ${b.invoiceDate}` : ''}${b.invoiceNumber ? `, document ${b.invoiceNumber}` : ''}`;
    case 'due-date': return `Due ${b.dueDate}`;
    case 'paid-outside': return `Paid outside Finance on ${b.paidOn}${b.cents !== null ? `, ${money(b.cents)}` : ', amount not recorded'}`;
    case 'paid-in-full': return `Marked paid in full${b.on ? ` on ${b.on}` : ''}, no amount recorded`;
    case 'skip': return `Not billed this period${b.reason ? ` (${b.reason})` : ''}`;
    case 'credit': return `Credit ${money(b.cents)}${b.note ? ` (${b.note})` : ''}`;
  }
}

export { MODULE };
