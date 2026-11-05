import { liveQuery } from 'dexie';
import type { QuickAddDef } from '../../core/registry';
import { store } from '../../core/store';
import { todayISO } from '../../lib/money';
import { createEvent, defaultCalendarId, ensureCalendarSeed, loadLayers, newEventData, removeEventById } from './data';
import { eventFieldsFor, parseQuickEvent, type ParsedEvent } from './quickEvent';

/**
 * The Add box's Event destination. Words are read by `parseQuickEvent`. No date means today; no time means all-day; a single time
 * is one hour; `@name` picks one of your own calendars (otherwise the default calendar from Calendar settings is used).
 * `start` keeps the names of your calendars and tags so the preview can say which calendar it will land on and which tags are new.
 */
let calendars: { id: number; name: string }[] = [];
let tagNames: string[] = [];

const findCalendar = (name: string | undefined) => (name ? calendars.find((c) => c.name.toLowerCase() === name.toLowerCase()) : undefined);

const dayText = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const timeText = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const repeatText = (r: NonNullable<ParsedEvent['recurrence']>) => {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  return r.interval > 1 ? `Repeats every ${r.interval} ${unit}s` : `Repeats every ${unit}`;
};

export interface EventPayload {
  parsed: ParsedEvent;
  title: string;
  /** The calendar the name matched, if any. */
  calendarId: number | null;
}

export const eventQuickAdd: QuickAddDef = {
  id: 'event',
  label: 'Event',
  prefix: 'e',
  aliases: ['event'],
  start() {
    const a = liveQuery(async () => (await loadLayers()).filter((l) => l.sourceType === 'local').map((l) => ({ id: l.id, name: l.name }))).subscribe({ next: (v) => { calendars = v; }, error: () => undefined });
    const b = liveQuery(async () => (await store.shared.tags.query()).map((t) => t.name)).subscribe({ next: (v) => { tagNames = v; }, error: () => undefined });
    return () => { a.unsubscribe(); b.unsubscribe(); };
  },
  parse(text, opts) {
    const parsed = parseQuickEvent(text, todayISO(), opts);
    if (!parsed.title.trim()) return null;
    const cal = findCalendar(parsed.calendar);
    // An @word that is not one of your calendars stays in the title instead of vanishing.
    const title = parsed.calendar && !cal ? `${parsed.title} @${parsed.calendar}` : parsed.title;
    const f = eventFieldsFor(parsed, title);
    const when = f.allDay ? `${dayText(f.startDate)}, all day` : `${dayText(parsed.date)}, ${timeText(f.startAt)}–${timeText(f.endAt)}`;
    const fields = [
      { label: 'Event', value: title },
      { label: 'When', value: when },
      { label: 'Calendar', value: cal ? cal.name : 'your default calendar' },
      ...(parsed.recurrence ? [{ label: 'Repeats', value: repeatText(parsed.recurrence).replace('Repeats ', '') }] : []),
      ...(parsed.priority ? [{ label: 'Priority', value: parsed.priority }] : []),
      ...parsed.tags.map((t) => ({ label: 'Tag', value: `#${t}${tagNames.some((x) => x.toLowerCase() === t.toLowerCase()) ? '' : ' (new)'}` })),
    ];
    const payload: EventPayload = { parsed, title, calendarId: cal?.id ?? null };
    return { summary: `${title}, ${when}`, fields, payload };
  },
  async commit(preview) {
    const { parsed, title, calendarId } = preview.payload as EventPayload;
    await ensureCalendarSeed(); // the built-in calendars must exist even if the Calendar was never opened
    const known = await store.shared.tags.query();
    const tagIds: number[] = [];
    for (const name of parsed.tags) {
      const found = known.find((t) => t.name.toLowerCase() === name.toLowerCase());
      tagIds.push(found?.id ?? (await store.shared.tags.put({ name })));
    }
    const id = await createEvent(newEventData(eventFieldsFor(parsed, title), {
      calendarId: calendarId ?? (await defaultCalendarId()), tagIds, contactIds: [], recurrence: parsed.recurrence, trackDone: false,
    }));
    return async () => { await removeEventById(id); };
  },
};
