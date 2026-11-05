import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToday } from '../../ui/useToday';

export const TODAY_BASE = '/today';

const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

/** Today: one screen that merges every module. In this step it is only the frame; the cards arrive in the next part. */
export default function TodayModule() {
  const today = useToday();
  return (
    <ModuleBase value={TODAY_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <main className="main cal-main">
            <PageHeader title="Today" description={longDate(today)} />
            <EmptyState title="Today is still being built">This screen will gather your events, tasks, bills and alerts in one place. For now it is an empty frame; Calendar, Tasks and Ledger work as before.</EmptyState>
          </main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
