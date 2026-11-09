import { familyContactReferences } from './contactReferences';
import type { ModuleDef } from '../../core/registry';
import { lazyModule } from '../../core/lazyModule';
import { familyDueProvider } from './dueProvider';
import { FAMILY_BASE } from './model';

/**
 * Family, module #10 (F1): household members linked to shared Contacts (`family/member`, in `moduleRecords`). F2 adds a second kind, `family/date`
 * (important dates), and ONE contribution: the read-only due provider that puts member birthdays and important dates on the Calendar's "Family" layer
 * (and so on Today). No Today card, search source or Add-box destination yet. The provider is registered here so it works before Family has ever
 * been opened; the screens load on demand.
 */
export const familyModule: ModuleDef = {
  id: FAMILY_BASE.slice(1),
  name: 'Family',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M2.5 20v-2a5.5 5.5 0 0 1 11 0v2M14.5 20v-1.5a4 4 0 0 1 7 -2.6" /></svg>,
  Component: lazyModule(() => import('./FamilyModule')),
  routePaths: ['/'],
  nav: [],
  contributes: { dueProvider: familyDueProvider, contactReferences: familyContactReferences },
};
