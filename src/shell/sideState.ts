/** Which sidebar group is open (only one at a time), remembered per device. Everything starts collapsed. */

const KEY = 'ledger-side-open';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadOpenGroup(storage?: StorageLike): string | null {
  try {
    const v = (storage ?? localStorage).getItem(KEY);
    return v ? v : null;
  } catch {
    return null;
  }
}

export function saveOpenGroup(id: string | null, storage?: StorageLike): void {
  try {
    (storage ?? localStorage).setItem(KEY, id ?? '');
  } catch {
    /* storage unavailable: the choice just will not persist */
  }
}

/** Opening a group closes the one that was open; clicking the open one closes it. */
export const toggleGroup = (open: string | null, id: string): string | null => (open === id ? null : id);
