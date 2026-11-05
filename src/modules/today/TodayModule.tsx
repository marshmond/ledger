import { useCallback, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ModuleBase } from '../../core/router';
import { allTodayCards } from '../../core/registry';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import { PageHeader } from '../../ui/components';
import { useToday } from '../../ui/useToday';
import '../calendar/calendar.css';
import './today.css';
import CardBoundary from './CardBoundary';
import { HIDE_AMOUNTS_KEY, loadHideAmounts, loadLayout, moveEntry, resetLayout, saveHideAmounts, saveLayout, toggleEntryHidden, toggleEntrySize, type LayoutEntry } from './layout';
import { LOOK_AHEAD_CHOICES, loadTodaySettings, saveTodaySettings } from './settings';
import { TodayDataProvider } from './TodayData';

export const TODAY_BASE = '/today';

const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

/** Today: one screen that merges every module. The cards come from the module registry; their order, width and visibility are per device. */
export default function TodayModule() {
  const today = useToday();
  return (
    <ModuleBase value={TODAY_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <main className="main cal-main">
            <TodayDataProvider today={today}>
              <TodayScreen today={today} />
            </TodayDataProvider>
          </main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}

function TodayScreen({ today }: { today: string }) {
  const defs = useMemo(() => allTodayCards(), []);
  const byId = useMemo(() => new Map(defs.map((c) => [c.id, c])), [defs]);
  const [layout, setLayoutState] = useState<LayoutEntry[]>(() => loadLayout(defs));
  const [hideAmounts, setHideAmountsState] = useState(() => loadHideAmounts());
  const [editing, setEditing] = useState(false);
  const [empty, setEmpty] = useState<Record<string, boolean>>({});
  const settings = useLiveQuery(() => loadTodaySettings(), []);

  const update = (next: LayoutEntry[]) => { setLayoutState(next); saveLayout(next); };
  const setHide = (on: boolean) => { setHideAmountsState(on); saveHideAmounts(on); };
  const reset = () => { resetLayout(); setLayoutState(loadLayout(defs, { getItem: () => null })); };

  // One stable reportEmpty function per card, so a card's effect does not run again every render.
  const reporters = useRef(new Map<string, (e: boolean) => void>());
  const reporter = useCallback((id: string) => {
    let f = reporters.current.get(id);
    if (!f) {
      f = (e: boolean) => setEmpty((cur) => (cur[id] === e ? cur : { ...cur, [id]: e }));
      reporters.current.set(id, f);
    }
    return f;
  }, []);

  const hiddenCards = layout.filter((c) => c.hidden && byId.has(c.id));

  return (
    <>
      <PageHeader
        title="Today"
        description={longDate(today)}
        actions={
          <>
            <button type="button" role="switch" aria-checked={hideAmounts} className={`td-switch ${hideAmounts ? 'on' : ''}`} onClick={() => setHide(!hideAmounts)} data-key={HIDE_AMOUNTS_KEY}>
              <span className="td-switch-box" aria-hidden="true" /> Hide amounts
            </button>
            <button className={editing ? 'primary' : ''} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit layout'}</button>
          </>
        }
      />

      {editing && (
        <div className="card edit-panel">
          <div className="card-head"><strong>Edit Today</strong><button className="link" onClick={reset}>Reset to default</button></div>
          <p className="muted">Use the arrows to reorder, the width button to make a card wider or narrower (computer screens), and Hide to take one off. The layout is saved on this device only. The look-ahead below is shared with your other devices.</p>
          <label className="f" style={{ maxWidth: 260 }}>Coming up looks ahead
            <select value={settings?.lookAheadDays ?? 7} onChange={(e) => void saveTodaySettings({ lookAheadDays: Number(e.target.value) })}>
              {LOOK_AHEAD_CHOICES.map((n) => <option key={n} value={n}>{n} days</option>)}
            </select>
          </label>
          {hiddenCards.length > 0
            ? <div className="row" style={{ marginTop: 'var(--sp-3)' }}><span className="muted">Hidden cards:</span>{hiddenCards.map((c) => <button key={c.id} onClick={() => update(toggleEntryHidden(layout, c.id))}>+ {byId.get(c.id)!.title}</button>)}</div>
            : <p className="muted" style={{ margin: 'var(--sp-3) 0 0' }}>Every card is on the page.</p>}
        </div>
      )}

      <div className="home-grid">
        {layout.map((entry, i) => {
          const def = byId.get(entry.id);
          if (!def) return null;
          if (entry.hidden && !editing) return null;
          const hiddenForNow = !!def.hideWhenEmpty && empty[entry.id] === true;
          const Card = def.Component;
          return (
            <div key={entry.id} className={`hc ${entry.size} ${editing ? 'editing' : ''} ${entry.hidden ? 'td-off' : ''}`} hidden={!editing && hiddenForNow}>
              {editing && (
                <div className="hc-bar">
                  <span className="grow">{def.title}{hiddenForNow && !entry.hidden ? ' (nothing to show now)' : ''}</span>
                  <button aria-label={`Move ${def.title} earlier`} disabled={i === 0} onClick={() => update(moveEntry(layout, entry.id, -1))}>↑</button>
                  <button aria-label={`Move ${def.title} later`} disabled={i === layout.length - 1} onClick={() => update(moveEntry(layout, entry.id, 1))}>↓</button>
                  <button className="hc-width" onClick={() => update(toggleEntrySize(layout, entry.id))}>{entry.size === 'full' ? 'Make narrower' : 'Make wider'}</button>
                  <button aria-label={`${entry.hidden ? 'Show' : 'Hide'} ${def.title}`} onClick={() => update(toggleEntryHidden(layout, entry.id))}>{entry.hidden ? 'Show' : 'Hide'}</button>
                </div>
              )}
              {entry.hidden
                ? <div className="card hc-stub"><p className="muted" style={{ margin: 0 }}>{def.title} is hidden on this device.</p></div>
                : <CardBoundary title={def.title}><Card today={today} hideAmounts={hideAmounts} reportEmpty={reporter(entry.id)} /></CardBoundary>}
            </div>
          );
        })}
      </div>
    </>
  );
}
