/**
 * Ledger's due provider: the dated things Ledger already works out (scheduled items, RSU vests, tax deadlines, RMDs, pay milestones,
 * the next loan payment), handed to the Calendar read-only. Nothing is stored and no date is worked out a second time:
 *  - scheduled items come from `dueInstances()` (the same function Home, the sidebar count and the Scheduled page use),
 *  - everything else comes from `loadCalendar()` (the same list as Home's "Coming up").
 * Left out on purpose: budget bill goals (month only), windfalls and goals (year only), donations and HSA withdrawals (past actions).
 */
import { db, type FinanceDB } from '../../db';
import { derivedId, goTo, type DerivedItem, type DueProvider, type DueQuery } from '../../core/dueProvider';
import type { Priority } from '../../core/entities';
import { DEFAULT_CALENDAR_SETTINGS, loadCalendarSettings, type FinanceClass } from '../../core/calendarSettings';
import { addDays } from '../../lib/dates';
import { daysBetween, formatCents } from '../../lib/money';
import { loadCalendar } from '../../lib/calendarLive';
import type { CalKind } from '../../lib/calendar';
import { maskMoney } from '../../ui/TxnRefs';
import { loadHideAmounts } from '../today/layout';
import { dueInstances } from '../../lib/schedule';

export const LEDGER_LAYER_COLOR = '#2f8f6b';

/** Which class of Finance item a Ledger calendar entry belongs to (this decides its default priority). */
export function classOfKind(kind: CalKind): FinanceClass {
  switch (kind) {
    case 'vest': return 'vest';
    case 'tax': case 'year-end': return 'tax';
    case 'rmd': return 'rmd';
    case 'cap': return 'milestone';
    case 'loan': return 'loan';
    default: return 'bill';
  }
}

/**
 * The priority for an item: the class's setting, except bills and loans set to `medium` become `high` when due within 3 days or overdue.
 * (If you change a class to something other than medium, that choice is used as is.)
 */
export function financePriority(cls: FinanceClass, date: string, today: string, base: Priority): Priority {
  if ((cls === 'bill' || cls === 'loan') && base === 'medium' && daysBetween(date, today) <= 3) return 'high';
  return base;
}

/**
 * `hide` is the app-wide Hide Amounts switch (default: read it now). With it on, the SCREEN text of every Finance item carries no money figure:
 * a scheduled item shows its payee only ("Example Rent", detail "Scheduled payment to approve."), and any other amount in a title or detail
 * (a loan payment, an RSU vest, an estimated-tax shortfall) shows as the usual masked figure. Dates, identifiers, priorities and the
 * scheduling itself are unchanged. The calendar FILE (.ics) is a separate, deliberate export: it keeps the full text through `icsTitle` and
 * `icsDetail`, so hiding amounts on screen never silently changes what an exported file holds (docs/due-provider.md).
 */
export async function ledgerDueItems(d: FinanceDB, q: DueQuery, hide: boolean = loadHideAmounts()): Promise<DerivedItem[]> {
  const settings = await loadCalendarSettings(d).catch(() => DEFAULT_CALENDAR_SETTINGS);
  const prios = settings.financePriorities;
  const out: DerivedItem[] = [];
  // Ledger only looks forward from today; ask far enough ahead to cover the end of the range (a year or so at most).
  const ahead = Math.max(1, Math.min(800, daysBetween(q.to, q.today)));
  const [events, due] = await Promise.all([loadCalendar(d, q.today, ahead), dueInstances(d, q.today, ahead)]);

  // Everything except scheduled items: exactly what Home's "Coming up" lists.
  for (const e of events) {
    if (e.kind === 'bill') continue;
    if (e.date < q.from || e.date > q.to) continue;
    const cls = classOfKind(e.kind);
    out.push({
      id: derivedId('ledger', e.id, e.date),
      sourceModule: 'ledger',
      sourceRecordId: e.id,
      title: hide ? maskMoney(e.title) : e.title,
      date: e.date,
      allDay: true,
      priority: financePriority(cls, e.date, q.today, prios[cls]),
      status: 'open',
      detail: hide ? maskMoney(e.detail) : e.detail,
      ...(hide ? { icsTitle: e.title, icsDetail: e.detail } : {}),
      openSource: () => goTo(`/ledger${e.to}`),
      sourceLabel: 'Edit in Ledger',
      icsUid: `${e.id}@ledger.local`,
      icsAlarmMinutes: e.kind === 'cap' ? undefined : 1440,
    });
  }

  // Scheduled items: only the ones you have not approved or skipped. Old ones drop out after the overdue window.
  const oldest = addDays(q.today, -Math.max(0, settings.overdueDays));
  for (const { rule, date } of due) {
    if (date < oldest) continue;
    const inRange = date >= q.from && date <= q.to;
    const overdueExtra = q.overdueDays > 0 && date < q.today && date >= addDays(q.today, -q.overdueDays);
    if (!inRange && !overdueExtra) continue;
    const cls: FinanceClass = rule.transferAccountId || rule.amountCents >= 0 ? 'income' : 'bill';
    out.push({
      id: derivedId('ledger', `scheduled-${rule.id}`, date),
      sourceModule: 'ledger',
      sourceRecordId: `scheduled:${rule.id}`,
      title: hide ? rule.payee : `${rule.payee} ${formatCents(Math.abs(rule.amountCents))}`,
      date,
      allDay: true,
      priority: financePriority(cls, date, q.today, prios[cls]),
      status: 'open',
      detail: rule.transferAccountId ? 'Scheduled transfer to approve.' : rule.amountCents < 0 ? 'Scheduled payment to approve.' : 'Scheduled income to approve.',
      ...(hide ? { icsTitle: `${rule.payee} ${formatCents(Math.abs(rule.amountCents))}` } : {}),
      // Opens that item in the Scheduled page's edit form (the date and amount are changed there, never in the Calendar).
      openSource: () => goTo(`/ledger/scheduled?rule=${rule.id}`),
      sourceLabel: 'Edit in Ledger',
      // The same id the existing "Add to my calendar" file uses, so phone calendars do not show a bill twice.
      icsUid: `bill-${rule.id}-${date}@ledger.local`,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export const ledgerDueProvider: DueProvider = {
  id: 'ledger',
  layerName: 'Finance',
  color: LEDGER_LAYER_COLOR,
  getDueItems: (q) => ledgerDueItems(db, q),
  /** Scheduled items never approved or skipped and dated before the cutoff, for Today's "N older items" link to Ledger Scheduled. */
  olderThan: async (cutoff, today) => {
    const count = (await dueInstances(db, today, 0)).filter((x) => x.date < cutoff).length;
    return count > 0 ? { count, path: '/ledger/scheduled' } : null;
  },
};
