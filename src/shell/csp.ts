/**
 * The Content-Security-Policy added to the PRODUCTION build (see vite.config.ts). GitHub Pages cannot send headers, so it goes in a
 * <meta> tag. It limits where the app's scripts may load from and where data may be sent. It does not stop a script that is already
 * running from reading browser storage; it stops it from sending what it read to an arbitrary server.
 *
 * Every outside host the app talks to must be listed in CONNECT_HOSTS (a test checks this). An AI provider added later goes here too.
 */
export const CONNECT_HOSTS = [
  'https://api.github.com', // sync and backups, through a token you create
  'https://api.twelvedata.com', // optional price lookups, with your own key
  'https://gmail.googleapis.com', // CAL-G1: sends the Calendar messages you approve, only while you have connected Gmail
];

/**
 * CAL-G1: the narrow paths Google documents for its sign-in library (Google Identity Services). Exact paths, never the whole of google.com and no
 * wildcard. The library's script is the only outside script the app ever loads, and only after the owner enters a Google client ID. The library's
 * stylesheet path (`/gsi/style`, used by Google's own sign-in button, which Ledger does not show) is deliberately NOT allowed.
 */
export const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
export const GOOGLE_GSI_PATH = 'https://accounts.google.com/gsi/';

/** `scriptHashes` are the 'sha256-...' sources of the small inline scripts in index.html (the theme scripts). */
export function buildPolicy(scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${GOOGLE_SCRIPT_SRC} ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'", // screens set a few styles directly (sizes, colours)
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${CONNECT_HOSTS.join(' ')} ${GOOGLE_GSI_PATH}`,
    `frame-src ${GOOGLE_GSI_PATH}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
