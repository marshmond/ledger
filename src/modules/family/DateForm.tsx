import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { store } from '../../core/store';
import { createDate, updateDate } from './dateData';
import { DATE_KINDS, DATE_KIND_LABEL, LABEL_MAX, type DateFields, type DateKind, type DateRecord } from './dateModel';
import { loadMembers } from './data';
import { MONTH_NAMES, monthDay, validMonthDay } from './model';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/**
 * Add or edit an important date (an anniversary or another yearly date). A member's own birthday is NOT added here: it comes from their profile, so
 * there is one copy. The Calendar checkbox controls the owner's own Calendar only.
 */
export default function DateForm({ record, onClose, onSaved }: { record?: DateRecord; onClose: () => void; onSaved: (id: number) => void }) {
  const start = record?.data ?? undefined;
  const members = useLiveQuery(() => loadMembers(), []) ?? [];
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];

  const [kind, setKind] = useState<DateKind>(start?.dateKind ?? 'anniversary');
  const [label, setLabel] = useState(start?.label ?? '');
  const [month, setMonth] = useState(start ? start.monthDay.slice(0, 2) : '');
  const [day, setDay] = useState(start ? String(Number(start.monthDay.slice(3))) : '');
  const [year, setYear] = useState(start?.year !== undefined ? String(start.year) : '');
  const [memberId, setMemberId] = useState(start?.memberId !== undefined ? String(start.memberId) : '');
  const [onCalendar, setOnCalendar] = useState(start?.onCalendar !== false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const nameOf = (contactId: number) => contacts.find((c) => c.id === contactId)?.name ?? 'Contact no longer exists';
  const choices = members.filter((m) => m.data && (m.data.status === 'active' || String(m.id) === memberId)).sort((a, b) => nameOf(a.data!.contactId).localeCompare(nameOf(b.data!.contactId)));

  async function save() {
    if (busy) return;
    setError('');
    if (!month || !day) return setError('Choose a month and a day.');
    const md = monthDay(Number(month), Number(day));
    if (!validMonthDay(md)) return setError('Choose a month and a day that exist together (for example not 31 April).');
    if (year.trim() && !/^\d{4}$/.test(year.trim())) return setError('Enter the year as four digits, or leave it empty.');
    const fields: DateFields = {
      dateKind: kind, label, monthDay: md, status: start?.status ?? 'active',
      ...(year.trim() ? { year: Number(year.trim()) } : {}),
      ...(memberId ? { memberId: Number(memberId) } : {}),
      ...(!onCalendar ? { onCalendar: false } : {}),
    };
    setBusy(true);
    try {
      if (record) { await updateDate(record.id, fields); onSaved(record.id); } else onSaved(await createDate(fields));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nothing was saved.');
      setBusy(false);
    }
  }

  return (
    <Modal title={record ? 'Edit family date' : 'Add a family date'} onClose={onClose}>
      <form className="fm-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="fm-note">Birthdays of family members come from their profiles, so they are not added here.</p>
        <label className="f">Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as DateKind)}>{DATE_KINDS.map((k) => <option key={k} value={k}>{DATE_KIND_LABEL[k]}</option>)}</select>
        </label>
        <label className="f">Name
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={LABEL_MAX} autoComplete="off" aria-describedby="fm-date-label-help" />
        </label>
        <p className="muted small" id="fm-date-label-help">This is the title that appears on your Calendar. Keep private details out of it.</p>
        <fieldset className="fm-sub">
          <legend>Date (every year)</legend>
          <div className="fm-two">
            <label className="f">Month
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">Choose</option>
                {MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, '0')}>{n}</option>)}
              </select>
            </label>
            <label className="f">Day
              <select value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">Choose</option>
                {DAYS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <label className="f">Year it began (optional)<input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" maxLength={4} autoComplete="off" /></label>
        </fieldset>
        <label className="f">About a family member (optional)
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Nobody in particular</option>
            {choices.map((m) => <option key={m.id} value={m.id}>{nameOf(m.data!.contactId)}</option>)}
          </select>
        </label>
        <label className="as-check"><input type="checkbox" checked={onCalendar} onChange={(e) => setOnCalendar(e.target.checked)} aria-describedby="fm-date-cal-help" /> Show this date on my Calendar</label>
        <p className="muted small" id="fm-date-cal-help">Your own Calendar and Today only. It does not share the date with anyone or anything else.</p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row fm-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{record ? 'Save' : 'Add date'}</button>
        </div>
      </form>
    </Modal>
  );
}
