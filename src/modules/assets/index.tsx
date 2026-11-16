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
import { assetsAttention } from './attention';
import { ASSETS_ANSWERS } from './answerDefs';

/** Home & Assets, module #5: what the household owns that needs looking after (the house, what is in it, vehicles), where it is, and who services it. */
export const assetsModule: ModuleDef = {
  id: ASSETS_BASE.slice(1),
  name: 'Home & Assets',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 4.5l8 7M6 10v9.5h12V10M10 19.5v-5h4v5" /></svg>,
  Component: lazyModule(() => import('./AssetsModule')),
  routePaths: ['/', '/list'],
  nav: [],
  contributes: {
    answers: ASSETS_ANSWERS,
    // R4.1: the document references stored on assets, warranties and service history, as one read-only list. Loaded only when Records or Search asks.
    documentRefs: { label: 'Home & Assets', read: (ctx) => import('./docRefs').then((m) => m.readAssetDocs(ctx)) },
    todayCards: ASSETS_TODAY_CARDS, attention: assetsAttention, dueProvider: assetsDueProvider, records: assetRecords, searchSource: assetsSearchSource, quickAdd: [assetQuickAdd, serviceQuickAdd], txnReferences: assetsTxnReferences, contactReferences: assetsContactReferences,
    // R1.2: upcoming maintenance for the weekly review; the reader loads only when the review is opened.
    weekReview: { maintenance: (today) => import('./weekReview').then((m) => m.readWeekMaintenance(today)) },
    // R1.3: after a Task linked to an asset is finished, offer "Log maintenance" (the existing "Save to history" form). Both parts load only when needed.
    taskFollowUp: { read: (taskId) => import('./followUp').then((m) => m.readAssetsFollowUp(taskId)), Dialog: () => import('./FollowUpDialog') },
// R2.2: "Possible matches": candidate records for a Finance payment, and the module's own existing link call for Accept. Loaded only when the owner asks.
    paymentSuggestions: { label: 'Home & Assets', suggest: (c) => import('./paymentSuggest').then((m) => m.suggest(c)), accept: (c, d, today) => import('./paymentSuggest').then((m) => m.accept(c, d, today)), reject: (c, d) => import('./paymentSuggest').then((m) => m.reject(c, d)) },
  },
};
