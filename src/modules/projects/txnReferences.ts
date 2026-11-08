/**
 * Which Projects depend on a Finance transaction (ST-S2, DI-02). READ ONLY.
 *
 * A Project does not hold a shared reference: the transaction (or one of its split parts) carries the project tag itself, so the project's "paid" figure is worked
 * out from the transactions. Deleting a tagged transaction therefore LOWERS what the project shows as paid. That is a real consequence the owner should see, so it is
 * reported here, using the same `projectAllocations` the Projects figures use (a split's own tag wins; a transfer gives nothing).
 */
import type { TxnDependent, TxnReferenceProvider } from '../../core/txnDependents';
import { projectAllocations } from '../../lib/txnProject';
import { loadProjects } from './data';

const LABEL = 'Projects';

export const projectsTxnReferences: TxnReferenceProvider = {
  label: LABEL,
  async find({ ids, txns, d }) {
    const projects = new Map((await loadProjects(d)).map((p) => [p.id, p]));
    const out: TxnDependent[] = [];
    for (const id of ids) {
      const t = txns.get(id);
      if (!t) continue;
      const alloc = projectAllocations(t);
      if (!alloc.length) continue; // untagged, a transfer or a setup entry: no project depends on it
      const byProject = new Map<number, { parts: Set<number>; whole: boolean }>();
      if (t.splits?.length) {
        // projectAllocations lists the tagged parts without their positions, so read the positions from the transaction itself (a part's own tag wins)
        t.splits.forEach((s, i) => { const ref = s.project ?? t.project; if (ref) { const e = byProject.get(ref.projectId) ?? { parts: new Set<number>(), whole: false }; e.parts.add(i); byProject.set(ref.projectId, e); } });
      } else {
        for (const a of alloc) byProject.set(a.projectId, { parts: new Set(), whole: true });
      }
      for (const [projectId, e] of byProject) {
        const p = projects.get(projectId);
        out.push({
          txnId: id, module: 'projects', moduleLabel: LABEL, recordId: `project:${projectId}`,
          title: p ? p.data.name : 'A project that no longer exists', noun: ['project', 'projects'],
          relation: 'This transaction is tagged as spending on the project. Deleting it lowers what the project shows as paid.',
          scope: e.whole ? 'whole' : 'part', parts: [...e.parts].sort((a, b) => a - b), standing: p ? 'current' : 'stale', evidence: !!p,
          href: p ? `/projects/${projectId}` : undefined,
        });
      }
    }
    return out;
  },
};
