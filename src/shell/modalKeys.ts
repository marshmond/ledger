/**
 * The keyboard and focus behaviour of `Modal`, as a plain function so it can be tested without a browser DOM.
 *  - Escape closes (and is not passed on to anything else).
 *  - Tab / Shift+Tab wrap inside the TOPMOST open dialog (the last `[aria-modal="true"]` on the page). A dialog with nothing focusable is left alone.
 *  - Focus moves into the dialog unless something inside already has it, and goes back to where it was when the dialog closes.
 * With two dialogs open (D20.1B: a confirmation over another dialog), Escape is acted on only by the topmost one.
 */
export interface KeyEventLike { key: string; shiftKey: boolean; stopPropagation(): void; preventDefault(): void }
export interface FocusableLike { disabled?: boolean; focus(): void; getClientRects(): ArrayLike<unknown> }
export interface BoxLike extends FocusableLike { contains(x: unknown): boolean; querySelectorAll(selector: string): ArrayLike<FocusableLike> }
export interface DocLike {
  activeElement: unknown;
  addEventListener(type: 'keydown', fn: (e: KeyEventLike) => void, capture: boolean): void;
  removeEventListener(type: 'keydown', fn: (e: KeyEventLike) => void, capture: boolean): void;
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

export const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * `opener` is the element that had focus BEFORE the dialog was drawn (the caller reads it during the first render). Reading it here instead is too late for a dialog
 * with an autofocused field: that field has already taken focus, and closing would then send focus to the page instead of back to the button that opened it.
 */
export function attachModal(doc: DocLike, box: BoxLike | null, close: () => void, opener?: unknown): () => void {
  const before = (opener ?? doc.activeElement) as { focus?: () => void } | null;
  const onKey = (e: KeyEventLike) => {
    if (e.key === 'Escape') {
      // D20.1B: with a confirmation open over another dialog (the Tasks lists, an edit form), only the TOPMOST one reacts, so Escape cancels the question and leaves the dialog under it open.
      // With no way to tell (no box, or no open dialog found) it behaves as before.
      const open = box ? doc.querySelectorAll('[aria-modal="true"]') : [];
      if (box && open.length > 1 && open[open.length - 1] !== box) return;
      e.stopPropagation();
      close();
    }
    if (e.key === 'Tab' && box) {
      const open = doc.querySelectorAll('[aria-modal="true"]');
      if (open[open.length - 1] !== box) return;
      const items = [...Array.from(box.querySelectorAll(FOCUSABLE))].filter((x) => !x.disabled && x.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], at = doc.activeElement;
      if (e.shiftKey && (at === first || at === box || !box.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !box.contains(at))) { e.preventDefault(); first.focus(); }
    }
  };
  doc.addEventListener('keydown', onKey, true);
  // A field inside may already have asked for focus; only take it if nothing in the dialog has it.
  if (box && !box.contains(doc.activeElement)) box.focus();
  return () => {
    doc.removeEventListener('keydown', onKey, true);
    before?.focus?.();
  };
}

/**
 * D20: the close action a dialog hands to Escape, a click outside and its close button. While `isLocked()` is true (a save is running), it does nothing, so the dialog cannot be dismissed
 * in the middle of the action and leave the result unclear. With no lock it simply calls `close`. Reads the lock at the moment of use, never a stale copy.
 */
export function guardedClose(isLocked: () => boolean, close: () => void): () => void {
  return () => { if (!isLocked()) close(); };
}
