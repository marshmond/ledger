import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import AmountEntryCard from './AmountEntryCard';
import { PageHeader } from '../ui/components';

/** Settings and housekeeping that do not belong to a daily workflow. */
export default function MorePage() {
  const lastBackup = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;
  const age = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup)) / 86400000) : null;
  return (
    <>
      <PageHeader title="More" description="Money-specific options, shortcuts, and about. Colors, light/dark and backups are in the app-wide Settings." />

      <div className="card">
        <div className="row spread"><strong>Appearance</strong><Link to="/settings/appearance">Open in Settings →</Link></div>
        <p className="muted">Colors and light/dark now live in the app-wide Settings, so they apply to every module. Your choice has not changed.</p>
      </div>

      <AmountEntryCard />

      <div className="card">
        <div className="row spread"><strong>Data &amp; Backups</strong><Link to="/settings/backup">Open in Settings →</Link></div>
        <p className="muted">
          Your data lives only in this browser. {age === null ? 'You have not backed it up yet.' : age === 0 ? 'Last backup: today.' : `Last backup: ${age} day${age === 1 ? '' : 's'} ago.`}
        </p>
      </div>

      <div className="card">
        <div className="row spread"><strong>Year in review</strong><Link to="/review">Open →</Link></div>
        <p className="muted">A one-page look back at the year: net worth, spending, saving, taxes, and highlights.</p>
      </div>

      <div className="card">
        <div className="row spread"><strong>If something happens to me</strong><Link to="/guide">Open →</Link></div>
        <p className="muted">A printable guide for your family: who to call, where papers are, and what accounts and insurance you have. No passwords.</p>
      </div>

      <div className="card">
        <div className="row spread"><strong>Tax package</strong><Link to="/taxpackage">Open →</Link></div>
        <p className="muted">Pay, RSU income, sales by lot, HSA activity, and mortgage interest for your tax preparer, to print or download.</p>
      </div>

      <div className="card">
        <strong>Shortcuts</strong>
        <ul className="plain">
          <li><kbd>Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd> opens search from anywhere.</li>
          <li><kbd>N</kbd> opens the Add box from anywhere (when you are not typing in a box).</li>
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
