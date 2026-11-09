import Main from '../../shell/Main';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import CalendarPage from './CalendarPage';

import { CALENDAR_BASE } from '../bases';
export { CALENDAR_BASE };

/** The Calendar module: one page (the views are switched inside it), wrapped the way every module is. */
export default function CalendarModule() {
  return (
    <ModuleBase value={CALENDAR_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <Main className="main cal-main">
            <CalendarPage />
          </Main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
