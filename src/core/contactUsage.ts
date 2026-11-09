/**
 * Contacts C1: "where does this Contact show up?" A READ-ONLY, conservative usage reader over the shared tables. It writes nothing, opens no
 * transaction, repairs nothing and never changes a record.
 *
 * It does NOT know any module's field names. For every live record it looks at every whole number in the record's data and counts the record
 * once for each live Contact whose id equals one of those numbers (Contact ids are time-based, about 1.78e15, so an unrelated number rarely
 * equals one). That makes it complete for fields a newer version may add, and it can only OVER-count (a number that happens to equal an id),
 * never miss a reference stored as a number. Shared links also name a Contact as the text `contact:<id>`.
 *
 * What it is NOT: a list of verified relationships. A count means "this many records mention this Contact's id". It must never be used on its own
 * to decide that a Contact can be deleted, merged or relinked. Named lists with links come later (C2).
 *
 * Contacts with a short id (below LOW_ID: old data from before ids were time-based) could match unrelated small numbers, so their counts are
 * flagged `approximate`.
 */
import { db, type FinanceDB } from '../db';
import { isLive } from './store';

/** Below this a Contact id is not a time-based id, and a number match is weak evidence. Real ids are around 1.78e15. */
export const LOW_ID = 1e12;

export interface UsageEntry {
  /** `tasks`, `calendar`, ... or `shared` for links, attachments and due items. */
  module: string;
  /** `task`, `event`, `link`, ... */
  kind: string;
  /** How many live records of this kind mention the Contact (a record that mentions it twice counts once). */
  count: number;
}
export interface ContactUsage {
  /** Per Contact id (only Contacts with at least one mention have an entry), most-used kind first. */
  byContact: Map<number, UsageEntry[]>;
  /** Contacts whose counts may include unrelated matches (short ids). */
  approximate: Set<number>;
  /** How many live rows were looked at, for the record. */
  scanned: number;
}

const MODULE_NAME: Record<string, string> = {
  tasks: 'Tasks', calendar: 'Calendar', projects: 'Projects', assets: 'Home & Assets', services: 'Household Services', bills: 'Bills & Subscriptions',
  family: 'Family', household: 'Household Finances', contacts: 'Contacts', shared: 'Saved links and attachments',
};
/** The module's name for a person to read; an unknown module shows its own id (never hidden). */
export const usageModuleName = (id: string) => MODULE_NAME[id] ?? id;

const KIND_WORDS: Record<string, [string, string]> = {
  'tasks/task': ['task', 'tasks'],
  'calendar/event': ['calendar event', 'calendar events'],
  'projects/project': ['project', 'projects'],
  'projects/commitment': ['project commitment', 'project commitments'],
  'assets/asset': ['home or asset record', 'home or asset records'],
  'assets/service': ['service history entry', 'service history entries'],
  'assets/warranty': ['warranty', 'warranties'],
  'services/arrangement': ['service arrangement', 'service arrangements'],
  'services/visit': ['service visit', 'service visits'],
  'bills/obligation': ['bill or subscription', 'bills and subscriptions'],
  'family/member': ['family member record', 'family member records'],
  'family/contact': ['important-contact entry', 'important-contact entries'],
  'shared/link': ['saved link', 'saved links'],
  'shared/attachment': ['attachment', 'attachments'],
  'shared/due': ['dated reminder', 'dated reminders'],
};
/** "3 tasks", "1 calendar event". An unknown kind is still counted, as "record(s)". */
export function usageKindText(e: UsageEntry): string {
  const [one, many] = KIND_WORDS[`${e.module}/${e.kind}`] ?? ['record', 'records'];
  return `${e.count} ${e.count === 1 ? one : many}`;
}

/** Module ids in the order a person expects to read them; anything else follows alphabetically. */
const MODULE_ORDER = ['family', 'tasks', 'calendar', 'projects', 'assets', 'services', 'bills', 'household', 'shared'];
const moduleRank = (m: string) => { const i = MODULE_ORDER.indexOf(m); return i < 0 ? MODULE_ORDER.length : i; };

