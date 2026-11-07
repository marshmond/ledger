import RepeatFields from '../../ui/RepeatFields';
import { dayLabel } from '../../core/time';
import { WEEKDAYS_LONG } from '../../core/time';
import { dayOfWeek } from '../../lib/dates';
import { cadenceOfDraft, draftProblem, KIND_LABEL, previewDates, type CadenceDraft, type CadenceKind } from './cadenceDraft';
import { ADJUSTS, describeSemi, type Adjust, type Slot, type SlotKind } from './semimonthly';

const SLOT_LABEL: Record<SlotKind, string> = { day: 'A day of the month', lastDay: 'The last day of the month', lastBusinessDay: 'The last business day (Mon to Fri)' };
const ADJUST_LABEL: Record<Adjust, string> = { none: 'Keep that date even on a weekend', previous: 'On a weekend, use the business day before', next: 'On a weekend, use the business day after' };

function SlotEditor({ label, slot, onChange }: { label: string; slot: Slot; onChange: (s: Slot) => void }) {
  const setKind = (k: SlotKind) => onChange(k === 'day' ? { kind: 'day', day: slot.day ?? 15, adjust: slot.adjust ?? 'none' } : { kind: k });
  return (
    <fieldset className="sv-slot">
      <legend>{label}</legend>
      <label className="f">Which day
        <select value={slot.kind} onChange={(e) => setKind(e.target.value as SlotKind)} aria-label={`${label}: which day`}>
          {(Object.keys(SLOT_LABEL) as SlotKind[]).map((k) => <option key={k} value={k}>{SLOT_LABEL[k]}</option>)}
        </select>
      </label>
      {slot.kind === 'day' && (
        <div className="sv-two">
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
 * Chooses how often a service happens: none, every 2 weeks, twice a month, or another pattern. Shows the pattern in words, the next dates
 * it gives, and any problem, all before anything is saved. The parent holds the draft and builds the `Cadence` with `cadenceOfDraft`.
 */
export default function CadenceFields({ draft, onChange, today }: { draft: CadenceDraft; onChange: (d: CadenceDraft) => void; today: string }) {
  const patch = (p: Partial<CadenceDraft>) => onChange({ ...draft, ...p });
  const setKind = (kind: CadenceKind) => {
    if (kind === 'other' && !draft.rule) return onChange({ ...draft, kind, rule: { freq: 'weekly', interval: 1, byWeekday: [dayOfWeek(draft.first || today)], end: { type: 'never' } } });
    onChange({ ...draft, kind });
  };
  const c = cadenceOfDraft(draft);
  const problem = draftProblem(draft);
  const dates = !problem ? previewDates(c, today) : [];
  const first = draft.first || today;

  return (
    <fieldset className="sv-sub sv-cadence">
      <legend>How often?</legend>
      <label className="f">Pattern
        <select value={draft.kind} onChange={(e) => setKind(e.target.value as CadenceKind)} aria-label="Schedule pattern">
          {(Object.keys(KIND_LABEL) as CadenceKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>

      {draft.kind === 'biweekly' && (
        <>
          <div className="sv-two">
            <label className="f">First visit date<input type="date" value={draft.first} onChange={(e) => patch({ first: e.target.value })} /></label>
            <label className="f">Last visit on or before (optional)<input type="date" value={draft.until} onChange={(e) => patch({ until: e.target.value })} /></label>
          </div>
          <p className="muted small">Every other {draft.first ? WEEKDAYS_LONG[dayOfWeek(draft.first)] : 'week'}, exactly 14 days apart, from the first date. Moving one visit to another day does not move the later ones.</p>
        </>
      )}

      {draft.kind === 'semimonthly' && (
        <>
          <SlotEditor label="First visit each month" slot={draft.semi.a} onChange={(a) => patch({ semi: { ...draft.semi, a } })} />
          <SlotEditor label="Second visit each month" slot={draft.semi.b} onChange={(b) => patch({ semi: { ...draft.semi, b } })} />
          <div className="sv-two">
            <label className="f">Start on or after<input type="date" value={draft.first} onChange={(e) => patch({ first: e.target.value })} /></label>
            <label className="f">Last visit on or before (optional)<input type="date" value={draft.until} onChange={(e) => patch({ until: e.target.value })} /></label>
          </div>
          {!problem && <p className="small"><strong>{describeSemi(c?.semi ?? draft.semi)}</strong></p>}
          <p className="muted small">This is not "every 14 days": the time between visits changes from month to month. A day past the end of a short month means that month's last day (31 in April is 30 April; 30 in February is the last day of February). Business days are Monday to Friday; public holidays are not considered.</p>
        </>
      )}

      {draft.kind === 'other' && (
        <>
          <RepeatFields rule={draft.rule} onChange={(rule) => patch(rule ? { rule } : { kind: 'none', rule: null })} start={first} mode={draft.mode} onMode={(mode) => patch({ mode })} />
          <label className="f">First visit date<input type="date" value={draft.first} onChange={(e) => {
            const v = e.target.value;
            patch({ first: v, ...(v && draft.rule?.freq === 'weekly' && (draft.rule.byWeekday?.length ?? 0) <= 1 ? { rule: { ...draft.rule, byWeekday: [dayOfWeek(v)] } } : {}) });
          }} /></label>
        </>
      )}

      {problem && draft.kind !== 'none' && <p className="sv-warn" role="alert">{problem}</p>}
      {dates.length > 0 && (
        <div className="sv-preview" aria-live="polite">
          <strong className="small">The next visits would be:</strong>
          <ol className="plain small">{dates.map((d) => <li key={d}>{dayLabel(d, { weekday: 'short', year: true })}</li>)}</ol>
        </div>
      )}
    </fieldset>
  );
}
