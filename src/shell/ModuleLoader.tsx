import { Component, Fragment, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { PendingView, isChunkLoadError, retryLazyModule } from '../core/lazyModule';
import Main, { MAIN_ID } from './Main';
import { focusMain } from './routeFocus';
import { Icon } from '../ui/icons';

/** The marker the route announcer waits for: while it is on the page, the new screen has not arrived yet, so there is no heading to read. */
export const LOADING_ATTR = 'data-module-loading';
/** How long a module may take before "Loading ..." is shown. A module already saved on the device arrives well inside this, so it never flashes. */
export const LOADING_DELAY_MS = 150;

/**
 * Shown in the page area while a module's screens are fetched. The top bar, search and Add box stay live around it. It is a real `main`
 * (so the page always has exactly one), empty at first and saying "Loading ..." in a polite status line if the wait is noticeable.
 * If keyboard focus was parked on this placeholder, it is handed to the real page when that replaces it, so focus is never dropped.
 */
export function ModuleLoading({ name, delayMs = LOADING_DELAY_MS }: { name: string; delayMs?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [slow, setSlow] = useState(delayMs <= 0);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  useLayoutEffect(() => {
    const el = box.current;
    return () => {
      const main = el?.closest('main');
      if (main && document.activeElement === main) requestAnimationFrame(() => focusMain(document, MAIN_ID));
    };
  }, []);
  return (
    <Main className="main">
      {/* The marker is on the page from the first moment (the route announcer waits for it); the words only once the wait is noticeable. */}
      <div ref={box} {...{ [LOADING_ATTR]: '' }} role="status" className="muted ui-state-loading">{slow ? `Loading ${name}…` : ''}</div>
    </Main>
  );
}

/** What is shown when a module's screens could not be fetched. Nothing stored is touched; the other modules keep working. */
export function ModuleLoadFailed({ name, onRetry }: { name: string; onRetry(): void }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <Main className="main">
      <h1>{name} did not load</h1>
      <div className="error ui-state ui-state--bad" role="alert">
        <Icon name="alert" size={20} />
        {offline
          ? <p>You are offline, and this part of Ledger is not saved on this device yet. Reconnect, then try again.</p>
          : <p>This part of Ledger could not be loaded. If Ledger was updated after this tab was opened, reloading fetches the new version.</p>}
      </div>
      <p className="muted">Nothing you saved has changed, and the rest of Ledger still works. Use the top bar to go somewhere else.</p>
      <div className="row">
        <button type="button" className="primary" onClick={onRetry}>Try again</button>
        <button type="button" onClick={() => window.location.reload()}>Reload Ledger</button>
      </div>
    </Main>
  );
}

/** Where "Go to Today" leads: Ledger uses hash addresses, so a plain link works with no router around it (and in a test). */
export const SAFE_PLACE_HREF = '#/today';

/**
 * D20. What is shown when a page failed while it was being drawn (a bug, or a saved record in a shape the page did not expect). The top bar, search and Add box stay live around it, so
 * nothing else is shut off. It says plainly that the problem is in drawing the page and that this does not mean saved records were deleted, offers a retry, a safe place to go and a reload,
 * and says what a reload can lose (anything typed into an open form and not yet saved, never saved records). It shows no technical detail on screen: the details go to the browser console
 * only, and nothing is sent anywhere. `bare` leaves out the `main` landmark, for use inside a page frame that already has one.
 * Focus moves to the heading when it appears, so a keyboard or screen-reader user is told, and Tab continues from there.
 */
export function PageProblem({ onRetry, bare = false }: { onRetry(): void; bare?: boolean }) {
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => { head.current?.focus(); }, []); // scrolls it into view too (the CSS scroll margin keeps it clear of the sticky bars)
  const body = (
    <>
      <h1 ref={head} tabIndex={-1} className="ui-state-title">This page ran into a problem.</h1>
      <div className="error ui-state ui-state--bad" role="alert">
        <Icon name="alert" size={20} />
        <div>
          <p>Ledger could not draw this page. That does not mean your saved records were deleted or changed, and the rest of Ledger still works.</p>
          <p className="muted">Reloading Ledger keeps everything you have saved. It would discard anything you typed into an open form on this page and had not saved yet.</p>
        </div>
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={onRetry}>Try again</button>
        <a className="btn" href={SAFE_PLACE_HREF}>Go to Today</a>
        <button type="button" onClick={() => window.location.reload()}>Reload Ledger</button>
      </div>
    </>
  );
  return bare ? <div className="ui-state-page">{body}</div> : <Main className="main">{body}</Main>;
}

