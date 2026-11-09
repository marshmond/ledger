import type { ModuleDef } from '../../core/registry';
import { CALENDAR_BASE } from '../bases';
import { lazyModule } from '../../core/lazyModule';
import { eventQuickAdd } from './quickAddDef';
import { eventRecords } from './records';
import { calendarSearchSource } from './searchSource';

/** Calendar, module #2: your own events, plus dated things other modules work out (shown as read-only layers). */
export const calendarModule: ModuleDef = {
  id: CALENDAR_BASE.slice(1),
  name: 'Calendar',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
  Component: lazyModule(() => import('./CalendarModule')),
  routePaths: ['/'],
  nav: [],
  contributes: { records: eventRecords, searchSource: calendarSearchSource, quickAdd: eventQuickAdd },
};
