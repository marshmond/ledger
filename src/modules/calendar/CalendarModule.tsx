import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import CalendarPage from './CalendarPage';
import './calendar.css';

export const CALENDAR_BASE = '/calendar';

/** The Calendar module: one page (the views are switched inside it), wrapped the way every module is. */
export default function CalendarModule() {
  return (
    <ModuleBase value={CALENDAR_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <main className="main cal-main">
            <CalendarPage />
          </main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
