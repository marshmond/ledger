import type { ModuleDef } from '../../core/registry';
import { SERVICES_BASE } from '../bases';
import { lazyModule } from '../../core/lazyModule';
import { servicesDueProvider } from './dueProvider';
import { serviceQuickAdd } from './quickAddDef';
import { serviceRecords } from './records';
import { servicesSearchSource } from './searchSource';
import { servicesTxnReferences } from './txnReferences';
import { SERVICES_TODAY_CARDS } from './todayCards';

/** Household Services, module #6: who comes to the house (cleaners, lawn care, repair people), how often, and when they are next due. */
export const servicesModule: ModuleDef = {
  id: SERVICES_BASE.slice(1),
  name: 'Household Services',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20v-1.5a4 4 0 0 1 4-4h2.5M9 11.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM14 17l2.2 2.2L20 14.5" /></svg>,
  Component: lazyModule(() => import('./ServicesModule')),
  routePaths: ['/', '/a/:id', '/providers/:contactId', '/v/:id'],
  nav: [],
  contributes: { records: serviceRecords, searchSource: servicesSearchSource, quickAdd: serviceQuickAdd, todayCards: SERVICES_TODAY_CARDS, dueProvider: servicesDueProvider, txnReferences: servicesTxnReferences },
};
