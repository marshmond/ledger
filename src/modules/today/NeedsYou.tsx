import { useEffect, useMemo, useState } from 'react';
import { Link } from '../../core/router';
import { previewAttention, TIER_WORDS, whenWords, type AttentionTier, type RankedAttention } from '../../core/attention';
import { AttentionProviders } from '../../core/AttentionProviders';
import { loadHideAmounts } from '../../core/hideAmounts';
import { EmptyState, PageHeader } from '../../ui/components';
import { StatusChip, type StatusTone } from '../../ui/StatusChip';
import { useToday } from '../../ui/useToday';
import { maskAmounts } from './logic';
import { moduleName, useTodayData } from './TodayData';
import { useNeedsYou, type NeedsYou } from './useNeedsYou';

/** The address of the full list (inside the Today module). */
export const NEEDS_PATH = '/needs';
export const NEEDS_HREF = '#/today/needs';

const TONE: Record<AttentionTier, StatusTone> = { 1: 'overdue', 2: 'warning', 3: 'info', 4: 'neutral' };

/** Titles and reasons never carry an amount (core/attention.ts rejects any that do); masking is a second guard so Hide amounts can never leak one. */
const shown = (hide: boolean) => (s: string) => (hide ? maskAmounts(s) : s);

/**
 * The line under a row on the full list. The attention item keeps its full `provenance` (module and reader); the screen already shows the module, so only what
 * is NOT already said is shown: the part after the module name's colon ("bills not confirmed paid"), capitalized, or a short fixed phrase for Ledger alerts.
 */
export function provenanceNote(item: Pick<RankedAttention, 'provenance'>): string {
  const p = item.provenance;
  const i = p.indexOf(': ');
  if (i < 0) return /^Ledger alerts/.test(p) ? 'Same alert as on Ledger Home' : p;
  const rest = p.slice(i + 2);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** One row: the whole row is the link, so there is one Tab stop and one 44 px target per item. The words (not only a color) say how urgent it is. */
export function NeedsRow({ item, today, hide, source }: { item: RankedAttention; today: string; hide: boolean; source?: boolean }) {
  const t = shown(hide);
  const when = whenWords(item, today);
  return (
    <li className="td-need-item">
      <a className="td-need" href={item.href}>
        <span className="td-need-top">
          <span className="td-need-title">{t(item.title)}</span>
          <StatusChip tone={TONE[item.tier]}>{when}</StatusChip>
        </span>
        <span className="td-need-sub">
          <span className="td-need-src">{moduleName(item.moduleId)}{item.alsoFrom.length ? ` (also in ${item.alsoFrom.map(moduleName).join(', ')})` : ''}</span>
          <span className="td-need-reason">{t(item.reason)}</span>
        </span>
        {source && <span className="td-need-prov">{provenanceNote(item)}</span>}
      </a>
    </li>
  );
}

/**
 * "Needs you" on Today: the five most important unresolved items with a reason beside each, and "See all (N)" with the true count when there are more.
 * Presentational: it is given the ranked list (Today and the full list share `useNeedsYou`). Nothing is drawn when nothing needs attention, so the
 * section takes no space. When a module could not be read it says so in one quiet line, never as "nothing".
 */
export function NeedsYouSection({ needs, today, hideAmounts }: { needs: NeedsYou; today: string; hideAmounts: boolean }) {
  const preview = useMemo(() => previewAttention(needs.ranked), [needs.ranked]);
  if (!needs.ready || (preview.total === 0 && needs.failed.length === 0)) return null;
  return (
    <section className="card td-card td-needs-card" aria-labelledby="td-needs-h">
      <div className="card-head">
        <h2 className="card-title" id="td-needs-h">Needs you</h2>
        {preview.total > 0 && <span className="badge" aria-label={`${preview.total} ${preview.total === 1 ? 'item' : 'items'}`}>{preview.total}</span>}
        {preview.remaining > 0 && <Link className="card-link" to={NEEDS_PATH} aria-label={`See all ${preview.total} items that need you`}>See all ({preview.total})</Link>}
      </div>
      {preview.total > 0 && <ul className="plain td-list td-need-list">{preview.shown.map((i) => <NeedsRow key={i.id} item={i} today={today} hide={hideAmounts} />)}</ul>}
      {needs.failed.length > 0 && <p className="muted small td-msg" role="status">Some modules could not be checked just now ({needs.failed.map(moduleName).join(', ')}), so their items are not listed.</p>}
    </section>
  );
}

/**
 * Today's slot. Today's own agenda comes first: this starts reading the other modules only once the agenda has its data and the browser has a moment to spare
 * (`requestIdleCallback`, at most 300 ms later), so the main content never waits for it and the section simply fills in when ready.
 */
export function NeedsYouSlot({ today, hideAmounts, onShown }: { today: string; hideAmounts: boolean; onShown: (shown: boolean) => void }) {
  const { items } = useTodayData();
  const [go, setGo] = useState(false);
  const agendaReady = items !== undefined;
  useEffect(() => {
    if (!agendaReady || go) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) { const h = w.requestIdleCallback(() => setGo(true), { timeout: 300 }); return () => w.cancelIdleCallback?.(h); }
    const t = setTimeout(() => setGo(true), 50);
    return () => clearTimeout(t);
  }, [agendaReady, go]);
  return go ? <NeedsYouReader today={today} hideAmounts={hideAmounts} onShown={onShown} /> : null;
}

