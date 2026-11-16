import type { AnswerReader } from '../../core/answers';

/** R3.2: the Projects question. This file is light (it is read at start-up); the reader itself loads only when the question is asked. */
export const PROJECTS_ANSWERS: AnswerReader[] = [
  {
    id: 'projects.overBudget',
    question: 'Which projects are over budget?',
    title: 'Projects over budget',
    phrases: ['projects over budget', 'over budget projects', 'projects that are over budget', 'budget exceeded projects', 'projects over their budget'],
    defaultPeriod: 'as of today',
    run: (ctx) => import('./answers').then((m) => m.overBudgetAnswer(ctx)),
  },
];
