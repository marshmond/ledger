import { PREF_GROUP_TITLES, PREF_ITEMS, groupOf, type PrefGroup } from '../lib/devicePrefs';

const ORDER: PrefGroup[] = ['synced', 'deviceSaved', 'deviceOnly', 'secret'];

/**
 * One plain explanation of which choices follow you to other devices and which stay on this one (and which are in a backup file).
 * The list comes from `lib/devicePrefs.ts`, which a test checks against the code that saves each choice.
 */
export default function DevicePreferencesCard() {
  return (
    <section className="card" aria-labelledby="device-prefs-title">
      <div className="card-head"><h2 id="device-prefs-title" className="card-title" style={{ margin: 0 }}>What follows you to other devices, and what does not</h2></div>
      <p className="muted small">Ledger keeps everything in this browser. Sync copies your records to your other devices, but some choices are meant to differ from one device to the next (a phone may hide amounts and show a different Today layout than your computer).</p>
      {ORDER.map((g) => {
        const items = PREF_ITEMS.filter((i) => groupOf(i) === g);
        return (
          <div key={g} style={{ marginTop: 12 }}>
            <h3 style={{ margin: 0 }}>{PREF_GROUP_TITLES[g].title}</h3>
            <p className="muted small" style={{ margin: '2px 0 4px' }}>{PREF_GROUP_TITLES[g].blurb}</p>
            <ul className="plain" style={{ margin: 0 }}>{items.map((i) => <li key={i.label}>{i.label}</li>)}</ul>
          </div>
        );
      })}
    </section>
  );
}
