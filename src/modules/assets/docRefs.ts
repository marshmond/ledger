/**
 * R4.1 Records: Home & Assets' document references, read through the module's OWN loaders (`loadAssets`, `loadWarranties`, `loadServices`). Three kinds of record keep a reference
 * list: the asset itself, each warranty, and each service-history entry. Read only: nothing here writes, copies or repairs a reference.
 *
 * DATES. A warranty's own end date belongs to the warranty, so its documents carry it ("Warranty ends"). An asset's or a service entry's documents carry none: a purchase date,
 * a service date or an asset's old single warranty date (H1) is not an expiration of that document. The asset's H1 warranty fields are NOT turned into a warranty here.
 *
 * GAPS. Only a STORED warranty record (H4) with no document reference is reported, because that record exists precisely to hold its documents. A warranty that has already ended,
 * one on an archived or retired asset, and an asset's single H1 warranty (whose papers may sit on the asset itself) are left out. "No document linked" is not "the household has no document".
 */
import { db, type FinanceDB } from '../../db';
import { makeRefs, type DocumentGap, type DocumentRead, type DocumentReadContext, type DocumentRef } from '../../core/documentRefs';
import { dayLabel } from '../../core/time';
import { loadAssets, whereIs } from './data';
import { MODULE, PAST_STATUSES, STATUS_LABEL, type AssetRecord, type AssetType } from './model';
import { loadServices } from './serviceData';
import { SERVICE_KIND_LABEL } from './service';
import { loadWarranties } from './warrantyData';

export const SOURCE_LABEL = 'Home & Assets';

const KIND: Record<AssetType, string> = { property: 'Property', area: 'Area', system: 'System', appliance: 'Appliance', vehicle: 'Vehicle', other: 'Asset' };
const ACTION: Record<AssetType, string> = { property: 'View property', area: 'View area', system: 'View system', appliance: 'View appliance', vehicle: 'View vehicle', other: 'View asset' };

/** "Archived", "Sold" and the like: the asset's own words for why it is no longer in everyday use. Empty for an ordinary asset. */
const statusOf = (a: AssetRecord) => [a.data.archived ? 'Archived' : '', PAST_STATUSES.includes(a.data.status) ? STATUS_LABEL[a.data.status] : ''].filter(Boolean).join(', ');

export async function readAssetDocs(ctx: DocumentReadContext, d: FinanceDB = db): Promise<DocumentRead> {
  const [assets, warranties, services] = await Promise.all([loadAssets(d), loadWarranties(d), loadServices(d)]);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const refs: DocumentRef[] = [];
  const gaps: DocumentGap[] = [];

  for (const a of assets) {
    refs.push(...makeRefs({
      moduleId: MODULE, sourceLabel: SOURCE_LABEL, ownerKey: `asset:${a.id}`, ownerName: a.data.name, recordKind: KIND[a.data.type],
      context: whereIs(assets, a.id), status: statusOf(a), recordPath: `/assets/${a.id}`, recordAction: ACTION[a.data.type],
    }, a.data.refs));
  }

  for (const w of warranties) {
    const a = byId.get(w.data.assetId);
    refs.push(...makeRefs({
      moduleId: MODULE, sourceLabel: SOURCE_LABEL, ownerKey: `warranty:${w.id}`, ownerName: a ? a.data.name : 'Asset removed', recordKind: 'Warranty', recordName: w.data.title,
      context: a ? whereIs(assets, a.id) : '', status: a ? statusOf(a) : '',
      recordPath: a ? `/assets/${a.id}?warranty=${w.id}` : '/assets', recordAction: a ? ACTION[a.data.type] : 'View Home & Assets',
      expires: w.data.endDate ? { date: w.data.endDate, label: 'Warranty ends' } : null,
    }, w.data.refs));
    // Gap: a live warranty record on an asset still in use, not yet ended, with no document reference at all.
    if (a && w.data.refs.length === 0 && !a.data.archived && !PAST_STATUSES.includes(a.data.status) && (!w.data.endDate || w.data.endDate >= ctx.today)) {
      gaps.push({
        id: `${MODULE}:warranty:${w.id}`, moduleId: MODULE, sourceLabel: SOURCE_LABEL, ownerName: a.data.name, recordKind: 'Warranty', recordName: w.data.title,
        context: whereIs(assets, a.id), message: 'No warranty document is linked.', recordPath: `/assets/${a.id}?warranty=${w.id}`, recordAction: ACTION[a.data.type],
      });
    }
  }

  for (const s of services) {
    const a = byId.get(s.data.assetId);
    refs.push(...makeRefs({
      moduleId: MODULE, sourceLabel: SOURCE_LABEL, ownerKey: `service:${s.id}`, ownerName: a ? a.data.name : 'Asset removed', recordKind: 'Service record',
      recordName: s.data.title, context: [SERVICE_KIND_LABEL[s.data.kind], s.data.date ? dayLabel(s.data.date, { year: true }) : ''].filter(Boolean).join(' · '), status: a ? statusOf(a) : '',
      recordPath: a ? `/assets/${a.id}?service=${s.id}` : '/assets', recordAction: a ? ACTION[a.data.type] : 'View Home & Assets',
    }, s.data.refs));
  }
  return { refs, gaps };
}
