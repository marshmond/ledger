import { Link } from 'react-router-dom';
import { monthLabel } from '../lib/dates';
import { useCheckin } from './useCheckin';
import { PageHeader } from '../ui/components';

/** The monthly check-in: a short list that keeps your data accurate. Most steps tick themselves. */
export default function CheckinPage() {
  const c = useCheckin();
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;

  return (
    <>
      <PageHeader title="Monthly check-in" description="A few minutes once a month keeps everything trustworthy." about={<>A few minutes once a month keeps everything in the app trustworthy. Steps tick themselves when there is nothing left to do; the ones that need your eyes you tick yourself.</>} />

      {!c.ready ? <p className="muted">Looking at your data…</p> : (
        <>
          <div className="card">
            <div className="row spread">
              <strong>{monthLabel(c.month)}: {c.progress.done} of {c.progress.total} done</strong>
              {c.streak > 0 && <span className="badge">{c.streak} month{c.streak === 1 ? '' : 's'} in a row</span>}
            </div>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
            {c.progress.complete && <p className="ok" role="status">All done for {monthLabel(c.month)}. Nice work.</p>}
          </div>

          <ul className="checklist">
            {c.steps.filter((s) => s.status !== 'na').map((s) => (
              <li key={s.id} className={`check ${s.status === 'done' ? 'ok' : 'todo'}`}>
                <span className="mark" aria-hidden="true">{s.status === 'done' ? '✓' : '!'}</span>
                <div>
                  <strong>{s.title}</strong>
                  <div className="muted">{s.detail}</div>
                </div>
                <div className="row">
                  {s.status === 'todo' && <Link to={s.to}>{s.actionLabel} →</Link>}
                  {s.status === 'todo' && (
                    <label className="chk"><input type="checkbox" checked={!!c.marks[s.id]} onChange={(e) => c.setMark(s.id, e.target.checked)} /> done</label>
                  )}
                  {s.status === 'done' && c.marks[s.id] && <button className="link" onClick={() => c.setMark(s.id, false)}>undo</button>}
                </div>
              </li>
            ))}
          </ul>
          {c.steps.some((s) => s.status === 'na') && <p className="muted">Skipped because they do not apply yet: {c.steps.filter((s) => s.status === 'na').map((s) => s.title.toLowerCase()).join('; ')}.</p>}
          {c.completed.length > 0 && <p className="muted">Months completed: {[...c.completed].sort().slice(-12).map((m) => monthLabel(m)).join(', ')}.</p>}
        </>
      )}
    </>
  );
}
