/**
 * Which Calendar layers are switched on (B3.0B). PURE: no storage, no React, no database. It is the ONE visibility system the Calendar has: the
 * same device-local preference as before (`calendar-hidden-layers`), kept in the same place, with one extra way of writing it.
 *
 * Two states, and nothing else:
 *   - ALL-BUT: every layer is on except the listed ones. `[]` is "everything on". This is a fresh install, "Select all", and every value an
 *     earlier version wrote (a plain list of layer ids that were switched OFF). A layer registered later is ON, because nothing was chosen about it.
 *   - ONLY: exactly the listed layers are on. "Deselect all" is ONLY with an empty list (a valid state: an empty Calendar). A layer registered
 *     later is OFF until the owner switches it on, so an intentional "Personal only" choice survives new modules.
 * Any manual switch-off of a layer from the all-on state turns the choice into ONLY (the owner chose a particular set), and switching layers on
 * until every available one is on returns to ALL-BUT, so new layers appear again by themselves.
 *
 * Stored text: ALL-BUT is the old JSON array (so an older build reads it exactly as before); ONLY is `{"only":[ids]}`, which an older build
 * does not recognise and therefore treats as "everything on" (it can show too much, never hide something unexpectedly). No migration.
 * Ids of layers that no longer exist are ignored when reading and dropped the next time the choice is written.
 *
 * This only decides what the Calendar SCREEN draws (and which of your own calendars the .ics export offers). It never touches an event, a Task,
 * a derived item, a provider or the database.
 */
export type Visibility = { mode: 'all-but'; hidden: number[] } | { mode: 'only'; shown: number[] };

export const VISIBILITY_KEY = 'calendar-hidden-layers';
export const ALL_ON: Visibility = { mode: 'all-but', hidden: [] };

const ids = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))] : []);

/** Reads the stored text defensively. Anything unreadable means "everything on". Never throws. */
export function parseVisibility(raw: string | null | undefined): Visibility {
  if (!raw) return ALL_ON;
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) return { mode: 'all-but', hidden: ids(v) };
    if (v && typeof v === 'object' && Array.isArray((v as { only?: unknown }).only)) return { mode: 'only', shown: ids((v as { only: unknown }).only) };
  } catch { /* fall through */ }
  return ALL_ON;
}

export const serializeVisibility = (v: Visibility): string => (v.mode === 'all-but' ? JSON.stringify(v.hidden) : JSON.stringify({ only: v.shown }));

export const isLayerVisible = (v: Visibility, layerId: number): boolean => (v.mode === 'all-but' ? !v.hidden.includes(layerId) : v.shown.includes(layerId));

/** The ids among `available` that are on. */
export const visibleIds = (v: Visibility, available: number[]): number[] => available.filter((id) => isLayerVisible(v, id));

/** The state that shows exactly `on` (a subset of `available`): ALL-BUT when that is every available layer, otherwise ONLY. */
function exactly(on: number[], available: number[]): Visibility {
  const set = new Set(on.filter((id) => available.includes(id)));
  return available.length > 0 && available.every((id) => set.has(id)) ? ALL_ON : { mode: 'only', shown: available.filter((id) => set.has(id)) };
}

/** Flips one layer. Everything else keeps exactly the state it had. */
export function toggleLayer(v: Visibility, layerId: number, available: number[]): Visibility {
  if (!available.includes(layerId)) return v;
  const on = visibleIds(v, available);
  return exactly(on.includes(layerId) ? on.filter((x) => x !== layerId) : [...on, layerId], available);
}

/** Every layer on (and every layer registered later). */
export const selectAll = (): Visibility => ALL_ON;
/** Every layer off. A valid state: the Calendar is simply empty until the owner switches something on. */
export const deselectAll = (): Visibility => ({ mode: 'only', shown: [] });

/** How many of the available layers are on, for the words under the controls. */
export const visibleCount = (v: Visibility, available: number[]): number => visibleIds(v, available).length;
