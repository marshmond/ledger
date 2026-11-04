/** Layout helpers for the week grid: where each timed item sits within a day, and how overlapping items share the width. */
import { addDays } from '../../lib/dates';
import { msAt } from './time';

export interface Segment<T> {
  item: T;
  /** Minutes after midnight on this day. */
  start: number;
  end: number;
}
export interface Placed<T> extends Segment<T> {
  /** Which column inside the overlapping group (0-based) and how many columns that group has. */
  col: number;
  cols: number;
}

/** The part of an item that falls on `date` (null if none). A minimum length keeps tiny items clickable. */
export function segmentOnDay<T>(item: T, startMs: number, endMs: number, date: string, minLength = 25): Segment<T> | null {
  const dayStart = msAt(date);
  const dayEnd = msAt(addDays(date, 1));
  if (endMs <= dayStart && !(startMs === endMs && startMs === dayStart)) return null;
  if (startMs >= dayEnd) return null;
  const s = Math.max(startMs, dayStart);
  const e = Math.min(Math.max(endMs, startMs), dayEnd);
  const start = Math.round((s - dayStart) / 60000);
  const end = Math.max(start + minLength, Math.round((e - dayStart) / 60000));
  return { item, start, end: Math.min(end, 24 * 60 + minLength) };
}

/** Puts overlapping items side by side: items that overlap in time get separate columns, sharing the width equally. */
export function layoutDay<T>(segs: Segment<T>[]): Placed<T>[] {
  const sorted = [...segs].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -1;
  const flush = () => {
    const cols = group.reduce((m, g) => Math.max(m, g.col + 1), 0);
    for (const g of group) g.cols = cols;
    out.push(...group);
    group = [];
  };
  for (const s of sorted) {
    if (group.length && s.start >= groupEnd) flush();
    // first column whose last item has already ended
    const lastEnds: number[] = [];
    for (const g of group) lastEnds[g.col] = Math.max(lastEnds[g.col] ?? -1, g.end);
    let col = lastEnds.findIndex((e) => e <= s.start);
    if (col === -1) col = lastEnds.length;
    group.push({ ...s, col, cols: 1 });
    groupEnd = Math.max(groupEnd, s.end);
  }
  flush();
  return out;
}
