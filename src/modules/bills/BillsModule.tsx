import Main from '../../shell/Main';
import { Route, Routes, useParams } from 'react-router-dom';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import ListPage from './ListPage';
import ObligationPage from './ObligationPage';
import ReviewPage from './ReviewPage';
import UpcomingPage from './UpcomingPage';
import OverviewPage from './OverviewPage';
import { BILLS_BASE } from './paths';

const Obligation = () => { const n = Number(useParams().id); return Number.isFinite(n) ? <ObligationPage id={n} /> : <OverviewPage />; };

/** Bills & Subscriptions: the overview at /bills, all bills at /bills/list, upcoming at /bills/upcoming, needs review at /bills/review, one page per bill at /bills/o/<id>. */
export default function BillsModule() {
  return (
    <ModuleBase value={BILLS_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <Main className="main bl-main">
            <Routes>
              <Route index element={<OverviewPage />} />
              <Route path="list" element={<ListPage />} />
              <Route path="upcoming" element={<UpcomingPage />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="o/:id" element={<Obligation />} />
              <Route path="*" element={<OverviewPage />} />
            </Routes>
          </Main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
