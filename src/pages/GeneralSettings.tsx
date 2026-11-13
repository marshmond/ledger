import { useLiveQuery } from 'dexie-react-hooks';
import { allModules, lastModuleId } from '../core/registry';
import { loadShellSettings, resolveLanding, saveShellSettings } from '../core/shellSettings';
import { PageHeader } from '../ui/components';
import DevicePreferencesCard from './DevicePreferencesCard';
import { Pill, SettingsSection } from './SettingsParts';

/** App-wide options: for now, which module the app opens to. Saved in the settings table, so it follows you to your other devices. */
export default function GeneralSettings() {
  const s = useLiveQuery(() => loadShellSettings(), []);
  if (!s) return <p className="muted">Loading…</p>;
  const mods = allModules();
  const ids = mods.map((m) => m.id);
  const value = s.landing === 'last' || ids.includes(s.landing) ? s.landing : 'today';
  const nowName = mods.find((m) => m.id === resolveLanding(s.landing, lastModuleId(), ids))?.name;
  return (
    <>
      <PageHeader title="General" description="Which module the app opens to, and which choices follow you to your other devices." />
      <SettingsSection id="landing" title="When the app opens" badge={<Pill tone="info">Shared with your other devices</Pill>}>
        <div className="se-now" role="status">
          <span className="se-now-label">Ledger opens to</span>
          <strong className="se-now-value">{nowName}</strong>
        </div>
        <label className="f">Open to
          <select value={value} onChange={(e) => void saveShellSettings({ landing: e.target.value })}>
            {mods.map((m) => <option key={m.id} value={m.id}>{m.id === 'today' ? 'Today (recommended)' : m.name}</option>)}
            <option value="last">The module I used last</option>
          </select>
        </label>
        <p className="muted small">
          Applies when you open the app with no page in the address, or follow an unknown address. Right now that is{' '}
          <strong>{nowName}</strong>.
          This choice is shared with your other devices.
        </p>
        <ul className="se-points">
          <li><strong>A named module</strong> is where the app starts every time.</li>
          <li><strong>The module I used last</strong> reopens whichever module you were in when you left.</li>
          <li>A link to a particular page still opens that page; this choice only decides the starting point.</li>
        </ul>
      </SettingsSection>
      <DevicePreferencesCard />
    </>
  );
}
