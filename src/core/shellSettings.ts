/**
 * Settings for the app shell itself (not one module). One record in the existing `settings` table, so it is in backups and
 * syncs with everything else. Today: which module the app opens to.
 */
import { db, type FinanceDB } from '../db';

/** 'today' = the Today module, 'last' = whichever module you used last, otherwise a module id such as 'ledger'. */
export type Landing = string;

export interface ShellSettings {
  landing: Landing;
}

export const DEFAULT_SHELL_SETTINGS: ShellSettings = { landing: 'today' };

const KEY = 'shellSettings';

export function normalizeShellSettings(raw: unknown): ShellSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ShellSettings>;
  const landing = typeof r.landing === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(r.landing) ? r.landing : DEFAULT_SHELL_SETTINGS.landing;
  return { landing };
}

export async function loadShellSettings(d: FinanceDB = db): Promise<ShellSettings> {
  return normalizeShellSettings((await d.settings.get(KEY))?.value);
}

export async function saveShellSettings(patch: Partial<ShellSettings>, d: FinanceDB = db): Promise<ShellSettings> {
  const next = normalizeShellSettings({ ...(await loadShellSettings(d)), ...patch });
  await d.settings.put({ key: KEY, value: next });
  return next;
}

/**
 * Which module an address with no module in it opens. Never returns a module that does not exist (a saved choice can outlive the
 * module it named): it falls back to the last-used module, then the first registered one.
 */
export function resolveLanding(landing: Landing, lastUsed: string, moduleIds: readonly string[]): string {
  const has = (id: string) => moduleIds.includes(id);
  if (landing === 'last') return has(lastUsed) ? lastUsed : moduleIds[0] ?? 'ledger';
  if (has(landing)) return landing;
  return has(lastUsed) ? lastUsed : moduleIds[0] ?? 'ledger';
}
