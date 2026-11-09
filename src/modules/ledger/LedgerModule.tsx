import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { ModuleBase } from '../../core/router';
import Shell from '../../shell/Shell';
import HomePage from '../../pages/HomePage';
import MorePage from '../../pages/MorePage';
import NetWorthPage from '../../pages/NetWorthPage';
import RulesPage from '../../pages/RulesPage';
import ReportsPage from '../../pages/ReportsPage';
import ForecastPage from '../../pages/ForecastPage';
import PayoffPage from '../../pages/PayoffPage';
import ProtectionPage from '../../pages/ProtectionPage';
import GuidePage from '../../pages/GuidePage';
import ReviewPage from '../../pages/ReviewPage';
import GivingPage from '../../pages/GivingPage';
import AffordPage from '../../pages/AffordPage';
import CheckinPage from '../../pages/CheckinPage';
import SyncPage from '../../pages/SyncPage';
import TaxPackagePage from '../../pages/TaxPackagePage';
import TaxPlanPage from '../../pages/TaxPlanPage';
import AccountsPage from '../../pages/AccountsPage';
import LedgerPage from '../../pages/LedgerPage';
import CategoriesPage from '../../pages/CategoriesPage';
import ImportPage from '../../pages/ImportPage';
import BudgetPage from '../../pages/BudgetPage';
import ScheduledPage from '../../pages/ScheduledPage';
import IncomePage from '../../pages/IncomePage';
import PaycheckPage from '../../pages/PaycheckPage';
import RothPage from '../../pages/RothPage';
import DebtPage from '../../pages/DebtPage';
import TransactionsPage from '../../pages/TransactionsPage';
import InvestmentsPage from '../../pages/InvestmentsPage';
import ProjectionPage from '../../pages/ProjectionPage';
import RetirementPage from '../../pages/RetirementPage';
import GoalsPage from '../../pages/GoalsPage';

/** Every Ledger page, written without the `/ledger` prefix. The first entry is the home page. */
export const LEDGER_ROUTES: [string, ReactElement][] = [
  ['/', <HomePage />],
  ['/checkin', <CheckinPage />],
  ['/sync', <SyncPage />],
  ['/accounts', <AccountsPage />],
  ['/account/:id', <LedgerPage />],
  ['/transactions', <TransactionsPage />],
  ['/budget', <BudgetPage />],
  ['/income', <IncomePage />],
  ['/taxplan', <TaxPlanPage />],
  ['/afford', <AffordPage />],
  ['/giving', <GivingPage />],
  ['/paycheck', <PaycheckPage />],
  ['/networth', <NetWorthPage />],
  ['/investments', <InvestmentsPage />],
  ['/projections', <ProjectionPage />],
  ['/retirement', <RetirementPage />],
  ['/goals', <GoalsPage />],
  ['/protection', <ProtectionPage />],
  ['/roth', <RothPage />],
  ['/payoff', <PayoffPage />],
  ['/debt', <DebtPage />],
  ['/scheduled', <ScheduledPage />],
  ['/forecast', <ForecastPage />],
  ['/reports', <ReportsPage />],
  ['/rules', <RulesPage />],
  ['/import', <ImportPage />],
  ['/categories', <CategoriesPage />],
  // Backup and restore now live in the app-wide Settings (Data & Backups). The old address, still used by reminders and saved links, forwards there.
  ['/backup', <Navigate to="/settings/backup" replace />],
  ['/more', <MorePage />],
  ['/review', <ReviewPage />],
  ['/guide', <GuidePage />],
  ['/taxpackage', <TaxPackagePage />],
];
import { LEDGER_BASE } from '../bases';
export { LEDGER_BASE };

/** Ledger's whole experience: its own sidebar and tab bar (Shell) around its pages. */
export default function LedgerModule() {
  return (
    <ModuleBase value={LEDGER_BASE}>
      <Shell>
        <Routes>
          {LEDGER_ROUTES.map(([path, element]) => <Route key={path} path={path} element={element} />)}
          <Route path="*" element={LEDGER_ROUTES[0][1]} />
        </Routes>
      </Shell>
    </ModuleBase>
  );
}
