import type { AnswerReader } from '../../core/answers';

/** R3.2: the Household Finances questions. Light on purpose (read at start-up); each reader loads only when its question is asked. */
export const HOUSEHOLD_ANSWERS: AnswerReader[] = [
  {
    id: 'household.payments',
    question: 'What payments are coming up?',
    title: 'Payments coming up',
    phrases: ['payments coming up', 'upcoming payments', 'payments due soon', 'payments expected soon', 'what payments are due', 'bills due soon', 'bills coming up', 'expected payments', 'payments next 30 days', 'upcoming bills'],
    defaultPeriod: 'the next 30 days',
    run: (ctx) => import('./answers').then((m) => m.paymentsAnswer(ctx)),
  },
  {
    id: 'household.yearAhead',
    question: 'What do we need to prepare for over the next year?',
    title: 'The year ahead',
    phrases: ['prepare for over the next year', 'prepare for next year', 'year ahead', 'things to prepare for', 'next twelve months', 'next 12 months', 'planning ahead for the year', 'upcoming commitments next year'],
    defaultPeriod: 'the next twelve months',
    run: (ctx) => import('./answers').then((m) => m.yearAheadAnswer(ctx)),
  },
];
