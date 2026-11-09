/**
 * Loading a module's SCREENS on demand (ST-S4, PF-01).
 *
 * A module is two things: (1) its registration, which stays in the first download because Today, Search, the Add box, the Calendar and
 * Finance's delete check all need it before the module is ever opened (cards, search source, quick add, due provider, record source, reference
 * reader); and (2) its screens, which are only needed when someone opens it. `lazyModule` wraps (2). The registry still sees an ordinary
 * `ComponentType`, so `ModuleDef` and everything that reads it are unchanged.
 *
 * Why not React's `lazy()` and `Suspense`: React keeps a revealed "loading" state on screen for about 0.3 s so it does not flicker, which
 * made opening a module that was already saved on the device take 0.3 s instead of a few thousandths. This wrapper has its own small
 * loading state with no such wait.
 *
 *  - The file is asked for ONCE, however it is started (a preload at start-up, the first draw, a retry after a failure).
 *  - A failure is not kept: the next ask (a retry) goes to the network again. The draw rethrows it, so the module boundary can show a message.
 *  - Once the file has arrived, a new draw shows the screens in the very first pass.
 *  - While the file is on its way the page area is an empty `main` landmark; the "Loading ..." words appear only if it takes noticeably long.
 */
import { createContext, createElement, useContext, useEffect, useState, type ComponentType } from 'react';

type Loader = () => Promise<{ default: ComponentType }>;
const RETRY = Symbol('ledger.lazyModule.retry');
const PRELOAD = Symbol('ledger.lazyModule.preload');
type Retryable = ComponentType & { [RETRY]?: () => void; [PRELOAD]?: () => Promise<void> };

/** What the module boundary draws in the page area while the screens are on their way (it supplies the module's name and the page landmark). */
export const PendingView = createContext<ComponentType | null>(null);

type Phase = { kind: 'ready'; Screen: ComponentType } | { kind: 'pending' } | { kind: 'failed'; error: unknown };

export function lazyModule(load: Loader): ComponentType {
  let loaded: ComponentType | null = null;
  let started: Promise<{ default: ComponentType }> | null = null;
  const get = () => {
    started ??= load().then(
      (m) => { loaded = m.default; return m; },
      (e) => { started = null; throw e; },
    );
    return started;
  };
  const Wrapper: Retryable = () => {
    const [phase, setPhase] = useState<Phase>(() => (loaded ? { kind: 'ready', Screen: loaded } : { kind: 'pending' }));
    useEffect(() => {
      if (phase.kind !== 'pending') return;
      let live = true;
      get().then(
        (m) => { if (live) setPhase({ kind: 'ready', Screen: m.default }); },
        (error) => { if (live) setPhase({ kind: 'failed', error }); },
      );
      return () => { live = false; };
    }, [phase.kind]);
    const Pending = useContext(PendingView);
    if (phase.kind === 'failed') throw phase.error; // the module boundary above turns a fetch failure into a message
    if (phase.kind === 'ready') return createElement(phase.Screen);
    return Pending ? createElement(Pending) : null;
  };
  Wrapper[RETRY] = () => { started = null; };
  Wrapper[PRELOAD] = () => get().then(() => undefined, () => undefined);
  return Wrapper;
}

/**
 * Start fetching a module's screens now, without showing them. Used when the address already names the module (a bookmark or a reload inside
 * Bills), so the file downloads while the app is still starting instead of after the first screen is drawn. Resolves when the file is here
 * (or has failed; the later draw reports it). Does nothing, and resolves at once, for a component that is not lazy.
 */
export function preloadLazyModule(component: ComponentType): Promise<void> {
  return (component as Retryable)[PRELOAD]?.() ?? Promise.resolve();
}

/** Forget a failed load so the next draw tries again. Does nothing for a component that is not lazy. */
export function retryLazyModule(component: ComponentType): void {
  (component as Retryable)[RETRY]?.();
}

/**
 * True for "the file could not be fetched" (offline, the file is gone after an update, a blocked request), in the wording of each browser engine.
 * Anything else is a real bug in a screen and must keep its normal behaviour, so it is not matched.
 */
export function isChunkLoadError(err: unknown): boolean {
  const text = `${(err as { name?: string })?.name ?? ''} ${(err as { message?: string })?.message ?? String(err)}`;
  return /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(text);
}
