/**
 * Ledger's alerts for "Needs you" (R1.1). READ ONLY. The alerts are the SAME list Ledger Home and Today's "Needs attention" card show: they come from `useLedgerAlerts`
 * (the one place the alert inputs are gathered) and `computeAlerts` (the one place the rules live). Nothing was moved or re-written: the logic is a React hook with
 * twenty live queries, so it is used as it is instead of copying its rules. Today runs ONE copy of it (`alertsShare.tsx`, offered to Today through `Provider`), shared
 * by the "Needs attention" card and this source, because a second copy doubled the main-thread work on a phone (see the R1.1 report).
 *
 * What is kept from the source:
 *   - Dismiss and snooze are honored exactly as the card does (`isAlertHidden` over the same remembered choices): a dismissed or snoozed alert is not listed.
 *     Needs you adds no dismiss or snooze of its own; the buttons stay on the "Needs attention" card.
 *   - Severity: a "warn" alert is `serious` (tier 1, even with no date); an "info" alert is an ordinary review item.
 * What is changed, and only this: alert wording that carries an amount (a tax estimate, a cash low point, an account balance) is replaced by amount-free words, because
 * this list never shows money. The alert itself, its rule and its link are untouched.
 * Left out as informational (nothing to do): an upcoming RSU vest ("vest") and loss-harvesting candidates ("harvest").
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { acceptableAttention, containsMoney, type AttentionItem, type AttentionRead, type AttentionSource } from '../../core/attention';
import type { Alert } from '../../lib/alerts';
import { alertKey, isAlertHidden, loadAlertMemory, type AlertMemoryMap } from '../today/settings';
import { LedgerAlertsProvider, useSharedLedgerAlerts } from './alertsShare';

const MODULE = 'ledger';
const OMITTED_AS_INFORMATIONAL: ReadonlySet<string> = new Set(['vest', 'harvest']);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Amount-free replacements, used only when the alert's own text carries money. */
const NO_MONEY: Record<string, { title: string; reason: string }> = {
  owe: { title: 'On track to owe federal tax', reason: 'Withholding is below the estimated tax for the year. Adjust withholding or plan a payment.' },
  forecast: { title: 'Cash may run low', reason: 'The cash forecast drops below your warning level within the next 90 days.' },
  estimated: { title: 'An estimated tax payment is due', reason: 'You are on track to owe tax beyond withholding.' },
  noprice: { title: 'Some holdings have no price', reason: 'These holdings are not counted in balances until they are priced.' },
};

const safe = (text: string, fallback: string) => (containsMoney(text) ? fallback : text);

/** Pure: the alerts that are not dismissed or snoozed, as items. Alert order is the source's own (warn first); ranking happens later. */
export function ledgerAttentionItems(alerts: readonly Alert[], memory: AlertMemoryMap, today: string, accountNames: ReadonlyMap<number, string> = new Map()): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const a of alerts) {
    if (OMITTED_AS_INFORMATIONAL.has(a.id)) continue;
    if (isAlertHidden(memory[alertKey(a)], today)) continue;
    const mincash = /^mincash:(\d+)$/.exec(a.id);
    const accountId = mincash ? Number(mincash[1]) : null;
    const fb = mincash
      ? { title: `${accountNames.get(accountId!) ?? 'An account'} is under its minimum balance`, reason: 'The balance is below the minimum you set for this account.' }
      : NO_MONEY[a.id] ?? { title: 'A financial alert needs attention', reason: 'Open Ledger to see why.' };
    const dated = (a.id === 'forecast' || a.id === 'estimated') && a.period && ISO.test(a.period) ? a.period : null;
    out.push({
      id: `${MODULE}:alert:${a.id}:${a.period ?? ''}`, moduleId: MODULE, recordId: accountId === null ? null : `account:${accountId}`, condition: null,
      kind: 'review', ...(a.level === 'warn' ? { severity: 'serious' as const } : {}), sourceSeverity: a.level,
      date: dated, title: safe(mincash ? fb.title : a.title, fb.title), reason: safe(mincash ? fb.reason : a.detail, fb.reason),
      href: `#/ledger${a.to.startsWith('/') ? a.to : `/${a.to}`}`, provenance: 'Ledger alerts (the same list as Ledger Home)',
    });
  }
  return out;
}

export const ledgerAttention: AttentionSource = {
  Provider: LedgerAlertsProvider, // ONE copy of the alert hook for the whole Today screen, shared with the "Needs attention" card (read-only form: it never writes)
  useItems(today: string): AttentionRead {
    const shared = useSharedLedgerAlerts();
    const memory = useLiveQuery(() => loadAlertMemory(db), []);
    // outside a provider the alerts cannot be read: say so (the list names Ledger as not checked) instead of showing nothing
    if (!shared) return { items: [], ready: true, failed: true };
    if (memory === undefined) return { items: [], ready: false };
    const { alerts, accounts } = shared;
    const names = new Map(accounts.flatMap((x) => (x.id === undefined ? [] : [[x.id, x.name] as const])));
    return { items: acceptableAttention(MODULE, ledgerAttentionItems(alerts, memory, today, names)), ready: true };
  },
};
