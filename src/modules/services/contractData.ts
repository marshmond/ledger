/**
 * Saving an arrangement's contract dates (S4). One transaction: re-reads the arrangement, refuses when it changed since the owner opened the dialog,
 * validates, writes once and returns a sealed Undo (refused if anything it touched changed since). Touches nothing else: no Task, no Calendar event,
 * no reminder is made, and the schedule, status and provider are untouched.
 */
import { db, type FinanceDB } from '../../db';
import { contractProblem, type ContractDates } from './contract';
import { getArrangement, tables, writeArrangement } from './data';
import { Recorder, type Undo } from './undo';

export const CONTRACT_STALE = 'This arrangement was changed (maybe on another device) since you opened it. Close this, look again and redo your change. Nothing was changed.';

export function setContractDates(id: number, dates: ContractDates, expectUpdatedAt: number | null = null, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', ...tables(d), async () => {
    const a = await getArrangement(id, d);
    if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
    if (expectUpdatedAt !== null && a.updatedAt !== expectUpdatedAt) throw new Error(CONTRACT_STALE);
    const bad = contractProblem(dates);
    if (bad) throw new Error(`${bad} Nothing was changed.`);
    const rec = new Recorder();
    rec.arr(a);
    await writeArrangement(id, { ...a.data, renewalDate: dates.renewalDate, noticeByDate: dates.noticeByDate }, d);
    await rec.seal(d);
    return { undo: rec.undo };
  });
}
