import type { ReactNode } from 'react';
import { Link } from '../../core/router';
import { DateTile } from '../../ui/DateTile';
import { type Money } from './BillsParts';
import { obligationRoute } from './paths';
import { amountLine, dueLine, PeriodLabel } from './PeriodParts';
import { groupByDate } from './presentation';
import type { UpcomingEntry } from './readModel';

/**
 * D15. Expected dates grouped under a date tile. Every row keeps what it always showed: the bill, whether the date is a recorded due date or comes from the
 * schedule, the amount in words (expected, billed or an estimate, never $0 for an unknown amount), and the period's label with the line that says what Ledger
 * actually knows. A row is an EXPECTED date, never a payment; the tile is only a date. `past` marks the "past its date, not confirmed" group.
 */
export function DueList({ entries, today, money, past = false, detail, label = 'Expected dates' }: { entries: UpcomingEntry[]; today: string; money: Money; past?: boolean; detail?: (e: UpcomingEntry) => ReactNode; label?: string }) {
  return (
    <ol className="plain bl-days" aria-label={label}>
      {groupByDate(entries, (e) => e.period.timing.date!).map((g) => (
        <li key={g.date} className="bl-day">
          <DateTile iso={g.date} today={today} overdue={past} />
          <ul className="plain bl-day-rows">
            {g.entries.map((e) => (
              <li key={`${e.ob.id}-${e.period.slot}`} className="bl-due" data-testid="upcoming-row">
                <div className="bl-due-main">
                  <Link to={obligationRoute(e.ob.id)}><strong>{e.ob.data.title}</strong></Link>
                  <span className="muted small">{dueLine(e.period)}</span>
                  <span className="small bl-due-amt">{amountLine(e.period, money)}</span>
                  {detail?.(e)}
                </div>
                <div className="bl-due-status"><PeriodLabel p={e.period} money={money} /></div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
