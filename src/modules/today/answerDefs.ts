import { lazy } from 'react';
import type { AnswerReader } from '../../core/answers';

/**
 * R3.2: the two Today questions. Both sources exist only as React hooks (R1.1 Needs you reads every module's live attention; R1.2 This Week reads the review's own parts), so each
 * reader is a lazily loaded component (`Live`) that calls that hook and hands the state to the answer screen. Nothing loads until the question is asked.
 */
export const TODAY_ANSWERS: AnswerReader[] = [
  {
    id: 'today.needs',
    question: 'What needs my attention?',
    title: 'What needs attention',
    phrases: ['what needs my attention', 'needs attention', 'needs you', 'what needs me', 'what needs doing', 'what needs my attention today', 'items needing attention', 'attention needed'],
    defaultPeriod: 'as of today',
    Live: lazy(() => import('./answersLive').then((m) => ({ default: m.NeedsAnswerLive }))),
  },
  {
    id: 'today.week',
    question: 'What is happening this week?',
    title: 'This week',
    phrases: ['happening this week', 'week ahead', 'going on this week', 'plans this week', 'events this week', 'schedule this week', 'week summary', 'coming up this week'],
    defaultPeriod: 'the next 7 days',
    Live: lazy(() => import('./answersLive').then((m) => ({ default: m.WeekAnswerLive }))),
  },
];
