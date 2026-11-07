/**
 * EXPLICIT REPAIRS of conflicting or look-alike billing records (B2, B0 N10), and the controlled "Move to another billing period".
 *
 * Nothing here runs by itself and nothing destroys information:
 *   Use this one      the other records get `supersededBy`: they stay visible as history and drop out of every figure
 *   Different bills   the chosen invoice moves to a NEW extra period (`x<id>`), keeping `movedFrom`; nothing is merged
 *   Leave as is       only remembers (on the bill) that you looked; the records, the figures and the warning on the period do not change
 *   Remove            only for records whose bill is not here, and only ones this version can read; a soft delete
 * Every repair is previewed in words first, re-reads and re-detects the conflict inside the transaction (a stale preview is refused, writing
 * nothing), writes everything atomically and returns the guarded Undo that refuses if any touched record changed since.
 *
 * A payment record is never hidden by a repair: a skip that disagrees with a payment can only be set aside, never the payment.
 */
import { db, type FinanceDB } from '../../db';
import { isLive } from '../../core/store';
import { localISO } from '../../core/time';
import { formatCents } from '../../lib/money';
import { findConflicts, type Conflict } from './cycleConflicts';
import { CYCLE_KIND, factWords, isReadable, storedCycle, type CycleRecord } from './cycleModel';
import { loadCycles, rows, cycleTables } from './cycleData';
import { asObligation, KIND, MODULE, applyEdit, scheduleSource, toStored, type ObligationRecord } from './model';
import { parseSlot, slotWords2 } from './schedule';
import { scheduleProduces, extraSlot } from './slots';
import { ensureBillTasksIn, loadBillTasks, markersOf, taskAckKey } from './tasks';
import { Recorder, type Undo } from './undo';
import { newId } from '../../lib/sync/track';

export const STALE_REPAIR = 'These records changed since you looked (maybe on another device), so nothing was changed. Close this and look again.';

export type RepairChoice =
  | { kind: 'use-one'; keepId: number }
  | { kind: 'different-bills'; moveId: number }
  | { kind: 'leave' }
  | { kind: 'remove' };
export const REPAIR_LABEL: Record<RepairChoice['kind'], string> = { 'use-one': 'Use this one', 'different-bills': 'These are different bills', leave: 'Leave as is', remove: 'Remove these records' };

async function loadObligationRows(d: FinanceDB): Promise<ObligationRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, KIND]).toArray()).filter(isLive).map(asObligation);
}

/** Which records a choice would set aside (`supersede`), move, or remove. Pure over the conflict and its records. */
export function repairEffect(c: Conflict, choice: RepairChoice, byId: Map<number, CycleRecord>): { problem: string | null; supersede: number[]; move: number[]; remove: number[]; acknowledge: boolean } {
  const none = { supersede: [] as number[], move: [] as number[], remove: [] as number[], acknowledge: false };
  if (!c.repairs.includes(choice.kind)) return { problem: 'That choice is not available for this.', ...none };
  const facts = c.ids.map((i) => byId.get(i)).filter((x): x is CycleRecord => !!x && isReadable(x));
  if (choice.kind === 'leave') return { problem: c.obligationId === null ? 'There is no bill to remember this on.' : null, ...none, acknowledge: true };
  if (choice.kind === 'remove') return { problem: facts.length === 0 ? 'Nothing to remove.' : null, ...none, remove: facts.map((f) => f.id) };
  if (choice.kind === 'different-bills') {
    if (!c.candidates.includes(choice.moveId)) return { problem: 'Pick one of the bills to move.', ...none };
    return { problem: null, ...none, move: [choice.moveId] };
  }
  if (!c.candidates.includes(choice.keepId)) return { problem: 'Pick one of the records to keep.', ...none };
  const keep = byId.get(choice.keepId);
  if (!keep || !isReadable(keep)) return { problem: 'That record is not available.', ...none };
  let set: CycleRecord[];
  if (c.kind === 'skip-payment') set = facts.filter((f) => f.body!.fact === 'skip');
  else if (c.kind === 'due-date') { const keepDate = (keep.body as { dueDate?: string | null }).dueDate; set = facts.filter((f) => f.id !== keep.id && (f.body as { dueDate?: string | null }).dueDate !== keepDate); }
  else set = facts.filter((f) => f.id !== keep.id);
  return { problem: set.length === 0 ? 'There is nothing to set aside.' : null, ...none, supersede: set.map((f) => f.id) };
}

export interface RepairPlan { conflict: Conflict | null; problem: string | null; lines: string[] }

/** One record in words, with what makes it different from its look-alike (amounts are plain dollars here; the dialog masks them when Hide Amounts is on). */
const describeFact = (f: CycleRecord) => (f.body ? `"${factWords(f.body, formatCents)}" (recorded ${localISO(f.createdAt)})` : 'an unreadable record');

