import { useLiveQuery } from 'dexie-react-hooks';
import { dayLabel } from '../../core/time';
import { pathFor } from '../calendar/records';
import { loadLinkedWork } from './data';

/**
 * Calendar events linked to this asset from their own editors ("Link a record"). Read-only here. Linked tasks are shown under Maintenance
 * (open ones) and Service history (completed ones), so they are not listed twice.
 */
export default function LinkedWork({ assetId }: { assetId: number }) {
  const work = useLiveQuery(() => loadLinkedWork(assetId), [assetId]);
  if (!work || work.events.length === 0) return null;
  return (
    <section className="card as-card" aria-labelledby="as-linked-h">
      <h2 id="as-linked-h">Events linked to this</h2>
      <ul className="plain as-items">
        {work.events.map((e) => (
          <li key={e.id}>
            <a href={`#${pathFor(e)}`}>{e.data.title}</a>
            <span className="muted small"> Event · {dayLabel(e.data.startDate, { year: true })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
