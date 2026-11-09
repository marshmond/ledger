import { assetsContactReferences } from './contactReferences';
import type { ModuleDef } from '../../core/registry';
import { ASSETS_BASE } from '../bases';
import { lazyModule } from '../../core/lazyModule';
import { assetQuickAdd } from './quickAddDef';
import { assetsDueProvider } from './dueProvider';
import { assetRecords } from './records';
import { assetsSearchSource } from './searchSource';
import { assetsTxnReferences } from './txnReferences';
import { serviceQuickAdd } from './serviceQuickAdd';
import { ASSETS_TODAY_CARDS } from './todayCards';

/** Home & Assets, module #5: what the household owns that needs looking after (the house, what is in it, vehicles), where it is, and who services it. */
export const assetsModule: ModuleDef = {
  id: ASSETS_BASE.slice(1),
  name: 'Home & Assets',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 4.5l8 7M6 10v9.5h12V10M10 19.5v-5h4v5" /></svg>,
  Component: lazyModule(() => import('./AssetsModule')),
  routePaths: ['/', '/list'],
  nav: [],
  contributes: { todayCards: ASSETS_TODAY_CARDS, dueProvider: assetsDueProvider, records: assetRecords, searchSource: assetsSearchSource, quickAdd: [assetQuickAdd, serviceQuickAdd], txnReferences: assetsTxnReferences, contactReferences: assetsContactReferences },
};
