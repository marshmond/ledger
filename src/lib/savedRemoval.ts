import type { FinanceDB } from '../db';
import { parseViews, removeView } from './flowViews';
import { parseThemes, removeTheme } from './savedThemes';

/**
 * D20.1A. Removing ONE saved flow view or ONE saved theme by its id, for the confirmation dialogs that replaced the browser's own confirm box.
 *
 * Why this exists: a saved list is kept as a single stored value. The old code removed the item from the copy the screen had loaded and wrote that whole list back,
 * which was safe while the browser's confirm box froze the page. With a Ledger dialog the page keeps running while the question is open (a synced device can add or remove
 * a view in the meantime), so the list is read again at the moment the person confirms, inside one transaction, and only the chosen id is taken out of it.
 *
 * It returns false (and writes nothing) when the item is no longer there, so a record that disappeared while the dialog was open can never cause a different one to go.
 * Names are labels only: the match is by id, never by name or position.
 */
async function removeFromStoredList<T extends { id: string }>(d: FinanceDB, key: string, parse: (raw: unknown) => T[], remove: (list: T[], id: string) => T[], id: string): Promise<boolean> {
  return d.transaction('rw', d.settings, async () => {
    const list = parse((await d.settings.get(key))?.value);
    if (!list.some((x) => x.id === id)) return false;
    await d.settings.put({ key, value: remove(list, id) });
    return true;
  });
}

/** Removes the saved flow view with this id (stored under `flowViews`). True if it was removed, false if it was already gone. */
export const removeStoredFlowView = (d: FinanceDB, id: string): Promise<boolean> => removeFromStoredList(d, 'flowViews', parseViews, removeView, id);

/** Removes the saved theme with this id (stored under `savedThemes`). True if it was removed, false if it was already gone. Which colors are in use is not touched here. */
export const removeStoredTheme = (d: FinanceDB, id: string): Promise<boolean> => removeFromStoredList(d, 'savedThemes', parseThemes, removeTheme, id);
