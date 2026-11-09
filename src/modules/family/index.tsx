import type { ModuleDef } from '../../core/registry';
import { lazyModule } from '../../core/lazyModule';
import { FAMILY_BASE } from './model';

/**
 * Family, module #10 (F1): household members linked to shared Contacts. It stores one kind of record (`family/member`, in `moduleRecords`) and
 * contributes nothing else yet: no Calendar layer, Today card, search source or Add-box destination. Its screens load on demand.
 */
export const familyModule: ModuleDef = {
  id: FAMILY_BASE.slice(1),
  name: 'Family',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M2.5 20v-2a5.5 5.5 0 0 1 11 0v2M14.5 20v-1.5a4 4 0 0 1 7 -2.6" /></svg>,
  Component: lazyModule(() => import('./FamilyModule')),
  routePaths: ['/'],
  nav: [],
};
