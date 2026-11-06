import { Route, Routes } from 'react-router-dom';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import AssetPage from './AssetPage';
import AssetsPage from './AssetsPage';
import OverviewPage from './OverviewPage';
import './assets.css';
import './h3.css';

export const ASSETS_BASE = '/assets';

/** Home & Assets: the list at /assets and one page per asset at /assets/<id>, wrapped the way every module is. */
export default function AssetsModule() {
  return (
    <ModuleBase value={ASSETS_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <main className="main as-main">
            <Routes>
              <Route index element={<OverviewPage />} />
              <Route path="list" element={<AssetsPage />} />
              <Route path=":id" element={<AssetPage />} />
              <Route path="*" element={<OverviewPage />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
