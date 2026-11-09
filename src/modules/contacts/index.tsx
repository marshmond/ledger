import type { ModuleDef } from '../../core/registry';
import { lazyModule } from '../../core/lazyModule';
import { CONTACTS_BASE } from './model';
import { contactsSearchSource } from './searchSource';

/**
 * Contacts & Relationships, module #11 (C1): a directory, a detail page and a safe create/edit form over the ONE shared `contacts` table. No records of
 * its own, no new table and no new field. It contributes only a search source (registered here so Search works before the module is opened); the
 * screens load on demand.
 */
export const contactsModule: ModuleDef = {
  id: CONTACTS_BASE.slice(1),
  name: 'Contacts & Relationships',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="10" cy="10.5" r="2.3" /><path d="M6 16.5c.6-2 2.2-3 4-3s3.4 1 4 3M16 9.5h2.5M16 12.5h2.5" /></svg>,
  Component: lazyModule(() => import('./ContactsModule')),
  routePaths: ['/'],
  nav: [],
  contributes: { searchSource: contactsSearchSource },
};
