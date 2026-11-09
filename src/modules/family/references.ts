/**
 * Family Management F1: "who points at this person?" A small READ-ONLY reader over the shared Contact id. It writes nothing, deletes nothing
 * and repairs nothing; it exists so a screen can say what depends on a person, and so a future delete or relink can be previewed first.
 *
 * It reads only the kinds that can hold a person: Tasks and Calendar events (`contactIds`), Projects (`vendorContactIds`), shared links that
 * name the contact, and other Family members. It uses the `[module+kind]` index (no whole-database scan). Not included in F1: Home & Assets and
 * Household Services provider contacts (see the F1 report); a future controlled relink must add them first.
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { isLive } from '../../core/store';
import { KIND, MODULE } from './model';

export interface ContactReferences {
  tasks: number;
  events: number;
  projects: number;
  links: number;
  /** Other live Family records for the same contact (including past ones). Never counts the member asked about. */
  otherMembers: number;
  total: number;
}

const idList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
const has = (r: ModuleRecord, field: string, id: number) => isLive(r) && !!r.data && idList((r.data as Record<string, unknown>)[field]).includes(id);

/** Pure: counts from rows already read. */
export function countReferences(contactId: number, rows: { tasks: ModuleRecord[]; events: ModuleRecord[]; projects: ModuleRecord[]; links: Link[]; members: ModuleRecord[] }, selfMemberId?: number): ContactReferences {
  const tasks = rows.tasks.filter((r) => has(r, 'contactIds', contactId)).length;
  const events = rows.events.filter((r) => has(r, 'contactIds', contactId)).length;
  const projects = rows.projects.filter((r) => has(r, 'vendorContactIds', contactId)).length;
  const links = rows.links.filter((l) => isLive(l)).length;
  const otherMembers = rows.members.filter((r) => isLive(r) && r.id !== selfMemberId && (r.data as Record<string, unknown> | undefined)?.contactId === contactId).length;
  return { tasks, events, projects, links, otherMembers, total: tasks + events + projects + links + otherMembers };
}

/** Reads the rows (read-only, indexed) and counts. Pass the member's own record id so it is not counted as "another" member. */
export async function readContactReferences(contactId: number, d: FinanceDB = db, selfMemberId?: number): Promise<ContactReferences> {
  const kind = (module: string, k: string) => d.moduleRecords.where('[module+kind]').equals([module, k]).toArray();
  const linkRows = async (): Promise<Link[]> => {
    const refs: (string | number)[] = [contactId, `contact:${contactId}`];
    const found = await Promise.all(refs.flatMap((id) => [
      d.links.where('[fromModule+fromId]').equals(['contacts', id]).toArray(),
      d.links.where('[toModule+toId]').equals(['contacts', id]).toArray(),
    ]));
    return [...new Map(found.flat().map((l) => [l.id as number, l])).values()];
  };
  const [tasks, events, projects, links, members] = await Promise.all([kind('tasks', 'task'), kind('calendar', 'event'), kind('projects', 'project'), linkRows(), kind(MODULE, KIND)]);
  return countReferences(contactId, { tasks, events, projects, links, members }, selfMemberId);
}

/** Plain-words lines for a screen ("3 tasks"); only the non-zero kinds. */
export function referenceLines(r: ContactReferences): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    r.tasks ? plural(r.tasks, 'task', 'tasks') : '',
    r.events ? plural(r.events, 'calendar event', 'calendar events') : '',
    r.projects ? plural(r.projects, 'project', 'projects') : '',
    r.links ? plural(r.links, 'saved link', 'saved links') : '',
  ].filter(Boolean);
}
