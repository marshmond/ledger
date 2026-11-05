/**
 * One live database query shared by everything that asks for the same `key`.
 * Several Today cards need the same figure (the cash forecast feeds both "Needs attention" and "Cash outlook"); asking through here
 * runs the query once, keeps it up to date when the data changes, and stops when the last card using it goes away.
 * The key must name everything the query depends on (include `today`, a month, ...), because the first loader registered for a key wins.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';

interface Entry {
  value: unknown;
  ready: boolean;
  listeners: Set<() => void>;
  stop(): void;
}

const entries = new Map<string, Entry>();

function open(key: string, loader: () => Promise<unknown>): Entry {
  const entry: Entry = { value: undefined, ready: false, listeners: new Set(), stop: () => undefined };
  const sub = liveQuery(loader).subscribe({
    next: (v) => { entry.value = v; entry.ready = true; entry.listeners.forEach((l) => l()); },
    error: () => { entry.value = undefined; entry.ready = true; entry.listeners.forEach((l) => l()); },
  });
  entry.stop = () => sub.unsubscribe();
  entries.set(key, entry);
  return entry;
}

/** The latest result of `loader`, or undefined while it loads (or if it failed). Re-runs by itself when the data it read changes. */
export function useSharedLive<T>(key: string, loader: () => Promise<T>): T | undefined {
  const subscribe = useCallback((onChange: () => void) => {
    const entry = entries.get(key) ?? open(key, loader);
    entry.listeners.add(onChange);
    return () => {
      entry.listeners.delete(onChange);
      // Wait a moment before stopping: React re-subscribes straight away when a card re-renders or mounts twice in development.
      setTimeout(() => {
        if (entry.listeners.size === 0 && entries.get(key) === entry) { entry.stop(); entries.delete(key); }
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const get = useCallback(() => entries.get(key)?.value as T | undefined, [key]);
  return useSyncExternalStore(subscribe, get, get);
}

/** For tests: how many shared queries are open right now. */
export const openSharedQueries = () => entries.size;
