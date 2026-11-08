/**
 * The "Hide amounts" preference. It lives in core because many modules read it; it used to sit in Today's layout file, which made every module import from Today (ST-S2, ARCH-01).
 *
 * Nothing about it changed in the move: the same storage key (`today.hideAmounts.v1`, which is also in the plain backup's preference list), the same default (not hidden),
 * the same safe reads (no storage or an error means "not hidden"), the same switch in Today's header. It is a per-device choice kept in this browser. There is no
 * change notification: a screen reads it when it opens (and Today passes it to its cards), exactly as before.
 *
 * SCOPE (ST-S2, UX-01): it masks money on the screens that consult it: Today and its cards, Calendar, Bills & Subscriptions, Household Services, Home & Assets,
 * Household finances, and the "Coming up" list on Ledger Home. It does NOT mask Ledger's own pages (Accounts, Transactions, Budget, Reports, Net worth and the rest of
 * Ledger Home), and it does not change exports or backups. Wider masking is a separate, undecided owner choice. See `HIDE_AMOUNTS_SCOPE`.
 */
export const HIDE_AMOUNTS_KEY = 'today.hideAmounts.v1';

export function loadHideAmounts(store?: Pick<Storage, 'getItem'>): boolean {
  // `localStorage` is looked up INSIDE the try: where there is no storage (a test, a private window) the answer is "not hidden", never an error.
  try { return (store ?? localStorage).getItem(HIDE_AMOUNTS_KEY) === '1'; } catch { return false; }
}
export function saveHideAmounts(on: boolean, store: Pick<Storage, 'setItem'> = localStorage): void {
  try { store.setItem(HIDE_AMOUNTS_KEY, on ? '1' : '0'); } catch { /* private window: lasts until the page closes */ }
}

/** What the switch covers, in words (shown beside the switch). Kept here so the wording and the documentation cannot drift apart. */
export const HIDE_AMOUNTS_SCOPE = {
  label: 'Hide amounts',
  covers: 'Today, Calendar, Bills & Subscriptions, Household Services, Home & Assets and Household finances',
  doesNotCover: "Ledger's own pages (Accounts, Transactions, Budget, Reports, Net worth and the rest of Ledger Home) still show amounts, and exports and backups still contain them",
  help: "Hides amounts on Today, Calendar, Bills, Services, Home & Assets and Household finances. Ledger's own pages (Accounts, Transactions, Budget, Reports, Net worth) still show amounts. It is for glancing at a screen, not a privacy lock.",
} as const;
