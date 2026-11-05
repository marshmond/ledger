import type { ModuleDef } from '../../core/registry';
import { tasksDueProvider } from './dueProvider';
import { tasksSearchSource } from './searchSource';
import TasksModule, { TASKS_BASE } from './TasksModule';

/** Tasks, module #3: to-dos you own. Dated ones show on the Calendar's Tasks layer (computed, never copied). */
export const tasksModule: ModuleDef = {
  id: TASKS_BASE.slice(1),
  name: 'Tasks',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>,
  Component: TasksModule,
  routePaths: ['/'],
  nav: [],
  contributes: { dueProvider: tasksDueProvider, searchSource: tasksSearchSource },
};
