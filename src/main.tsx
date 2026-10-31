import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { db, seedIfEmpty } from './db';
import { startAutoSync } from './lib/sync/auto';
import { startAutoBackup } from './lib/autoBackup';
import { installTracking } from './lib/sync/track';
import { ensureSetupCategory } from './lib/setupCategory';
import { updateAssetClasses } from './lib/assetClassUpdate';
import './styles.css';
import { startPwa } from './pwa';
import { initTheme } from './theme';

installTracking(db);
initTheme();
startPwa();

seedIfEmpty().then(() => ensureSetupCategory(db)).then(() => updateAssetClasses(db)).catch(() => undefined).finally(() => {
  startAutoSync();
  startAutoBackup();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  );
});
