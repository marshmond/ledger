/**
 * CAL-G1: the Google client ID, kept on THIS device only. It is public configuration (it appears in every sign-in link Google opens), not a
 * credential, so it may live in browser storage; it is nevertheless kept out of the database on purpose, so it is never synced to the owner's other
 * devices, never in a backup file and never in the GitHub synchronization repository. Each device has its own entry.
 *
 * This is the ONLY file in the Gmail folder that touches browser storage. Nothing here (or anywhere) stores an access token.
 */
import { checkClientId } from './config';

export const GMAIL_CLIENT_ID_KEY = 'ledger-gmail-client-id';

const store = (): Storage | null => { try { return localStorage; } catch { return null; } };

/** The saved client ID, or null (never saved, storage unavailable, or the saved text is not a valid ID). */
export function readClientId(): string | null {
  try {
    const v = store()?.getItem(GMAIL_CLIENT_ID_KEY);
    if (!v) return null;
    const c = checkClientId(v);
    return c.ok ? c.id : null;
  } catch { return null; }
}

export function writeClientId(id: string): boolean {
  try { store()?.setItem(GMAIL_CLIENT_ID_KEY, id); return store() !== null; } catch { return false; }
}

export function removeClientId(): void {
  try { store()?.removeItem(GMAIL_CLIENT_ID_KEY); } catch { /* nothing to remove */ }
}
