import { useEffect, useId, useRef, useState } from 'react';
import { countSentence, layerRowName, shownCount, swatchColor, triggerLabel, triggerSpeech, type LayerMenuLayer } from './layerMenuModel';

/**
 * "Calendars & Layers" (F2.1): ONE small button that opens a list of every calendar layer, each with its colour and a checkbox, plus
 * Select all / Deselect all. It replaces the row of chips the Calendar used to show.
 *
 * Presentation only. It knows nothing about storage: the Calendar passes in `isVisible` and the three callbacks (which are the existing
 * `useLayerVisibility` functions), so what is on, where that is remembered and how a layer registered later behaves are all unchanged.
 * It is written against the small `LayerMenuLayer` shape so another screen could reuse it with its own list.
 *
 * Behaviour: click or tap or Enter/Space on the button opens and closes it; the list stays open while boxes are ticked; Escape closes it and
 * puts focus back on the button; a click outside, or Tab leaving it, closes it. It opens in the page flow after the button, so Tab reaches
 * every box and action in order and there is no keyboard trap. Nothing opens on hover: hover does not exist on touch screens, and the delay
 * and flicker handling it needs is the brittle part, so click and tap are the one way in.
 */
export default function LayerMenu({ layers, isVisible, onToggle, onSelectAll, onDeselectAll, onManage, defaultOpen = false }: {
  layers: LayerMenuLayer[];
  isVisible: (id: number) => boolean;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** Optional: a link at the foot for adding, renaming, recolouring and deleting calendars. Closes the menu first. */
  onManage?: () => void;
  /** For tests and previews only. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const headId = useId();

  useEffect(() => {
    if (!open) return;
    const down = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only when focus is on the button or inside the list (another dialog open on top keeps its own Escape).
      if (wrap.current?.contains(document.activeElement) || document.activeElement === document.body) { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key); };
  }, [open]);

  const shown = shownCount(layers, isVisible);
  const total = layers.length;

  return (
    <div
      className="cal-lm"
      ref={wrap}
      // Tab (or a screen reader) moving focus to something outside closes the list. A null target (a click on blank space) is the outside-click handler's job.
      onBlur={(e) => { if (open && e.relatedTarget instanceof Node && !wrap.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <button
        ref={trigger}
        type="button"
        className={`btn cal-lm-btn${shown < total ? ' partial' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {/* D13: the colors of the layers that are on, as a small stack (decoration; <i> not <span>, the count words are the accessible name). */}
        <i className="cal-lm-stack" aria-hidden="true">{layers.filter((l) => isVisible(l.id)).slice(0, 6).map((l) => <i key={l.id} className="cal-lm-chipdot" style={{ background: swatchColor(l.color) }} />)}</i>
        <span aria-hidden="true">{triggerLabel(shown, total)}</span>
        <span className="sr-only">{triggerSpeech(shown, total)}</span>
        <span className="cal-lm-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        // tabIndex -1: a click on plain text inside the menu then keeps focus inside it (otherwise the browser hands focus to the page's main landmark, which would count as "leaving").
        <div className="cal-lm-pop" id={popId} role="dialog" aria-labelledby={headId} tabIndex={-1}>
          <div className="cal-lm-head">
            <strong id={headId} className="cal-lm-title">Calendars &amp; Layers</strong>
            <span className="cal-lm-bulk">
              <button type="button" className="btn cal-lm-act" onClick={onSelectAll}>Select all</button>
              <button type="button" className="btn cal-lm-act" onClick={onDeselectAll}>Deselect all</button>
            </span>
          </div>
          <ul className="plain cal-lm-list">
            {layers.map((l) => {
              const on = isVisible(l.id);
              return (
                <li key={l.id}>
                  <label className={`cal-lm-row${on ? '' : ' off'}`} title={l.derived ? 'Read-only: worked out from another part of the app' : undefined}>
                    <input type="checkbox" checked={on} onChange={() => onToggle(l.id)} aria-label={layerRowName(l)} />
                    <span className="cal-lm-dot" style={{ background: swatchColor(l.color) }} aria-hidden="true" />
                    <span className="cal-lm-name">{l.name}</span>
                    {l.derived && <span className="muted small cal-lm-auto" aria-hidden="true">(auto)</span>}
                  </label>
                </li>
              );
            })}
            {total === 0 && <li className="muted small cal-lm-empty">No calendars yet.</li>}
          </ul>
          <div className="cal-lm-foot">
            <span className="muted small" role="status" aria-live="polite">{countSentence(shown, total)}</span>
            {onManage && <button type="button" className="link" onClick={() => { setOpen(false); onManage(); }}>Manage calendars</button>}
            <button type="button" className="btn cal-lm-act cal-lm-done" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
