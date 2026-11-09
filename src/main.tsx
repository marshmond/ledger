import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App, { preloadForAddress } from './App';
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

// The module named in the address downloads while the database opens. The first draw waits for it for a moment only (so a quick download is
// ready and nothing flashes a loading state); on a slow connection the page draws anyway and shows its own loading message.
const moduleReady = preloadForAddress(window.location.hash);
const atMost = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
seedIfEmpty().then(() => ensureSetupCategory(db)).then(() => updateAssetClasses(db)).catch(() => undefined).then(() => atMost(moduleReady, 400)).finally(() => {
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
