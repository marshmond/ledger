import { addDays, dayOfWeek } from '../../lib/dates';
import { describeRule, nthOfMonth, type Recurrence } from './recurrence';
import { WEEKDAYS_LONG, WEEKDAYS_SHORT } from './time';

/**
 * The "Repeat" controls shared by events and tasks: how often, which weekdays, monthly pattern, and when it ends.
 * `start` is the date the series starts on (it decides "day 15" or "2nd Tuesday"). Tasks also pass `mode`/`onMode` to choose between
 * a fixed schedule and "repeat after completion".
 */
export default function RepeatFields({ rule, onChange, start, mode, onMode }: {
  rule: Recurrence | null; onChange: (r: Recurrence | null) => void; start: string;
  mode?: 'fixed' | 'after'; onMode?: (m: 'fixed' | 'after') => void;
}) {
  const patch = (p: Partial<Recurrence>) => rule && onChange({ ...rule, ...p });
  const nth = nthOfMonth(start);
  const onKind = (v: string) => {
    if (v === 'none') return onChange(null);
    const freq = v as Recurrence['freq'];
    onChange({ freq, interval: rule?.interval ?? 1, end: rule?.end ?? { type: 'never' }, ...(freq === 'weekly' ? { byWeekday: [dayOfWeek(start)] } : {}), ...(freq === 'monthly' ? { monthly: 'date' as const } : {}) });
  };
  const unit = rule ? { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[rule.freq] : '';

  return (
    <fieldset className="cal-repeat">
      <legend>Repeat</legend>
      <div className="row">
        <select value={rule?.freq ?? 'none'} onChange={(e) => onKind(e.target.value)} aria-label="Repeat">
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        {rule && (
          <>
            <span>every</span>
            <input type="number" min={1} max={999} className="cal-num" value={rule.interval} onChange={(e) => patch({ interval: Math.max(1, Number(e.target.value) || 1) })} aria-label="Repeat every" />
            <span>{unit}</span>
          </>
        )}
      </div>
      {rule && onMode && (
        <select value={mode ?? 'fixed'} onChange={(e) => onMode(e.target.value as 'fixed' | 'after')} aria-label="How it repeats">
          <option value="fixed">On a fixed schedule</option>
          <option value="after">After I complete it</option>
        </select>
      )}
      {rule?.freq === 'weekly' && mode !== 'after' && (
        <div className="row cal-days" role="group" aria-label="Repeat on">
          {WEEKDAYS_SHORT.map((w, d) => {
            const on = (rule.byWeekday ?? []).includes(d);
            return (
              <button type="button" key={w} className={`cal-daybtn ${on ? 'on' : ''}`} aria-pressed={on} aria-label={WEEKDAYS_LONG[d]}
                onClick={() => {
                  const cur = rule.byWeekday ?? [];
                  const next = on ? cur.filter((x) => x !== d) : [...cur, d];
                  patch({ byWeekday: next.length ? next.sort((a, b) => a - b) : cur });
                }}>{w[0]}<span className="sr-only">{w}</span></button>
            );
          })}
        </div>
      )}
      {rule?.freq === 'monthly' && mode !== 'after' && (
        <select value={rule.monthly ?? 'date'} onChange={(e) => patch({ monthly: e.target.value as Recurrence['monthly'] })} aria-label="Monthly pattern">
          <option value="date">On day {Number(start.slice(8, 10))} (last day in shorter months)</option>
          <option value="nth">On the {['', '1st', '2nd', '3rd', '4th'][nth.nth]} {WEEKDAYS_LONG[nth.weekday]}</option>
          <option value="last">On the last {WEEKDAYS_LONG[nth.weekday]}</option>
        </select>
      )}
      {rule && (
        <div className="row">
          <select value={rule.end.type} onChange={(e) => {
            const t = e.target.value;
            patch({ end: t === 'until' ? { type: 'until', date: addDays(start, 90) } : t === 'count' ? { type: 'count', count: 10 } : { type: 'never' } });
          }} aria-label="Repeat ends">
            <option value="never">Never ends</option>
            <option value="until">Ends on a date</option>
            <option value="count">Ends after a number of times</option>
          </select>
          {rule.end.type === 'until' && <input type="date" value={rule.end.date} onChange={(e) => e.target.value && patch({ end: { type: 'until', date: e.target.value } })} aria-label="Repeat until" />}
          {rule.end.type === 'count' && <><input type="number" min={1} max={1000} className="cal-num" value={rule.end.count} onChange={(e) => patch({ end: { type: 'count', count: Math.max(1, Number(e.target.value) || 1) } })} aria-label="Number of times" /><span>times</span></>}
        </div>
      )}
      {rule && <p className="muted small">{mode === 'after' ? `The next one is due ${rule.interval} ${{ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq]}${rule.interval === 1 ? '' : 's'} after you complete it.` : describeRule(rule, start)}</p>}
    </fieldset>
  );
}
