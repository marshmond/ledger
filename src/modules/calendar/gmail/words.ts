/**
 * CAL-G1: everything the owner reads about the Gmail connection, in plain words. One place, so the settings section, the review screen and the
 * tests say the same thing. No sentence here ever contains an address, a token or a raw message from Google.
 */
import type { GmailProblem, GmailState } from './auth';
import { APP_ORIGIN, GMAIL_SEND_SCOPE } from './config';

export function problemText(p: GmailProblem | 'busy'): string {
  switch (p) {
    case 'busy': return 'Google\'s window is already open. Finish there, or press Cancel.';
    case 'no-client-id': return 'Enter your Google client ID in Calendar settings first.';
    case 'offline': return 'This device is offline, so Ledger cannot reach Google. Nothing was changed.';
    case 'script-unavailable': return 'Ledger could not load Google\'s sign-in code. Check your connection (and that nothing blocks accounts.google.com), then try again.';
    case 'popup-blocked': return 'Your browser blocked Google\'s window. Allow pop-ups for this site, then press Connect Gmail again.';
    case 'closed': return 'Google\'s window closed before Gmail was connected. If Google showed an error first ("Access blocked", "origin_mismatch" or "invalid_client"), check the setup steps below.';
    case 'denied': return 'Google did not give Ledger permission, so Gmail is not connected. If Google said the app is not allowed, check that your own Google address is listed as a test user.';
    case 'scope-missing': return 'Google connected, but the "send email" permission was not ticked, so Ledger cannot send. Press Connect Gmail and tick it.';
    case 'too-broad': return 'Google reported more permission than Ledger asked for, so Ledger refused it and asked Google to remove it. Press Connect Gmail again.';
    case 'invalid-client': return 'Google does not recognise this client ID. Check that you copied the Client ID of a "Web application" client from the right Google project.';
    case 'invalid-request': return `Google rejected the request. Check the client ID, and that ${APP_ORIGIN} is listed as an authorized JavaScript origin (the address only, with no /ledger/ on the end).`;
    case 'timeout': return 'Google did not answer. Press Connect Gmail to try again.';
    case 'unknown': return 'Google could not connect Gmail. Try again, or check the setup steps below.';
  }
}

export type Tone = 'ok' | 'warn' | 'info' | 'quiet';
export interface GmailSummary { tone: Tone; label: string; sentence: string }

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function summaryOf(s: GmailState): GmailSummary {
  if (!s.configured) return { tone: 'quiet', label: 'Not configured', sentence: 'Gmail is not set up on this device. Enter your Google client ID below to begin. Until then Ledger cannot email anyone, exactly as before.' };
  switch (s.phase) {
    case 'connecting': return { tone: 'info', label: 'Waiting for Google', sentence: 'Finish in Google\'s window. Nothing is sent by connecting.' };
    case 'connected': return { tone: 'ok', label: 'Connected for this browser session', sentence: `Ledger can send the messages you approve${s.expiresAt ? ` until about ${clock(s.expiresAt)}` : ''}, or until you close or reload this page. Ledger does not keep the permission.` };
    case 'expired': return { tone: 'warn', label: 'Authorization expired', sentence: 'Google\'s permission has run out. Press Connect Gmail to authorize again. Nothing is sent when you do.' };
    default: return { tone: 'warn', label: 'Not connected', sentence: 'Press Connect Gmail and approve the permission in Google\'s own window. Ledger does not keep it, so you do this once per browser session.' };
  }
}

/** What Ledger can and cannot say about the account, stated plainly rather than guessed. */
export const ACCOUNT_NOTE = 'Which Google account: Ledger asked Google only for permission to send, so Google does not tell it which account you chose and it cannot show one. Choose the account yourself in Google\'s window. While your Google project is in "Testing" with only you as a test user, only your own account can authorize.';

export const PERMISSION_NOTE = 'Ledger asks for one permission only: "Send email on your behalf". It cannot read, search or change your mail.';

/** The short setup steps shown in Calendar settings (the report carries the longer version). Google may rename screens; the idea stays the same. */
export const SETUP_STEPS: readonly string[] = [
  'Open console.cloud.google.com and create a project (any name, for example "Ledger").',
  'Turn on the Gmail API: APIs & Services, then Library, search "Gmail API", then Enable.',
  'Open Google Auth Platform and set up the app: a name such as "Ledger", your own email as the contact, and Audience "External".',
  'Under Audience leave the publishing status as "Testing" and add your own Gmail address (only yours) under Test users.',
  `Under Data Access, add one scope: ${GMAIL_SEND_SCOPE} ("Send email on your behalf"). Add no others.`,
  `Under Clients, choose Create client, type "Web application", and add ${APP_ORIGIN} under Authorized JavaScript origins. That is the address only: no /ledger/. Leave the redirect addresses empty.`,
  'Copy the Client ID (the long text ending in .apps.googleusercontent.com). Never copy or paste the client secret.',
  'Paste the Client ID above, press Save client ID, then Connect Gmail. Google warns that the app is not verified because it is your own project in Testing: choose Advanced, then continue, and tick "Send email on your behalf".',
];

export const TESTING_NOTE = 'In Testing, Google may ask you to approve again after about seven days, and it limits the app to the test users you list. Neither matters for personal use. Ledger keeps no permission anyway, so you press Connect Gmail once each time you open Ledger and want to send.';