/** The preview. Reads only. */
export async function planRepair(key: string, choice: RepairChoice, d: FinanceDB = db): Promise<RepairPlan> {
  const [obs, cycles] = await Promise.all([loadObligationRows(d), loadCycles(d)]);
  const c = findConflicts(obs, cycles).find((x) => x.key === key) ?? null;
  if (!c) return { conflict: null, problem: 'This has already changed or been dealt with. Close this and look again.', lines: [] };
  const byId = new Map(cycles.map((x) => [x.id, x]));
  const e = repairEffect(c, choice, byId);
  if (e.problem) return { conflict: c, problem: e.problem, lines: [] };
  const lines: string[] = [];
  const words = c.slot ? slotWords2(c.slot) : 'this bill';
  if (choice.kind === 'use-one') {
    lines.push(`Keep ${describeFact(byId.get(choice.keepId)!)} for ${words}.`);
    for (const id of e.supersede) lines.push(`Set aside ${describeFact(byId.get(id)!)}. It stays visible under History, and is left out of every figure.`);
  } else if (choice.kind === 'different-bills') {
    lines.push(`Treat ${describeFact(byId.get(choice.moveId)!)} as a separate extra bill, not part of ${words}.`);
    lines.push('It moves to its own new extra period. The other record stays where it is. Nothing is merged or deleted, and the amounts and dates on both stay as they are.');
  } else if (choice.kind === 'leave') {
    lines.push('Remember that you looked at this and want to leave the records as they are.');
    lines.push('Nothing is changed or hidden. The period keeps showing that its records disagree, and the amounts stay unknown until you choose.');
  } else {
    lines.push(`Remove ${e.remove.length} record${e.remove.length === 1 ? '' : 's'} that belong to a bill that is not on this device. You can undo this.`);
  }
  lines.push('Nothing in Finance is read or changed.');
  return { conflict: c, problem: null, lines };
}

/** Applies a repair in one transaction. Refused (nothing written) if the conflict is no longer exactly what was previewed. */
export function applyRepair(input: { key: string; choice: RepairChoice; today: string }, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', ...cycleTables(d), async () => {
    const [obs, cycles] = await Promise.all([loadObligationRows(d), loadCycles(d)]);
    const c = findConflicts(obs, cycles).find((x) => x.key === input.key);
    if (!c) throw new Error(STALE_REPAIR);
    const byId = new Map(cycles.map((x) => [x.id, x]));
    const e = repairEffect(c, input.choice, byId);
    if (e.problem) throw new Error(e.problem);
    const rec = new Recorder();
    for (const id of e.supersede) {
      const f = byId.get(id)!;
      await rec.capture(id, d);
      await rows(d).put({ id, module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: f.raw, obligationId: f.obligationId!, slot: f.slot!, op: f.op, supersededBy: (input.choice as { keepId: number }).keepId, movedFrom: f.movedFrom }, f.body!) });
    }
    for (const id of e.move) {
      const f = byId.get(id)!;
      await rec.capture(id, d);
      // a SEPARATION is not a period move: the old period keeps its other records, so it is remembered as `separatedFrom` (an extra field this version preserves), not `movedFrom`
      await rows(d).put({ id, module: MODULE, kind: CYCLE_KIND, data: { ...storedCycle({ raw: f.raw, obligationId: f.obligationId!, slot: extraSlot(newId()), op: f.op, supersededBy: f.supersededBy, movedFrom: f.movedFrom }, f.body!), separatedFrom: f.slot } });
    }
    for (const id of e.remove) { await rec.capture(id, d); await rows(d).remove(id); }
    if (e.acknowledge && c.obligationId !== null) {
      const ob = obs.find((o) => o.id === c.obligationId)!;
      await rec.capture(ob.id, d);
      const ack = [...ob.data.acknowledged.filter((k) => k !== c.key), c.key].slice(-200);
      await rows(d).put({ id: ob.id, module: MODULE, kind: KIND, data: toStored(applyEdit(ob.data, { acknowledged: ack })) });
    }
    const touched = new Set<number>([...e.supersede, ...e.move, ...e.remove].map((id) => byId.get(id)?.obligationId).filter((x): x is number => typeof x === 'number'));
    for (const oid of touched) await ensureBillTasksIn(oid, input.today, d, rec);
    return { undo: await rec.seal(d) };
  });
}

/** "Leave as is" for a reminder Task that was finished while its period has no payment record: only remembers that you looked. The Task and the period are untouched. */
export function leaveTaskAsIs(obligationId: number, taskId: number, expectObligationUpdatedAt: number, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', ...cycleTables(d), async () => {
    const ob = (await loadObligationRows(d)).find((o) => o.id === obligationId);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    if (ob.updatedAt !== expectObligationUpdatedAt) throw new Error(STALE_REPAIR);
    const t = (await loadBillTasks(d)).find((k) => k.id === taskId);
    if (!t || markersOf(t)?.obligation !== obligationId) throw new Error('That Task is no longer there. Nothing was changed.');
    const rec = new Recorder();
    await rec.capture(obligationId, d);
    await rows(d).put({ id: obligationId, module: MODULE, kind: KIND, data: toStored(applyEdit(ob.data, { acknowledged: [...ob.data.acknowledged.filter((k) => k !== taskAckKey(t)), taskAckKey(t)].slice(-200) })) });
    return { undo: await rec.seal(d) };
  });
}

