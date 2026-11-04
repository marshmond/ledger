import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ModuleBar from './core/ModuleBar';
import { allModules, lastModuleId, rememberModule } from './core/registry';
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

/** Old (pre-module) addresses such as #/budget forward to the new ones, keeping any ?search part. Unknown addresses open the last module. */
function Fallback() {
  const loc = useLocation();
  const mods = allModules();
  const to = legacyTarget(loc.pathname, loc.search, mods, lastModuleId());
  return <Navigate to={to} replace />;
}

export default function App() {
  return (
    <>
      <ModuleBar />
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
