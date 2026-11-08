import type { ModuleDef } from '../../core/registry';
import { PROJECTS_TODAY_CARDS } from './todayCards';
import { projectsDueProvider } from './dueProvider';
import ProjectsModule, { PROJECTS_BASE } from './ProjectsModule';
import { projectQuickAdd } from './quickAddDef';
import { projectRecords } from './records';
import { projectsSearchSource } from './searchSource';
import { projectsTxnReferences } from './txnReferences';

/** Projects, module #4: a renovation, a trip or any big job, with a budget made of lines and the vendors involved. Money tracking comes in later steps. */
export const projectsModule: ModuleDef = {
  id: PROJECTS_BASE.slice(1),
  name: 'Projects',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>,
  Component: ProjectsModule,
  routePaths: ['/'],
  nav: [],
  contributes: { dueProvider: projectsDueProvider, todayCards: PROJECTS_TODAY_CARDS, records: projectRecords, searchSource: projectsSearchSource, quickAdd: projectQuickAdd, txnReferences: projectsTxnReferences },
};
