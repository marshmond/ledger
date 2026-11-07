import { useLiveQuery } from 'dexie-react-hooks';
import { dayLabel } from '../../core/time';
import { getArrangement } from '../services/data';
import { servicesOfProject } from '../services/projectLinks';
import { getVisit } from '../services/visits';
import { statusWords } from '../services/visitModel';
import { STATUS_LABEL } from '../services/model';
import type { ProjectRecord } from './model';

/**
 * The Household Services records that explicitly involve this project: arrangements and visits the owner linked from the Services screens. A read-only
 * list. It holds no copy, creates no Project task, and shows NO Services payment: this project's own financial view is the only money here, and a
 * payment that appears in both places is never added together. Provider names are shown; contact details and amounts are not.
 */
export default function RelatedServices({ project }: { project: ProjectRecord }) {
  const data = useLiveQuery(async () => {
    const ids = await servicesOfProject(project.id);
    const arrangements = (await Promise.all(ids.arrangementIds.map((id) => getArrangement(id)))).filter((x): x is NonNullable<typeof x> => !!x);
    const visits = (await Promise.all(ids.visitIds.map((id) => getVisit(id)))).filter((x): x is NonNullable<typeof x> => !!x);
    return { arrangements, visits, missing: ids.arrangementIds.length - arrangements.length + ids.visitIds.length - visits.length };
  }, [project.id]);
  if (!data) return null;
  const none = data.arrangements.length + data.visits.length + data.missing === 0;
  return (
    <section className="card pj-card" id="pj-services" aria-labelledby="pj-services-h">
      <div className="pj-card-head"><h2 id="pj-services-h">Related household services</h2></div>
      <p className="muted small">Services you linked to this project from Household Services. A link only: this project&apos;s money stays here, and nothing a provider was paid through Services is added to it.</p>
      {none && <p className="muted">No service is linked. Link one from its arrangement or visit page in Household Services.</p>}
      <ul className="plain pj-paylist">
        {data.arrangements.map((a) => (
          <li key={`a${a.id}`} className="pj-payrow">
            <span className="pj-payrow-main"><a href={`#/services/a/${a.id}`}><strong>{a.data.title}</strong></a>{' '}<span className="muted small">{a.data.providerNameSnapshot ? `${a.data.providerNameSnapshot} · ` : ''}{STATUS_LABEL[a.data.status]}</span></span>
          </li>
        ))}
        {data.visits.map((v) => (
          <li key={`v${v.id}`} className="pj-payrow">
            <span className="pj-payrow-main"><a href={`#/services/v/${v.id}`}><strong>{v.data.title}</strong></a>{' '}<span className="muted small">{v.data.providerNameSnapshot ? `${v.data.providerNameSnapshot} · ` : ''}{statusWords(v.data)}{v.data.date ? `, ${dayLabel(v.data.date, { year: true })}` : ''}</span></span>
          </li>
        ))}
      </ul>
      {data.missing > 0 && <p className="muted small">{data.missing === 1 ? '1 linked service record is' : `${data.missing} linked service records are`} not on this device (it may have been deleted or not synced yet).</p>}
    </section>
  );
}
