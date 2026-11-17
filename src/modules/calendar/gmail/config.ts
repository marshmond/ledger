/**
 * CAL-G1: the fixed facts about Ledger's Gmail connection. Public constants only: nothing here is a secret.
 *
 * The permission Ledger asks Google for is ONE scope: "send email on your behalf". It cannot read, search, list, change or delete mail. Ledger does
 * not ask for an identity scope, offline access, a refresh token, Drive or Google Calendar.
 */

/** The only scope ever requested. */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/**
 * Scopes Ledger tolerates in a token Google hands back. Anything else (for example mailbox read access left over from an earlier grant) makes Ledger
 * refuse the token, because a broader token than needed is a larger loss if it were ever stolen.
 */
export const TOLERATED_SCOPES: readonly string[] = [
  GMAIL_SEND_SCOPE, 'openid', 'email', 'profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile',
];

/** Google's own sign-in library (Google Identity Services). Loaded only when the owner has entered a client ID, never at start-up. */
export const GOOGLE_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

/** The Gmail API call that sends one message. */
export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/** The web address Google must list as an "authorised JavaScript origin" (an address, never a path). */
export const APP_ORIGIN = 'https://marshmond.github.io';

/** A Google OAuth web client ID looks like `1234567890-abc123def.apps.googleusercontent.com`. It is public configuration, not a secret. */
const CLIENT_ID = /^[0-9]{6,}-[a-z0-9_]{6,}\.apps\.googleusercontent\.com$/i;

export type ClientIdCheck = { ok: true; id: string } | { ok: false; problem: string };

/** Checks what the owner typed or pasted. A client SECRET is refused by name: Ledger never needs one and must never hold one. */
export function checkClientId(raw: string): ClientIdCheck {
  const id = raw.trim();
  if (!id) return { ok: false, problem: 'Enter the client ID from Google.' };
  if (/^GOCSPX-/i.test(id) || /client[_ -]?secret/i.test(id)) return { ok: false, problem: 'That looks like a client secret. Ledger never needs one and will not keep one. Paste the Client ID instead (it ends in .apps.googleusercontent.com).' };
  if (/\s/.test(id)) return { ok: false, problem: 'The client ID has no spaces. Paste just the ID.' };
  if (!CLIENT_ID.test(id)) return { ok: false, problem: 'That does not look like a Google client ID. It looks like 1234567890-abc123.apps.googleusercontent.com.' };
  return { ok: true, id };
}
