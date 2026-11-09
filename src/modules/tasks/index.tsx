import type { ModuleDef } from '../../core/registry';
import { tasksDueProvider } from './dueProvider';
import { taskQuickAdd } from './quickAddDef';
import { taskRecords } from './records';
import { tasksSearchSource } from './searchSource';
import { TASKS_BASE } from '../bases';
import { lazyModule } from '../../core/lazyModule';

/** Tasks, module #3: to-dos you own. Dated ones show on the Calendar's Tasks layer (computed, never copied). */
export const tasksModule: ModuleDef = {
  id: TASKS_BASE.slice(1),
  name: 'Tasks',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>,
  Component: lazyModule(() => import('./TasksModule')),
  routePaths: ['/'],
  nav: [],
  contributes: { dueProvider: tasksDueProvider, records: taskRecords, searchSource: tasksSearchSource, quickAdd: taskQuickAdd },
};
