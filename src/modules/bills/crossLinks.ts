/**
 * The OPTIONAL "bills for" relationship between a Bills obligation and a Household Services arrangement (B4, B0 8.2 / B-8).
 *
 * It says only that the two records describe related household activity ("the cleaners" in Services, "the cleaning payment" in Bills). It is a plain row in the
 * shared `links` table (type `bills-for`, from `obligation:<n>` to `arrangement:<n>`): no new table, no new field on either record, no schema or sync change.
 * It is made only after the owner confirms it, never from matching names, and either side can be unlinked.
 *
 * WHAT IT DOES: lets the Calendar leave out a Bills cancel-by or renewal marker ONLY when the linked arrangement shows the same kind of date on the same day (and
 * only while that Services marker is itself shown), and shows the relationship on the Bills page.
 * WHAT IT NEVER DOES: merge the two records' money, schedules, reminders or Tasks; suppress a service VISIT, a Task, a different date, a different kind of notice
 * or a Finance Scheduled approval; change `householdSpend()` or the Bills-only recorded payments; create a Contact or a provider; touch a Services record.
 *
 * Linking and unlinking write the link AND an audit record (a `service-link` lifecycle record that also appears in the timeline) in ONE transaction with a
 * guarded Undo. Bills never imports the Services module: arrangements are read as plain rows, the id formats are a string contract pinned by a test.
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { isLive, repo } from '../../core/store';
import { newId } from '../../lib/sync/track';
import { getObligation, tables } from './data';
import { LC_KIND, newLcData } from './lifecycleModel';
import { lifecycleRecordsOf } from './lifecycleRead';
import { lcToken } from './lifecycleState';
import { obligationRefId } from './model';
import { Recorder, type Undo } from './undo';

export const BILLS_FOR = 'bills-for';
export const arrangementRefIdOf = (id: number) => `arrangement:${id}`;
export const parseArrangementId = (v: unknown): number | null => { const m = /^arrangement:(\d+)$/.exec(String(v)); return m ? Number(m[1]) : null; };

export interface ArrangementInfo { id: number; title: string; status: string; provider: string }
export interface BillLink { linkId: number; arrangementId: number; arrangement: ArrangementInfo | null }

const info = (r: ModuleRecord): ArrangementInfo => { const d = (r.data ?? {}) as Record<string, unknown>; return { id: r.id as number, title: typeof d.title === 'string' ? d.title : '(no title)', status: typeof d.status === 'string' ? d.status : 'active', provider: typeof d.providerNameSnapshot === 'string' ? d.providerNameSnapshot : '' }; };

/** The Household Services arrangements, read as plain rows (live ones only). */
export async function loadArrangementInfos(d: FinanceDB = db): Promise<ArrangementInfo[]> {
  return (await d.moduleRecords.where('[module+kind]').equals(['services', 'arrangement']).toArray()).filter(isLive).map(info).sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id);
}

const isBillsFor = (l: Link) => isLive(l) && l.type === BILLS_FOR && l.fromModule === 'bills' && l.toModule === 'services';

/** The live "bills for" links of the given bills, by bill id (arrangement ids). Reads only. */
export async function serviceLinksFor(obligationIds: number[], d: FinanceDB = db): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (obligationIds.length === 0) return out;
  const rows = await d.links.where('[fromModule+fromId]').anyOf(obligationIds.map((id) => ['bills', obligationRefId(id)])).toArray();
  for (const l of rows) {
    const arr = parseArrangementId(l.toId), ob = /^obligation:(\d+)$/.exec(String(l.fromId));
    if (!isBillsFor(l) || arr === null || !ob) continue;
    const id = Number(ob[1]);
    out.set(id, [...new Set([...(out.get(id) ?? []), arr])]);
  }
  return out;
}

/** The arrangements a bill is linked to, with their titles (a link to an arrangement that is gone is shown as such, never hidden). */
export async function billLinks(obligationId: number, d: FinanceDB = db): Promise<BillLink[]> {
  const rows = (await d.links.where('[fromModule+fromId]').equals(['bills', obligationRefId(obligationId)]).toArray()).filter(isBillsFor);
  const infos = new Map((await loadArrangementInfos(d)).map((a) => [a.id, a]));
  return rows.flatMap((l) => { const a = parseArrangementId(l.toId); return a === null ? [] : [{ linkId: l.id as number, arrangementId: a, arrangement: infos.get(a) ?? null }]; });
}

/** Other bills linked to the same arrangement (for the "linked to more than one bill" notice). */
export async function billsLinkedTo(arrangementId: number, d: FinanceDB = db): Promise<number[]> {
  const rows = (await d.links.where('[toModule+toId]').equals(['services', arrangementRefIdOf(arrangementId)]).toArray()).filter(isBillsFor);
  return [...new Set(rows.flatMap((l) => { const m = /^obligation:(\d+)$/.exec(String(l.fromId)); return m ? [Number(m[1])] : []; }))];
}

