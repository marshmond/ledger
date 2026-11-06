import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { linkProjectToAsset, projectsOfAsset, unlinkProjectFromAsset } from '../../core/projectAssetLink';
import { dayLabel } from '../../core/time';
import { db } from '../../db';
import { formatCents } from '../../lib/money';
import { loadProjectSummary } from '../../lib/txnProject';
import { useToast } from '../../ui/Toast';
import { getProject, loadProjects } from '../projects/data';
import { STATUS_LABEL } from '../projects/model';
import type { AssetRecord } from './model';

/**
 * Projects that involve this asset, shown for context. The money is Projects' own "paid so far" (its existing summary function); it is
 * NEVER added to the asset's spending. A project can involve several assets and an asset can have several projects.
 */
export default function RelatedProjects({ asset }: { asset: AssetRecord }) {
  const toast = useToast();
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const data = useLiveQuery(async () => {
    const pairs = await projectsOfAsset(asset.id);
    const rows = await Promise.all(pairs.map(async (p) => {
      const project = (await getProject(p.projectId)) ?? null;
      const summary = project ? await loadProjectSummary(db, p.projectId) : null;
      return { ...p, project, summary };
    }));
    return { rows: rows.sort((a, b) => (a.project?.data.name ?? '~').localeCompare(b.project?.data.name ?? '~')), all: await loadProjects() };
  }, [asset.id]);
  if (!data) return null;
  const linkedIds = new Set(data.rows.map((r) => r.projectId));
  const choices = data.all.filter((p) => !linkedIds.has(p.id)).sort((a, b) => Number(a.data.archived) - Number(b.data.archived) || a.data.name.localeCompare(b.data.name));

  async function add() {
    const pid = Number(pick);
    if (!pid) return;
    try {
      if (!(await getProject(pid))) throw new Error('That project no longer exists.');
      await linkProjectToAsset(pid, asset.id);
      setPick(''); setError('');
      toast('Linked. Neither record was changed.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not link.'); }
  }
  async function remove(pid: number, name: string) {
    await unlinkProjectFromAsset(pid, asset.id);
    toast(`${name} is no longer linked. Both records are kept.`, async () => { await linkProjectToAsset(pid, asset.id); });
  }

  return (
    <section className="card as-card" aria-labelledby="as-proj-h">
      <h2 id="as-proj-h">Related projects</h2>
      <p className="muted small">Projects that improved, replaced or repaired this. Their payments are shown here for context only and are not part of this asset's spending above.</p>
      {data.rows.length === 0 ? <p className="muted">No project is linked.</p> : (
        <ul className="plain as-items">
          {data.rows.map((r) => (
            <li key={r.linkId} className="as-proj">
              {r.project ? (
                <>
                  <a href={`#/projects/${r.project.id}`} aria-label={`Open project: ${r.project.data.name}`}><strong>{r.project.data.name}</strong></a>{' '}
                  <span className="as-chip">{STATUS_LABEL[r.project.data.status]}</span>
                  {r.project.data.archived && <span className="as-chip s-past">Archived</span>}
                  <span className="muted small">
                    {r.project.data.startDate ? ` · starts ${dayLabel(r.project.data.startDate, { year: true })}` : ''}{r.project.data.targetDate ? ` · target ${dayLabel(r.project.data.targetDate, { year: true })}` : ''}
                  </span>
                  <div className="small">{r.summary ? <>Paid so far on the whole project: <strong>{formatCents(r.summary.paidCents)}</strong> <span className="muted">(shown for context, not added to this asset's spending)</span></> : <span className="muted">No payment figures available.</span>}</div>
                  <div className="as-hist-actions">
                    {r.project.data.status === 'completed' && <a className="btn" href={`#/assets/${asset.id}?fromProject=${r.project.id}`}>Record in Home &amp; Assets…</a>}
                    <button type="button" className="link" onClick={() => void remove(r.projectId, r.project!.data.name)} aria-label={`Unlink project ${r.project.data.name}`}>Unlink</button>
                  </div>
                </>
              ) : (
                <>
                  <strong className="muted">(project no longer exists)</strong>{' '}
                  <button type="button" className="link" onClick={() => void remove(r.projectId, 'That project')}>Remove this link</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {choices.length > 0 && (
        <div className="as-add-row">
          <select aria-label="Link a project" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Link a project…</option>
            {choices.map((p) => <option key={p.id} value={p.id}>{p.data.name}{p.data.archived ? ' (archived)' : ''}</option>)}
          </select>
          <button type="button" className="btn" disabled={!pick} onClick={() => void add()}>Link</button>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}
