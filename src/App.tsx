import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ModuleBar from './core/ModuleBar';
import { useLiveQuery } from 'dexie-react-hooks';
import { allModules, getModule, lastModuleId, rememberModule } from './core/registry';
import { loadShellSettings, resolveLanding } from './core/shellSettings';
import GlobalFrame from './shell/GlobalFrame';
import { registerModules } from './modules';
import { legacyTarget } from './core/legacy';
import { lazyModule, preloadLazyModule } from './core/lazyModule';
import { ModuleLoadBoundary } from './shell/ModuleLoader';
import { TaskCreator } from './modules/tasks/QuickTask';
import { RouteAnnouncer, SkipLink } from './shell/SkipAndRoute';

registerModules();

/** Settings (backup, sync, appearance) loads on demand like a module's screens do. */
const SettingsPage = lazyModule(() => import('./pages/SettingsPage'));

/**
 * Called once at start-up, before the first screen is drawn: if the address already names a module that loads on demand (a bookmark, or a
 * reload while inside Bills), start downloading it now, in step with the database opening, rather than after the first draw. With no module
 * in the address, the module the app opens to (Settings > General) is started the same way, once that choice has been read.
 * Resolves when that file has arrived (or failed, which the screen reports itself); never rejects. The caller waits for it only briefly.
 */
export function preloadForAddress(hash: string): Promise<void> {
  const first = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  if (first === 'settings') return preloadLazyModule(SettingsPage);
  if (first) { const mod = getModule(first); return mod ? preloadLazyModule(mod.Component) : Promise.resolve(); }
  return loadShellSettings()
    .then((s) => {
      const id = resolveLanding(s.landing, lastModuleId(), allModules().map((m) => m.id));
      const mod = getModule(id);
      return mod ? preloadLazyModule(mod.Component) : undefined;
    })
    .catch(() => undefined);
}

/** Remembers the module you are in, so the app opens there next time. */
function Remember({ id }: { id: string }) {
  useEffect(() => rememberModule(id), [id]);
  return null;
}

/** Old (pre-module) addresses such as #/budget forward to the new ones, keeping any ?search part. Addresses with no module open the landing module (Settings > General). */
function Fallback() {
  const loc = useLocation();
  const mods = allModules();
  const settings = useLiveQuery(() => loadShellSettings(), []);
  if (!settings) return null; // a blink while the saved choice is read
  const landing = resolveLanding(settings.landing, lastModuleId(), mods.map((m) => m.id));
  return <Navigate to={legacyTarget(loc.pathname, loc.search, mods, landing)} replace />;
}

export default function App() {
  const loc = useLocation();
  return (
    <>
      <SkipLink />
      <RouteAnnouncer pathname={loc.pathname} />
      <ModuleBar />
      <GlobalFrame />
      <TaskCreator />
      <Routes>
        {allModules().map((m) => (
          <Route key={m.id} path={`/${m.id}/*`} element={<><Remember id={m.id} /><ModuleLoadBoundary key={m.id} name={m.name} component={m.Component} resetKey={loc.pathname}><m.Component /></ModuleLoadBoundary></>} />
        ))}
        <Route path="/settings/*" element={<ModuleLoadBoundary key="settings" name="Settings" component={SettingsPage} resetKey={loc.pathname}><SettingsPage /></ModuleLoadBoundary>} />
        <Route path="*" element={<Fallback />} />
      </Routes>
    </>
  );
}
