import Main from '../../shell/Main';
import { Route, Routes, useParams } from 'react-router-dom';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import MemberPage from './MemberPage';
import OverviewPage from './OverviewPage';
import { FAMILY_BASE } from './model';

const Member = () => { const n = Number(useParams().id); return Number.isInteger(n) ? <MemberPage id={n} /> : <OverviewPage />; };

/** Family: the overview at /family and one page per household member at /family/m/<id>. */
export default function FamilyModule() {
  return (
    <ModuleBase value={FAMILY_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <Main className="main fm-main">
            <Routes>
              <Route index element={<OverviewPage />} />
              <Route path="m/:id" element={<Member />} />
              <Route path="*" element={<OverviewPage />} />
            </Routes>
          </Main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
