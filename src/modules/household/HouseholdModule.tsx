import Main from '../../shell/Main';
import { Route, Routes } from 'react-router-dom';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import OverviewPage from './OverviewPage';
import YearAheadPage from './YearAheadPage';
import { HOUSEHOLD_BASE } from './model';

/** Household finances: two read-only pages, the overview at /household and the Year Ahead view at /household/year-ahead. They read Bills, Household Services, Home & Assets, Finance and Projects and write nothing anywhere. */
export default function HouseholdModule() {
  return (
    <ModuleBase value={HOUSEHOLD_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <Main className="main hh-main">
            <Routes>
              <Route index element={<OverviewPage />} />
              <Route path="year-ahead" element={<YearAheadPage />} />
              <Route path="*" element={<OverviewPage />} />
            </Routes>
          </Main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