/** Pure: entries -> distinct module ids in reading order. */
export const usedModules = (entries: readonly UsageEntry[]): string[] =>
  [...new Set(entries.map((e) => e.module))].sort((a, b) => moduleRank(a) - moduleRank(b) || a.localeCompare(b));

/** Pure: "Used in Family, Tasks and Calendar", or "Not used anywhere yet". */
export function usageSummary(entries: readonly UsageEntry[] | undefined): string {
  const mods = usedModules(entries ?? []).map(usageModuleName);
  if (mods.length === 0) return 'Not mentioned anywhere else yet';
  if (mods.length === 1) return `Used in ${mods[0]}`;
  return `Used in ${mods.slice(0, -1).join(', ')} and ${mods[mods.length - 1]}`;
}

/** Pure: the whole numbers found anywhere in a value (objects, arrays, nested), not following non-JSON shapes. Strings `contact:<id>` are read as that id. */
export function collectNumbers(v: unknown, into: Set<number>, depth = 0): void {
  if (depth > 12 || v === null || v === undefined) return;
  if (typeof v === 'number') { if (Number.isInteger(v)) into.add(v); return; }
  if (typeof v === 'string') { const m = /^contact:(\d+)$/.exec(v); if (m) into.add(Number(m[1])); return; }
  if (Array.isArray(v)) { for (const x of v) collectNumbers(x, into, depth + 1); return; }
  if (typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) collectNumbers(x, into, depth + 1);
}

/**
 * Reads the usage of every live Contact (or only `onlyIds`) in ONE pass over the module records, links, attachments and due items.
 * `contactIds` limits which Contacts are looked for; when omitted, every live Contact is.
 */
export async function readContactUsage(d: FinanceDB = db, onlyIds?: readonly number[]): Promise<ContactUsage> {
  const wanted = new Set<number>(onlyIds ?? (await d.contacts.toArray()).filter(isLive).map((c) => c.id as number));
  const byKey = new Map<number, Map<string, UsageEntry>>();
  let scanned = 0;
  const tally = (ids: Set<number>, module: string, kind: string) => {
    for (const id of ids) {
      if (!wanted.has(id)) continue;
      const m = byKey.get(id) ?? new Map<string, UsageEntry>();
      const key = `${module}/${kind}`;
      const e = m.get(key) ?? { module, kind, count: 0 };
      e.count++;
      m.set(key, e);
      byKey.set(id, m);
    }
  };

  for (const r of await d.moduleRecords.toArray()) {
    if (!isLive(r)) continue;
    scanned++;
    const found = new Set<number>();
    collectNumbers(r.data, found);
    if (found.size) tally(found, r.module, r.kind);
  }
  for (const l of await d.links.toArray()) {
    if (!isLive(l)) continue;
    scanned++;
    const found = new Set<number>();
    collectNumbers(l.fromId, found);
    collectNumbers(l.toId, found);
    if (found.size) tally(found, 'shared', 'link');
  }
  const loose = (row: unknown) => { const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = row as Record<string, unknown>; void _i; void _c; void _u; void _d; return rest; };
  for (const a of await d.attachments.toArray()) {
    if (!isLive(a)) continue;
    scanned++;
    const found = new Set<number>();
    collectNumbers(loose(a), found);
    if (found.size) tally(found, 'shared', 'attachment');
  }
  for (const x of await d.dueItems.toArray()) {
    if (!isLive(x as { deletedAt?: number | null })) continue;
    scanned++;
    const found = new Set<number>();
    collectNumbers(loose(x), found);
    if (found.size) tally(found, 'shared', 'due');
  }

  const byContact = new Map<number, UsageEntry[]>();
  for (const [id, m] of byKey) byContact.set(id, [...m.values()].sort((a, b) => moduleRank(a.module) - moduleRank(b.module) || b.count - a.count || a.kind.localeCompare(b.kind)));
  return { byContact, approximate: new Set([...wanted].filter((id) => id < LOW_ID)), scanned };
}
