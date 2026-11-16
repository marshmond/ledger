import type { AnswerReader } from '../../core/answers';

/** R3.2: the Bills question. Light on purpose (read at start-up); the reader loads only when the question is asked. */
export const BILLS_ANSWERS: AnswerReader[] = [
  {
    id: 'bills.priceIncreases',
    question: 'Which bills have increased recently?',
    title: 'Bills that went up',
    phrases: ['bills increased recently', 'bills that increased', 'bills that went up', 'bill price increases', 'subscription price increases', 'subscriptions increased', 'which bills went up', 'price increases bills', 'bills price went up'],
    defaultPeriod: 'the last 90 days',
    run: (ctx) => import('./answers').then((m) => m.priceIncreaseAnswer(ctx)),
  },
];
