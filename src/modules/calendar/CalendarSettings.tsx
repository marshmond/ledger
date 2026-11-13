import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  DEFAULT_CALENDAR_SETTINGS, FINANCE_CLASSES, FINANCE_CLASS_LABEL, loadCalendarSettings, saveCalendarSettings, type CalendarSettings, type FinanceClass,
} from '../../core/calendarSettings';
import type { Priority } from '../../core/entities';
import { ensureCalendarSeed, loadLayers } from './data';
import { PRIORITIES, PRIORITY_ICON, PRIORITY_LABEL } from './model';
import { WEEKDAYS_LONG } from './time';
import { PageHeader } from '../../ui/components';
import { SettingsSection } from '../../pages/SettingsParts';

/** Calendar options, shown on the shell's Settings page. */
export default function CalendarSettingsCard() {
  const s = useLiveQuery(() => loadCalendarSettings(), []);
  const layers = useLiveQuery(() => loadLayers(), []) ?? [];
  const [days, setDays] = useState('');
  useEffect(() => { void ensureCalendarSeed().catch(() => undefined); }, []);
  useEffect(() => { if (s) setDays(String(s.overdueDays)); }, [s?.overdueDays]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <p className="muted">Loading…</p>;
  const set = (patch: Partial<CalendarSettings>) => void saveCalendarSettings(patch);
  const local = layers.filter((l) => l.sourceType === 'local');

  return (
    <>
      <PageHeader title="Calendar" description="How the Calendar looks when it opens, where new events go, and how Finance items show up on it." />

      <SettingsSection id="cal-display" title="Display" intro="How the Calendar looks when you open it. You can still switch views on the Calendar itself.">
        <div className="an-form">
          <label className="f">First day of the week
            <select value={s.weekStart} onChange={(e) => set({ weekStart: Number(e.target.value) })}>
              {WEEKDAYS_LONG.map((w, d) => <option key={w} value={d}>{w}</option>)}
            </select>
          </label>
          <label className="f">Open the Calendar on
            <select value={s.openWith} onChange={(e) => set({ openWith: e.target.value as CalendarSettings['openWith'] })}>
              <option value="last">The view I used last</option>
              <option value="month">Month</option>
              <option value="week">Week</option>
              <option value="workweek">Work week</option>
              <option value="agenda">Agenda</option>
            </select>
          </label>
        </div>
      </SettingsSection>

      <SettingsSection id="cal-defaults" title="Defaults" intro="Where an event goes when you do not pick a calendar.">
        <div className="an-form">
          <label className="f">New events go into
            <select value={s.defaultCalendarId ?? local.find((l) => l.builtin)?.id ?? ''} onChange={(e) => set({ defaultCalendarId: Number(e.target.value) })}>
              {local.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        </div>
      </SettingsSection>

      <SettingsSection id="cal-finance" title="Finance items on the Calendar">
        <div className="an-form">
          <label className="f">Show past-due Finance items for (days)
            <input
              inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)}
              onBlur={() => { const n = Math.floor(Number(days)); if (Number.isFinite(n) && n >= 0 && n <= 3650) set({ overdueDays: n }); else setDays(String(s.overdueDays)); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
          </label>
        </div>
        <p className="muted small">Past-due Finance items are scheduled items you have neither approved nor skipped. Older ones stay on Ledger's Scheduled page; the Calendar just stops listing them. Ledger itself is not changed by this setting.</p>
      </SettingsSection>

      <SettingsSection id="cal-priority" title="Finance items: default priority"
        intro="Each kind of Finance item gets this priority on the Calendar (it is not per item). Bills and loan payments set to Medium become High when due within 3 days or overdue.">
        <div className="an-form">
          {FINANCE_CLASSES.map((c: FinanceClass) => (
            <label key={c} className="f">{FINANCE_CLASS_LABEL[c]}
              <select value={s.financePriorities[c]} onChange={(e) => set({ financePriorities: { ...s.financePriorities, [c]: e.target.value as Priority } })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_ICON[p]} {PRIORITY_LABEL[p]}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="row se-actions"><button className="btn" onClick={() => set({ financePriorities: DEFAULT_CALENDAR_SETTINGS.financePriorities })}>Reset priorities</button></div>
      </SettingsSection>
    </>
  );
}
