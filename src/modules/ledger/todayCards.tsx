import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { TodayCardDef, TodayCardProps } from '../../core/registry';
import { useSharedLive } from '../../core/sharedLive';
import { cashOutlook } from '../../lib/cashOutlook';
import { formatCents } from '../../lib/money';
import { loadForecast } from '../../lib/forecastLive';
import { useLedgerAlerts } from '../../pages/useLedgerAlerts';
import { dayLabel } from '../../core/time';
import { maskAmounts } from '../today/logic';
import { alertKey, isAlertHidden, isValidSnoozeDate, loadAlertMemory, rememberAlert, restoreAlert, snoozeUntil } from '../today/settings';

/** Ledger's own address from an in-Ledger one (`/budget` becomes `#/ledger/budget`). */
const ledgerHref = (to: string) => `#/ledger${to.startsWith('/') ? to : `/${to}`}`;

/**
 * "Needs attention": the same alerts Ledger Home shows (computed by the same hook), minus the ones you dismissed or snoozed.
 * Each is remembered against the alert plus the period it is about, and shared with your other devices, so it comes back by itself
 * when the situation changes (next month, a different dip date, another account under its minimum).
 */
function AttentionCard({ today, hideAmounts, reportEmpty }: TodayCardProps) {
  const { alerts, hasData } = useLedgerAlerts(today);
  const memory = useLiveQuery(() => loadAlertMemory(db), []);
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [customDate, setCustomDate] = useState('');

  const shown = alerts.filter((a) => !isAlertHidden(memory?.[alertKey(a)], today));
  const hidden = alerts.filter((a) => isAlertHidden(memory?.[alertKey(a)], today));
  useEffect(() => { reportEmpty(false); }, [reportEmpty]);
  const text = (s: string) => (hideAmounts ? maskAmounts(s) : s);

  return (
    <section className="card" aria-label="Needs attention">
      <div className="card-head"><strong>Needs attention</strong>{shown.length > 0 && <span className="badge">{shown.length}</span>}<a className="card-link" href="#/ledger">Ledger Home</a></div>
      {shown.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{hasData ? 'Nothing needs attention right now.' : 'Alerts will show here once you have entered some data in Ledger.'}</p>
      ) : (
        <ul className="alerts">
          {shown.map((a) => {
            const key = alertKey(a);
            return (
              <li key={key} className={`alert ${a.level}`}>
                <div className="td-att">
                  <strong>{text(a.title)}</strong>
                  <div className="muted">{text(a.detail)}</div>
                  <div className="td-att-acts">
                    <a className="alert-act" href={ledgerHref(a.to)}>{a.actionLabel}</a>
                    {snoozing === key ? (
                      <>
                        <span className="muted">Snooze until</span>
                        <button className="link" onClick={() => { void rememberAlert(key, { state: 'snoozed', until: snoozeUntil(today, 1) }); setSnoozing(null); }}>tomorrow</button>
                        <button className="link" onClick={() => { void rememberAlert(key, { state: 'snoozed', until: snoozeUntil(today, 7) }); setSnoozing(null); }}>next week</button>
                        <span className="muted">or</span>
                        <input type="date" aria-label="Snooze until a date" value={customDate} min={snoozeUntil(today, 1)} onChange={(e) => setCustomDate(e.target.value)} style={{ minHeight: 32, width: 'auto' }} />
                        <button className="link" disabled={!isValidSnoozeDate(customDate, today)} onClick={() => { void rememberAlert(key, { state: 'snoozed', until: customDate }); setSnoozing(null); setCustomDate(''); }}>Snooze</button>
                        <button className="link" onClick={() => { setSnoozing(null); setCustomDate(''); }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="link" onClick={() => setSnoozing(key)} aria-label={`Snooze: ${text(a.title)}`}>Snooze</button>
                        <button className="link" onClick={() => void rememberAlert(key, { state: 'dismissed' })} aria-label={`Dismiss: ${text(a.title)}`}>Dismiss</button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hidden.length > 0 && (
        <div className="td-hidden-list">
          <button className="link" onClick={() => setShowHidden(!showHidden)} aria-expanded={showHidden}>{hidden.length} dismissed or snoozed {showHidden ? '(hide)' : '(show)'}</button>
          {showHidden && (
            <ul className="plain">
              {hidden.map((a) => {
                const key = alertKey(a);
                const m = memory?.[key];
                return (
                  <li key={key}>
                    <span>{text(a.title)} <span className="muted">· {m?.state === 'snoozed' && m.until ? `snoozed until ${dayLabel(m.until)}` : 'dismissed'}</span></span>
                    <button className="link" onClick={() => void restoreAlert(key)}>Bring back</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** "Cash outlook": only the lowest point of the next 90 days (date and amount) and whether it is under your level. Nothing if there is no meaningful forecast. */
function CashCard({ today, hideAmounts, reportEmpty }: TodayCardProps) {
  const f = useSharedLive(`ledger.forecast:${today}`, () => loadForecast(db, today));
  const o = f ? cashOutlook(f, today) : null;
  useEffect(() => { reportEmpty(!o); }, [o, reportEmpty]); // while it loads there is nothing to show either
  if (!f || !o) return null;
  const money = (c: number) => (hideAmounts ? '$••••' : formatCents(c));
  return (
    <section className="card" aria-label="Cash outlook">
      <div className="card-head"><strong>Cash outlook</strong><a className="card-link" href="#/ledger/forecast">Forecast</a></div>
      <div className={`td-cash-low ${o.below ? 'neg' : ''}`}>{money(o.lowCents)}</div>
      <div className="muted">Lowest point in the next 90 days, on {dayLabel(o.lowDate)}</div>
      <p className={o.below ? 'warn' : 'ok'} style={{ margin: 'var(--sp-2) 0 0' }}>
        {o.below
          ? `Under your ${o.usesMinimums ? 'account minimums' : 'warning level'} (${money(o.thresholdCents)}).`
          : `Stays above your ${o.usesMinimums ? 'account minimums' : 'warning level'} (${money(o.thresholdCents)}).`}
      </p>
    </section>
  );
}

export const LEDGER_TODAY_CARDS: TodayCardDef[] = [
  { id: 'ledger.attention', title: 'Needs attention', defaultWidth: 'half', priority: 40, Component: AttentionCard },
  { id: 'ledger.cash', title: 'Cash outlook', defaultWidth: 'half', priority: 50, hideWhenEmpty: true, Component: CashCard },
];