/**
 * Reads and ranks every module's items (`useNeedsYou`), draws the section when there is something to say, and tells Today whether it is drawn.
 * It is a component of its own so that the many live queries behind it re-render only this component, never the whole Today screen.
 */
function NeedsYouReader({ today, hideAmounts, onShown }: { today: string; hideAmounts: boolean; onShown: (shown: boolean) => void }) {
  const needs = useNeedsYou(today);
  const show = needs.ready && (needs.ranked.length > 0 || needs.failed.length > 0);
  useEffect(() => { onShown(show); }, [show, onShown]);
  return show ? <div className="td-needs" data-col="needs"><NeedsYouSection needs={needs} today={today} hideAmounts={hideAmounts} /></div> : null;
}

/** The full list: every unresolved item in the same order, grouped by the four words the ranking uses, each with where it came from. */
export function NeedsYouPage() {
  const today = useToday();
  return <AttentionProviders today={today}><NeedsYouPageBody today={today} /></AttentionProviders>;
}
function NeedsYouPageBody({ today }: { today: string }) {
  const needs = useNeedsYou(today);
  const hide = useMemo(() => loadHideAmounts(), []);
  const groups = ([1, 2, 3, 4] as AttentionTier[]).map((tier) => ({ tier, items: needs.ranked.filter((r) => r.tier === tier) })).filter((g) => g.items.length > 0);
  return (
    <>
      <PageHeader
        title="Needs you"
        className="td-head"
        description="What needs a look across Ledger, most urgent first. Items drop off once they are sorted out."
        actions={<Link className="link" to="/">Back to Today</Link>}
      />
      <div className="td-needs-page">
      {!needs.ready && <p className="muted td-msg" role="status">Checking every module…</p>}
      {needs.ready && needs.ranked.length === 0 && <EmptyState title="Nothing needs you right now">Overdue items, deadlines in the next seven days and things to review will show here.</EmptyState>}
      {groups.map((g) => (
        <section key={g.tier} className="card td-card td-needs-card" aria-labelledby={`td-needs-t${g.tier}`}>
          <div className="card-head"><h2 className="card-title" id={`td-needs-t${g.tier}`}>{TIER_WORDS[g.tier]}</h2><span className="badge" aria-label={`${g.items.length} ${g.items.length === 1 ? 'item' : 'items'}`}>{g.items.length}</span></div>
          <ul className="plain td-list td-need-list">{g.items.map((i) => <NeedsRow key={i.id} item={i} today={today} hide={hide} source />)}</ul>
        </section>
      ))}
      {needs.failed.length > 0 && <p className="muted small td-msg" role="status">Some modules could not be checked just now ({needs.failed.map(moduleName).join(', ')}), so their items are not listed.</p>}
      </div>
    </>
  );
}