/** Local, private record of a failed draw. Goes to the browser console only; nothing is stored or sent anywhere. */
function reportLocally(error: unknown, info: ErrorInfo) {
  // eslint-disable-next-line no-console
  console.error('Ledger: a page failed while it was being drawn.', error, info?.componentStack);
}

interface Props {
  name: string;
  /** The component being shown, so a retry can forget its failed load. */
  component: ComponentType;
  /** D20: when this changes (the address changed), a page that failed to draw is tried again. A "file could not be fetched" failure is not reset by it. */
  resetKey?: string;
  children: ReactNode;
}

/**
 * Wraps one module's page area: a loading state while its screens arrive (through `PendingView`), a clear message if they cannot be fetched, and (D20) a recoverable
 * "this page ran into a problem" state if a screen fails while it is drawn.
 *
 * What it catches: errors thrown while React draws a screen (its render, lifecycle methods and constructors) anywhere below it, and a screen's file that cannot be fetched.
 * What it does NOT catch (React does not hand these to a boundary): errors inside event handlers (a click that fails), errors in async code such as a database call that rejects,
 * errors thrown by a timer, and errors in this boundary itself. Those keep their previous behaviour (the screen's own messages, or the browser console).
 * It never touches stored data and never retries by itself: a retry is only ever the person pressing "Try again", or going to another address.
 */
export class ModuleLoadBoundary extends Component<Props, { error: unknown; attempt: number }> {
  state = { error: null as unknown, attempt: 0 };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  private Pending: ComponentType = () => <ModuleLoading name={this.props.name} />;
  componentDidCatch(error: unknown, info: ErrorInfo) { if (!isChunkLoadError(error)) reportLocally(error, info); }
  componentDidUpdate(prev: Props) {
    // Going to another address clears a page that failed to draw (its replacement is drawn fresh). A failed file fetch is left to "Try again" and its own self-heal.
    if (prev.resetKey !== this.props.resetKey && this.state.error != null && !isChunkLoadError(this.state.error)) this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  }
  retry = () => {
    retryLazyModule(this.props.component);
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };
  render() {
    if (this.state.error != null) {
      if (!isChunkLoadError(this.state.error)) return <PageProblem onRetry={this.retry} />;
      return <ModuleLoadFailed name={this.props.name} onRetry={this.retry} />;
    }
    return <PendingView.Provider key={this.state.attempt} value={this.Pending}>{this.props.children}</PendingView.Provider>;
  }
}

/**
 * D20. A smaller boundary for ONE page inside a frame that must stay on screen (Ledger's navigation, for example): the page is replaced by the same "ran into a problem" state, and
 * everything around it keeps working. Changing `resetKey` (going to another page) draws the new page fresh. A "file could not be fetched" error is passed up unchanged, to the module
 * boundary, which knows how to retry it. Catches the same kinds of error as `ModuleLoadBoundary` (drawing errors only).
 */
export class PageErrorBoundary extends Component<{ resetKey?: string; children: ReactNode }, { error: unknown; attempt: number }> {
  state = { error: null as unknown, attempt: 0 };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { if (!isChunkLoadError(error)) reportLocally(error, info); }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error != null) this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  }
  retry = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  render() {
    if (this.state.error != null) {
      if (isChunkLoadError(this.state.error)) throw this.state.error;
      return <PageProblem bare onRetry={this.retry} />;
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
