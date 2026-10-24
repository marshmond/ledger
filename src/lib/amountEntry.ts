import { useSyncExternalStore } from 'react';

/**
 * Keystroke-style dollar entry: digits shift in from the right, so typing 1, 2, 4, 5 shows 0.01, 0.12, 1.24, 12.45, and
 * Backspace takes the last digit off. It works from the whole text of the box (not from individual keys), so it behaves
 * the same with a phone keyboard, which does not report which key was pressed.
 */

const MAX_DIGITS = 11; // up to 999,999,999.99

const fmt = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The text a box should show for whatever is in it after a keystroke: its digits read as cents. Empty when there is no amount. */
export function keypadText(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, MAX_DIGITS);
  const cents = digits === '' ? 0 : Number(digits);
  return cents === 0 ? '' : fmt(cents);
}

/** The text for a whole amount in cents (a pasted amount, or an existing one): empty for zero. The sign is not shown. */
export function centsText(cents: number): string {
  const abs = Math.min(Math.abs(Math.round(cents)), 10 ** MAX_DIGITS - 1);
  return abs === 0 ? '' : fmt(abs);
}

// ---- the on/off switch (this device only) ----

const KEY = 'ledger-keypad-amounts';
const EVENT = 'ledger-keypad-amounts-changed';

export function keypadEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setKeypadEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage unavailable: the choice lasts until the page closes */ }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

/** Whether amount boxes in the transaction forms use keystroke-style entry (on unless switched off in Settings). */
export const useKeypadAmounts = (): boolean => useSyncExternalStore(subscribe, keypadEnabled, () => true);
