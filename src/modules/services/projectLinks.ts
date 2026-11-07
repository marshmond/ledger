/**
 * Informational links between Household Services and Projects (S4): an arrangement or a visit `involves` a Project (shared link type `involves`,
 * from the services record to the Project, whose id is a plain number like every other Project link).
 *
 * A link changes NOTHING else: not the Project's commitments, budget or paid-to-date, not Finance attribution, not any Services payment reference.
 * It is never inferred from a matching vendor or an amount: only the owner adds or removes it. Both ends keep their own records; deleting either
 * unlinks cleanly. The Project's own money screens stay authoritative for the Project; Services payments are never added to Project spending.
 */
import { db, type FinanceDB } from '../../db';
import { createStore, isLive } from '../../core/store';
import { getProject } from '../projects/data';
import { getArrangement } from './data';
import { arrangementRef } from './model';
import { Recorder, type Undo } from './undo';
import { getVisit } from './visits';
import { visitRef } from './visitModel';

const endExists = async (e: { kind: 'arrangement' | 'visit'; id: number }, d: FinanceDB) => !!(e.kind === 'arrangement' ? await getArrangement(e.id, d) : await getVisit(e.id, d));

export const SERVICE_PROJECT_LINK = 'involves';
export type ServiceEnd = { kind: 'arrangement' | 'visit'; id: number };
export const endRef = (e: ServiceEnd) => (e.kind === 'arrangement' ? arrangementRef(e.id) : visitRef(e.id));

const parseProject = (id: unknown): number | null => (/^\d+$/.test(String(id)) ? Number(id) : null);

export interface ProjectLink { linkId: number; projectId: number }

/** Projects this arrangement or visit explicitly involves (live links; the Project itself may be gone: callers cope). */
export async function projectLinksOf(e: ServiceEnd, d: FinanceDB = db): Promise<ProjectLink[]> {
  const ref = endRef(e);
  return (await createStore(d).shared.links.linkedTo(ref)).flatMap((l) => {
    if (l.type !== SERVICE_PROJECT_LINK || l.fromModule !== ref.module || l.fromId !== ref.id || l.toModule !== 'projects') return [];
    const projectId = parseProject(l.toId);
    return projectId === null ? [] : [{ linkId: l.id as number, projectId }];
  });
}

/** Project ids explicitly linked from any of these arrangements or visits (the provider page's "linked projects"). Not the Projects that merely use the contact as a vendor. */
export async function explicitProjectIds(ends: ServiceEnd[], d: FinanceDB = db): Promise<number[]> {
  const out = new Set<number>();
  for (const e of ends) for (const l of await projectLinksOf(e, d)) out.add(l.projectId);
  return [...out].sort((a, b) => a - b);
}

export interface ServicesOfProject { arrangementIds: number[]; visitIds: number[] }
/** Arrangements and visits that explicitly involve this Project. A link to a record that is gone is simply not returned. */
export async function servicesOfProject(projectId: number, d: FinanceDB = db): Promise<ServicesOfProject> {
  const links = (await createStore(d).shared.links.linkedTo({ module: 'projects', id: projectId })).filter((l) => l.type === SERVICE_PROJECT_LINK && l.fromModule === 'services' && l.toModule === 'projects' && parseProject(l.toId) === projectId);
  const arr = new Set<number>(), vis = new Set<number>();
  for (const l of links) {
    const a = /^arrangement:(\d+)$/.exec(String(l.fromId)), v = /^visit:(\d+)$/.exec(String(l.fromId));
    if (a) arr.add(Number(a[1])); else if (v) vis.add(Number(v[1]));
  }
  return { arrangementIds: [...arr].sort((x, y) => x - y), visitIds: [...vis].sort((x, y) => x - y) };
}

/**
 * Links an arrangement or visit to a Project. One transaction: re-reads both ends, refuses (writing nothing) when either is gone, and returns a sealed
 * Undo. Doing it twice changes nothing (the same link comes back). Writes no Project record and nothing in Finance.
 */
export function linkProject(e: ServiceEnd, projectId: number, d: FinanceDB = db): Promise<{ linkId: number; created: boolean; undo: Undo }> {
  return d.transaction('rw', d.moduleRecords, d.links, d.contacts, async () => {
    if (!(await endExists(e, d))) throw new Error(`That ${e.kind} no longer exists. Nothing was changed.`);
    if (!(await getProject(projectId, d))) throw new Error('That Project no longer exists. Nothing was changed.');
    const existing = (await projectLinksOf(e, d)).find((l) => l.projectId === projectId);
    const rec = new Recorder();
    rec.watch({ id: e.id });
    let linkId: number;
    if (existing) linkId = existing.linkId;
    else { linkId = await createStore(d).shared.links.add(endRef(e), { module: 'projects', id: projectId }, SERVICE_PROJECT_LINK); rec.linkAdded(linkId); }
    await rec.seal(d);
    return { linkId, created: !existing, undo: rec.undo };
  });
}

/** Removes the relationship only. Both records are kept. Returns a sealed Undo. */
export function unlinkProject(e: ServiceEnd, projectId: number, d: FinanceDB = db): Promise<{ removed: number; undo: Undo }> {
  return d.transaction('rw', d.moduleRecords, d.links, d.contacts, async () => {
    const mine = (await projectLinksOf(e, d)).filter((l) => l.projectId === projectId);
    const rec = new Recorder();
    rec.watch({ id: e.id });
    const store = createStore(d);
    for (const l of mine) { const row = await d.links.get(l.linkId); if (row && isLive(row)) { rec.linkRemoved(row); await store.shared.links.remove(l.linkId); } }
    await rec.seal(d);
    return { removed: mine.length, undo: rec.undo };
  });
}
