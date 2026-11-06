/**
 * Reads everything the overview needs in ONE pass (read-only), then hands it to the pure `buildOverview`. The page and the Today card both
 * call this, so they can never disagree. Each table is read once: assets, warranties, service records, tasks, the asset links, and the
 * Finance transactions that service/purchase references point at (one bulk read). Nothing is written and nothing is cached or stored.
 */
import { db, type FinanceDB } from '../../db';
import type { Link } from '../../core/entities';
import { isLive } from '../../core/store';
import { todayISO } from '../../lib/money';
import { loadTasks } from '../tasks/data';
import { loadAssets } from './data';
import { detectOrphans } from './orphans';
import { buildOverview, type Overview, type Period } from './overview';
import { loadServices } from './serviceData';
import { costRecords } from './spending';
import { loadTxnMap, lookupOfMap } from './txnLookup';
import { loadWarranties } from './warrantyData';

/** Live shared links that have an asset at either end (one indexed range read on each side, not one query per asset). */
export async function loadAssetLinks(d: FinanceDB = db): Promise<Link[]> {
  const [out, inn] = await Promise.all([
    d.links.where('[fromModule+fromId]').between(['assets', ''], ['assets', '￿']).toArray(),
    d.links.where('[toModule+toId]').between(['assets', ''], ['assets', '￿']).toArray(),
  ]);
  const seen = new Set<number>();
  return [...out, ...inn].filter((l) => isLive(l) && !seen.has(l.id as number) && seen.add(l.id as number));
}

export async function loadOverview(period: Period, today: string = todayISO(), d: FinanceDB = db): Promise<Overview> {
  const [assets, warranties, services, links, orphans] = await Promise.all([loadAssets(d), loadWarranties(d), loadServices(d), loadAssetLinks(d), detectOrphans(d)]);
  const tasks = links.some((l) => l.fromModule === 'tasks' || l.toModule === 'tasks') ? await loadTasks(d) : [];
  const map = await loadTxnMap(costRecords(assets, services).flatMap((r) => r.refs), d);
  return buildOverview({ assets, warranties, services, tasks, links, lookup: lookupOfMap(map), orphanCount: orphans.length, today, period });
}
