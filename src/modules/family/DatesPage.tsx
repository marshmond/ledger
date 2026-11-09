import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { store } from '../../core/store';
import ConfirmDialog from '../../shell/ConfirmDialog';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import DateForm from './DateForm';
import { loadMembers } from './data';
import { loadDates, setDateOnCalendar, setDateStatus } from './dateData';
import { DATE_KIND_LABEL, type DateRecord } from './dateModel';
import { memberRoute, MONTH_NAMES, monthDayText } from './model';
import { upcomingRows, type UpcomingRow } from './upcoming';

/** "14 May 2027" from a plain date, with no time zone involved. */
const dateText = (iso: string) => `${Number(iso.slice(8))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const TYPE_LABEL: Record<UpcomingRow['type'], string> = { birthday: 'Birthday', ...DATE_KIND_LABEL };

/**
 * Family dates: member birthdays (from their profiles) and important dates (anniversaries and others) in the order they next fall. A date can be added,
 * edited, kept off the Calendar, or archived (never permanently deleted; an archived date can be restored).
 */
export default function DatesPage() {
  const today = useToday();
  const members = useLiveQuery(() => loadMembers(), []);
  const dates = useLiveQuery(() => loadDates(), []);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []);
  const [form, setForm] = useState<{ record?: DateRecord } | null>(null);
  const [confirm, setConfirm] = useState<DateRecord | null>(null);
  const toast = useToast();

  const head = (
    <PageHeader
      title="Family dates"
      description="Birthdays and other dates the household wants to remember. They appear on your Calendar (the Family layer) and on Today, and nothing is copied or scheduled."
      actions={<button type="button" className="btn primary" onClick={() => setForm({})}>Add date</button>}
    />
  );
  if (!members || !dates || !contacts) return <div className="fm">{head}<p className="muted" role="status">Loading…</p></div>;

  const names = new Map(contacts.filter((c) => c.id !== undefined).map((c) => [c.id as number, c.name]));
  const rows = upcomingRows(members, dates, names, today);
  const recordOf = (id: number | undefined) => dates.find((r) => r.id === id);
  const archived = dates.filter((r) => r.data?.status === 'archived');
  const review = dates.filter((r) => !r.data);
  const withProblems = dates.filter((r) => r.data && r.problems.length);

  const rowView = (r: UpcomingRow) => {
    const rec = r.recordId !== undefined ? recordOf(r.recordId) : undefined;
    return (
      <li key={r.key} className="fm-card fm-date-row">
        <div className="fm-card-text">
          <span className="fm-name">{r.title}</span>
          <span className="muted small">{dateText(r.date)} · {TYPE_LABEL[r.type]}{r.onCalendar ? '' : ' · Not on my Calendar'}</span>
        </div>
        <span className="row fm-date-actions">
          {r.memberId !== undefined && <Link to={memberRoute(r.memberId)} className="btn fm-mini" aria-label={`Open profile: ${r.title}`}>Open profile</Link>}
          {rec && (
            <>
              <button type="button" className="btn fm-mini" aria-label={`Edit ${r.title}`} onClick={() => setForm({ record: rec })}>Edit</button>
              <button type="button" className="btn fm-mini" aria-label={`${r.onCalendar ? 'Take off' : 'Put on'} my Calendar: ${r.title}`}
                onClick={async () => { await setDateOnCalendar(rec.id, !r.onCalendar); toast(r.onCalendar ? 'Taken off your Calendar' : 'Put on your Calendar'); }}>
                {r.onCalendar ? 'Take off Calendar' : 'Put on Calendar'}
              </button>
              <button type="button" className="btn fm-mini" aria-label={`Archive ${r.title}`} onClick={() => setConfirm(rec)}>Archive</button>
            </>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="fm">
      {head}
      <p><Link to="/" className="fm-back">← Family</Link></p>

      {rows.length === 0 ? (
        <EmptyState title="No family dates yet" action={<button type="button" className="btn primary" onClick={() => setForm({})}>Add a date</button>}>
          Birthdays appear here once a member has one set. Add anniversaries and other yearly dates yourself.
        </EmptyState>
      ) : (
        <section className="card" aria-labelledby="fm-up">
          <div className="card-head"><h2 className="card-title" id="fm-up">Coming up</h2><span className="muted small">{rows.length}</span></div>
          <ul className="plain fm-list">{rows.map(rowView)}</ul>
        </section>
      )}

      {withProblems.length > 0 && (
        <div className="fm-warn" role="status">
          <strong>Part of {withProblems.length === 1 ? 'a date' : `${withProblems.length} dates`} could not be read</strong>
          <p className="small">The stored values are untouched until you save that date again. {withProblems.map((r) => r.data!.label).join(', ')}.</p>
        </div>
      )}

      {archived.length > 0 && (
        <section className="card" aria-labelledby="fm-arch">
          <div className="card-head"><h2 className="card-title" id="fm-arch">Archived dates</h2><span className="muted small">{archived.length}</span></div>
          <p className="muted small">Archived dates are not on your Calendar. Nothing is deleted; restore one to bring it back.</p>
          <ul className="plain fm-list">
            {archived.map((r) => (
              <li key={r.id} className="fm-card fm-date-row">
                <div className="fm-card-text"><span className="fm-name">{r.data!.label}</span><span className="muted small">{monthDayText(r.data!.monthDay)} · {DATE_KIND_LABEL[r.data!.dateKind]}</span></div>
                <button type="button" className="btn fm-mini" aria-label={`Restore ${r.data!.label}`} onClick={async () => { await setDateStatus(r.id, 'active'); toast('Restored'); }}>Restore</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.length > 0 && (
        <section className="card" aria-labelledby="fm-date-review">
          <div className="card-head"><h2 className="card-title" id="fm-date-review">Needs review</h2><span className="muted small">{review.length}</span></div>
          <p className="muted small">These records could not be read by this version of Ledger. They are kept exactly as they are and nothing was changed.</p>
          <ul className="plain fm-list">{review.map((r) => <li key={r.id} className="fm-card"><div className="fm-card-text"><span className="fm-name">Record {r.id}</span><span className="muted small">{r.problems.join(' ')}</span></div></li>)}</ul>
        </section>
      )}

      {form && <DateForm record={form.record} onClose={() => setForm(null)} onSaved={() => { setForm(null); toast(form.record ? 'Saved' : 'Added'); }} />}
      {confirm?.data && (
        <ConfirmDialog
          title="Archive this date?"
          confirmLabel="Archive date"
          tone="primary"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { await setDateStatus(confirm.id, 'archived'); setConfirm(null); toast('Archived'); }}
        >
          <p>“{confirm.data.label}” stops appearing on your Calendar and Today. Nothing is deleted: it moves to “Archived dates”, and you can restore it at any time.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
