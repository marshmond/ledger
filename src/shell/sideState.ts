/** Which sidebar groups you have collapsed, remembered per device. */

const KEY = 'ledger-side-closed';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadClosedGroups(storage?: StorageLike): string[] {
  try {
    const v = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveClosedGroups(ids: string[], storage?: StorageLike): void {
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: the choice just will not persist */
  }
}

export const toggleGroup = (closed: string[], id: string): string[] => (closed.includes(id) ? closed.filter((x) => x !== id) : [...closed, id]);
