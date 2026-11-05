import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ModuleBar from './core/ModuleBar';
import { useLiveQuery } from 'dexie-react-hooks';
import { allModules, lastModuleId, rememberModule } from './core/registry';
import { loadShellSettings, resolveLanding } from './core/shellSettings';
import GlobalFrame from './shell/GlobalFrame';
import { registerModules } from './modules';
import { legacyTarget } from './core/legacy';
import SettingsPage from './pages/SettingsPage';
import { TaskCreator } from './modules/tasks/QuickTask';

registerModules();

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
  return (
    <>
      <ModuleBar />
      <GlobalFrame />
      <TaskCreator />
      <Routes>
        {allModules().map((m) => (
          <Route key={m.id} path={`/${m.id}/*`} element={<><Remember id={m.id} /><m.Component /></>} />
        ))}
        <Route path="/settings/*" element={<SettingsPage />} />
        <Route path="*" element={<Fallback />} />
      </Routes>
    </>
  );
}
