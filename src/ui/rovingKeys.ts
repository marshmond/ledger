/**
 * Arrow-key behaviour for a row of tabs or radio buttons (the keys a screen reader promises when it says "tab 2 of 4" or "radio button").
 * Left/Up = previous, Right/Down = next, Home = first, End = last; the choice follows focus (the tab is pressed as focus lands on it),
 * and the list wraps. Put it on the element with `role="tablist"` or `role="radiogroup"`; give the selected item `tabIndex={0}` and the
 * others `-1` (see `rovingIndex`) so Tab enters and leaves the group in one stop.
 */
export interface RovingItem { disabled?: boolean; focus(): void; click(): void }

/** Which item the key moves to, or null if the key is not one of ours. Pure, so it can be tested without a browser. */
export function nextIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': return (current + 1 + count) % count;
    case 'ArrowLeft': case 'ArrowUp': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/** The `tabIndex` for item `i` when `selected` is the chosen one (or -1 when none is chosen: then the first is the stop). */
export function rovingIndex(i: number, selected: number): 0 | -1 {
  return i === (selected < 0 ? 0 : selected) ? 0 : -1;
}

/** `onKeyDown` for the group element. */
export function rovingKeys(e: { key: string; currentTarget: { querySelectorAll(sel: string): ArrayLike<unknown> }; target: unknown; preventDefault(): void }): void {
  const items = Array.from(e.currentTarget.querySelectorAll('[role="tab"], [role="radio"]')) as RovingItem[];
  const live = items.filter((x) => !x.disabled);
  const at = live.indexOf(e.target as RovingItem);
  if (at < 0) return;
  const to = nextIndex(e.key, at, live.length);
  if (to === null) return;
  e.preventDefault();
  live[to].focus();
  live[to].click();
}
