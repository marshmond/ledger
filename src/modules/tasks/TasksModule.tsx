import Main from '../../shell/Main';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import TasksPage from './TasksPage';

import { TASKS_BASE } from '../bases';
export { TASKS_BASE };

/** The Tasks module: one page (the views are switched inside it), wrapped the way every module is. */
export default function TasksModule() {
  return (
    <ModuleBase value={TASKS_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <Main className="main cal-main">
            <TasksPage />
          </Main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
