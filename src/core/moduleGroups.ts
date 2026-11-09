import type { ModuleDef } from './registry';

/**
 * How the module switcher groups the modules. Navigation only: it changes nothing about routes, module ids or data.
 * Modules are looked up in the registry (nothing is duplicated here); a module that is not named below lands in "Other",
 * so a future module is never hidden.
 */
export interface ModuleGroup {
  /** Stable key. */
  key: string;
  /** The heading shown above the group. `null` for Today, which stands alone at the top without a heading. */
  label: string | null;
  modules: ModuleDef[];
}

const LAYOUT: { key: string; label: string | null; ids: string[] }[] = [
  { key: 'today', label: null, ids: ['today'] },
  { key: 'productivity', label: 'Productivity', ids: ['calendar', 'tasks', 'projects'] },
  { key: 'household', label: 'Household', ids: ['assets', 'services', 'bills', 'family', 'contacts'] },
  { key: 'finances', label: 'Finances', ids: ['ledger', 'household'] },
];

/** Every module exactly once, in group order; empty groups are left out. Unlisted modules follow in "Other", in registration order. */
export function groupModules(mods: readonly ModuleDef[]): ModuleGroup[] {
  const byId = new Map(mods.map((m) => [m.id, m] as const));
  const placed = new Set<string>();
  const groups: ModuleGroup[] = LAYOUT.map((g) => ({
    key: g.key,
    label: g.label,
    modules: g.ids.flatMap((id) => {
      const m = byId.get(id);
      if (!m || placed.has(id)) return [];
      placed.add(id);
      return [m];
    }),
  }));
  const rest = mods.filter((m) => !placed.has(m.id));
  if (rest.length) groups.push({ key: 'other', label: 'Other', modules: rest });
  return groups.filter((g) => g.modules.length > 0);
}
