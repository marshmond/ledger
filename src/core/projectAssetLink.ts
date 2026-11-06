/**
 * The shared relationship between a Project and a Home & Assets asset: `projects:<projectId>` -> `assets:asset:<id>`, type `involves`.
 * Many-to-many, kept in the shared links table, so deleting either side's record unlinks it without touching the other. One place defines
 * the shape so the two modules cannot drift apart. It stores NO money: a project's figures always come from Projects' own summary.
 */
import { db, type FinanceDB } from '../db';
import type { Link } from './entities';
import { createStore } from './store';

export const PROJECT_ASSET_LINK = 'involves';
export const assetRefText = (assetId: number) => `asset:${assetId}`;
const parseAsset = (id: unknown): number | null => { const m = /^asset:(\d+)$/.exec(String(id)); return m ? Number(m[1]) : null; };
const parseProject = (id: unknown): number | null => (/^\d+$/.test(String(id)) ? Number(id) : null);

export interface ProjectAssetPair { linkId: number; projectId: number; assetId: number }

const pairOf = (l: Link): ProjectAssetPair | null => {
  if (l.type !== PROJECT_ASSET_LINK || l.fromModule !== 'projects' || l.toModule !== 'assets') return null;
  const projectId = parseProject(l.fromId);
  const assetId = parseAsset(l.toId);
  return projectId === null || assetId === null ? null : { linkId: l.id as number, projectId, assetId };
};

/** Projects linked to an asset (live links only; the projects themselves may no longer exist: callers must cope). */
export async function projectsOfAsset(assetId: number, d: FinanceDB = db): Promise<ProjectAssetPair[]> {
  return (await createStore(d).shared.links.linkedTo({ module: 'assets', id: assetRefText(assetId) })).flatMap((l) => { const p = pairOf(l); return p ? [p] : []; });
}
/** Assets linked to a project. */
export async function assetsOfProject(projectId: number, d: FinanceDB = db): Promise<ProjectAssetPair[]> {
  return (await createStore(d).shared.links.linkedTo({ module: 'projects', id: projectId })).flatMap((l) => { const p = pairOf(l); return p ? [p] : []; });
}
/** Connects them. Doing it twice returns the same link. Returns the link id. */
export function linkProjectToAsset(projectId: number, assetId: number, d: FinanceDB = db): Promise<number> {
  return createStore(d).shared.links.add({ module: 'projects', id: projectId }, { module: 'assets', id: assetRefText(assetId) }, PROJECT_ASSET_LINK);
}
/** Removes the relationship only. Neither the project nor the asset is touched. */
export async function unlinkProjectFromAsset(projectId: number, assetId: number, d: FinanceDB = db): Promise<number> {
  const found = (await projectsOfAsset(assetId, d)).filter((p) => p.projectId === projectId);
  for (const p of found) await createStore(d).shared.links.remove(p.linkId);
  return found.length;
}
/** Brings back a relationship removed a moment ago (Undo). */
export const relinkProjectToAsset = linkProjectToAsset;
