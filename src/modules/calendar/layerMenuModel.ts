/**
 * Words and small decisions for the "Calendars & Layers" menu (F2.1). PURE: no React, no storage, no database. The menu draws whatever
 * layers the Calendar hands it and reports what the owner clicked; WHICH layers are on is decided only by `layerVisibility.ts`.
 */
import { isHex } from '../../palette';

/** One row of the menu. Deliberately smaller than a `CalendarLayer` so another screen could reuse the menu with its own list. */
export interface LayerMenuLayer {
  id: number;
  name: string;
  color: string;
  /** Worked out from another part of the app (read-only). Shown as "(auto)", as the old chip row did. */
  derived?: boolean;
}

/** Used when a layer has no usable colour, so the dot is still visible and nothing throws. */
export const NEUTRAL_COLOR = 'var(--muted)';

/** The layer's own colour when it is a plain #RRGGBB value, otherwise a neutral grey. The colour is never changed or stored. */
export const swatchColor = (color: unknown): string => (typeof color === 'string' && isHex(color) ? color : NEUTRAL_COLOR);

/** The short words on the closed button, e.g. `Layers (5/8)`. */
export const triggerLabel = (shown: number, total: number): string => `Layers (${shown}/${total})`;

/** What a screen reader says for the closed button (the colour of nothing is the only signal here, so the count is spelled out). */
export const triggerSpeech = (shown: number, total: number): string => `Calendars & Layers: ${shown} of ${total} shown`;

/** The sentence under the list, also read out when it changes. */
export function countSentence(shown: number, total: number): string {
  if (total === 0) return 'No calendars to show.';
  if (shown === 0) return `None of the ${total} calendar${total === 1 ? ' is' : 's are'} shown.`;
  if (shown === total) return total === 1 ? 'The calendar is shown.' : `All ${total} calendars are shown.`;
  return `${shown} of ${total} calendars shown.`;
}

/** How many of `layers` are on, per `isVisible`. */
export const shownCount = (layers: readonly LayerMenuLayer[], isVisible: (id: number) => boolean): number => layers.reduce((n, l) => n + (isVisible(l.id) ? 1 : 0), 0);

/** The words next to a layer's checkbox for a screen reader: the name, plus what kind it is when that matters. */
export const layerRowName = (l: LayerMenuLayer): string => (l.derived ? `${l.name} (automatic, read-only)` : l.name);
