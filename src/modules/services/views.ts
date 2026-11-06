/**
 * Read models for the Household Services screens. One loader reads everything once; pure builders turn it into the rows each screen shows.
 * Nothing here writes. Phone, email and notes are not part of any row except where a screen is the provider page itself.
 */
import { db, type FinanceDB } from '../../db';
import type { Contact } from '../../core/entities';
import { createStore, isLive } from '../../core/store';
import { loadTasks } from '../tasks/data';
import type { TaskRecord } from '../tasks/model';
import { loadAssets, publicLabel } from '../assets/data';
import { parseAssetRef, STATUS_LABEL as ASSET_STATUS, TYPE_LABEL, type AssetRecord } from '../assets/model';
import { ASSET_LINK, MODULE, parseArrangementRef, TASK_LINK, type ArrangementRecord } from './model';
import { loadArrangements } from './data';
import { openOf, scheduleHealth, type Health } from './schedule';

export interface AssetView { id: number; name: string; typeLabel: string; statusLabel: string; /** sold, disposed of or replaced */ past: boolean; archived: boolean; /** the asset no longer exists on this device */ missing: boolean; replacedBy: string | null }

export function assetViews(ids: number[], assets: AssetRecord[]): AssetView[] {
  return ids.map((id) => {
    const a = assets.find((x) => x.id === id);
    if (!a) return { id, name: 'An asset that no longer exists', typeLabel: '', statusLabel: '', past: false, archived: false, missing: true, replacedBy: null };
    const repl = a.data.replacedById !== null ? assets.find((x) => x.id === a.data.replacedById) : undefined;
    return {
      id, name: publicLabel(assets, id), typeLabel: TYPE_LABEL[a.data.type], statusLabel: ASSET_STATUS[a.data.status], past: ['sold', 'disposed', 'replaced'].includes(a.data.status),
      archived: a.data.archived, missing: false, replacedBy: repl ? publicLabel(assets, repl.id) : null,
    };
  });
}

