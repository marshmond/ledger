import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import ThemeToggle from './ThemeToggle';

/** Settings and housekeeping that do not belong to a daily workflow. */
export default function MorePage() {
  const lastBackup = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;
  const age = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup)) / 86400000) : null;
  return (
    <>
      <h1>More</h1>

      <div className="card">
        <strong>Appearance</strong>
        <p className="muted">Device follows your phone or computer setting. Light and Dark override it on this device.</p>
        <ThemeToggle />
      </div>

      <div className="card">
        <div className="row spread"><strong>Backup and restore</strong><Link to="/backup">Open →</Link></div>
        <p className="muted">
          Your data lives only in this browser. {age === null ? 'You have not backed it up yet.' : age === 0 ? 'Last backup: today.' : `Last backup: ${age} day${age === 1 ? '' : 's'} ago.`}
        </p>
      </div>

      <div className="card">
        <strong>Shortcuts</strong>
        <ul className="plain">
          <li><kbd>Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd> opens search from anywhere.</li>
          <li>The <strong>+</strong> button adds a transaction from any page, or jumps to logging a trade.</li>
        </ul>
      </div>

      <div className="card">
        <strong>About</strong>
        <p className="muted">
          Ledger runs entirely in your browser; nothing is sent anywhere except an optional price lookup with your own key. It is a planning aid, not tax, legal, or
          investment advice. Tax tables for each year are on the Income tab; the Roth planner’s rules are listed on its page.
        </p>
      </div>
    </>
  );
}
