import { useLiveQuery } from 'dexie-react-hooks';
import { allModules, lastModuleId } from '../core/registry';
import { loadShellSettings, resolveLanding, saveShellSettings } from '../core/shellSettings';

/** App-wide options: for now, which module the app opens to. Saved in the settings table, so it follows you to your other devices. */
export default function GeneralSettings() {
  const s = useLiveQuery(() => loadShellSettings(), []);
  if (!s) return <p className="muted">Loading…</p>;
  const mods = allModules();
  const ids = mods.map((m) => m.id);
  const value = s.landing === 'last' || ids.includes(s.landing) ? s.landing : 'today';
  return (
    <div className="card">
      <div className="card-head"><strong>When the app opens</strong></div>
      <label className="f">Open to
        <select value={value} onChange={(e) => void saveShellSettings({ landing: e.target.value })}>
          {mods.map((m) => <option key={m.id} value={m.id}>{m.id === 'today' ? 'Today (recommended)' : m.name}</option>)}
          <option value="last">The module I used last</option>
        </select>
      </label>
      <p className="muted small">
        Applies when you open the app with no page in the address, or follow an unknown address. Right now that is{' '}
        <strong>{mods.find((m) => m.id === resolveLanding(s.landing, lastModuleId(), ids))?.name}</strong>.
        This choice is shared with your other devices.
      </p>
    </div>
  );
}
