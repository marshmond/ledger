import { NavLink, Route, Routes } from 'react-router-dom';
import AccountsPage from './pages/AccountsPage';
import LedgerPage from './pages/LedgerPage';
import CategoriesPage from './pages/CategoriesPage';
import ImportPage from './pages/ImportPage';
import BackupPage from './pages/BackupPage';

export default function App() {
  return (
    <div className="app">
      <nav className="nav">
        <strong className="brand">Ledger</strong>
        <NavLink to="/" end>Accounts</NavLink>
        <NavLink to="/import">Import</NavLink>
        <NavLink to="/categories">Categories</NavLink>
        <NavLink to="/backup">Backup</NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<AccountsPage />} />
          <Route path="/account/:id" element={<LedgerPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/backup" element={<BackupPage />} />
        </Routes>
      </main>
    </div>
  );
}
