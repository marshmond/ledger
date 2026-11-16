import type { AnswerReader } from '../../core/answers';

/** R3.2: the Household Services question. Light on purpose (read at start-up); the reader loads only when the question is asked. */
export const SERVICES_ANSWERS: AnswerReader[] = [
  {
    id: 'services.upcoming',
    question: 'What household services are coming up?',
    title: 'Household services coming up',
    phrases: ['household services coming up', 'services coming up', 'upcoming household services', 'upcoming services', 'service visits coming up', 'upcoming service visits', 'cleaner visits coming up'],
    defaultPeriod: 'the next 30 days',
    run: (ctx) => import('./answers').then((m) => m.servicesUpcomingAnswer(ctx)),
  },
];
