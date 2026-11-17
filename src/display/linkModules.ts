import type { FinanceDB } from '../db';
import { isLive } from '../core/store';

/** All live links, as the module names at each end, keyed by "module:id". One read of the shared links table. */
export async function linkModules(d: FinanceDB, module: string): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  for (const l of await d.links.toArray()) {
    if (!isLive(l)) continue;
    const add = (id: unknown, other: string) => { const n = Number(id); if (Number.isFinite(n)) out.set(n, [...(out.get(n) ?? []), other]); };
    if (l.fromModule === module) add(l.fromId, l.toModule);
    if (l.toModule === module) add(l.toId, l.fromModule);
  }
  return out;
}
