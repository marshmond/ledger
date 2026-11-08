import { Route, Routes } from 'react-router-dom';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import OverviewPage from './OverviewPage';
import { HOUSEHOLD_BASE } from './model';
import './household.css';

/** Household finances: one read-only page at /household. It reads Bills, Household Services and Home & Assets and writes nothing anywhere. */
export default function HouseholdModule() {
  return (
    <ModuleBase value={HOUSEHOLD_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <main className="main hh-main">
            <Routes>
              <Route index element={<OverviewPage />} />
              <Route path="*" element={<OverviewPage />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
