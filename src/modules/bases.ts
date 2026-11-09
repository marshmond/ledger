/**
 * The address prefix of each module (`#/bills/...`). Kept apart from the module shells so a module's registration (which must be in the first
 * download) can name its prefix without pulling in its screens (which load on demand; see `src/core/lazyModule.ts`).
 */
export const LEDGER_BASE = '/ledger';
export const CALENDAR_BASE = '/calendar';
export const TASKS_BASE = '/tasks';
export const PROJECTS_BASE = '/projects';
export const ASSETS_BASE = '/assets';
export const SERVICES_BASE = '/services';
