import { useLiveQuery } from 'dexie-react-hooks';
import { dayLabel } from '../../core/time';
import { db } from '../../db';
import { formatCents } from '../../lib/money';
import { latestValue } from '../../lib/property';

/** The Finance net worth entry this asset points at, READ ONLY. Finance owns the value; a removed entry just reads "removed". */
export default function NetWorthEntry({ propertyId }: { propertyId: number }) {
  const data = useLiveQuery(async () => {
    const p = await db.properties.get(propertyId);
    return { p: p ?? null, v: p ? latestValue(await db.propertyValues.where('propertyId').equals(propertyId).toArray(), propertyId) : null };
  }, [propertyId]);
  if (!data) return null;
  if (!data.p) return <p className="muted small">Net worth entry: (net worth entry removed). Edit this asset to choose another or clear it.</p>;
  return (
    <p className="small">
      Net worth entry: <strong>{data.p.name}</strong>
      {data.v ? <> · latest value {formatCents(data.v.valueCents)} as of {dayLabel(data.v.date, { year: true })}</> : <> · no value recorded yet</>}
      {' · '}<a href="#/ledger/networth">Open Net worth in Finance</a>
      <span className="muted"> (the value belongs to Finance and is changed there)</span>
    </p>
  );
}
