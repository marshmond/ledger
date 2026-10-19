import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { db, seedIfEmpty } from './db';
import { startAutoSync } from './lib/sync/auto';
import { installTracking } from './lib/sync/track';
import { ensureSetupCategory } from './lib/setupCategory';
import './styles.css';
import { startPwa } from './pwa';
import { initTheme } from './theme';

installTracking(db);
initTheme();
startPwa();

seedIfEmpty().then(() => ensureSetupCategory(db)).catch(() => undefined).finally(() => {
  startAutoSync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  );
});
