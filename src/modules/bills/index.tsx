import { billsContactReferences } from './contactReferences';
import type { ModuleDef } from '../../core/registry';
import { lazyModule } from '../../core/lazyModule';
import { BILLS_BASE } from './paths';
import { billQuickAdd } from './quickAddDef';
import { billRecords } from './records';
import { billsSearchSource } from './searchSource';
import { billsDueProvider } from './dueProvider';
import { billsTxnReferences } from './txnReferences';
import { BILLS_TODAY_CARDS } from './todayCards';
import { billsAttention } from './attention';
import { BILLS_ANSWERS } from './answerDefs';

/**
 * Bills & Subscriptions, module #7: what you expect to pay regularly, to whom, how often and roughly how much.
 * B1 added records, previews and figures. B2 adds billing-period facts, reminder Tasks, a read-only Calendar layer (`bills`), the `bills.attention` Today card, Upcoming and Needs-review pages. It never writes Finance.
 */
export const billsModule: ModuleDef = {
  id: BILLS_BASE.slice(1),
  name: 'Bills & Subscriptions',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" /></svg>,
  Component: lazyModule(() => import('./BillsModule')),
  routePaths: ['/', '/list', '/upcoming', '/review', '/o/:id'],
  nav: [],
  contributes: { answers: BILLS_ANSWERS, documentRefs: { label: 'Bills & Subscriptions', read: (ctx) => import('./docRefs').then((m) => m.readBillDocs(ctx)) }, records: billRecords, searchSource: billsSearchSource, quickAdd: billQuickAdd, todayCards: BILLS_TODAY_CARDS, attention: billsAttention, dueProvider: billsDueProvider, txnReferences: billsTxnReferences, contactReferences: billsContactReferences,
    // R2.2: "Possible matches": candidate bills for a Finance payment, and Bills' own existing link call for Accept. Loaded only when the owner asks.
    paymentSuggestions: { label: 'Bills & Subscriptions', suggest: (c) => import('./paymentSuggest').then((m) => m.suggest(c)), accept: (c, d, today) => import('./paymentSuggest').then((m) => m.accept(c, d, today)), reject: (c, d) => import('./paymentSuggest').then((m) => m.reject(c, d)) },
  },
};
