import { NavLink, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { dueInstances } from './lib/schedule';
import { todayISO } from './lib/money';
import AccountsPage from './pages/AccountsPage';
import LedgerPage from './pages/LedgerPage';
import CategoriesPage from './pages/CategoriesPage';
import ImportPage from './pages/ImportPage';
import BackupPage from './pages/BackupPage';
import BudgetPage from './pages/BudgetPage';
import ScheduledPage from './pages/ScheduledPage';

export default function App() {
  const dueCount = useLiveQuery(async () => (await dueInstances(db, todayISO(), 7)).length, []) ?? 0;
  return (
    <div className="app">
      <nav className="nav">
        <strong className="brand">Ledger</strong>
        <NavLink to="/" end>Accounts</NavLink>
        <NavLink to="/budget">Budget</NavLink>
        <NavLink to="/scheduled">Scheduled{dueCount > 0 && <span className="count">{dueCount}</span>}</NavLink>
        <NavLink to="/import">Import</NavLink>
        <NavLink to="/categories">Categories</NavLink>
        <NavLink to="/backup">Backup</NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<AccountsPage />} />
          <Route path="/account/:id" element={<LedgerPage />} />
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/scheduled" element={<ScheduledPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/backup" element={<BackupPage />} />
        </Routes>
      </main>
    </div>
  );
}
