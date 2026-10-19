/**
 * The monthly check-in: a short routine that keeps the data trustworthy. Most steps look at your data and tick themselves when there is
 * nothing left to do; a few (like comparing balances with your bank) you tick yourself. Pure: the page gathers the numbers.
 */

export interface CheckinInput {
  today: string;
  /** Scheduled items that are due or overdue. */
  dueScheduled: number;
  /** Uncategorized transactions this month. */
  uncategorized: number;
  /** Transactions still pending after more than a week. */
  pendingOld: number;
  overspentCategories: number;
  readyToAssignCents: number;
  /** Budget targets that exist, and how much they still need this month. */
  targetsCount: number;
  targetsNeedCents: number;
  /** Holdings: how many have no price, and the age in days of the oldest price (null if there are no holdings). */
  holdings: number;
  noPriceCount: number;
  oldestPriceDays: number | null;
  /** Property values older than a year. */
  propertyCount: number;
  propertyStale: number;
  forecastBelow: { date: string } | null;
  hasCashAccounts: boolean;
  lastBackup?: string;
  /** Anything entered yet? */
  hasData: boolean;
}

export interface Step {
  id: string;
  title: string;
  /** What is left to do, or why it is done. */
  detail: string;
  /** done: nothing left. todo: needs you. na: does not apply to you. */
  status: 'done' | 'todo' | 'na';
  /** Steps you tick yourself. */
  manual: boolean;
  to: string;
  actionLabel: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (a: string, b: string) => Math.round((Date.parse(a.slice(0, 10) + 'T00:00:00Z') - Date.parse(b.slice(0, 10) + 'T00:00:00Z')) / 86400000);

export function buildCheckin(i: CheckinInput, fmt: (c: number) => string = (c) => `$${(c / 100).toFixed(2)}`): Step[] {
  const steps: Step[] = [];
  const add = (s: Step) => steps.push(s);

  add({
    id: 'scheduled', manual: false, to: '/scheduled', actionLabel: 'Review',
    title: 'Approve or skip scheduled items',
    status: i.dueScheduled === 0 ? 'done' : 'todo',
    detail: i.dueScheduled === 0 ? 'Nothing is waiting.' : `${plural(i.dueScheduled, 'scheduled item')} due. Approving posts it to your ledger.`,
  });
  add({
    id: 'categorize', manual: false, to: '/transactions?q=', actionLabel: 'Open transactions',
    title: 'Categorize this month’s transactions',
    status: i.uncategorized === 0 ? 'done' : 'todo',
    detail: i.uncategorized === 0 ? 'Everything this month has a category.' : `${plural(i.uncategorized, 'transaction')} still uncategorized. Rules can do this for you.`,
  });
  add({
    id: 'pending', manual: false, to: '/accounts', actionLabel: 'Open accounts',
    title: 'Clear pending transactions',
    status: i.pendingOld === 0 ? 'done' : 'todo',
    detail: i.pendingOld === 0 ? 'No old pending items.' : `${plural(i.pendingOld, 'transaction')} pending for over a week. Mark them cleared once they appear on your statement.`,
  });
  add({
    id: 'reconcile', manual: true, to: '/accounts', actionLabel: 'Open accounts',
    title: 'Compare balances with your bank',
    status: 'todo',
    detail: 'Check each account’s balance against your bank or card statement and reconcile what differs.',
  });

  const budgetOk = i.overspentCategories === 0 && i.readyToAssignCents >= 0 && i.readyToAssignCents < 5000;
  add({
    id: 'budget', manual: false, to: '/budget', actionLabel: 'Open budget',
    title: 'Give every dollar a job',
    status: budgetOk ? 'done' : 'todo',
    detail: budgetOk ? 'No overspending and nothing left unassigned.' : [
      i.overspentCategories > 0 ? `${plural(i.overspentCategories, 'category', 'categories')} overspent` : '',
      i.readyToAssignCents < 0 ? `Ready to Assign is ${fmt(i.readyToAssignCents)}` : i.readyToAssignCents >= 5000 ? `${fmt(i.readyToAssignCents)} is unassigned` : '',
    ].filter(Boolean).join('; ') + '.',
  });
  add({
    id: 'targets', manual: false, to: '/budget', actionLabel: 'Fund targets',
    title: 'Fund your budget targets',
    status: i.targetsCount === 0 ? 'na' : i.targetsNeedCents === 0 ? 'done' : 'todo',
    detail: i.targetsCount === 0 ? 'You have no targets.' : i.targetsNeedCents === 0 ? 'Every target is funded for this month.' : `${fmt(i.targetsNeedCents)} still needed this month to stay on track.`,
  });

  const priceBad = i.noPriceCount > 0 || (i.oldestPriceDays !== null && i.oldestPriceDays > 10);
  add({
    id: 'prices', manual: false, to: '/investments', actionLabel: 'Update prices',
    title: 'Update investment prices',
    status: i.holdings === 0 ? 'na' : priceBad ? 'todo' : 'done',
    detail: i.holdings === 0 ? 'You have no holdings.' : i.noPriceCount > 0 ? `${plural(i.noPriceCount, 'holding')} with no price.` : priceBad ? `Prices are ${i.oldestPriceDays} days old.` : 'Prices are fresh.',
  });
  add({
    id: 'property', manual: false, to: '/networth', actionLabel: 'Update values',
    title: 'Refresh your home value',
    status: i.propertyCount === 0 ? 'na' : i.propertyStale === 0 ? 'done' : 'todo',
    detail: i.propertyCount === 0 ? 'No property entered.' : i.propertyStale === 0 ? 'Values are recent.' : `${plural(i.propertyStale, 'value')} over a year old.`,
  });
  add({
    id: 'forecast', manual: false, to: '/forecast', actionLabel: 'See the forecast',
    title: 'Look at the cash forecast',
    status: !i.hasCashAccounts ? 'na' : i.forecastBelow ? 'todo' : 'done',
    detail: !i.hasCashAccounts ? 'No checking or savings accounts.' : i.forecastBelow ? `Cash may dip below your warning level on ${i.forecastBelow.date}.` : 'Cash stays above your warning level.',
  });

  const backupAge = i.lastBackup ? days(i.today, i.lastBackup) : null;
  add({
    id: 'backup', manual: false, to: '/backup', actionLabel: 'Back up',
    title: 'Back up your data',
    status: !i.hasData ? 'na' : backupAge !== null && backupAge <= 30 ? 'done' : 'todo',
    detail: !i.hasData ? 'Nothing to back up yet.' : backupAge === null ? 'No backup yet.' : backupAge <= 30 ? `Last backup ${backupAge === 0 ? 'today' : `${backupAge} day${backupAge === 1 ? '' : 's'} ago`}.` : `Last backup was ${backupAge} days ago.`,
  });
  return steps;
}

export type Marks = Record<string, boolean>;

/** Your own ticks win for manual steps, and can also override an automatic step you have dealt with another way. */
export function withMarks(steps: Step[], marks: Marks): Step[] {
  return steps.map((s) => (s.status === 'todo' && marks[s.id] ? { ...s, status: 'done' as const, detail: s.manual ? 'You checked this off.' : `${s.detail} (checked off by you)` } : s));
}

export function progress(steps: Step[]): { done: number; total: number; left: number; complete: boolean } {
  const live = steps.filter((s) => s.status !== 'na');
  const done = live.filter((s) => s.status === 'done').length;
  return { done, total: live.length, left: live.length - done, complete: live.length > 0 && done === live.length };
}

/** How many months in a row, ending at `month` (or the month before it if this one is not finished), were completed. */
export function streak(completed: string[], month: string): number {
  const set = new Set(completed);
  const prev = (m: string) => { const y = Number(m.slice(0, 4)); const mo = Number(m.slice(5, 7)); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
  let m = set.has(month) ? month : prev(month);
  let n = 0;
  while (set.has(m)) {
    n++;
    m = prev(m);
  }
  return n;
}
