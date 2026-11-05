import { db } from '../../db';
import type { SearchResult, SearchSource } from '../../core/registry';
import { norm, score } from '../../lib/search';
import { loadProjects } from './data';
import { STATUS_LABEL, type ProjectRecord } from './model';

/** Pure: the Projects hits for a typed query, from already-loaded projects. Open projects rank above archived ones. */
export function searchProjectsData(raw: string, projects: ProjectRecord[], cap = 8): SearchResult[] {
  const query = norm(raw).split(/\s+/).filter(Boolean);
  if (query.length === 0) return [];
  const out: SearchResult[] = [];
  const s0 = score(query, 'Projects', 'projects renovation budget vendors');
  if (s0 > 0) out.push({ id: 'page:/projects', title: 'Projects', subtitle: 'Go to this page', kind: 'Page', score: s0, path: '/projects' });
  const hits = projects
    .map((p) => ({ p, base: score(query, p.data.name, p.data.notes) }))
    .filter((x) => x.base > 0)
    .map((x) => ({ p: x.p, s: x.base - (x.p.data.archived ? 8 : 0) }))
    .sort((a, b) => b.s - a.s || a.p.data.name.localeCompare(b.p.data.name))
    .slice(0, cap);
  for (const { p, s } of hits) {
    out.push({ id: `project:${p.id}`, title: p.data.name, subtitle: [STATUS_LABEL[p.data.status], p.data.archived ? 'Archived' : ''].filter(Boolean).join(' · '), kind: 'Project', score: s, path: `/projects/${p.id}` });
  }
  return out;
}

/** What global search finds in Projects: the page, and projects by name and notes. */
export const projectsSearchSource: SearchSource = {
  group: 'Projects',
  async search(query, limit) {
    return searchProjectsData(query, await loadProjects(db)).slice(0, limit);
  },
};
