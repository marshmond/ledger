/**
 * R4.3: the Calendar's "Export a calendar file (.ics)" dialog. The owner ticks which calendars and layers go into ONE downloaded snapshot, chooses whether
 * financial amounts and reminders are in it, sees exactly what the file will hold, and downloads it. The ticks here are the dialog's own: they start from what the
 * Calendar is showing but never write that choice back (`calendar-hidden-layers` is untouched). Nothing is stored and nothing is sent anywhere.
 * What goes in the file is decided by `exportPlan.ts`; what a layer holds is read from its own module's due provider (`exportRead.ts`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { allDueProviders } from '../../core/dueProvider';
import { loadHideAmounts } from '../../core/hideAmounts';
import { downloadText } from '../../lib/download';
import { todayISO } from '../../lib/money';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { buildExport, choiceOf, defaultKeys, offeredLayers, type OfferedLayer } from './exportPlan';
import { readProviders, readStored, type ExportStored, type ProviderRead } from './exportRead';
import type { CalendarLayer } from './model';
import { dayLabel } from './time';

const slug = (s: string) => s.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'calendar';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ExportDialog({ layers, isVisible, only, onClose }: { layers: CalendarLayer[]; isVisible: (id: number) => boolean; only?: number; onClose: () => void }) {
  const toast = useToast();
  const today = todayISO();
  const hide = loadHideAmounts();
  const offered = useMemo(() => offeredLayers(layers, allDueProviders().map((p) => p.id)).filter((l) => only === undefined || l.id === only), [layers, only]);
  const [keys, setKeys] = useState<string[]>(() => (only !== undefined ? offered.map((l) => l.key) : defaultKeys(offered, isVisible)));
  const [amounts, setAmounts] = useState(false);
  const [askAmounts, setAskAmounts] = useState(false);
  const [alarms, setAlarms] = useState(true);
  const [stored, setStored] = useState<ExportStored | null>(null);
  const [reads, setReads] = useState<Record<string, ProviderRead>>({});
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nowIso = useRef(new Date().toISOString());
  const providerIds = useMemo(() => offered.filter((l) => l.kind === 'provider').map((l) => l.providerId!), [offered]);

  const load = async (ids: readonly string[]) => {
    try {
      const [st, rs] = await Promise.all([readStored(), readProviders(ids, today)]);
      setStored(st);
      setReads((cur) => ({ ...cur, ...Object.fromEntries(rs.map((r) => [r.providerId, r])) }));
      setLoadError('');
    } catch {
      setLoadError('Your own calendars could not be read, so nothing can be exported right now. Close this and try again.');
    }
  };
  useEffect(() => { void load(providerIds); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choice = useMemo(() => choiceOf(keys, offered, amounts, alarms), [keys, offered, amounts, alarms]);
  const failed = choice.providerIds.filter((p) => reads[p] && !reads[p].ok);
  const waiting = !stored || choice.providerIds.some((p) => !reads[p]);
  const nameOf = (p: string) => offered.find((l) => l.providerId === p)?.name ?? p;
  const result = useMemo(() => {
    if (!stored || waiting || failed.length) return null;
    const derived = Object.fromEntries(Object.values(reads).filter((r) => r.ok).map((r) => [r.providerId, r.items]));
    return buildExport({ layers, events: stored.events, derived, choice, today, nowIso: nowIso.current, tagName: (id) => stored.tags.get(id) });
  }, [stored, reads, choice, waiting, failed.length, layers, today]);
  const total = result ? result.storedEvents + result.derivedCount : 0;
  const hasDerived = offered.some((l) => l.kind === 'provider');

  const toggle = (k: string) => setKeys((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const wantAmounts = (on: boolean) => { if (on && hide) setAskAmounts(true); else { setAmounts(on); setAskAmounts(false); } };

  const countOf = (l: OfferedLayer): string => {
    if (l.kind === 'local') return stored ? plural(stored.events.filter((e) => !e.data.retired && e.data.calendarId === l.id).length, 'event') : 'Reading…';
    const r = reads[l.providerId!];
    if (!r) return 'Reading…';
    if (!r.ok) return 'Could not be read';
    return r.items.length === 0 ? 'Nothing scheduled in this period' : plural(r.items.length, 'date');
  };

  const run = async () => {
    setBusy(true); setError('');
    try {
      const [st, rs] = await Promise.all([readStored(), readProviders(choice.providerIds, today)]);
      setStored(st);
      setReads((cur) => ({ ...cur, ...Object.fromEntries(rs.map((r) => [r.providerId, r])) }));
      const bad = rs.filter((r) => !r.ok);
      if (bad.length) { setError(`No file was made, because ${bad.map((r) => nameOf(r.providerId)).join(', ')} could not be read. Try again, or untick ${bad.length === 1 ? 'it' : 'them'}.`); return; }
      const out = buildExport({ layers, events: st.events, derived: Object.fromEntries(rs.map((r) => [r.providerId, r.items])), choice, today, nowIso: new Date().toISOString(), tagName: (id) => st.tags.get(id) });
      if (out.storedEvents + out.derivedCount === 0) { setError('There is nothing to put in the file for these choices.'); return; }
      downloadText(`${slug(out.name === 'Ledger household calendar' ? 'ledger-household-calendar' : out.name)}.ics`, 'text/calendar', out.text);
      toast(`Downloaded ${plural(out.storedEvents, 'event')} and ${plural(out.derivedCount, 'date')}`);
      onClose();
    } catch {
      setError('The file could not be saved by this browser. Nothing was changed in Ledger. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const groups: { label: string; rows: OfferedLayer[] }[] = [
    { label: 'Your calendars', rows: offered.filter((l) => l.kind === 'local') },
    { label: 'Household layers', rows: offered.filter((l) => l.kind === 'provider') },
  ].filter((g) => g.rows.length > 0);
  const canDownload = !busy && !waiting && failed.length === 0 && total > 0 && keys.length > 0;

  return (
    <Modal title="Export a calendar file (.ics)" onClose={onClose} wide description="A snapshot you download and add to your phone or computer calendar. Nothing is sent anywhere.">
      {only === undefined && (
        <div className="row cal-xtools">
          <span className="muted small" role="status">{keys.length} of {offered.length} selected</span>
          <button type="button" className="link" onClick={() => setKeys(offered.map((l) => l.key))}>Select all</button>
          <button type="button" className="link" onClick={() => setKeys([])}>Deselect all</button>
        </div>
      )}
      {groups.map((g) => (
        <fieldset key={g.label} className="cal-xgroup">
          <legend>{g.label}</legend>
          {g.rows.map((l) => (
            <label key={l.key} className="cal-check cal-xrow">
              <input type="checkbox" checked={keys.includes(l.key)} onChange={() => toggle(l.key)} />
              <span className="cal-swatch" style={{ background: l.color }} aria-hidden="true" />
              <span>{l.name}</span>
              <span className="muted small cal-xcount">{countOf(l)}</span>
            </label>
          ))}
        </fieldset>
      ))}
      {offered.length === 0 && <p className="muted small">There is no calendar to export.</p>}
      {only === undefined && !choice.providerIds.includes('tasks') && providerIds.includes('tasks') && (choice.providerIds.includes('bills') || choice.providerIds.includes('services')) && <p className="muted small" role="note">Tasks is not ticked. A bill reminder or the next household visit that already has a Task is listed on the Tasks layer instead of its own, so tick Tasks to include those.</p>}
      {only === undefined && <p className="muted small">The boxes start from what the Calendar is showing. Changing them here does not change what the Calendar shows.</p>}

      {hasDerived && (
        <fieldset className="cal-xgroup">
          <legend>Privacy</legend>
          <p className="small">A calendar file is an ordinary file outside Ledger's encrypted storage. Anyone who gets a copy can read it. Titles and notes you typed yourself are written exactly as typed.</p>
          <label className="cal-check"><input type="checkbox" checked={amounts} onChange={(e) => wantAmounts(e.target.checked)} /> Include Finance-generated amounts in exported events</label>
          <p className="muted small">{amounts ? 'Amounts are included where Ledger shows them (for example a scheduled payment or loan payment), so anyone who can read this file can see them.' : 'Off: Finance dates are listed by payee or name only, with no Finance amounts in titles, descriptions or reminders. This does not look inside titles or notes you wrote yourself; those are exported as written.'}</p>
          {hide && !amounts && !askAmounts && <p className="muted small" role="note">Hide Amounts is on, so amounts stay out of the file unless you choose otherwise here.</p>}
          {askAmounts && (
            <div className="bl-warn small cal-xconfirm" role="group" aria-label="Confirm including amounts">
              <p>Hide Amounts is on in Ledger. Include amounts in this file anyway? Ledger on screen keeps hiding them either way.</p>
              <div className="row"><button type="button" className="btn" onClick={() => { setAmounts(true); setAskAmounts(false); }}>Include amounts</button><button type="button" className="btn primary" onClick={() => setAskAmounts(false)}>Keep amounts out</button></div>
            </div>
          )}
        </fieldset>
      )}
      <label className="cal-check"><input type="checkbox" checked={alarms} onChange={(e) => setAlarms(e.target.checked)} /> Include reminders (alarms)</label>
      <p className="muted small">Your own events keep the reminders you set. Other dates get a reminder only where they are a deadline or have a clock time.</p>

      {failed.length > 0 && (
        <div className="bl-warn small" role="alert">
          <p>{failed.map(nameOf).join(', ')} could not be read, so {failed.length === 1 ? 'it is' : 'they are'} not shown as empty. Try again, or untick {failed.length === 1 ? 'it' : 'them'}.</p>
          <button type="button" className="btn" onClick={() => { setReads((cur) => { const n = { ...cur }; failed.forEach((f) => delete n[f]); return n; }); void load(failed); }}>Try again</button>
        </div>
      )}
      {loadError && <p className="bl-warn small" role="alert">{loadError}</p>}

      <section className="cal-xsummary" aria-live="polite" aria-label="What the file will contain">
        <strong>What the file will contain</strong>
        {keys.length === 0 ? <p className="muted small">Nothing is selected. Tick at least one calendar or layer.</p>
          : !result ? <p className="muted small">{failed.length ? 'Waiting for the source above.' : 'Reading…'}</p>
          : total === 0 ? <p className="muted small">There is nothing to export for these choices: no events and no dates in the next 12 months.</p>
          : (
            <>
              <ul className="plain small">
                {choice.localIds.length > 0 && <li><b>{plural(result.storedEvents, 'event')}</b> from your own calendars (repeating events are written once, with their repeat rule). They are included in full, including dates already past.</li>}
                {choice.providerIds.length > 0 && <li><b>{plural(result.derivedCount, 'date')}</b> from {result.layers.filter((l) => l.key !== 'local').map((l) => `${l.name} (${l.count})`).join(', ')}, covering {dayLabel(result.from, { year: true })} to {dayLabel(result.to, { year: true })}.</li>}
                <li>Financial amounts: <b>{result.amounts ? 'included' : 'not included'}</b>. Reminders: <b>{!result.alarms ? 'not included' : plural(result.alarmCount, 'item') + ' with a reminder'}</b>.</li>
                {result.coveredCount > 0 && <li>{plural(result.coveredCount, 'date')} left out because another selected entry already stands for {result.coveredCount === 1 ? 'it' : 'them'}.</li>}
              </ul>
              <ul className="plain small cal-xprev" aria-label="A sample of the entries">
                {result.preview.map((e, i) => <li key={`${e.date}-${i}`}><span className="muted">{dayLabel(e.date)}</span> {e.title} <span className="muted">· {e.layer}</span></li>)}
              </ul>
            </>
          )}
        <p className="muted small">This is a one-way snapshot. It does not update itself: after something changes in Ledger, download and import it again.</p>
      </section>

      {error && <p className="bl-warn small" role="alert">{error}</p>}
      <div className="row cal-actions"><button className="btn primary" disabled={!canDownload} onClick={() => void run()}>{busy ? 'Preparing…' : 'Download'}</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}
