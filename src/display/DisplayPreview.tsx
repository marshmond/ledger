import type { DisplayProjection } from './contract';

/** The owner's preview of exactly what a display could show (Settings > Family display, and the first-publication review). Titles are the owner's own words. */
export const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const shortDay = (date: string | null) => (date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'no upcoming date');

export function Preview({ p, killed }: { p: DisplayProjection; killed: boolean }) {
  const names = new Map(p.people.map((x) => [x.id, x.name]));
  const days = new Map<string, { when: string; title: string; who: string; kind: string }[]>();
  for (const e of p.entries) {
    const when = e.allDay ? (e.start.date === e.end.date ? 'All day' : `All day to ${shortDay(e.end.date)}`) : `${e.start.time}–${e.end.time}`;
    days.set(e.start.date, [...(days.get(e.start.date) ?? []), { when, title: e.title, who: e.people.map((x) => names.get(x) ?? '').join(', '), kind: e.source }]);
  }
  const KIND: Record<string, string> = { events: 'Event', dates: 'Family date', visits: 'Visit', reminders: 'Reminder' };
  return (
    <>
      <ul className="ds-stats">
        <li><strong>{p.counts.entries}</strong><span className="muted small">{p.counts.entries === 1 ? 'calendar item' : 'calendar items'}</span></li>
        <li><strong>{p.counts.tasks}</strong><span className="muted small">Tasks</span></li>
        <li><strong>{p.people.length}</strong><span className="muted small">{p.people.length === 1 ? 'person named' : 'people named'}</span></li>
        <li><strong>{p.grantsSeen.length}</strong><span className="muted small">{p.grantsSeen.length === 1 ? 'choice recorded' : 'choices recorded'}</span></li>
      </ul>
      <p className="muted small">From {shortDay(p.window.from)} to {shortDay(p.window.to)}, in the time zone {p.generatedFor.tz}.</p>
      {p.entries.length === 0 && p.tasks.length === 0 && <p className="muted">{killed ? 'Hide everything is on, so nothing would be shown.' : 'Nothing would be shown. That is how everything starts.'}</p>}
      {[...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => (
        <div key={date}>
          <h4 className="ds-preview-day">{dayLabel(date)}</h4>
          <ul className="ds-list">
            {items.map((it, i) => <li key={i} className="ds-row"><span className="ds-row-main"><strong>{it.title}</strong><span className="muted small">{KIND[it.kind]} · {it.when}{it.who ? ` · ${it.who}` : ''}</span></span></li>)}
          </ul>
        </div>
      ))}
      {p.tasks.length > 0 && (
        <div>
          <h4 className="ds-preview-day">Tasks</h4>
          <ul className="ds-list">
            {p.tasks.map((t) => <li key={t.id} className="ds-row"><span className="ds-row-main"><strong>{t.title}</strong><span className="muted small">{t.due ? `Due ${shortDay(t.due.date)}${t.due.time ? ` ${t.due.time}` : ''}` : 'No due date'} · {t.status}{t.repeat ? ' · repeats' : ''}{t.people.length ? ` · ${t.people.map((x) => names.get(x) ?? '').join(', ')}` : ''}</span></span></li>)}
          </ul>
        </div>
      )}
    </>
  );
}
