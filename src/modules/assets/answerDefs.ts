import type { AnswerReader } from '../../core/answers';

/** R3.2: the Home & Assets questions. Light on purpose (read at start-up); each reader loads only when its question is asked. */
export const ASSETS_ANSWERS: AnswerReader[] = [
  {
    id: 'assets.maintenanceSpend',
    question: 'How much have we spent on home maintenance this year?',
    title: 'Home maintenance spending',
    phrases: ['spent on home maintenance', 'home maintenance spending', 'maintenance spending this year', 'spent on maintenance', 'home maintenance costs', 'maintenance costs this year', 'spend on maintenance'],
    defaultPeriod: 'January 1 through today',
    run: (ctx) => import('./answers').then((m) => m.maintenanceSpendAnswer(ctx)),
  },
  {
    id: 'assets.maintenanceOverdue',
    question: 'What maintenance is overdue?',
    title: 'Overdue maintenance',
    phrases: ['maintenance overdue', 'overdue maintenance', 'overdue maintenance tasks', 'maintenance that is overdue', 'late maintenance'],
    defaultPeriod: 'as of today',
    run: (ctx) => import('./answers').then((m) => m.maintenanceOverdueAnswer(ctx)),
  },
  {
    id: 'assets.warrantiesExpiring',
    question: 'What warranties are expiring soon?',
    title: 'Warranties expiring soon',
    phrases: ['warranties expiring soon', 'expiring warranties', 'warranty expires soon', 'warranties expire', 'warranty expiration'],
    defaultPeriod: 'the next 90 days',
    run: (ctx) => import('./answers').then((m) => m.warrantiesExpiringAnswer(ctx)),
  },
];
