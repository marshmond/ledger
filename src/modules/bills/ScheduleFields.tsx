import { dayLabel } from '../../core/time';
import { dayOfWeek } from '../../lib/dates';
import { ADJUSTS, type Adjust, type Slot, type SlotKind } from '../../lib/semimonthly';
import { describeSchedule } from './schedule';
import { draftProblem, isMonthly, isWeekly, PATTERN_LABEL, PATTERN_ORDER, previewDraft, scheduleOfDraft, type DayKind, type Pattern, type ScheduleDraft } from './scheduleDraft';
import { WEEKDAY_NAMES } from './util';

const SLOT_LABEL: Record<SlotKind, string> = { day: 'A day of the month', lastDay: 'The last day of the month', lastBusinessDay: 'The last business day (Mon to Fri)' };
const ADJUST_LABEL: Record<Adjust, string> = { none: 'Keep that date even on a weekend', previous: 'On a weekend, use the business day before', next: 'On a weekend, use the business day after' };
const DAY_LABEL: Record<DayKind, string> = { day: 'The same day each time (the date above)', lastDay: 'The last day of the month', lastBusinessDay: 'The last business day (Mon to Fri)' };

function SlotEditor({ label, slot, onChange }: { label: string; slot: Slot; onChange: (s: Slot) => void }) {
  const setKind = (k: SlotKind) => onChange(k === 'day' ? { kind: 'day', day: slot.day ?? 15, adjust: slot.adjust ?? 'none' } : { kind: k });
  return (
    <fieldset className="bl-slot">
      <legend>{label}</legend>
      <label className="f">Which day
        <select value={slot.kind} onChange={(e) => setKind(e.target.value as SlotKind)} aria-label={`${label}: which day`}>
          {(Object.keys(SLOT_LABEL) as SlotKind[]).map((k) => <option key={k} value={k}>{SLOT_LABEL[k]}</option>)}
        </select>
      </label>
      {slot.kind === 'day' && (
        <div className="bl-two">
          <label className="f">Day number (1 to 31)
            <input type="number" min={1} max={31} value={slot.day ?? ''} onChange={(e) => onChange({ ...slot, day: Math.min(31, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })} aria-label={`${label}: day number`} />
          </label>
          <label className="f">If it is a weekend
            <select value={slot.adjust ?? 'none'} onChange={(e) => onChange({ ...slot, adjust: e.target.value as Adjust })} aria-label={`${label}: weekend rule`}>
              {ADJUSTS.map((a) => <option key={a} value={a}>{ADJUST_LABEL[a]}</option>)}
            </select>
          </label>
        </div>
      )}
    </fieldset>
  );
}

/**
 * Chooses how often a bill comes. Shows the pattern in words, the next three expected dates and any problem BEFORE anything is saved.
 * The parent holds the draft and builds the schedule with `scheduleOfDraft`. Expected dates are a preview: nothing is created from them.
 */
export default function ScheduleFields({ draft, onChange, trackingSince, today }: { draft: ScheduleDraft; onChange: (d: ScheduleDraft) => void; trackingSince: string; today: string }) {
  const patch = (p: Partial<ScheduleDraft>) => onChange({ ...draft, ...p });
  const problem = draftProblem(draft);
  const dates = previewDraft(draft, trackingSince, today, 3);
  const s = scheduleOfDraft(draft);
  return (
    <fieldset className="bl-sub bl-cadence">
      <legend>How often?</legend>
      <label className="f">Pattern
        <select value={draft.pattern} onChange={(e) => patch({ pattern: e.target.value as Pattern })} aria-label="Schedule pattern">
          {PATTERN_ORDER.map((p) => <option key={p} value={p}>{PATTERN_LABEL[p]}</option>)}
        </select>
      </label>

      {(draft.pattern === 'everyNweeks' || draft.pattern === 'everyNmonths') && (
        <label className="f">{draft.pattern === 'everyNweeks' ? 'Every how many weeks? (1 to 52)' : 'Every how many months? (1 to 24)'}
          <input type="number" min={1} max={draft.pattern === 'everyNweeks' ? 52 : 24} value={draft.n} onChange={(e) => patch({ n: Math.floor(Number(e.target.value)) || 1 })} aria-label="Every how many" />
        </label>
      )}

      {(isWeekly(draft.pattern) || isMonthly(draft.pattern)) && (
        <label className="f">Date of the next bill
          <input type="date" value={draft.first} onChange={(e) => patch({ first: e.target.value })} aria-label="Date of the next bill" />
        </label>
      )}
      {isWeekly(draft.pattern) && draft.first && !problem && <p className="muted small">The same weekday every time: {WEEKDAY_NAMES[dayOfWeek(draft.first)]}.</p>}

      {isMonthly(draft.pattern) && (
        <>
          <label className="f">Which day
            <select value={draft.dayKind} onChange={(e) => patch({ dayKind: e.target.value as DayKind })} aria-label="Which day of the month">
              {(Object.keys(DAY_LABEL) as DayKind[]).map((k) => <option key={k} value={k}>{DAY_LABEL[k]}</option>)}
            </select>
          </label>
          {draft.dayKind === 'day' && (
            <label className="f">If that day is a weekend
              <select value={draft.adjust} onChange={(e) => patch({ adjust: e.target.value as Adjust })} aria-label="Weekend rule">
                {ADJUSTS.map((a) => <option key={a} value={a}>{ADJUST_LABEL[a]}</option>)}
              </select>
            </label>
          )}
        </>
      )}

      {draft.pattern === 'twice' && (
        <>
          <SlotEditor label="First bill each month" slot={draft.semi.a} onChange={(a) => patch({ semi: { ...draft.semi, a } })} />
          <SlotEditor label="Second bill each month" slot={draft.semi.b} onChange={(b) => patch({ semi: { ...draft.semi, b } })} />
          <label className="f">Starting in the month of
            <input type="date" value={draft.first} onChange={(e) => patch({ first: e.target.value })} aria-label="Starting in the month of" />
          </label>
          <p className="muted small">This is not "every 14 days": the gap changes from month to month. A day past the end of a short month means that month's last day. Business days are Monday to Friday; public holidays are not considered.</p>
        </>
      )}

      {s && !problem && <p className="small"><strong>{describeSchedule(s)}</strong></p>}
      {problem && draft.pattern !== 'ondemand' && <p className="bl-err" role="alert">{problem}</p>}
      {draft.pattern === 'ondemand' && <p className="muted small">No dates are worked out. You can add the bills yourself in a later version of Ledger.</p>}
      {dates.length > 0 && (
        <div className="bl-preview" aria-live="polite">
          <strong className="small">The next expected dates would be (a preview, nothing is created):</strong>
          <ol className="plain small">{dates.map((d) => <li key={d.slot}>{dayLabel(d.nominal, { weekday: 'short', year: true })}</li>)}</ol>
        </div>
      )}
    </fieldset>
  );
}
