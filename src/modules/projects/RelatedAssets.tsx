import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { assetsOfProject, linkProjectToAsset, unlinkProjectFromAsset } from '../../core/projectAssetLink';
import { recordSource } from '../../core/registry';
import { useToast } from '../../ui/Toast';
import type { ProjectRecord } from './model';

/**
 * The Home & Assets items this project involves. A link only: it changes neither record and carries no money. Names and the picker come
 * from Home & Assets through the shared record registry. On a completed project each item offers "Record in Home & Assets…", which just
 * OPENS that item's own service form with a few facts filled in; nothing is saved until the owner presses Save there.
 */
export default function RelatedAssets({ project }: { project: ProjectRecord }) {
  const toast = useToast();
  const src = recordSource('assets');
  const [filter, setFilter] = useState('');
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const data = useLiveQuery(async () => {
    if (!src) return { rows: [], choices: [] };
    const pairs = await assetsOfProject(project.id);
    const rows = await Promise.all(pairs.map(async (p) => ({ ...p, info: await src.describe(`asset:${p.assetId}`) })));
    const choices = (await src.search(filter)).filter((c) => c.kind === 'Asset' && !pairs.some((p) => `asset:${p.assetId}` === c.id));
    return { rows: rows.sort((a, b) => (a.info?.label ?? '~').localeCompare(b.info?.label ?? '~')), choices };
  }, [project.id, filter]);
  if (!src || !data) return null;
  const done = project.data.status === 'completed';

  async function add() {
    const m = /^asset:(\d+)$/.exec(pick);
    if (!m) return;
    try {
      if (!(await src!.describe(pick))) throw new Error('That item no longer exists.');
      await linkProjectToAsset(project.id, Number(m[1]));
      setPick(''); setError('');
      toast('Linked. Neither record was changed.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not link.'); }
  }
  async function remove(assetId: number, label: string) {
    await unlinkProjectFromAsset(project.id, assetId);
    toast(`${label} is no longer linked. Both records are kept.`, async () => { await linkProjectToAsset(project.id, assetId); });
  }

  return (
    <section className="card pj-card" id="pj-assets" aria-labelledby="pj-assets-h">
      <div className="pj-card-head"><h2 id="pj-assets-h">Related assets</h2></div>
      <p className="muted small">The house, systems or equipment this project improves, replaces or repairs. A link only: this project&apos;s money stays here and is not split between them.</p>
      {data.rows.length === 0 ? <p className="muted">No asset is linked.</p> : (
        <ul className="plain pj-paylist">
          {data.rows.map((r) => (
            <li key={r.linkId} className="pj-payrow">
              <span className="pj-payrow-main">
                {r.info ? <a href={`#${r.info.path}`}><strong>{r.info.label}</strong></a> : <strong className="muted">(asset no longer exists)</strong>}
              </span>
              <span className="pj-assets-actions">
                {done && r.info && <a className="btn" href={`#/assets/${r.assetId}?fromProject=${project.id}`}>Record in Home &amp; Assets…</a>}
                <button className="link" onClick={() => void remove(r.assetId, r.info?.label ?? 'That item')} aria-label={`Unlink ${r.info?.label ?? 'this item'} from this project`}>Unlink</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="pj-add">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an asset" aria-label="Find an asset to link" />
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Pick an asset to link">
          <option value="">Link an asset…</option>
          {data.choices.map((c) => <option key={String(c.id)} value={String(c.id)}>{c.label}</option>)}
        </select>
        <button className="btn" disabled={!pick} onClick={() => void add()}>Link</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
