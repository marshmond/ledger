import { Link } from '../core/router';
import { formatCents } from '../lib/money';
import type { NetWorthBar } from '../lib/homeCharts';
import { NetWorthChart } from '../ui/charts';
import { useMediaQuery } from '../ui/useMediaQuery';

/**
 * The top of Ledger Home (D12 refinement): one full-width panel that says where you stand. On the left, net worth (the figure Ledger already shows), its change since
 * the first saved month and, once two months are saved, the trend chart. On the right, this month's income, spending and "Ready to assign", then two slim bars.
 *
 * Every figure arrives already worked out by the page's own readers (loadNetWorth, changeOver, spendingSnapshot and the budget reader) and is only drawn here.
 * Nothing is added, subtracted or turned into a percentage. The two small "Assets" and "Owed" figures are the ones the page already worked out for its own
 * "What you own and owe" section (the sum of the positive cash, investment and property balances, and the amount owed on cards and loans); they are named for what they
 * are, and nothing here implies that they add up to the net worth shown above them. The two bars are the same drawing the page always had (each is that figure's share of the larger of the
 * two), and they carry their own names and values for assistive technology.
 *
 * One panel with two panes. On a computer they share one dark surface; on a phone (640px and narrower) the same markup is drawn as TWO cards, as in the approved mobile design:
 * the net-worth card (dark) and the month card (light in Signature light, the dark card color in Signature dark). It is one set of data and one stored section, never two.
 */
export interface HeroProps {
  netCents: number;
  change: { sinceCents: number; since: string } | null;
  nwBars: NetWorthBar[];
  monthName: string;
  incomeCents: number;
  spentCents: number;
  /** Null when there is no budget to read. */
  readyCents: number | null;
  /** The positive cash, investment and property balances, and the amount owed on cards and loans, as the page worked them out. Null when there is nothing to show. */
  assetsCents?: number | null;
  owedCents?: number | null;
}

export default function HomeHero({ netCents, change, nwBars, monthName, incomeCents, spentCents, readyCents, assetsCents = null, owedCents = null }: HeroProps) {
  const phone = useMediaQuery('(max-width: 640px)');
  const longPair = [assetsCents, owedCents].some((c) => c !== null && formatCents(c).length >= 12); // a seven-digit amount: the two boxes stack so the figure is never split
  const max = Math.max(incomeCents, spentCents, 1);
  const spentOver = spentCents > incomeCents && incomeCents > 0;
  const bar = (name: string, cents: number, cls: string) => {
    const ratio = cents / max;
    return (
      <div className="hh-barrow" key={name}>
        <span className="hh-barname">{name}</span>
        <div className={`hh-bar ${cls}`} role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))}><span style={{ width: `${Math.min(1, ratio) * 100}%` }} /></div>
      </div>
    );
  };
  return (
    <section className="card home-hero" aria-label="Where you stand">
      <div className="hh-nw">
        <div className="hh-head"><h2 className="hh-label">Net worth</h2><Link className="card-link" to="/networth">History</Link></div>
        <div className={`hero ${netCents < 0 ? 'neg' : ''}`}>{formatCents(netCents)}</div>
        {change && <div className="hh-sub">{change.sinceCents >= 0 ? 'Up' : 'Down'} <strong className={change.sinceCents >= 0 ? 'pos' : 'neg'}>{change.sinceCents >= 0 ? '+' : '-'}{formatCents(Math.abs(change.sinceCents))}</strong> since {change.since}</div>}
        {assetsCents !== null && owedCents !== null && (
          <dl className={`hh-pair${longPair ? ' hh-pair--stack' : ''}`}>
            <div className="hh-chip2"><dt>Assets (positive balances)</dt><dd>{formatCents(assetsCents)}</dd></div>
            <div className="hh-chip2"><dt>Owed (cards and loans)</dt><dd>{formatCents(owedCents)}</dd></div>
          </dl>
        )}
        {nwBars.length < 2
          ? <p className="hh-sub hh-trend-empty"><span className="hh-dots" aria-hidden="true" />A trend line appears once a couple of months of history have been saved.</p>
          : <div className="hh-chart"><NetWorthChart bars={nwBars} label="Assets and amounts owed by month, with net worth as a line" height={phone ? 176 : 240} /></div>}
      </div>
      <div className="hh-month">
        <div className="hh-head"><h2 className="hh-label">{monthName}</h2><Link className="card-link" to="/budget">Budget</Link></div>
        <dl className="hh-figs">
          <div className="hh-fig"><dt>Income</dt><dd>{formatCents(incomeCents)}</dd></div>
          <div className="hh-fig"><dt>Spent</dt><dd>{formatCents(spentCents)}{spentOver && <span className="bar-flag">More than income</span>}</dd></div>
          {readyCents !== null && <div className={`hh-fig hh-fig--ready${readyCents < 0 ? ' neg' : ''}`}><dt>Ready to assign</dt><dd>{formatCents(readyCents)}</dd></div>}
        </dl>
        <div className="hh-bars">{bar('Income', incomeCents, 'good')}{bar('Spent', spentCents, spentOver ? 'over' : '')}</div>
      </div>
    </section>
  );
}
