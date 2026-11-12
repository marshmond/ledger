import Main from '../../shell/Main';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ModuleBase } from '../../core/router';
import { allTodayCards } from '../../core/registry';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import { PageHeader } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { useToday } from '../../ui/useToday';
import '../calendar/calendar.css';
import './today.css';
import CardBoundary from './CardBoundary';
import { HIDE_AMOUNTS_KEY, HIDE_AMOUNTS_SCOPE, loadHideAmounts, saveHideAmounts } from '../../core/hideAmounts';
import {
  NOTICE_KEY, PHONE_PROMOTED, STATUS_TITLE, composeToday, copyArrangement, defaultArrangement, forgetArrangement, hideCard, isCustomLegacy, loadArrangement, moveUnit,
  readLegacy, saveArrangement, showCard, unitTitle, type PlacedCard, type PlacedUnit, type TodayArrangement,
} from './composition';
import { LOOK_AHEAD_CHOICES, OVERDUE_ROWS_CHOICES, loadTodaySettings, saveTodaySettings } from './settings';
import { TodayDataProvider } from './TodayData';
import { TodayHero } from './TodayHero';
import { PHONE_QUERY, headingDate } from './todayModel';

export const TODAY_BASE = '/today';

/**
 * Today: one screen that merges every module. D13.1: a Next up bar and a status band, then a wide agenda column and a narrow supporting column. The cards come
 * from the module registry; their placement is designed (see composition.ts) and only the supporting sections and the hidden cards are per device.
 */
