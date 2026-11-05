import type { ModuleDef } from '../../core/registry';
import { TODAY_CARDS } from './cards';
import TodayModule, { TODAY_BASE } from './TodayModule';

/** Today, module #4 (listed first): one screen across all modules. Cards are contributed by the modules through `contributes.todayCards`. */
export const todayModule: ModuleDef = {
  id: TODAY_BASE.slice(1),
  name: 'Today',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></svg>,
  Component: TodayModule,
  routePaths: ['/'],
  nav: [],
  // Dated things (events, tasks, bills, vests, tax dates) come from every module's due provider; these cards present them.
  contributes: { todayCards: TODAY_CARDS },
};
