/**
 * READING the lifecycle records (B4): one plain read of the bills' `lifecycle` rows and the step that attaches each bill's derived view to it.
 * Nothing here writes. The loaders in `data.ts` and `readModel.ts` call it, so every screen, the Tasks planner, the Calendar layer and the read model
 * see the same view. A bill with NO lifecycle record gets no view at all and behaves exactly as it did before B4.
 */
import type { FinanceDB } from '../../db';
import { db } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { isLive } from '../../core/store';
import { LC_KIND, readLifecycle, type LcRecord } from './lifecycleModel';
import { EMPTY_VIEW, lifecycleView, type LifecycleView } from './lifecycleState';
import { MODULE, type ObligationRecord } from './model';

/** Every live lifecycle record (readable or not). */
export async function loadLifecycleRecords(d: FinanceDB = db): Promise<LcRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, LC_KIND]).toArray()).filter(isLive).map((r: ModuleRecord) => readLifecycle(r));
}

/** The live lifecycle records of one bill. */
export async function lifecycleRecordsOf(obligationId: number, d: FinanceDB = db): Promise<LcRecord[]> {
  return (await loadLifecycleRecords(d)).filter((r) => r.obligationId === obligationId);
}

/** Attaches the derived view (reader only; never stored) to every bill that has lifecycle records. */
export function withLifecycle(obs: ObligationRecord[], records: LcRecord[]): ObligationRecord[] {
  const by = new Map<number, LcRecord[]>();
  for (const r of records) if (r.obligationId !== null) by.set(r.obligationId, [...(by.get(r.obligationId) ?? []), r]);
  return obs.map((o) => {
    const mine = by.get(o.id);
    if (!mine || mine.length === 0) return o;
    return { ...o, data: { ...o.data, lc: lifecycleView({ obligationId: o.id, baselinePrices: o.data.prices, records: mine }) } };
  });
}

/** The bill's view, or an empty one (never undefined). */
export const lcOf = (d: { lc?: LifecycleView }): LifecycleView => d.lc ?? EMPTY_VIEW;
