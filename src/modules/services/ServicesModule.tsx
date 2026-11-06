import { Route, Routes, useParams } from 'react-router-dom';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import ArrangementPage from './ArrangementPage';
import OverviewPage from './OverviewPage';
import ProviderPage from './ProviderPage';
import './services.css';

export const SERVICES_BASE = '/services';

const Arrangement = () => { const n = Number(useParams().id); return Number.isFinite(n) ? <ArrangementPage id={n} /> : <OverviewPage />; };
const Provider = () => { const n = Number(useParams().contactId); return Number.isFinite(n) ? <ProviderPage contactId={n} /> : <OverviewPage />; };

/** Household Services: the overview at /services, one page per arrangement at /services/a/<id>, one per provider at /services/providers/<contactId>. */
export default function ServicesModule() {
  return (
    <ModuleBase value={SERVICES_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <main className="main sv-main">
            <Routes>
              <Route index element={<OverviewPage />} />
              <Route path="a/:id" element={<Arrangement />} />
              <Route path="providers/:contactId" element={<Provider />} />
              <Route path="*" element={<OverviewPage />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
