/**
 * Household finances for the weekly review (R1.2). READ ONLY. The rows come from B5's own `householdCommitments` (through `loadHouseholdOverview`, the reader the
 * Household finances page uses); this file only cuts them to the seven-day window and tallies the listed rows with B5's own `addRow`. Nothing is recalculated.
 *
 * B5's "7 days" window runs from today through today + 7, which is EIGHT calendar days. The review is seven (today through today + 6), so rows dated on the eighth day are
 * left out. A Services row that B5 folded into its linked bill's row is not listed and not added again (`foldedInto`); it is only counted in `folded`.
 */
import { addDays } from '../../lib/dates';
import { todayISO } from '../../lib/money';
import type { WeekMoney, WeekPayRow, WeekTotals } from '../../core/weekReaders';
import { addRow } from './commitments';
import { loadHouseholdOverview, type HouseholdOverview } from './overview';

export function weekMoneyOf(o: HouseholdOverview, today: string): WeekMoney {
  const win = o.commitments.windows.find((w) => w.days === 7);
  const to = addDays(today, 6);
  const inside = (win?.rows ?? []).filter((r) => r.date >= today && r.date <= to);
  const kept = inside.filter((r) => r.foldedInto === null);
  const rows: WeekPayRow[] = kept.map((r) => ({ id: r.id, module: r.module, sourceId: r.sourceId, title: r.title, date: r.date, cents: r.cents, certainty: r.certainty, note: r.note, href: r.href }));
  const totals: WeekTotals = { known: { cents: 0, count: 0 }, estimated: { cents: 0, count: 0 }, unknown: { count: 0 }, disputed: { count: 0 } };
  for (const r of kept) addRow(totals, r.cents, r.certainty);
  const unproven = (win?.consolidations ?? []).filter((c) => c.status !== 'folded');
  return {
    rows, folded: inside.length - kept.length, totals,
    overlap: kept.some((r) => unproven.some((c) => (r.module === 'bills' ? r.sourceId === c.billId : r.sourceId === c.arrangementId))),
    notConverted: win?.notConverted.length ?? 0,
    contractDates: o.actions.filter((a) => a.date >= today && a.date <= to).map((a) => ({ id: a.id, date: a.date, title: a.title, label: a.label, href: a.href })),
  };
}

export async function readWeekMoney(today: string = todayISO()): Promise<WeekMoney> {
  return weekMoneyOf(await loadHouseholdOverview('all', today), today);
}
