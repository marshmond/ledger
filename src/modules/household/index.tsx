import type { ModuleDef } from '../../core/registry';
import HouseholdModule from './HouseholdModule';
import { HOUSEHOLD_BASE } from './model';
import { HOUSEHOLD_TODAY_CARDS } from './todayCards';
import { householdSearchSource } from './searchSource';

/**
 * Household finances, module #8 (B5): one read-only overview that composes Bills & Subscriptions, Household Services and Home & Assets. It owns no records, no table, no link type,
 * no Calendar layer and no Task. It contributes a counts-only Today card and a page-only search entry (no records, no amounts). Everything it shows comes from the existing modules' own readers.
 */
export const householdModule: ModuleDef = {
  id: HOUSEHOLD_BASE.slice(1),
  name: 'Household finances',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7M5 10v10h14V10M9 20v-6h6v6" /></svg>,
  Component: HouseholdModule,
  routePaths: ['/'],
  nav: [],
  contributes: { todayCards: HOUSEHOLD_TODAY_CARDS, searchSource: householdSearchSource },
};
