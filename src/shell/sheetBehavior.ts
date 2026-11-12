import { useEffect, type RefObject } from 'react';

/**
 * D10: the phone behaviour of a dialog that uses `Modal variant="sheet"` (only Quick Add does). Opt-in: a plain Modal never calls any of this.
 *
 *  1. Visible height. The on-screen keyboard shrinks the VISUAL viewport but not the layout viewport (iPhone Safari, current Android Chrome), so a sheet that is
 *     pinned to the bottom of the layout viewport ends up behind the keyboard. While the sheet is open its backdrop is therefore trimmed to the visible area:
 *     `--sheet-top` and `--sheet-bottom` (pixels) are set on the backdrop and the stylesheet uses them as the backdrop's top and bottom edges. Without
 *     `visualViewport` nothing is trimmed and the stylesheet's own sizing applies.
 *  2. Scroll lock. While a sheet is shown to a touch screen or a phone-width window, the page behind it does not scroll.
 *     The lock is counted, so two sheets cannot release each other, and it puts back exactly what it found.
 *
 * The pure parts take plain objects so they are tested without a browser. `attachSheet` adds its listeners only while the sheet is mounted and removes them all when it closes.
 */

/** The query under which a sheet is shown as a bottom sheet or the page must not scroll behind it: a phone-width window, or any touch screen. */
export const SHEET_QUERY = '(max-width: 640px), (pointer: coarse)';
/** More than this many pixels hidden below the visible area means the on-screen keyboard is open (the footer then drops its home-indicator padding). */
export const KEYBOARD_PX = 120;

export interface ViewportLike { height: number; offsetTop: number }

/** How far the visible area starts below the top, and ends above the bottom, of the layout viewport. Never negative; whole pixels. */
export function sheetInsets(vv: ViewportLike | null | undefined, layoutHeight: number): { top: number; bottom: number; keyboard: boolean } {
  if (!vv || !(layoutHeight > 0) || !(vv.height > 0)) return { top: 0, bottom: 0, keyboard: false };
  const top = Math.max(0, Math.round(vv.offsetTop));
  const bottom = Math.max(0, Math.round(layoutHeight - (vv.offsetTop + vv.height)));
  return { top, bottom, keyboard: bottom > KEYBOARD_PX };
}

export interface LockTarget { documentElement: { style: { overflow: string; overscrollBehavior: string } }; body: { style: { overflow: string } } }
let locks = 0;
let saved: { root: string; rootOver: string; body: string } | null = null;

/** Stops the page behind the sheet from scrolling. Returns the function that lets go (safe to call twice). Counted: the page is released when the last lock is. */
export function lockScroll(doc: LockTarget): () => void {
  if (locks === 0) {
    saved = { root: doc.documentElement.style.overflow, rootOver: doc.documentElement.style.overscrollBehavior, body: doc.body.style.overflow };
    doc.documentElement.style.overflow = 'hidden';
    doc.documentElement.style.overscrollBehavior = 'none';
    doc.body.style.overflow = 'hidden';
  }
  locks++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    locks--;
    if (locks === 0 && saved) {
      doc.documentElement.style.overflow = saved.root;
      doc.documentElement.style.overscrollBehavior = saved.rootOver;
      doc.body.style.overflow = saved.body;
      saved = null;
    }
  };
}
/** For tests: how many locks are held right now. */
export const scrollLocksHeld = () => locks;

export interface BackdropLike {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): unknown };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}
export interface WindowLike {
  innerHeight: number;
  visualViewport?: (ViewportLike & { addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void }) | null;
  requestAnimationFrame(cb: () => void): number;
  cancelAnimationFrame(id: number): void;
  matchMedia?(query: string): { matches: boolean; addEventListener(type: 'change', fn: () => void): void; removeEventListener(type: 'change', fn: () => void): void };
}

/** Attaches the behaviour to the backdrop element and returns the function that removes every listener and puts everything back. */
export function attachSheet(el: BackdropLike, win: WindowLike, doc: LockTarget): () => void {
  // 1. Visible height (follows the on-screen keyboard). One animation frame at a time, so a burst of resize events changes the layout once.
  const vv = win.visualViewport ?? null;
  let frame = 0;
  const apply = () => {
    frame = 0;
    const { top, bottom, keyboard } = sheetInsets(vv, win.innerHeight);
    el.style.setProperty('--sheet-top', `${top}px`);
    el.style.setProperty('--sheet-bottom', `${bottom}px`);
    if (keyboard) el.setAttribute('data-keyboard', 'open'); else el.removeAttribute('data-keyboard');
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(apply); };
  if (vv) {
    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
  }

  // 2. Scroll lock, while a touch screen or a phone-width window is showing the sheet (re-evaluated if the window is resized or turned).
  const mq = typeof win.matchMedia === 'function' ? win.matchMedia(SHEET_QUERY) : null;
  let release: (() => void) | null = null;
  const sync = () => {
    if (mq?.matches && !release) release = lockScroll(doc);
    else if (!mq?.matches && release) { release(); release = null; }
  };
  sync();
  mq?.addEventListener('change', sync);

  return () => {
    if (vv) { vv.removeEventListener('resize', schedule); vv.removeEventListener('scroll', schedule); }
    if (frame) win.cancelAnimationFrame(frame);
    mq?.removeEventListener('change', sync);
    release?.();
    el.style.removeProperty('--sheet-top');
    el.style.removeProperty('--sheet-bottom');
    el.removeAttribute('data-keyboard');
  };
}

/** The hook: attaches while the sheet is mounted (and `enabled`), removes everything when it closes. */
export function useSheetBehavior(backdrop: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = backdrop.current;
    if (!enabled || !el || typeof window === 'undefined') return;
    return attachSheet(el, window as unknown as WindowLike, document);
  }, [backdrop, enabled]);
}
