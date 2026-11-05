import type { SearchResult } from '../core/registry';

export interface ResultGroup {
  moduleId: string;
  /** Heading, e.g. "Tasks". */
  name: string;
  results: SearchResult[];
}

/**
 * Puts each module's answers into display order: results inside a group best score first; groups with the best top result first
 * (ties keep the module order they were asked in); groups with nothing are dropped. Pure, so the ordering is tested.
 */
export function groupResults(answers: { moduleId: string; name: string; results: SearchResult[] }[]): ResultGroup[] {
  return answers
    .map((a, order) => ({ ...a, order, results: [...a.results].sort((x, y) => (y.score ?? 0) - (x.score ?? 0) || x.title.localeCompare(y.title)) }))
    .filter((a) => a.results.length > 0)
    .sort((a, b) => (b.results[0].score ?? 0) - (a.results[0].score ?? 0) || a.order - b.order)
    .map(({ moduleId, name, results }) => ({ moduleId, name, results }));
}
