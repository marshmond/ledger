import { PREF_GROUP_TITLES, PREF_ITEMS, groupOf, type PrefGroup } from '../lib/devicePrefs';
import { Pill, SettingsSection, SubHeading, type PillTone } from './SettingsParts';

const ORDER: PrefGroup[] = ['synced', 'deviceSaved', 'deviceOnly', 'secret'];

/** A word for each group, so the difference is readable without color. */
const TAG: Record<PrefGroup, { word: string; tone: PillTone }> = {
  synced: { word: 'Synced and backed up', tone: 'ok' },
  deviceSaved: { word: 'This device, in backups', tone: 'info' },
  deviceOnly: { word: 'This device only', tone: 'warn' },
  secret: { word: 'Never copied', tone: 'quiet' },
};

/**
 * One plain explanation of which choices follow you to other devices and which stay on this one (and which are in a backup file).
 * The list comes from `lib/devicePrefs.ts`, which a test checks against the code that saves each choice.
 */
export default function DevicePreferencesCard() {
  return (
    <SettingsSection id="device-prefs" titleId="device-prefs-title" title="What follows you to other devices, and what does not"
      intro="Ledger keeps everything in this browser. Sync copies your records to your other devices, but some choices are meant to differ from one device to the next (a phone may hide amounts and show a different Today layout than your computer).">
      <div className="se-prefs">
        {ORDER.map((g) => {
          const items = PREF_ITEMS.filter((i) => groupOf(i) === g);
          return (
            <div key={g} className="se-pref">
              <Pill tone={TAG[g].tone}>{TAG[g].word}</Pill>
              <SubHeading>{PREF_GROUP_TITLES[g].title}</SubHeading>
              <p className="muted small se-pref-blurb">{PREF_GROUP_TITLES[g].blurb}</p>
              <ul className="plain se-pref-list">{items.map((i) => <li key={i.label}>{i.label}</li>)}</ul>
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
}
