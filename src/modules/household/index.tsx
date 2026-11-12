import type { ModuleDef } from '../../core/registry';
import { lazyModule } from '../../core/lazyModule';
import { HOUSEHOLD_BASE } from './model';
import { HOUSEHOLD_TODAY_CARDS } from './todayCards';
import { householdSearchSource } from './searchSource';

/**
 * Household finances, module #8 (B5): one read-only overview that composes Bills & Subscriptions, Household Services and Home & Assets. It owns no records, no table, no link type,
 * no Calendar layer and no Task. It contributes a counts-only Today card and a page-only search entry (no records, no amounts). Everything it shows comes from the existing modules' own readers.
 */
export const householdModule: ModuleDef = {
  id: HOUSEHOLD_BASE.slice(1),
  name: 'Household Finances',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v4" /><path d="M3 7.5v10A2.5 2.5 0 0 0 5.5 20H20V9H5.5A2.5 2.5 0 0 1 3 7.5z" /><circle cx="16.5" cy="14.5" r="1.2" /></svg>,
  Component: lazyModule(() => import('./HouseholdModule')),
  routePaths: ['/'],
  nav: [],
  contributes: { todayCards: HOUSEHOLD_TODAY_CARDS, searchSource: householdSearchSource },
};
