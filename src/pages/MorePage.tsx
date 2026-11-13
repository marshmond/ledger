import type { ReactNode } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import AmountEntryCard from './AmountEntryCard';
import { Banner, PageHeader } from '../ui/components';
import { BACKUP_STALE_DAYS } from './BackupPage';
import './analysis.css';
import './docs.css';

/** One destination: what it is called, what it gives you, and (optionally) its current state. The whole row is the link. */
function Dest({ to, title, children, status }: { to: string; title: string; children: ReactNode; status?: ReactNode }) {
  return (
    <li>
      <Link to={to} className="dc-dest">
        <span className="dc-dest-text">
          <strong>{title}</strong>
          <span className="muted">{children}</span>
          {status && <span className="dc-dest-status">{status}</span>}
        </span>
        <span className="dc-dest-go" aria-hidden="true">→</span>
      </Link>
    </li>
  );
}

function Group({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="an-card dc-group" aria-labelledby={`${id}-h`}>
      <h2 className="an-h2" id={`${id}-h`}>{title}</h2>
      {intro && <p className="an-note dc-group-intro">{intro}</p>}
      {children}
    </section>
  );
}

/** Everything that is not a daily workflow: reports and documents, the app-wide Settings, and help. Each row goes to a page that exists. */
export default function MorePage() {
  const lastBackup = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;
  const age = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup)) / 86400000) : null;
  const backupWords = age === null ? 'You have not backed it up yet.' : age === 0 ? 'Last backup: today.' : `Last backup: ${age} day${age === 1 ? '' : 's'} ago.`;
  const attention = age === null || age > BACKUP_STALE_DAYS;
  return (
    <>
      <PageHeader title="More" description="Reports and documents, tax preparation, the app-wide Settings, and help." />

      {attention && (
        <Banner level="warn" title={age === null ? 'Your data is not backed up yet' : `Your last backup was ${age} days ago`}
          action={<Link to="/settings/backup">Back up now →</Link>}>
          Your data lives only in this browser. A backup is the copy you control.
        </Banner>
      )}

      <div className="dc-more">
        <Group id="more-reports" title="Review and history" intro="Look back at a year from what you have recorded.">
          <ul className="dc-dests">
            <Dest to="/review" title="Year in review">A one-page look back at the year: net worth, spending, saving, taxes, and highlights. Print it or save it as a PDF.</Dest>
          </ul>
        </Group>

        <Group id="more-docs" title="Documents and tax preparation" intro="Printable pages for your family and for your tax preparer.">
          <ul className="dc-dests">
            <Dest to="/taxpackage" title="Tax package">Pay, RSU income, sales by lot, HSA activity, and mortgage interest for your tax preparer, to print or download.</Dest>
            <Dest to="/guide" title="If something happens to me">A printable guide for your family: who to call, where papers are, and what accounts and insurance you have. No passwords.</Dest>
          </ul>
        </Group>

        <Group id="more-settings" title="Settings, data and devices" intro="These apply to the whole app, not just Finance.">
          <ul className="dc-dests">
            <Dest to="/settings/backup" title="Data & Backups" status={<span className={attention ? 'dc-state dc-state--warn' : 'dc-state'}>{backupWords}</span>}>
              Your data lives only in this browser. Back it up, restore a backup, or turn on weekly encrypted copies.
            </Dest>
            <Dest to="/settings/sync" title="Sync devices">Keep your phone and computer in step through a private repository of yours.</Dest>
            <Dest to="/settings/appearance" title="Appearance">Colors and light/dark live in the app-wide Settings, so they apply to every module. Your choice has not changed.</Dest>
            <Dest to="/settings/general" title="General">Which module opens first, and which choices stay on this device.</Dest>
            <Dest to="/settings/calendar" title="Calendar settings">Week start, opening view, and how Finance items appear on the Calendar.</Dest>
          </ul>
        </Group>

        <section className="dc-money" aria-labelledby="more-money-h">
          <h2 className="an-h2" id="more-money-h">Money options</h2>
          <AmountEntryCard />
        </section>

        <Group id="more-help" title="Help and shortcuts">
          <h3 className="dc-h3">Shortcuts</h3>
          <ul className="plain dc-keys">
            <li><kbd>Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd> opens search from anywhere.</li>
            <li><kbd>N</kbd> opens the Add box from anywhere (when you are not typing in a box).</li>
            <li>The <strong>+</strong> button adds a transaction from any page, or jumps to logging a trade.</li>
          </ul>
          <h3 className="dc-h3">About</h3>
          <p className="muted dc-about">
            Ledger runs entirely in your browser; nothing is sent anywhere except an optional price lookup with your own key. It is a planning aid, not tax, legal, or
            investment advice. Tax tables for each year are on the Income tab; the Roth planner’s rules are listed on its page.
          </p>
        </Group>
      </div>
    </>
  );
}
