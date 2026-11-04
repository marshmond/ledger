/**
 * The module registry. Adding a module (Calendar, Tasks, ...) means writing one `ModuleDef` and listing it in
 * `src/modules/index.ts`; the top bar, the routes and "open to the last module used" all come from this list.
 */
import type { ComponentType, ReactNode } from 'react';
import type { DueItemInput } from './entities';

export interface ModuleNavItem {
  to: string;
  label: string;
  keywords?: string;
}
export interface ModuleNavGroup {
  id: string;
  label: string;
  to: string;
  items: ModuleNavItem[];
}

export interface ModuleDef {
  /** Short, lowercase, permanent. Used in addresses (`#/ledger/...`) and as the data namespace. */
  id: string;
  name: string;
  icon: ReactNode;
  /** The module's whole experience (its own sidebar, pages and routes). Rendered at `/<id>/*`. */
  Component: ComponentType;
  /** Page addresses inside the module, written without the prefix (`/budget`). Old bookmarks use the same list. */
  routePaths: string[];
  /** The module's own navigation map (informational for the shell; the module draws its own sidebar). */
  nav: ModuleNavGroup[];
  /** Optional hooks. Empty stubs for now; Phase 2 will read them. */
  contributes?: {
    /** Returns the due dates / events this module wants on the shared calendar. */
    dueItems?: () => Promise<DueItemInput[]>;
    /** Returns tasks this module wants on the shared task list (shape decided in Phase 2). */
    tasks?: () => Promise<unknown[]>;
  };
}

const modules: ModuleDef[] = [];

export function registerModule(m: ModuleDef) {
  if (modules.some((x) => x.id === m.id)) throw new Error(`Module "${m.id}" is registered twice.`);
  modules.push(m);
}
export const allModules = (): readonly ModuleDef[] => modules;
export const getModule = (id: string | null | undefined) => modules.find((m) => m.id === id);

const LAST_KEY = 'ledger-last-module';
/** The module to open when no module is named in the address: the one used last, else the first registered. */
export function lastModuleId(store: Pick<Storage, 'getItem'> | null = safeStorage()): string {
  let id: string | null = null;
  try { id = store?.getItem(LAST_KEY) ?? null; } catch { /* storage unavailable */ }
  return getModule(id)?.id ?? modules[0]?.id ?? 'ledger';
}
export function rememberModule(id: string, store: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { store?.setItem(LAST_KEY, id); } catch { /* storage unavailable */ }
}
function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
