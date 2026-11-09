/**
 * Family Management F2: reading and writing important dates. Rows of `moduleRecords` (module `family`, kind `date`) only. This file never touches
 * a Contact, a Task, a Calendar event or Finance, and never creates a Calendar record: the dates reach the Calendar through the due provider.
 *
 * There is NO permanent delete. "Remove" is ARCHIVE: the date stops appearing on the Calendar and moves to "Archived dates", from where it can be
 * brought back. Archiving rewrites the stored row from its raw form with only the status changed, so a field this version cannot read is never lost.
 */
import { db, type FinanceDB } from '../../db';
import { isLive, repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { asDate, cleanDate, DATE_KIND, toStoredDate, validateDate, type DateFields, type DateRecord } from './dateModel';
import { KIND as MEMBER_KIND, MODULE } from './model';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);

/** Every live date row, readable or not (an unreadable one is listed for review, not hidden). Oldest first. */
export async function loadDates(d: FinanceDB = db): Promise<DateRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, DATE_KIND]).toArray()).filter(isLive).map((r) => asDate(r)).sort((a, b) => a.id - b.id);
}
export async function getDate(id: number, d: FinanceDB = db): Promise<DateRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === DATE_KIND && isLive(r) ? asDate(r) : undefined;
}

async function checkMember(memberId: number | undefined, d: FinanceDB) {
  if (memberId === undefined) return;
  const m = await d.moduleRecords.get(memberId);
  if (!m || m.module !== MODULE || m.kind !== MEMBER_KIND || !isLive(m)) throw new Error('That family member no longer exists.');
}

export async function createDate(fields: DateFields, d: FinanceDB = db, thisYear = new Date().getFullYear()): Promise<number> {
  const problem = validateDate(fields, thisYear);
  if (problem) throw new Error(problem);
  return d.transaction('rw', d.moduleRecords, async () => {
    await checkMember(fields.memberId, d);
    return rows(d).put({ module: MODULE, kind: DATE_KIND, data: toStoredDate({}, fields) });
  });
}

/** Changes a date. Fields this version does not know are kept. An unreadable row is not changed. */
export async function updateDate(id: number, fields: DateFields, d: FinanceDB = db, thisYear = new Date().getFullYear()): Promise<void> {
  const problem = validateDate(fields, thisYear);
  if (problem) throw new Error(problem);
  await d.transaction('rw', d.moduleRecords, async () => {
    const row = await d.moduleRecords.get(id);
    if (!row || row.module !== MODULE || row.kind !== DATE_KIND || !isLive(row)) throw new Error('That date no longer exists.');
    const cur = asDate(row, thisYear);
    if (!cur.data) throw new Error('This record could not be read by this version, so it was not changed.');
    // a member the date already points at is left alone even if it has since gone; only a NEWLY chosen member must exist
    if (fields.memberId !== undefined && fields.memberId !== cur.data.memberId) await checkMember(fields.memberId, d);
    await rows(d).put({ id, module: MODULE, kind: DATE_KIND, data: toStoredDate(cur.raw, cleanDate(fields)) });
  });
}

/** Archives (or restores) a date: the status only. Every other stored field, including ones this version cannot read, is written back exactly. */
export async function setDateStatus(id: number, status: 'active' | 'archived', d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const cur = await getDate(id, d);
    if (!cur) throw new Error('That date no longer exists.');
    if (!cur.data) throw new Error('This record could not be read by this version, so it was not changed.');
    if (cur.data.status === status) return;
    await rows(d).put({ id, module: MODULE, kind: DATE_KIND, data: { ...cur.raw, status } });
  });
}

/** Turns the date's Calendar appearance on or off (the owner's Calendar only). Same rewrite rule as archiving. */
export async function setDateOnCalendar(id: number, on: boolean, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const cur = await getDate(id, d);
    if (!cur) throw new Error('That date no longer exists.');
    if (!cur.data) throw new Error('This record could not be read by this version, so it was not changed.');
    if ((cur.data.onCalendar !== false) === on) return;
    const next: Record<string, unknown> = { ...cur.raw };
    if (on) delete next.onCalendar; else next.onCalendar = false;
    await rows(d).put({ id, module: MODULE, kind: DATE_KIND, data: next });
  });
}
