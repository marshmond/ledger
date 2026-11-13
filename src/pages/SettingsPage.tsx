import Main from '../shell/Main';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ModuleBase, NavLink } from '../core/router';
import { ToastProvider } from '../ui/Toast';
import { PageHeader, PageHeadingLevel, useEdgeFade } from '../ui/components';
import BackupReminder from '../shell/BackupReminder';
import BackupPage from './BackupPage';
import SyncPage from './SyncPage';
import CalendarSettingsCard from '../modules/calendar/CalendarSettings';
import GeneralSettings from './GeneralSettings';
import AppearanceCard from './AppearanceCard';
import './settings.css';

/** The five Settings pages, in order. The address is under the Settings module; the hint is what the page is for. */
const TABS = [
  { to: '/general', label: 'General', hint: 'Which module opens first, and what stays on this device' },
  { to: '/appearance', label: 'Appearance', hint: 'Light or dark, color palettes and saved themes' },
  { to: '/backup', label: 'Data & Backups', hint: 'Back up, restore and automatic weekly copies' },
  { to: '/sync', label: 'Sync devices', hint: 'Keep your phone and computer in step' },
  { to: '/calendar', label: 'Calendar', hint: 'Week start, opening view and Finance items' },
] as const;

/**
 * Settings for the whole app (not for one module): which module opens first, how the app looks (colors, light/dark), data and backups, and syncing between devices.
 * Ledger's own menu still has a Sync page (the same page). Appearance and Data & Backups live ONLY here; Ledger's old addresses for them forward to this page.
 * On a computer the five pages are a list beside the page; on a phone they are a row of tabs that scrolls sideways (every page stays one tap away).
 */
export default function SettingsPage() {
  const fade = useEdgeFade<HTMLElement>();
  return (
    <ToastProvider>
      <ModuleBase value="/settings">
        <div className="shell-main">
          <BackupReminder />
          <Main className="main">
            <PageHeader title="Settings" description="Which module opens first, colors and light/dark, backup and restore, device sync and Calendar options for the whole app. Each module keeps its own options inside the module." />
            <div className="se-layout">
              <nav className={`settings-tabs se-nav ${fade.className}`} aria-label="Settings pages" ref={fade.ref}>
                {TABS.map((t) => (
                  <NavLink key={t.to} to={t.to} end className={({ isActive }) => (isActive ? 'active' : '')}>
                    <span className="se-nav-label">{t.label}</span>
                    <span className="se-nav-hint">{t.hint}</span>
                  </NavLink>
                ))}
              </nav>
              <div className="se-content">
                <PageHeadingLevel.Provider value={2}>
                  <Routes>
                    <Route path="general" element={<GeneralSettings />} />
                    <Route path="appearance" element={<AppearanceCard />} />
                    <Route path="backup" element={<BackupPage />} />
                    <Route path="sync" element={<SyncPage />} />
                    <Route path="calendar" element={<CalendarSettingsCard />} />
                    <Route path="*" element={<Navigate to="/settings/backup" replace />} />
                  </Routes>
                </PageHeadingLevel.Provider>
              </div>
            </div>
          </Main>
        </div>
      </ModuleBase>
    </ToastProvider>
  );
}
