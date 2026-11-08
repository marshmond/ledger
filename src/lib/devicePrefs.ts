/**
 * What follows you between devices and what stays put (UX-05). One list, used by the Settings explanation card and checked by a test against the
 * code that actually does the saving, so the words cannot drift from the behaviour:
 *  - `synced`    : stored in the database. Syncs to your other devices (when Sync is on) and is in backup files.
 *  - `device`    : stored in this browser only. Never synced. `inBackup` says whether `PREFERENCE_KEYS` (src/lib/backupFile.ts) carries it.
 *  - `secret`    : stays on each device, is never in a backup file or sync, and is typed in again on a new device.
 * Nothing here changes any behaviour.
 */
export type PrefKind = 'synced' | 'device' | 'secret';

export interface PrefItem {
  kind: PrefKind;
  /** Plain-language name shown to the owner. */
  label: string;
  /** For `device` items: the browser-storage keys this entry covers. Every key in `PREFERENCE_KEYS` must appear in exactly one entry. */
  keys?: string[];
  /** For `device` items: true when those keys are in `PREFERENCE_KEYS` (so a backup file carries them). */
  inBackup?: boolean;
}

export const PREF_ITEMS: PrefItem[] = [
  // Follow you to other devices when Sync is on, and are in backup files.
  { kind: 'synced', label: 'Your records: accounts, transactions, budget, scheduled items, tasks, events, bills, services, assets, projects, contacts and tags' },
  { kind: 'synced', label: 'The module the app opens to (Settings > General)' },
  { kind: 'synced', label: 'Today: how many days ahead to look and how many overdue items to list; alerts you dismissed' },
  { kind: 'synced', label: 'Calendar options set in Settings > Calendar' },

  // This device only, but saved in a backup file (restoring a backup puts them back).
  { kind: 'device', inBackup: true, label: 'Hide amounts', keys: ['today.hideAmounts.v1'] },
  { kind: 'device', inBackup: true, label: 'Today layout: card order, width and which cards are hidden', keys: ['today.layout.v1'] },
  { kind: 'device', inBackup: true, label: 'Colors and light or dark', keys: ['ledger-theme', 'ledger-palette', 'ledger-palette-vars'] },
  { kind: 'device', inBackup: true, label: 'The view you last used in Tasks', keys: ['tasks-last-view'] },
  { kind: 'device', inBackup: true, label: 'Household Services: the "Upcoming" window', keys: ['services-upcoming-days'] },
  { kind: 'device', inBackup: true, label: 'The module you used last', keys: ['ledger-last-module'] },
  { kind: 'device', inBackup: true, label: 'Finance layout and convenience choices: Home layout, folded sections, remembered tabs, open menu groups, amount keypad, last quick-add account, last sale method, last cash-flow view and dismissed hints', keys: ['ledger.home.layout.v1', 'ledger-collapsed', 'ledger-tabs', 'ledger-side-open', 'ledger-keypad-amounts', 'ledger-quick-account', 'ledger-sale-method', 'ledger-flow-last', 'ledger.onboarding.dismissed'] },

  // This device only, and NOT in a backup file.
  { kind: 'device', inBackup: false, label: 'Calendar: which calendars are shown, the last view and the agenda range', keys: ['calendar-hidden-layers', 'calendar-last-view', 'calendar-agenda-range'] },

  // Secrets.
  { kind: 'secret', label: 'The sync token and sync passphrase' },
  { kind: 'secret', label: 'The weekly-backup passphrase' },
  { kind: 'secret', label: 'The price-lookup key' },
];

export const PREF_GROUP_TITLES: Record<'synced' | 'deviceSaved' | 'deviceOnly' | 'secret', { title: string; blurb: string }> = {
  synced: { title: 'Follows you to your other devices', blurb: 'Saved with your records, so it syncs when Sync is on, and it is in every backup file.' },
  deviceSaved: { title: 'Stays on this device, but is saved in a backup file', blurb: 'Not synced, so each device keeps its own. Restoring a backup file puts these back on the device you restore to.' },
  deviceOnly: { title: 'Stays on this device and is not in a backup file', blurb: 'Not synced and not backed up. If you clear this browser’s data or move to a new device, you set these again.' },
  secret: { title: 'Secrets: enter them again on each device', blurb: 'Kept in this browser only. Never in a backup file and never synced, on purpose.' },
};

export type PrefGroup = keyof typeof PREF_GROUP_TITLES;

export const groupOf = (i: PrefItem): PrefGroup => (i.kind === 'synced' ? 'synced' : i.kind === 'secret' ? 'secret' : i.inBackup ? 'deviceSaved' : 'deviceOnly');
