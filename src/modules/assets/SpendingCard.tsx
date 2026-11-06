import { useLiveQuery } from 'dexie-react-hooks';
import { formatCents } from '../../lib/money';
import { loadAssets } from './data';
import { assetSpend, costRecords, GROUP_LABEL, pieceUsers, type CostGroup, type ReviewItem, type SpendSummary } from './spending';
import { loadServices } from './serviceData';
import { loadTxnMap, lookupOfMap } from './txnLookup';
import { RefLine } from './TxnRefs';
import type { AssetRecord } from './model';

const GROUPS: CostGroup[] = ['acquisition', 'maintenance', 'other'];

function sourceWords(s: SpendSummary, g: CostGroup): string {
  const typed = s.manualByGroup[g] !== 0;
  const fin = s.financeByGroup[g] !== 0 || s.pieces.some((p) => p.group === g);
  return [typed ? 'typed' : '', fin ? 'from Finance' : ''].filter(Boolean).join(' and ');
}

/**
 * What has been spent on this asset (H3). Everything is worked out when the page opens, from the purchase and service records and the LIVE
 * Finance transactions they point at (`spending.ts`). Project money is NOT included; it is shown separately under Related projects.
 */
export default function SpendingCard({ asset, onEdit }: { asset: AssetRecord; onEdit: () => void }) {
  const data = useLiveQuery(async () => {
    const [assets, services] = await Promise.all([loadAssets(), loadServices()]);
    const records = costRecords(assets, services);
    const map = await loadTxnMap(records.flatMap((r) => r.refs));
    const lookup = lookupOfMap(map);
    return { assets, records, users: pieceUsers(records), result: assetSpend(assets, services, asset.id, lookup) };
  }, [asset.id]);
  if (!data) return null;
  const { assets, records, users, result } = data;
  const { own, combined, hasInside } = result;
  const shown = hasInside ? combined : own;
  const nameOf = (id: number) => assets.find((a) => a.id === id)?.data.name ?? '(asset removed)';
  const rec = new Map(records.map((r) => [r.id, r]));
  const empty = records.every((r) => r.assetId !== asset.id) && !hasInside && combined.pieces.length === 0 && combined.review.length === 0 && combined.manualRecords === 0;

  const fixLink = (it: ReviewItem) => {
    if (it.recordId.startsWith('service:')) return <a href={`#/assets/${it.assetId}?service=${it.recordId.slice(8)}`}>Open the service record to fix it</a>;
    return it.assetId === asset.id ? <button type="button" className="link" onClick={onEdit}>Edit this asset to fix it</button> : <a href={`#/assets/${it.assetId}`}>Open {nameOf(it.assetId)} to fix it</a>;
  };
  const where = (recordId: string, assetId: number) => `${rec.get(recordId)?.title ?? 'record'}${assetId !== asset.id ? ` (${nameOf(assetId)})` : ''}`;

  return (
    <section className="card as-card" aria-labelledby="as-spend-h">
      <h2 id="as-spend-h">Spending</h2>
      <p className="muted small">What was paid for this asset, from its price and its service history. Amounts taken from Finance follow the transactions; typed amounts are counted as typed. Project spending is shown separately under Related projects and is never added here.</p>
      {empty ? <p className="muted">Nothing recorded yet. Add a price or a cost to a service record, or link the Finance transaction that paid for it.</p> : (
        <>
          {hasInside ? (
            <dl className="as-facts as-spend-top">
              <div className="as-fact"><dt>On {asset.data.name} itself</dt><dd><strong>{formatCents(own.totalCents)}</strong></dd></div>
              <div className="as-fact"><dt>On things inside it</dt><dd><strong>{formatCents(result.insideCents)}</strong></dd></div>
              <div className="as-fact as-total"><dt>Combined, each payment once</dt><dd><strong>{formatCents(combined.totalCents)}</strong></dd></div>
            </dl>
          ) : (
            <p className="as-total-line">Total spent directly: <strong>{formatCents(own.totalCents)}</strong></p>
          )}
          {hasInside && result.insideCents !== 0 && <p className="muted small">The combined figure counts a payment once even when it is linked from several places. Typed amounts are counted as typed.</p>}
          <dl className="as-facts">
            {GROUPS.map((g) => (shown.byGroup[g] !== 0 || shown.manualByGroup[g] !== 0 || shown.pieces.some((p) => p.group === g)) && (
              <div className="as-fact" key={g}><dt>{GROUP_LABEL[g]}</dt><dd>{formatCents(shown.byGroup[g])} <span className="muted small">{sourceWords(shown, g)}</span></dd></div>
            ))}
          </dl>
          {shown.review.length > 0 && (
            <div className="as-warn" role="alert">
              <p><strong>{shown.review.length === 1 ? '1 linked transaction needs review' : `${shown.review.length} linked transactions need review`}.</strong> {shown.review.length === 1 ? 'It is' : 'They are'} NOT in the figures above, and nothing has been guessed in {shown.review.length === 1 ? 'its' : 'their'} place.</p>
              <ul className="plain as-txns">
                {shown.review.map((it) => <RefLine key={`${it.recordId}|${it.resolved.key}`} r={it.resolved} extra={<span className="muted small"> · in {where(it.recordId, it.assetId)} · {fixLink(it)}</span>} />)}
              </ul>
            </div>
          )}
          {shown.unknown.length > 0 && <p className="muted small">{shown.unknown.length === 1 ? '1 service record has' : `${shown.unknown.length} service records have`} no cost recorded. {shown.unknown.length === 1 ? 'It is' : 'They are'} not counted as $0.</p>}
          {shown.both.length > 0 && <p className="muted small" role="status">{shown.both.length === 1 ? '1 record has' : `${shown.both.length} records have`} both a typed amount and linked transactions. The linked transactions are used. Edit {shown.both.length === 1 ? 'it' : 'them'} to choose one.</p>}
          {shown.coveredParts.length > 0 && <p className="muted small" role="status">{shown.coveredParts.length === 1 ? 'A part of a transaction is' : `${shown.coveredParts.length} parts of transactions are`} also linked together with the whole transaction, so it is counted once.</p>}
          {shown.pieces.length > 0 && (
            <details className="as-sec" open>
              <summary>Linked transactions ({shown.pieces.length})</summary>
              <ul className="plain as-txns">
                {shown.pieces.map((p) => {
                  const elsewhere = (users.get(p.key) ?? []).filter((u) => !p.recordIds.includes(u.recordId));
                  const extra = (
                    <span className="muted small">
                      {' · '}{GROUP_LABEL[p.group].split(',')[0].toLowerCase()}: {p.recordIds.map((id) => where(id, rec.get(id)?.assetId ?? asset.id)).join('; ')}
                      {p.recordIds.length > 1 && <> · <strong>linked from {p.recordIds.length} records, counted once</strong></>}
                      {elsewhere.length > 0 && <> · <strong>also linked on {[...new Set(elsewhere.map((u) => nameOf(u.assetId)))].join(', ')}, not added here</strong></>}
                    </span>
                  );
                  return <RefLine key={p.key} r={p.resolved} extra={extra} />;
                })}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