/**
 * THE ONLY relationship Bills may write into the shared `links` table: `bills-for`, from a Bills obligation to a Household Services arrangement. The writer calls this
 * before every write, so even a code change that picked another type, another module or a malformed id would throw (and the transaction would write nothing).
 * (The Tasks API's own `about` links from a Task to a bill are written by that API, never by Bills.)
 */
export function assertBillsLink(l: Pick<Link, 'fromModule' | 'fromId' | 'toModule' | 'toId' | 'type'>): void {
  const ok = l.type === BILLS_FOR && l.fromModule === 'bills' && /^obligation:\d+$/.test(String(l.fromId)) && l.toModule === 'services' && parseArrangementId(l.toId) !== null;
  if (!ok) throw new Error('Bills may only link a bill to a Household Services arrangement ("bills-for"). Nothing was changed.');
}

export interface LinkPreview { problem: string | null; lines: string[]; token: string }

/** Reads only. */
export async function previewServiceLink(obligationId: number, arrangementId: number, action: 'linked' | 'unlinked', d: FinanceDB = db): Promise<LinkPreview> {
  const ob = await getObligation(obligationId, d);
  if (!ob) throw new Error('That bill no longer exists.');
  const records = await lifecycleRecordsOf(obligationId, d);
  const token = `${ob.updatedAt}|${lcToken(records)}|${(await billLinks(obligationId, d)).map((l) => l.linkId).sort().join(',')}`;
  const arr = (await loadArrangementInfos(d)).find((a) => a.id === arrangementId);
  const existing = (await billLinks(obligationId, d)).find((l) => l.arrangementId === arrangementId);
  if (action === 'linked') {
    if (!arr) return { problem: 'That Household Services arrangement is not here (it may have been removed, or it has not reached this device yet).', lines: [], token };
    if (existing) return { problem: 'This bill is already linked to that arrangement.', lines: [], token };
  } else if (!existing) return { problem: 'This bill is not linked to that arrangement.', lines: [], token };
  const others = action === 'linked' ? (await billsLinkedTo(arrangementId, d)).filter((x) => x !== obligationId) : [];
  const name = arr?.title ?? 'the arrangement';
  return {
    problem: null, token,
    lines: action === 'linked' ? [
      `Say that "${ob.data.title}" and the Household Services arrangement "${name}" describe related household activity.`,
      'This only records the relationship. It does not merge the two records, their money, their schedules, their reminders or their Tasks, and it creates no Contact.',
      'On the Calendar, a Bills cancel-by or renewal marker is left out only when this arrangement shows the same kind of date on the same day. Every service visit, every Task, every different date and every Finance approval stays visible.',
      ...(others.length ? [`${others.length === 1 ? 'Another bill is' : `${others.length} other bills are`} already linked to this arrangement. Both links are kept and you will be asked to look at it.`] : []),
      'Nothing is added to or removed from any total. You can unlink it at any time, and undo this right after.',
    ] : [
      `Remove the link between "${ob.data.title}" and "${name}". Neither record is changed and nothing is deleted.`,
      'Markers that were left out because of the link come back on the Calendar. You can undo this right after.',
    ],
  };
}

/** Links or unlinks in ONE transaction (the link row and its audit record), refusing if anything changed since the preview. Guarded Undo. */
export function applyServiceLink(obligationId: number, arrangementId: number, action: 'linked' | 'unlinked', token: string, today: string, d: FinanceDB = db, hooks: { afterWrite?: (d: FinanceDB) => Promise<void> } = {}): Promise<{ undo: Undo }> {
  return d.transaction('rw', [...tables(d)], async () => {
    const p = await previewServiceLink(obligationId, arrangementId, action, d);
    if (p.token !== token) throw new Error('Something changed since you opened this (maybe on another device). Nothing was changed. Close it, look again and redo your change.');
    if (p.problem) throw new Error(p.problem);
    const rec = new Recorder();
    const links = repo<Link>(d.links);
    if (action === 'linked') {
      const row = { fromModule: 'bills', fromId: obligationRefId(obligationId), toModule: 'services', toId: arrangementRefIdOf(arrangementId), type: BILLS_FOR };
      assertBillsLink(row);
      const id = await links.put(row);
      rec.linkAdded([id]);
    } else {
      const found = (await billLinks(obligationId, d)).filter((l) => l.arrangementId === arrangementId);
      for (const l of found) await links.remove(l.linkId);
      rec.linkRemoved(found.map((l) => l.linkId));
    }
    const records = await lifecycleRecordsOf(obligationId, d);
    const id = Math.max(newId(), records.reduce((m, r) => Math.max(m, r.id), 0) + 1);
    await repo<ModuleRecord>(d.moduleRecords).put({ id, module: 'bills', kind: LC_KIND, data: newLcData(obligationId, { fact: 'service-link', arrangementId, action, on: today }, { seen: records.map((r) => r.id) }) });
    rec.made(id);
    if (hooks.afterWrite) await hooks.afterWrite(d);
    return { undo: await rec.seal(d) };
  });
}
