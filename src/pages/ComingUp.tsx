import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { loadCalendar } from '../lib/calendarLive';
import { toIcs } from '../lib/calendar';
import { downloadText } from '../lib/download';
import { todayISO } from '../lib/money';

const KIND: Record<string, string> = { vest: 'RSU', tax: 'Tax', rmd: 'RMD', cap: 'Pay', bill: 'Bill', loan: 'Loan', 'year-end': 'Tax' };
const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The next dates that matter, with a download so they show up in your phone's calendar. */
export default function ComingUp({ limit = 6, withDownload = true }: { limit?: number; withDownload?: boolean }) {
  const today = todayISO();
  const events = useLiveQuery(() => loadCalendar(db, today, 365), [today]);
  const soon = (events ?? []).filter((e) => e.date <= `${Number(today.slice(0, 4)) + 1}-01-01`).slice(0, limit);
  const download = async () => {
    const all = await loadCalendar(db, todayISO(), 365);
    downloadText('ledger-key-dates.ics', 'text/calendar', toIcs(all, new Date().toISOString()));
  };
  return (
    <div className="card">
      <div className="row spread"><strong>Coming up</strong>{withDownload && <button className="link" onClick={download} disabled={!events || events.length === 0} title="Download a calendar file (.ics) to add these dates to your phone or computer calendar">Add to my calendar</button>}</div>
      {!events ? <p className="muted">Loading…</p> : soon.length === 0 ? (
        <p className="muted">Nothing is coming up. Vests, tax deadlines, required distributions, bills, and loan payments will appear here.</p>
      ) : (
        <ul className="plain">
          {soon.map((e) => (
            <li key={e.id} className="row spread">
              <span><strong>{fmtDay(e.date)}</strong> <span className="badge">{KIND[e.kind]}</span> <Link to={e.to}>{e.title}</Link></span>
            </li>
          ))}
        </ul>
      )}
      {withDownload && <p className="muted">The calendar file is a snapshot of the next year; download it again to refresh it.</p>}
    </div>
  );
}
