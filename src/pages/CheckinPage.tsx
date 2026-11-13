import { Link } from '../core/router';
import { monthLabel } from '../lib/dates';
import { useCheckin } from './useCheckin';
import { PageHeader } from '../ui/components';
import { StatusChip } from '../ui/StatusChip';
import { checkinSegments, splitCheckin } from './moneyPresentation';
import type { Step } from '../lib/checkin';
import './money.css';

/** One step of the check-in. The step's status, wording and link come from the check-in model; the tick box and undo are the same actions as before. */
export function StepRow({ step: s, marked, onMark }: { step: Step; marked: boolean; onMark: (on: boolean) => void }) {
  const todo = s.status === 'todo';
  return (
    <li className={`mny-step ${todo ? 'is-todo' : 'is-done'}`}>
      <span className="mny-step-mark" aria-hidden="true">{todo ? '!' : '✓'}</span>
      <div className="mny-step-body">
        <div className="mny-step-title">
          <strong>{s.title}</strong>
          <StatusChip tone={todo ? 'warning' : 'done'}>{todo ? 'Needs you' : 'Done'}</StatusChip>
        </div>
        <div className="muted">{s.detail}</div>
      </div>
      <div className="mny-step-act">
        {todo && <Link className="btn" to={s.to}>{s.actionLabel} →</Link>}
        {todo && (
          <label className="chk"><input type="checkbox" checked={marked} onChange={(e) => onMark(e.target.checked)} /> done</label>
        )}
        {s.status === 'done' && marked && <button className="link" onClick={() => onMark(false)}>undo</button>}
      </div>
    </li>
  );
}

/** The monthly check-in: a short list that keeps your data accurate. Most steps tick themselves. */
export default function CheckinPage() {
  const c = useCheckin();
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
  const parts = splitCheckin(c.steps);
  const segs = checkinSegments(c.steps);

  return (
    <div className="mny-page mny-checkin">
      <PageHeader title="Monthly check-in" description="A few minutes once a month keeps everything trustworthy." about={<>A few minutes once a month keeps everything in the app trustworthy. Steps tick themselves when there is nothing left to do; the ones that need your eyes you tick yourself.</>} />

      {!c.ready ? <p className="muted">Looking at your data…</p> : (
        <>
          <section className="card mny-prog" aria-labelledby="checkin-month">
            <div className="mny-prog-head">
              <div>
                <h2 id="checkin-month" className="mny-h2 mny-h2--tight">{monthLabel(c.month)}</h2>
                <p className="mny-prog-count"><strong>{c.progress.done} of {c.progress.total}</strong> done{c.progress.left > 0 && <> · {c.progress.left} left</>}</p>
              </div>
              {c.streak > 0 && <StatusChip tone="info" icon={false}>{c.streak} month{c.streak === 1 ? '' : 's'} in a row</StatusChip>}
            </div>
            {/* One segment per step; each says its state in words for assistive technology. The bar's value is the same percentage as before. */}
            <div className="mny-segbar" role="progressbar" aria-label="Check-in progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              {segs.map((s) => <span key={s.id} className={`mny-seg mny-seg--${s.status}`} title={`${s.title}: ${s.status === 'done' ? 'done' : 'needs you'}`} />)}
            </div>
            {c.progress.complete && <p className="ok" role="status">All done for {monthLabel(c.month)}. Nice work.</p>}
          </section>

          {parts.todo.length > 0 && (
            <section aria-labelledby="checkin-todo">
              <h2 id="checkin-todo" className="mny-h2">Needs your attention <span className="mny-count">{parts.todo.length}</span></h2>
              <ul className="card flush mny-steps">
                {parts.todo.map((s) => <StepRow key={s.id} step={s} marked={!!c.marks[s.id]} onMark={(on) => c.setMark(s.id, on)} />)}
              </ul>
            </section>
          )}
          {parts.done.length > 0 && (
            <section aria-labelledby="checkin-done">
              <h2 id="checkin-done" className="mny-h2">Done <span className="mny-count">{parts.done.length}</span></h2>
              <ul className="card flush mny-steps">
                {parts.done.map((s) => <StepRow key={s.id} step={s} marked={!!c.marks[s.id]} onMark={(on) => c.setMark(s.id, on)} />)}
              </ul>
            </section>
          )}
          {parts.na.length > 0 && <p className="muted">Skipped because they do not apply yet: {parts.na.map((s) => s.title.toLowerCase()).join('; ')}.</p>}
          {c.completed.length > 0 && <p className="muted">Months completed: {[...c.completed].sort().slice(-12).map((m) => monthLabel(m)).join(', ')}.</p>}
        </>
      )}
    </div>
  );
}
