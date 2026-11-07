import type { ModuleDef } from '../../core/registry';
import BillsModule from './BillsModule';
import { BILLS_BASE } from './paths';
import { billQuickAdd } from './quickAddDef';
import { billRecords } from './records';
import { billsSearchSource } from './searchSource';

/**
 * Bills & Subscriptions, module #7: what you expect to pay regularly, to whom, how often and roughly how much.
 * B1 adds records, previews and figures only. It contributes NO due provider, Today card, Task or Calendar layer yet (B2), and it never writes Finance.
 */
export const billsModule: ModuleDef = {
  id: BILLS_BASE.slice(1),
  name: 'Bills & Subscriptions',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" /></svg>,
  Component: BillsModule,
  routePaths: ['/', '/list', '/o/:id'],
  nav: [],
  contributes: { records: billRecords, searchSource: billsSearchSource, quickAdd: billQuickAdd },
};
