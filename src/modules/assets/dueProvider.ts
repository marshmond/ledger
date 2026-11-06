/**
 * The Home & Assets due provider: each warranty end date appears on the Calendar's "Home & Assets" layer as a plain, read-only marker
 * ("Warranty ends: Dishwasher — Manufacturer warranty"). Worked out when the Calendar draws; nothing is stored, copied or written, and no
 * Task or reminder is created. Maintenance is NOT here: open maintenance tasks reach the Calendar through the Tasks layer only.
 *
 *  - One marker per warranty: the stored warranty records, or, for an asset with no live record, its one implicit H1 warranty.
 *  - Assets that are archived, sold, disposed of or replaced show no markers (their coverage history stays on the asset page). Stored assets
 *    still show them. In-use assets show every marker.
 *  - A marker whose date has passed is `handled`, so an old end date never sits in Overdue; it is just a past date.
 *  - The title holds only the asset's own name and the warranty's title. Never a serial number, VIN, plate, address, provider or note.
 */
import { db, type FinanceDB } from '../../db';
import { derivedId, goTo, type DerivedItem, type DueProvider, type DueQuery } from '../../core/dueProvider';
import { loadAssets } from './data';
import { effectiveWarranties, groupByAsset } from './warranty';
import { loadWarranties } from './warrantyData';
import type { AssetRecord } from './model';

export const ASSETS_LAYER_COLOR = '#b07a1f';

/** True when reminders for this asset's warranties make sense: it is not archived and has not left the household. */
export const showsWarrantyMarkers = (a: AssetRecord) => !a.data.archived && (a.data.status === 'active' || a.data.status === 'stored');

export async function assetDueItems(d: FinanceDB, q: DueQuery): Promise<DerivedItem[]> {
  const [assets, warranties] = await Promise.all([loadAssets(d), loadWarranties(d)]);
  const by = groupByAsset(warranties);
  const out: DerivedItem[] = [];
  for (const a of assets) {
    if (!showsWarrantyMarkers(a)) continue;
    for (const w of effectiveWarranties(a.id, a.data, by.get(a.id) ?? [])) {
      const date = w.endDate;
      if (!date || date < q.from || date > q.to) continue;
      const key = w.id === null ? `asset-${a.id}` : `warranty-${w.id}`;
      out.push({
        id: derivedId('assets', key, date), sourceModule: 'assets', sourceRecordId: w.id === null ? `asset:${a.id}` : `warranty:${w.id}`,
        title: w.implicit ? `Warranty ends: ${a.data.name}` : `Warranty ends: ${a.data.name} — ${w.title}`,
        date, allDay: true, priority: 'low', status: date >= q.today ? 'open' : 'handled',
        detail: 'The last day this warranty covers.',
        openSource: () => goTo(w.id === null ? `/assets/${a.id}` : `/assets/${a.id}?warranty=${w.id}`), sourceLabel: 'Open asset',
      });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title) || x.id.localeCompare(y.id));
}

export const assetsDueProvider: DueProvider = {
  id: 'assets',
  layerName: 'Home & Assets',
  color: ASSETS_LAYER_COLOR,
  getDueItems: (q) => assetDueItems(db, q),
};
