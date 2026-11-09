import { Component, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { PendingView, isChunkLoadError, retryLazyModule } from '../core/lazyModule';
import Main, { MAIN_ID } from './Main';
import { focusMain } from './routeFocus';

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
      <div ref={box} {...{ [LOADING_ATTR]: '' }} role="status" className="muted" style={{ padding: 'var(--sp-4, 16px) 0' }}>{slow ? `Loading ${name}…` : ''}</div>
    </Main>
  );
}

/** What is shown when a module's screens could not be fetched. Nothing stored is touched; the other modules keep working. */
export function ModuleLoadFailed({ name, onRetry }: { name: string; onRetry(): void }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <Main className="main">
      <h1>{name} did not load</h1>
      <div className="error" role="alert">
        {offline
          ? <p style={{ margin: 0 }}>You are offline, and this part of Ledger is not saved on this device yet. Reconnect, then try again.</p>
          : <p style={{ margin: 0 }}>This part of Ledger could not be loaded. If Ledger was updated after this tab was opened, reloading fetches the new version.</p>}
      </div>
      <p className="muted">Nothing you saved has changed, and the rest of Ledger still works. Use the top bar to go somewhere else.</p>
      <div className="row">
        <button type="button" className="primary" onClick={onRetry}>Try again</button>
        <button type="button" onClick={() => window.location.reload()}>Reload Ledger</button>
      </div>
    </Main>
  );
}

interface Props {
  name: string;
  /** The component being shown, so a retry can forget its failed load. */
  component: ComponentType;
  children: ReactNode;
}

/**
 * Wraps one module's page area: a loading state while its screens arrive (through `PendingView`), and a clear message if they cannot be
 * fetched. It catches only "file could not be fetched" errors; a real bug in a screen is passed on untouched, exactly as before lazy loading existed.
 */
export class ModuleLoadBoundary extends Component<Props, { error: unknown; attempt: number }> {
  state = { error: null as unknown, attempt: 0 };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  private Pending: ComponentType = () => <ModuleLoading name={this.props.name} />;
  retry = () => {
    retryLazyModule(this.props.component);
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };
  render() {
    if (this.state.error != null) {
      if (!isChunkLoadError(this.state.error)) throw this.state.error;
      return <ModuleLoadFailed name={this.props.name} onRetry={this.retry} />;
    }
    return <PendingView.Provider key={this.state.attempt} value={this.Pending}>{this.props.children}</PendingView.Provider>;
  }
}
