import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import AppearanceCard from './AppearanceCard';
import AmountEntryCard from './AmountEntryCard';
import { PageHeader } from '../ui/components';

/** Settings and housekeeping that do not belong to a daily workflow. */
export default function MorePage() {
  const lastBackup = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;
  const age = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup)) / 86400000) : null;
  return (
    <>
      <PageHeader title="More" description="Appearance, shortcuts, and about." />

      <AppearanceCard />

      <AmountEntryCard />

      <div className="card">
        <div className="row spread"><strong>Backup and restore</strong><Link to="/backup">Open →</Link></div>
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
