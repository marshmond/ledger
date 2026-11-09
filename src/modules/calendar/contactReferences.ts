/**
 * Contacts C2: which Calendar events list a Contact under People (`contactIds`). READ ONLY. A repeating event is ONE reference (its series), shown with
 * its next date from the Calendar's own recurrence engine (`occurrenceToOpen`, looked up only for the events that name a requested Contact); nothing is
 * expanded into occurrences and nothing is stored. An event handed over to another module (retired) is listed quietly and has no link, because the
 * Calendar no longer shows it.
 */
import { readRows, type ContactReference, type ContactReferenceProvider } from '../../core/contactReferences';
import { asEvent, MODULE } from './model';
import { pathFor } from './records';
import { occurrenceToOpen } from './searchSource';

export const calendarContactReferences: ContactReferenceProvider = {
  label: 'Calendar',
  async find({ ids, d, today }) {
    const out: ContactReference[] = [];
    for (const ev of await readRows(d, MODULE, 'event', asEvent)) {
      const mine = [...new Set(ev.data.contactIds)].filter((c) => ids.has(c));
      if (!mine.length) continue;
      const retired = !!ev.data.retired;
      let date = ev.data.startDate;
      let href: string | undefined;
      // A damaged event (no readable dates) is still listed by its title; it just has no next date and no link.
      if (!retired) { try { date = occurrenceToOpen(ev, today)?.firstDay ?? date; href = pathFor(ev, today); } catch { href = undefined; } }
      for (const cid of mine) {
        out.push({
          contactId: cid, module: 'calendar', kind: 'event', recordId: String(ev.id), role: 'person',
          title: ev.data.title.trim() || 'Untitled event',
          relation: ev.data.type === 'birthday' ? 'Listed under People on this birthday event' : 'Listed under People on this event',
          ...(retired ? { inactive: true, status: 'Moved to another module' } : { ...(href ? { href } : {}), ...(ev.data.recurrence ? { status: 'Repeats' } : {}) }),
          ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
        });
      }
    }
    return out;
  },
};
