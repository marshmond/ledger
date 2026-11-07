/**
 * Helpers about billing-period SLOTS (B2). PURE. A slot names a period, not a date (see schedule.ts): `m2026-12` is a calendar month,
 * `s2026-12a` the first bill of a twice-monthly month, `w2026-12-07` a week (its Monday), `x<id>` an extra bill no schedule produced.
 */
import { addDays, endOfMonth } from '../../lib/dates';
import { expectedDates, parseSlot, type ScheduleSource } from './schedule';

/** The first and last day a slot covers. Null for an extra bill (`x`) or an unreadable slot. */
export function slotRange(slot: string): { from: string; to: string } | null {
  const p = parseSlot(slot);
  if (!p) return null;
  if (p.kind === 'm' || p.kind === 's') return { from: `${p.month}-01`, to: endOfMonth(p.month) };
  if (p.kind === 'w') return { from: p.monday, to: addDays(p.monday, 6) };
  return null;
}

/**
 * The nominal date at which ANY schedule of this obligation (the current one or an earlier one, each within its own date range) produces this
 * slot, ignoring the tracking start, pauses and the end date (those decide what is EXPECTED, not what a period is). Null when no schedule
 * produces it (an extra bill, or a period left behind by a schedule change).
 */
export function scheduleProduces(src: ScheduleSource, slot: string): string | null {
  const r = slotRange(slot);
  if (!r) return null;
  const bare: ScheduleSource = { schedule: src.schedule, scheduleHistory: src.scheduleHistory, trackingSince: '0000-01-01', pauses: [], status: 'active', endedOn: null };
  return expectedDates(bare, r.from, r.to).find((e) => e.slot === slot)?.nominal ?? null;
}

export const isExtraSlot = (slot: string) => parseSlot(slot)?.kind === 'x';
/** A new extra-bill slot from a time-based id. */
export const extraSlot = (id: number) => `x${id}`;

/** The periods a bill's records may be moved to: every period any schedule of the bill produces from about a year ago to about a year and a half ahead, ignoring pauses and the tracking start. */
export function moveTargets(src: ScheduleSource, today: string): { slot: string; nominal: string }[] {
  const bare: ScheduleSource = { schedule: src.schedule, scheduleHistory: src.scheduleHistory, trackingSince: '0000-01-01', pauses: [], status: 'active', endedOn: null };
  const seen: Record<string, boolean> = {};
  return expectedDates(bare, addDays(today, -400), addDays(today, 500)).filter((e) => (seen[e.slot] ? false : (seen[e.slot] = true)));
}