export default function TodayModule() {
  const today = useToday();
  return (
    <ModuleBase value={TODAY_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <Main className="main cal-main">
            <TodayDataProvider today={today}>
              <TodayScreen today={today} />
            </TodayDataProvider>
          </Main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}

/** "Thursday · November 12, 2026": a bold weekday and the rest, from the app's own date (never a fixed one). */
function DateLine({ today }: { today: string }) {
  const d = headingDate(today);
  return d ? <time dateTime={today}><b>{d.weekday}</b> · {d.rest}</time> : <>{today}</>;
}

function TodayScreen({ today }: { today: string }) {
  const defs = useMemo(() => allTodayCards(), []);
  const byId = useMemo(() => new Map(defs.map((c) => [c.id, c])), [defs]);
  const [loaded, setLoaded] = useState(() => loadArrangement(defs));
  const [hideAmounts, setHideAmountsState] = useState(() => loadHideAmounts());
  const [editing, setEditing] = useState(false);
  const [empty, setEmpty] = useState<Record<string, boolean>>({});
  const [noticeOff, setNoticeOff] = useState(() => { try { return localStorage.getItem(NOTICE_KEY) === '1'; } catch { return false; } });
  const settings = useLiveQuery(() => loadTodaySettings(), []);

  const arrangement = loaded.arrangement;
  // On a phone Cash outlook is drawn once, after Overdue (composition.ts, PHONE_PROMOTED); elsewhere the arrangement decides.
  const phone = useMediaQuery(PHONE_QUERY);
  const comp = useMemo(() => composeToday(defs, arrangement, { phone }), [defs, arrangement, phone]);
  const titleOf = (id: string) => byId.get(id)?.title ?? id;

  const update = (next: TodayArrangement) => { setLoaded({ arrangement: next, source: 'saved' }); saveArrangement(next); };
  const setHide = (on: boolean) => { setHideAmountsState(on); saveHideAmounts(on); };
  const resetToDefault = () => update(copyArrangement(defaultArrangement(defs)));
  const useEarlier = () => { forgetArrangement(); setLoaded(loadArrangement(defs)); };
  const dismissNotice = () => { try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* it just comes back next time */ } setNoticeOff(true); };
  // Only true when an earlier customized layout exists: then "Use my earlier layout again" has something to bring back.
  const earlierLayout = useMemo(() => { const l = readLegacy(defs); return l && isCustomLegacy(l, defs) ? l : null; }, [defs, loaded]);

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

  const hiddenCards = arrangement.hidden.filter((id) => byId.has(id));
  /** A card that is hidden because it reported nothing to show (not because the owner hid it). */
  const emptyNow = (id: string) => !!byId.get(id)?.hideWhenEmpty && empty[id] === true;
  /** Drawn now: not hidden by the owner, and not an empty "hide when empty" card. A card that has not reported yet counts as not drawn only when it hides itself when empty. */
  const drawn = (c: PlacedCard) => !c.hidden && (!byId.get(c.id)?.hideWhenEmpty || empty[c.id] === false);

  /** One card in its slot. `bar` is the Edit layout strip above it. */
  const slot = (c: PlacedCard, bar: ReactNode) => {
    const def = byId.get(c.id);
    if (!def) return null;
    if (c.hidden && !editing) return null;
    const Card = def.Component;
    const off = emptyNow(c.id);
    return (
      <div key={c.id} data-card={c.id} className={`td-slot${editing ? ' editing' : ''}${c.hidden ? ' td-off' : ''}`} hidden={!editing && off}>
        {editing && bar}
        {c.hidden
          ? <div className="card hc-stub"><p className="muted td-msg">{def.title} is hidden on this device.</p></div>
          : <CardBoundary title={def.title}><Card today={today} hideAmounts={hideAmounts} reportEmpty={reporter(c.id)} /></CardBoundary>}
      </div>
    );
  };

  const hideButton = (c: PlacedCard) => (
    <button aria-label={`${c.hidden ? 'Show' : 'Hide'} ${titleOf(c.id)}`} onClick={() => update(c.hidden ? showCard(arrangement, c.id) : hideCard(arrangement, c.id))}>{c.hidden ? 'Show' : 'Hide'}</button>
  );
  const note = (c: PlacedCard) => (emptyNow(c.id) && !c.hidden ? ' (nothing to show now)' : '');

  const agendaBar = (c: PlacedCard) => (
    <div className="hc-bar"><span className="grow">{titleOf(c.id)}{note(c)} <span className="muted">{c.promoted ? `· on a phone it follows ${titleOf(PHONE_PROMOTED.after)}` : '· stays in the agenda column'}</span></span>{hideButton(c)}</div>
  );
  /** Sections not in the side list right now (on a phone, Cash outlook is shown in the agenda column): a move steps past the next visible section. */
  const skipped = phone ? [PHONE_PROMOTED.id] : [];
  const moveButtons = (u: PlacedUnit, i: number) => {
    const t = unitTitle(u, titleOf);
    return (
      <>
        <button aria-label={`Move ${t} earlier`} disabled={i === 0} onClick={() => update(moveUnit(arrangement, u.id, -1, skipped))}>↑</button>
        <button aria-label={`Move ${t} later`} disabled={i === comp.side.length - 1} onClick={() => update(moveUnit(arrangement, u.id, 1, skipped))}>↓</button>
      </>
    );
  };

  const sideUnit = (u: PlacedUnit, i: number) => {
    if (!u.group) {
      const c = u.cards[0];
      return slot(c, <div className="hc-bar"><span className="grow">{titleOf(c.id)}{note(c)}</span>{moveButtons(u, i)}{hideButton(c)}</div>);
    }
    const anyDrawn = u.cards.some(drawn);
    if (!editing && u.cards.every((c) => c.hidden)) return null;
    return (
      <div key={u.id} role="group" aria-label={STATUS_TITLE} data-unit={u.id} className={`td-status${editing ? ' editing' : ''}`} hidden={!editing && !anyDrawn}>
        {editing && <div className="hc-bar"><span className="grow">{STATUS_TITLE}</span>{moveButtons(u, i)}</div>}
        <div className="td-status-title" aria-hidden="true">{STATUS_TITLE}</div>
        {u.cards.map((c) => slot(c, <div className="hc-bar"><span className="grow">{titleOf(c.id)}{note(c)}</span>{hideButton(c)}</div>))}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Today"
        className="td-head"
        description={<DateLine today={today} />}
        actions={
          <div className="td-tools">
            <button type="button" role="switch" aria-checked={hideAmounts} className={`td-switch ${hideAmounts ? 'on' : ''}`} onClick={() => setHide(!hideAmounts)} data-key={HIDE_AMOUNTS_KEY} aria-describedby="td-hide-help">
              <span className="td-switch-box" aria-hidden="true" /> Hide amounts
            </button>
            <button className={editing ? 'primary' : 'ghost'} onClick={() => setEditing(!editing)}>{editing ? 'Done' : <><Icon name="sliders" size={16} /> <span className="td-tool-label">Edit layout</span></>}</button>
          </div>
        }
      />

      {/* What the switch covers: always read out as the switch's description, and shown on screen while it is on. */}
      {hideAmounts ? <p id="td-hide-help" className="muted small td-hide-help">{HIDE_AMOUNTS_SCOPE.help}</p> : <span id="td-hide-help" className="sr-only">{HIDE_AMOUNTS_SCOPE.help}</span>}

      {loaded.source === 'derived' && !noticeOff && (
        <div className="card td-notice" role="note">
          <p><strong>Your earlier Today layout was carried over.</strong> The order of the side sections and any cards you hid are kept. Card widths no longer apply, because Today now has a wide agenda column and a narrow side column. Your earlier saved layout is untouched.</p>
          <div className="td-notice-acts">
            <button className="link" onClick={dismissNotice}>Got it</button>
            <button className="link" onClick={resetToDefault}>Use the new default arrangement</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="card edit-panel">
          <div className="card-head"><h2 className="card-title">Edit Today</h2><button className="link" onClick={resetToDefault}>Reset to default</button></div>
          <p className="muted">Use the arrows to move a side section up or down and Hide to take a card off the page. Today, Reminders due, Overdue and Coming up stay in the agenda column, in that order. The arrangement is saved on this device only. The two settings below are shared with your other devices.</p>
          <label className="f td-setting">Coming up looks ahead
            <select value={settings?.lookAheadDays ?? 7} onChange={(e) => void saveTodaySettings({ lookAheadDays: Number(e.target.value) })}>
              {LOOK_AHEAD_CHOICES.map((n) => <option key={n} value={n}>{n} days</option>)}
            </select>
          </label>
          <label className="f td-setting">Overdue lists up to
            <select value={settings?.overdueRows ?? 25} onChange={(e) => void saveTodaySettings({ overdueRows: Number(e.target.value) })}>
              {OVERDUE_ROWS_CHOICES.map((n) => <option key={n} value={n}>{n} items</option>)}
            </select>
          </label>
          {hiddenCards.length > 0
            ? <div className="row td-hidden-row"><span className="muted">Hidden cards:</span>{hiddenCards.map((id) => <button key={id} onClick={() => update(showCard(arrangement, id))}>+ {titleOf(id)}</button>)}</div>
            : <p className="muted td-msg td-hidden-row">Every card is on the page.</p>}
          {earlierLayout && loaded.source === 'saved' && <p className="td-hidden-row"><button className="link" onClick={useEarlier}>Use my earlier layout again</button> <span className="muted">(its order and hidden cards, without widths)</span></p>}
        </div>
      )}

      <TodayHero today={today} hideAmounts={hideAmounts} />

      {/* The wrapper is the size container: the two columns appear when THIS area is wide enough (a sidebar or a narrow window can take width the screen alone would not show). */}
      <div className="td-cols-wrap">
        <div className="td-cols">
          <div className="td-col td-col--agenda" data-col="agenda">
            {comp.agenda.map((c) => slot(c, agendaBar(c)))}
          </div>
          <div className="td-col td-col--side" data-col="side">
            {comp.side.map((u, i) => sideUnit(u, i))}
          </div>
        </div>
      </div>
    </>
  );
}
