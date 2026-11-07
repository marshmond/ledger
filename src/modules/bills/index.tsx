import type { ModuleDef } from '../../core/registry';
import BillsModule from './BillsModule';
import { BILLS_BASE } from './paths';
import { billQuickAdd } from './quickAddDef';
import { billRecords } from './records';
import { billsSearchSource } from './searchSource';
import { billsDueProvider } from './dueProvider';
import { BILLS_TODAY_CARDS } from './todayCards';

/**
 * Bills & Subscriptions, module #7: what you expect to pay regularly, to whom, how often and roughly how much.
 * B1 added records, previews and figures. B2 adds billing-period facts, reminder Tasks, a read-only Calendar layer (`bills`), the `bills.attention` Today card, Upcoming and Needs-review pages. It never writes Finance.
 */
export const billsModule: ModuleDef = {
  id: BILLS_BASE.slice(1),
  name: 'Bills & Subscriptions',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" /></svg>,
  Component: BillsModule,
  routePaths: ['/', '/list', '/upcoming', '/review', '/o/:id'],
  nav: [],
  contributes: { records: billRecords, searchSource: billsSearchSource, quickAdd: billQuickAdd, todayCards: BILLS_TODAY_CARDS, dueProvider: billsDueProvider },
};
