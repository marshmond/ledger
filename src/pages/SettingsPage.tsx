import { Navigate, Route, Routes } from 'react-router-dom';
import { ModuleBase, NavLink } from '../core/router';
import { ToastProvider } from '../ui/Toast';
import { PageHeader } from '../ui/components';
import BackupReminder from '../shell/BackupReminder';
import BackupPage from './BackupPage';
import SyncPage from './SyncPage';
import CalendarSettingsCard from '../modules/calendar/CalendarSettings';
import GeneralSettings from './GeneralSettings';
import AppearanceCard from './AppearanceCard';

/**
 * Settings for the whole app (not for one module): which module opens first, how the app looks (colors, light/dark), data and backups, and syncing between devices.
 * Ledger's own sidebar still has a Sync page (the same page). Appearance and Data & Backups live ONLY here; Ledger's old addresses for them forward to this page.
 */
export default function SettingsPage() {
  return (
    <ToastProvider>
      <ModuleBase value="/settings">
        <div className="shell-main">
          <BackupReminder />
          <main className="main">
            <PageHeader title="Settings" description="Which module opens first, colors and light/dark, backup and restore, device sync and Calendar options for the whole app. Each module keeps its own options inside the module." />
            <nav className="sectiontabs settings-tabs" aria-label="Settings pages">
              <NavLink to="/general" end className={({ isActive }) => (isActive ? "active" : "")}>General</NavLink>
              <NavLink to="/appearance" end className={({ isActive }) => (isActive ? "active" : "")}>Appearance</NavLink>
              <NavLink to="/backup" end className={({ isActive }) => (isActive ? 'active' : '')}>Data &amp; Backups</NavLink>
              <NavLink to="/sync" end className={({ isActive }) => (isActive ? 'active' : '')}>Sync devices</NavLink>
              <NavLink to="/calendar" end className={({ isActive }) => (isActive ? "active" : "")}>Calendar</NavLink>
            </nav>
            <Routes>
              <Route path="general" element={<GeneralSettings />} />
              <Route path="appearance" element={<AppearanceCard />} />
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
