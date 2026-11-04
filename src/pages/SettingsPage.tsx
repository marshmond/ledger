import { Navigate, Route, Routes } from 'react-router-dom';
import { ModuleBase, NavLink } from '../core/router';
import { ToastProvider } from '../ui/Toast';
import { PageHeader } from '../ui/components';
import BackupReminder from '../shell/BackupReminder';
import BackupPage from './BackupPage';
import SyncPage from './SyncPage';
import CalendarSettingsCard from '../modules/calendar/CalendarSettings';

/**
 * Settings for the whole app (not for one module): backup, export and import, and syncing between devices.
 * Ledger keeps its own copies of these two pages in its sidebar; they are the same pages, so nothing differs.
 */
export default function SettingsPage() {
  return (
    <ToastProvider>
      <ModuleBase value="/settings">
        <div className="shell-main">
          <BackupReminder />
          <main className="main">
            <PageHeader title="Settings" description="Backup, restore, device sync and Calendar options for the whole app. Each module keeps its own options inside the module." />
            <nav className="sectiontabs settings-tabs" aria-label="Settings pages">
              <NavLink to="/backup" end className={({ isActive }) => (isActive ? 'active' : '')}>Backup and restore</NavLink>
              <NavLink to="/sync" end className={({ isActive }) => (isActive ? 'active' : '')}>Sync devices</NavLink>
              <NavLink to="/calendar" end className={({ isActive }) => (isActive ? "active" : "")}>Calendar</NavLink>
            </nav>
            <Routes>
              <Route path="backup" element={<BackupPage />} />
              <Route path="sync" element={<SyncPage />} />
              <Route path="calendar" element={<CalendarSettingsCard />} />
              <Route path="*" element={<Navigate to="/settings/backup" replace />} />
            </Routes>
          </main>
        </div>
      </ModuleBase>
    </ToastProvider>
  );
}