// ---- Move to another billing period (B0 N1) ----

export interface MovePlan {
  problem: string | null;
  lines: string[];
  from: string;
  to: string;
  /** Every record that moves (all records of the source period, superseded ones included), and every record already at the target. */
  moving: CycleRecord[];
  expect: { id: number; updatedAt: number }[];
}

const snap = (xs: CycleRecord[]) => xs.map((x) => ({ id: x.id, updatedAt: x.updatedAt })).sort((a, b) => a.id - b.id);

/** Pure: can the records of `from` move to `to`? */
export function moveProblem(ob: ObligationRecord, from: string, to: string, at: { source: CycleRecord[]; target: CycleRecord[] }): string | null {
  if (!parseSlot(from) || !parseSlot(to)) return 'That is not a billing period this version understands.';
  if (from === to) return 'The records are already in that period.';
  if (at.source.length === 0) return 'There is nothing in that period to move.';
  if (at.source.some((r) => r.body === null)) return 'This period holds a record this version cannot read, so it cannot be moved safely. Nothing was changed.';
  if (!to.startsWith('x') && scheduleProduces(scheduleSource(ob.data), to) === null) return `${slotWords2(to)} is not a billing period of this bill's schedule.`;
  // a target may only hold records that came from this same source (the owner is finishing a move that another device interrupted)
  if (at.target.some((r) => r.movedFrom !== from)) return `${slotWords2(to)} already has its own records. If they are two different bills, use "These are different bills" instead. Nothing was changed.`;
  return null;
}

export async function planMove(obligationId: number, from: string, to: string, d: FinanceDB = db): Promise<MovePlan> {
  const ob = (await loadObligationRows(d)).find((o) => o.id === obligationId);
  const cycles = (await loadCycles(d)).filter((c) => c.obligationId === obligationId);
  const source = cycles.filter((c) => c.slot === from), target = cycles.filter((c) => c.slot === to);
  const base = { from, to, moving: source, expect: snap([...source, ...target]) };
  if (!ob) return { ...base, problem: 'That bill no longer exists.', lines: [] };
  const problem = moveProblem(ob, from, to, { source, target });
  if (problem) return { ...base, problem, lines: [] };
  const lines = [
    `Move ${source.length} record${source.length === 1 ? '' : 's'} from ${slotWords2(from)} to ${to.startsWith('x') ? 'a new extra bill' : slotWords2(to)}:`,
    ...source.map((r) => `${r.body!.fact === 'invoice' ? 'The bill' : r.body!.fact === 'due-date' ? 'The due date' : r.body!.fact === 'paid-outside' ? 'The "paid outside Finance" record' : r.body!.fact === 'paid-in-full' ? 'The "paid in full" record' : r.body!.fact === 'skip' ? 'The "not billed" record' : 'The credit'}${r.supersededBy !== null ? ' (already set aside)' : ''}`),
    'Every amount, payment record and actual due date stays exactly as it is. Only the period they belong to changes, and each record remembers where it came from.',
    'A record added to the old period later (for example from another device) is NOT moved or merged: it is listed for you to look at.',
    'Nothing in Finance is read or changed. You can undo this unless something changes first.',
  ];
  return { ...base, problem: null, lines };
}

export function applyMove(input: { obligationId: number; from: string; to: string; expect: { id: number; updatedAt: number }[]; today: string }, d: FinanceDB = db): Promise<{ undo: Undo; moved: number }> {
  return d.transaction('rw', ...cycleTables(d), async () => {
    const ob = (await loadObligationRows(d)).find((o) => o.id === input.obligationId);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    const cycles = (await loadCycles(d)).filter((c) => c.obligationId === input.obligationId);
    const source = cycles.filter((c) => c.slot === input.from), target = cycles.filter((c) => c.slot === input.to);
    if (JSON.stringify(snap([...source, ...target])) !== JSON.stringify([...input.expect].sort((a, b) => a.id - b.id))) throw new Error(STALE_REPAIR);
    const problem = moveProblem(ob, input.from, input.to, { source, target });
    if (problem) throw new Error(problem);
    const rec = new Recorder();
    for (const f of source) {
      await rec.capture(f.id, d);
      await rows(d).put({ id: f.id, module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: f.raw, obligationId: input.obligationId, slot: input.to, op: f.op, supersededBy: f.supersededBy, movedFrom: input.from }, f.body!) });
    }
    await ensureBillTasksIn(input.obligationId, input.today, d, rec);
    return { undo: await rec.seal(d), moved: source.length };
  });
}

