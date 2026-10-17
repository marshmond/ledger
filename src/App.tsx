import { Route, Routes } from 'react-router-dom';
import Shell from './shell/Shell';
import HomePage from './pages/HomePage';
import MorePage from './pages/MorePage';
import AccountsPage from './pages/AccountsPage';
import LedgerPage from './pages/LedgerPage';
import CategoriesPage from './pages/CategoriesPage';
import ImportPage from './pages/ImportPage';
import BackupPage from './pages/BackupPage';
import BudgetPage from './pages/BudgetPage';
import ScheduledPage from './pages/ScheduledPage';
import IncomePage from './pages/IncomePage';
import PaycheckPage from './pages/PaycheckPage';
import RothPage from './pages/RothPage';
import DebtPage from './pages/DebtPage';
import TransactionsPage from './pages/TransactionsPage';
import InvestmentsPage from './pages/InvestmentsPage';
import ProjectionPage from './pages/ProjectionPage';
import RetirementPage from './pages/RetirementPage';
import GoalsPage from './pages/GoalsPage';

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/account/:id" element={<LedgerPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/income" element={<IncomePage />} />
        <Route path="/paycheck" element={<PaycheckPage />} />
        <Route path="/investments" element={<InvestmentsPage />} />
        <Route path="/projections" element={<ProjectionPage />} />
        <Route path="/retirement" element={<RetirementPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/roth" element={<RothPage />} />
        <Route path="/debt" element={<DebtPage />} />
        <Route path="/scheduled" element={<ScheduledPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/backup" element={<BackupPage />} />
        <Route path="/more" element={<MorePage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </Shell>
  );
}
