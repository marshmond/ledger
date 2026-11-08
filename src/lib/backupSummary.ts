import type { BackupFile } from './backup';

/**
 * A plain-language "what is in this backup" summary. The groups are only a way of presenting the counts: they do NOT match the
 * database tables one to one (the Tasks, Calendar, Projects, Home & Assets and Household Services records all live in the single
 * shared `moduleRecords` table, told apart by their module and kind). Counts are of live records; records that were deleted
 * (kept only as hidden deletion markers so the deletion can sync) are not counted. Only counts are shown, never names or amounts.
 */
export interface SummaryItem { label: string; n: number }
export interface SummaryGroup { id: string; label: string; items: SummaryItem[] }

/** Shared tables, and the Finance tables worth naming. Every other table is counted under "other Finance data". */
const SHARED_TABLES = ['contacts', 'tags', 'attachments', 'links', 'dueItems', 'moduleRecords'];
const FINANCE_NAMED: [string, string][] = [['accounts', 'Accounts'], ['txns', 'Transactions'], ['categories', 'Budget categories'], ['invAccounts', 'Investment accounts'], ['loans', 'Loans']];

/** module -> kind -> label. A kind this build does not know about is still counted ("<module> records"), never dropped. */
const MODULE_KINDS: Record<string, { group: string; kinds: Record<string, string> }> = {
  tasks: { group: 'tasks-calendar', kinds: { task: 'Tasks', list: 'Task lists' } },
  calendar: { group: 'tasks-calendar', kinds: { event: 'Calendar events', calendar: 'Calendars' } },
  projects: { group: 'projects', kinds: { project: 'Projects', commitment: 'Commitments', budgetLine: 'Budget lines' } },
  assets: { group: 'assets', kinds: { asset: 'Items', service: 'Service entries', warranty: 'Warranties' } },
  services: { group: 'services', kinds: { arrangement: 'Arrangements', visit: 'Visits' } },
  bills: { group: 'bills', kinds: { obligation: 'Bills and subscriptions', cycle: 'Billing-period records', discovery: 'Recurring-expense review choices' } },
};
const GROUP_LABEL: Record<string, string> = {
  finance: 'Finance', 'tasks-calendar': 'Tasks & Calendar', projects: 'Projects', assets: 'Home & Assets', services: 'Household Services', bills: 'Bills & Subscriptions',
  shared: 'Contacts & shared relationships', other: 'Other application data',
};
const GROUP_ORDER = ['finance', 'tasks-calendar', 'projects', 'assets', 'services', 'bills', 'shared', 'other'];

type Row = { deletedAt?: number | null; module?: string; kind?: string };
const rowsOf = (b: BackupFile, k: string): Row[] => (((b as unknown as Record<string, unknown>)[k] as Row[] | undefined) ?? []);
const live = (r: Row) => r.deletedAt == null;

export function summarizeBackup(b: BackupFile): SummaryGroup[] {
  const groups = new Map<string, SummaryItem[]>(GROUP_ORDER.map((g) => [g, []]));
  const add = (g: string, label: string, n: number) => {
    const items = groups.get(g)!;
    const hit = items.find((i) => i.label === label);
    if (hit) hit.n += n; else items.push({ label, n });
  };

  // Finance: everything in the file that is not a shared table.
  let namedTotal = 0;
  for (const [t, label] of FINANCE_NAMED) { const n = rowsOf(b, t).length; namedTotal += n; add('finance', label, n); }
  const allTables = Object.keys(b).filter((k) => Array.isArray((b as unknown as Record<string, unknown>)[k]));
  let financeTotal = 0;
  for (const t of allTables) if (!SHARED_TABLES.includes(t)) financeTotal += rowsOf(b, t).length;
  const other = financeTotal - namedTotal;
  if (other > 0) add('finance', 'Other Finance records (budget, income, goals, settings and so on)', other);

  for (const [t, label] of [['contacts', 'Contacts'], ['links', 'Links between records'], ['tags', 'Tags'], ['attachments', 'Attachment entries (names and web addresses only)'], ['dueItems', 'Due items']] as const) {
    add('shared', label, rowsOf(b, t).filter(live).length);
  }

  for (const r of rowsOf(b, 'moduleRecords').filter(live)) {
    const m = MODULE_KINDS[r.module ?? ''];
    if (m) add(m.group, m.kinds[r.kind ?? ''] ?? `${r.module} records (${r.kind})`, 1);
    else add('other', `${r.module ?? 'unknown'} records`, 1);
  }

  return GROUP_ORDER
    .map((id) => ({ id, label: GROUP_LABEL[id], items: groups.get(id)!.filter((i) => i.n > 0) }))
    .filter((g) => g.items.length > 0);
}

/** The warning every plain backup carries. */
export const PRIVACY_WARNING = 'This backup may contain sensitive household and financial information. Store it securely.';
