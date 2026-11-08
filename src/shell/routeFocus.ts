/**
 * Plain functions behind the skip link and the "new page" focus rule, so they can be tested without a browser.
 *
 * The rule (WCAG 2.4.3, 4.1.3): after you move to another page, keyboard focus must not be left on something that no longer exists, and
 * assistive technology should hear which page it is. Ledger keeps its own place: if focus is still on a real control (for example the tab
 * you just pressed), nothing moves. Only when focus has been lost (the page body, or an element that was removed) does it go to the page's `main`.
 */

export interface FocusProbe {
  /** The element that has focus now, if any. */
  active: unknown;
  /** The page body (what the browser reports when nothing has focus). */
  body: unknown;
  /** True when the element is still part of the page. */
  attached(el: unknown): boolean;
}

/** True when focus was lost in the page change and should be placed on the new page. */
export function focusWasLost(p: FocusProbe): boolean {
  if (p.active == null || p.active === p.body) return true;
  return !p.attached(p.active);
}

export const APP_NAME = 'Ledger';

/** The browser-tab title and the spoken page name: "Budget · Ledger". Falls back to the module name, then to the app name. */
export function pageTitle(heading: string | null | undefined, moduleName?: string | null): string {
  const h = (heading ?? '').replace(/\s+/g, ' ').trim();
  if (h) return h === APP_NAME ? APP_NAME : `${h} · ${APP_NAME}`;
  const m = (moduleName ?? '').replace(/\s+/g, ' ').trim();
  return m ? `${m} · ${APP_NAME}` : APP_NAME;
}

/**
 * The page's name from its h1. A heading whose words change as you use the page (the Calendar's date range) can say what the page IS with
 * `data-page-title`; the heading itself keeps its visible words.
 */
export function headingTitle(h: { textContent?: string | null; dataset?: { pageTitle?: string } } | null | undefined): string {
  return (h?.dataset?.pageTitle ?? h?.textContent ?? '').trim();
}

/** Moves focus to the main landmark without scrolling. Returns whether it found one. */
export function focusMain(doc: Pick<Document, 'getElementById'>, id: string): boolean {
  const el = doc.getElementById(id) as (HTMLElement | null);
  if (!el) return false;
  el.focus({ preventScroll: true });
  return true;
}
