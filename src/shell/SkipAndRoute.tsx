import { useEffect, useRef, useState } from 'react';
import { getModule } from '../core/registry';
import { MAIN_ID } from './Main';
import { LOADING_ATTR } from './ModuleLoader';
import { focusMain, focusWasLost, headingTitle, pageTitle } from './routeFocus';

/**
 * A "Skip to main content" link: the first Tab stop on every screen, hidden until it has keyboard focus. Ledger uses hash addresses
 * (#/budget), so the link must NOT change the address: it moves focus to the page's `main` itself and ignores the browser's own jump.
 */
export function SkipLink() {
  return (
    <a
      className="skip-link"
      href={`#${MAIN_ID}`}
      onClick={(e) => {
        e.preventDefault();
        const main = document.getElementById(MAIN_ID);
        if (main) { main.focus(); main.scrollIntoView?.({ block: 'start' }); }
      }}
    >Skip to main content</a>
  );
}

/**
 * Runs after you move to another page (on first load it only sets the title):
 *  - sets the browser-tab title to the page's heading ("Budget · Ledger"),
 *  - says the page name once through a hidden polite status line, so a screen reader hears that the page changed,
 *  - and, only if focus was lost in the change (it was on something that went away), puts focus on the page's `main` without scrolling.
 * If focus is still on a control that exists (the tab or link you just used), it is left exactly where it is.
 */
export function RouteAnnouncer({ pathname }: { pathname: string }) {
  const first = useRef(true);
  const [said, setSaid] = useState('');

  useEffect(() => {
    // On the very first load the tab title is set too, but nothing is announced and focus is left alone (the browser already reads the new page).
    const initial = first.current;
    first.current = false;
    // A short wait lets the new page draw and read its data, so the heading exists. A page that is still loading its record gets one more try.
    let timer: ReturnType<typeof setTimeout>;
    let waitedForScreens = 0;
    const settle = (attempt: number) => {
      // A module's screens may still be on their way (they load on demand): wait for them, for up to ten seconds, before reading the heading.
      if (document.querySelector(`[${LOADING_ATTR}]`) && waitedForScreens++ < 40) { timer = setTimeout(() => settle(attempt), 250); return; }
      const h1 = headingTitle(document.querySelector<HTMLElement>(`#${MAIN_ID} h1, main h1`));
      if (!h1 && attempt === 0) { timer = setTimeout(() => settle(1), 700); return; }
      const mod = getModule(pathname.split('/')[1])?.name;
      const title = pageTitle(h1, mod);
      document.title = title;
      if (initial) return;
      setSaid(title);
      if (focusWasLost({ active: document.activeElement, body: document.body, attached: (el) => document.body.contains(el as Node) })) focusMain(document, MAIN_ID);
    };
    timer = setTimeout(() => settle(0), 250);
    return () => clearTimeout(timer);
  }, [pathname]);

  // Cleared a few seconds later so the same title can be announced again on a return visit.
  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(''), 4000);
    return () => clearTimeout(t);
  }, [said]);

  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{said}</div>;
}