export interface Snapshot {
  arrangements: ArrangementRecord[];
  tasksBy: Map<number, TaskRecord[]>;
  assetIdsBy: Map<number, number[]>;
  assets: AssetRecord[];
  contacts: Contact[];
}
export async function loadSnapshot(d: FinanceDB = db): Promise<Snapshot> {
  const [arrangements, tasks, links, assets, contacts] = await Promise.all([loadArrangements(d), loadTasks(d), d.links.toArray(), loadAssets(d), createStore(d).shared.contacts.query()]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const tasksBy = new Map<number, TaskRecord[]>();
  const assetIdsBy = new Map<number, number[]>();
  for (const l of links) {
    if (!isLive(l)) continue;
    if (l.type === TASK_LINK && l.fromModule === 'tasks' && l.toModule === MODULE) {
      const arr = parseArrangementRef(l.toId); const t = byId.get(Number(l.fromId));
      if (arr !== null && t) { const list = tasksBy.get(arr) ?? []; if (!list.includes(t)) list.push(t); tasksBy.set(arr, list); }
    } else if (l.type === ASSET_LINK && l.fromModule === MODULE && l.toModule === 'assets') {
      const arr = parseArrangementRef(l.fromId); const as = parseAssetRef(l.toId);
      if (arr !== null && as !== null) { const list = assetIdsBy.get(arr) ?? []; if (!list.includes(as)) list.push(as); assetIdsBy.set(arr, list); }
    }
  }
  return { arrangements, tasksBy, assetIdsBy, assets, contacts };
}

export interface Row {
  a: ArrangementRecord;
  tasks: TaskRecord[];
  open: TaskRecord | null;
  health: Health;
  nextDate: string | null;
  assets: AssetView[];
  /** The provider's contact is gone from this device (the saved name is shown). */
  contactGone: boolean;
}
export interface AttentionItem { key: string; arrangementId: number; text: string; hint: string }

export function buildRow(s: Snapshot, a: ArrangementRecord): Row {
  const tasks = s.tasksBy.get(a.id) ?? [];
  const open = openOf(tasks).sort((x, y) => (x.data.dueDate ?? '9999').localeCompare(y.data.dueDate ?? '9999'))[0] ?? null;
  return {
    a, tasks, open, health: scheduleHealth(a, tasks), nextDate: open?.data.dueDate ?? null,
    assets: assetViews(s.assetIdsBy.get(a.id) ?? [], s.assets),
    contactGone: a.data.providerContactId !== null && !s.contacts.some((c) => c.id === a.data.providerContactId),
  };
}

export interface Overview { rows: Row[]; active: Row[]; paused: Row[]; ended: Row[]; upcoming: Row[]; attention: AttentionItem[] }

export function buildOverview(s: Snapshot): Overview {
  const rows = s.arrangements.map((a) => buildRow(s, a));
  const active = rows.filter((r) => r.a.data.status === 'active');
  const attention: AttentionItem[] = [];
  for (const r of rows) {
    const t = r.a.data.title;
    if (r.a.data.status === 'active' && r.a.data.providerContactId === null) attention.push({ key: `p${r.a.id}`, arrangementId: r.a.id, text: `${t}: no provider yet`, hint: 'Pick who does this' });
    if (r.health.needsAttention) attention.push({ key: `h${r.a.id}`, arrangementId: r.a.id, text: `${t}: ${r.health.message}`, hint: r.health.state === 'no-task' ? 'Schedule the next visit' : 'See how to fix it' });
    if (r.a.data.status !== 'ended') for (const as of r.assets) {
      if (as.missing) attention.push({ key: `m${r.a.id}:${as.id}`, arrangementId: r.a.id, text: `${t}: a linked asset no longer exists`, hint: 'Remove the link or pick another asset' });
      else if (as.past) attention.push({ key: `a${r.a.id}:${as.id}`, arrangementId: r.a.id, text: `${t}: serves "${as.name}", which is ${as.statusLabel.toLowerCase()}`, hint: as.replacedBy ? `Replaced by ${as.replacedBy}` : 'Link it to another asset or end the arrangement' });
    }
  }
  return {
    rows, active, paused: rows.filter((r) => r.a.data.status === 'paused'), ended: rows.filter((r) => r.a.data.status === 'ended'),
    upcoming: active.filter((r) => r.nextDate).sort((x, y) => x.nextDate!.localeCompare(y.nextDate!)), attention,
  };
}

export interface ProviderView { contact: Contact | null; contactId: number; name: string; active: Row[]; past: Row[]; assets: AssetView[] }
export function buildProvider(s: Snapshot, contactId: number): ProviderView {
  const rows = s.arrangements.filter((a) => a.data.providerContactId === contactId).map((a) => buildRow(s, a));
  const contact = s.contacts.find((c) => c.id === contactId) ?? null;
  const ids = [...new Set(rows.filter((r) => r.a.data.status !== 'ended').flatMap((r) => r.assets.map((x) => x.id)))];
  return {
    contact, contactId, name: contact?.name ?? rows[0]?.a.data.providerNameSnapshot ?? '', active: rows.filter((r) => r.a.data.status !== 'ended'),
    past: rows.filter((r) => r.a.data.status === 'ended'), assets: assetViews(ids, s.assets),
  };
}
/** Providers (contacts with at least one arrangement), most active first. Names only. */
export function providerList(s: Snapshot): { contactId: number; name: string; active: number; total: number }[] {
  const m = new Map<number, { contactId: number; name: string; active: number; total: number }>();
  for (const a of s.arrangements) {
    const id = a.data.providerContactId;
    if (id === null) continue;
    const e = m.get(id) ?? { contactId: id, name: s.contacts.find((c) => c.id === id)?.name ?? a.data.providerNameSnapshot, active: 0, total: 0 };
    e.total++; if (a.data.status === 'active') e.active++;
    m.set(id, e);
  }
  return [...m.values()].sort((x, y) => y.active - x.active || x.name.localeCompare(y.name));
}
