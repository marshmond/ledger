import { allDocumentSources } from '../core/registry';
import { filterRefs, refSearchLine, sortRefs, type DocumentGap, type DocumentRef, type DocumentSource } from '../core/documentRefs';
import { score, norm } from '../lib/search';
import type { SearchResult } from '../core/registry';

/**
 * R4.1 Records: reads every module's document references and says plainly which sources could NOT be read. Read only; asks each module's own reader (registry hook), in parallel,
 * and one that fails (or throws) does not hide the others. An index with a failed source is `complete: false`, so the screen can never present it as the whole inventory.
 */
export interface SourceStatus { moduleId: string; label: string; ok: boolean }
export interface DocumentIndex {
  refs: DocumentRef[];
  gaps: DocumentGap[];
  sources: SourceStatus[];
  /** Every source was read. False when any failed. */
  complete: boolean;
}

export async function loadDocumentIndex(today: string, sources: readonly { moduleId: string; source: DocumentSource }[] = allDocumentSources()): Promise<DocumentIndex> {
  const results = await Promise.all(sources.map(async ({ moduleId, source }) => {
    try { return { moduleId, label: source.label, ok: true as const, read: await source.read({ today }) }; } catch { return { moduleId, label: source.label, ok: false as const, read: null }; }
  }));
  const order = sources.map((s) => s.moduleId);
  return {
    refs: sortRefs(results.flatMap((r) => r.read?.refs ?? []), order),
    gaps: results.flatMap((r) => r.read?.gaps ?? []).sort((a, b) => order.indexOf(a.moduleId) - order.indexOf(b.moduleId) || a.ownerName.localeCompare(b.ownerName) || a.recordName.localeCompare(b.recordName) || a.id.localeCompare(b.id, undefined, { numeric: true })),
    sources: results.map((r) => ({ moduleId: r.moduleId, label: r.label, ok: r.ok })),
    complete: results.every((r) => r.ok),
  };
}

// ---- global Search ----

/** One cached read per open Search dialog: the first typed word reads the three modules once, later keystrokes filter the same list. Nothing is read when Search opens or the box is empty. */
let cache: Promise<DocumentIndex> | null = null;
export const resetDocumentSearch = () => { cache = null; };

export interface DocumentHits { results: SearchResult[]; failed: string[] }

/** Pure: the Search rows for a typed query, best match first. Each reference is one row; its line says where it belongs. Selecting it opens that reference on the Records screen. */
export function documentHits(query: string, index: DocumentIndex, limit: number): DocumentHits {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return { results: [], failed: [] };
  const found = filterRefs(index.refs, { query }, '');
  const results = found
    .map((r) => ({ r, s: score(words, r.label, `${r.ownerName} ${r.recordKind} ${r.recordName} ${r.context} ${r.sourceLabel}`) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r.label.localeCompare(b.r.label) || a.r.id.localeCompare(b.r.id, undefined, { numeric: true }))
    .slice(0, limit)
    .map(({ r, s }): SearchResult => ({ id: r.id, title: r.label, subtitle: refSearchLine(r), kind: 'Document', score: s, path: `/records?ref=${encodeURIComponent(r.id)}` }));
  return { results, failed: index.sources.filter((s) => !s.ok).map((s) => s.label) };
}

export async function searchDocuments(query: string, today: string, limit: number): Promise<DocumentHits> {
  if (!cache) cache = loadDocumentIndex(today);
  return documentHits(query, await cache, limit);
}
