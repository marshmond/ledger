import { db } from '../../db';
import type { RecordChoice, RecordSource } from '../../core/registry';
import { goTo } from '../../core/dueProvider';
import { isLive } from '../../core/store';
import { todayISO } from '../../lib/money';
import { loadEvents } from './data';
import { asEvent, MODULE } from './model';
import { occurrenceToOpen } from './searchSource';

/** Lets other modules link to a Calendar event and show it by name. Event ids are plain numbers. */
const num = (id: string | number) => (typeof id === 'number' ? id : /^\d+$/.test(id) ? Number(id) : NaN);

/** The Calendar address that opens this event (the next date from today, or its first). */
export function pathFor(ev: ReturnType<typeof asEvent>): string {
  const occ = occurrenceToOpen(ev, todayISO());
  const date = occ?.firstDay ?? ev.data.startDate;
  return occ ? `/calendar?v=agenda&d=${date}&open=${encodeURIComponent(`e:${ev.id}:${occ.key}`)}` : `/calendar?v=agenda&d=${date}`;
}

export const eventRecords: RecordSource = {
  async search(text) {
    const q = text.trim().toLowerCase();
    const rows = (await loadEvents(db)).filter((e) => !e.data.retired && (!q || e.data.title.toLowerCase().includes(q)));
    rows.sort((a, b) => b.data.startDate.localeCompare(a.data.startDate));
    return rows.slice(0, 30).map<RecordChoice>((e) => ({ id: e.id, label: e.data.title, kind: 'Event' }));
  },
  async describe(id) {
    const n = num(id);
    if (Number.isNaN(n)) return null;
    const r = await db.moduleRecords.get(n);
    if (!r || r.module !== MODULE || r.kind !== 'event' || !isLive(r)) return null;
    const ev = asEvent(r);
    if (ev.data.retired) return null;
    return { label: ev.data.title, kind: 'Event', path: pathFor(ev) };
  },
  async openSource(id) {
    const info = await eventRecords.describe(id);
    if (!info) return false;
    goTo(info.path);
    return true;
  },
};
