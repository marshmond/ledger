import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCents, todayISO } from '../lib/money';
import { netForTax } from '../lib/lots';
import { estimatedDueDates, withHarvest } from '../lib/taxPlan';
import Collapsible from './Collapsible';
import { useTaxPlanData } from './useTaxPlanData';

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Year-end tax planning: bracket room, withholding vs. what you will owe, tax-loss harvesting, and a checklist. */
export default function TaxPlanPage() {
  const today = todayISO();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { people, profiles, settings, model, tables, hh, room, wp, realized, candidates, gainLots, checklist, build } = useTaxPlanData(year);

  const chosen = candidates.filter((c) => picked.has(c.lot.id!));
  const afterRealized = withHarvest(realized, chosen);
  const afterGains = netForTax(afterRealized);
  const afterHh = useMemo(() => (chosen.length ? build(year, afterGains).household : null), [chosen.length, afterGains, year, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalTax = (h: typeof hh) => (h ? h.federal.totalLiability + h.ma.totalLiability : 0);
  const saved = hh && afterHh ? totalTax(hh) - totalTax(afterHh) : 0;
  void settings;

  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? 'Person';
  const years = [...new Set([...profiles.map((p) => p.year), thisYear])].sort();
  const totalFica = hh ? hh.ficaTotal + hh.pfmlTotal : 0;
  const totalAll = hh ? hh.federal.totalLiability + hh.ma.totalLiability + totalFica : 0;
  const gross = model.years.reduce((a, y) => a + y.totals.gross, 0);

  return (
    <>
      <div className="row spread">
        <h1>Tax planning</h1>
        <label className="row">Year<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      </div>
      <p className="muted">
        A look at where your {year} taxes are headed and what you can still do about them. It uses the setup on the <Link to="/income">Income</Link> tab, your sales on the{' '}
        <Link to="/investments">Investments</Link> tab, and HSA withdrawals. It is a planning estimate, not tax advice.
      </p>

      {!tables && <div className="card rta-neg"><strong className="neg">No tax tables for {year}.</strong> Add them on the Income tab first.</div>}
      {tables && !hh && <p className="warn">Set up income for {year} on the Income tab to see the plan.</p>}

      {hh && room && wp && (
        <>
          <div className="viz">
            <div className="muted">Projected taxes for {year}</div>
            <div className="hero">{formatCents(totalAll)}</div>
            <div className="tiles">
              <div className="tile"><div className="muted">Federal income tax</div><div className="v">{formatCents(hh.federal.totalLiability)}</div></div>
              <div className="tile"><div className="muted">Massachusetts</div><div className="v">{formatCents(hh.ma.totalLiability)}</div></div>
              <div className="tile"><div className="muted">Social Security, Medicare, PFML</div><div className="v">{formatCents(totalFica)}</div></div>
              <div className="tile"><div className="muted">Share of gross pay</div><div className="v">{gross > 0 ? `${((totalAll / gross) * 100).toFixed(1)}%` : '—'}</div></div>
              <div className="tile"><div className="muted">Top federal bracket</div><div className="v">{pct(room.rate)}</div></div>
            </div>
          </div>

          <Collapsible id="taxplan.room" title="Bracket room">
            <p>
              Your last dollar of ordinary income is taxed at <strong>{pct(room.rate)}</strong>.{' '}
              {room.roomCents !== null
                ? <>About <strong>{formatCents(room.roomCents)}</strong> more fits before the {pct(room.nextRate ?? 0)} bracket starts. That is the room for a Roth conversion, extra income, or selling a gain taxed as ordinary income.</>
                : 'You are in the top bracket.'}
            </p>
            <table><tbody>
              <tr><td>Taxable income</td><td className="num">{formatCents(hh.federal.taxableIncome)}</td></tr>
              <tr><td>Ordinary income part (taxed by bracket)</td><td className="num">{formatCents(room.ordinaryTaxable)}</td></tr>
              {hh.federal.longTermGains > 0 && <tr><td>Long-term gains (taxed at 0/15/20%)</td><td className="num">{formatCents(hh.federal.longTermGains)}</td></tr>}
              <tr><td>Room left in this bracket</td><td className="num">{room.roomCents === null ? '—' : formatCents(room.roomCents)}</td></tr>
              <tr><td>Room left in the 0% capital-gains band</td><td className="num">{formatCents(room.zeroGainRoomCents)}</td></tr>
              {hh.federal.niit > 0 && <tr><td>Net investment income tax (3.8%)</td><td className="num">{formatCents(hh.federal.niit)}</td></tr>}
            </tbody></table>
            <p className="muted">Try a Roth conversion with this room in the <Link to="/roth">Roth planner</Link>.</p>
          </Collapsible>

          <Collapsible id="taxplan.withholding" title="Withholding and estimated payments">
            <div className="grid">
              <div className="card">
                <strong>Federal</strong>
                <table><tbody>
                  <tr><td>Tax for the year</td><td className="num">{formatCents(wp.federal.owed)}</td></tr>
                  <tr><td>Withheld so far</td><td className="num">{formatCents(wp.federal.withheldToDate)}</td></tr>
                  <tr><td>Withheld by year end (projected)</td><td className="num">{formatCents(wp.federal.projected)}</td></tr>
                  <tr><td><strong>{wp.federal.balance >= 0 ? 'Expected refund' : 'Expected to owe'}</strong></td><td className={`num ${wp.federal.balance >= 0 ? 'pos' : 'neg'}`}><strong>{formatCents(Math.abs(wp.federal.balance))}</strong></td></tr>
                </tbody></table>
              </div>
              <div className="card">
                <strong>Massachusetts</strong>
                <table><tbody>
                  <tr><td>Tax for the year</td><td className="num">{formatCents(wp.ma.owed)}</td></tr>
                  <tr><td>Withheld so far</td><td className="num">{formatCents(wp.ma.withheldToDate)}</td></tr>
                  <tr><td>Withheld by year end (projected)</td><td className="num">{formatCents(wp.ma.projected)}</td></tr>
                  <tr><td><strong>{wp.ma.balance >= 0 ? 'Expected refund' : 'Expected to owe'}</strong></td><td className={`num ${wp.ma.balance >= 0 ? 'pos' : 'neg'}`}><strong>{formatCents(Math.abs(wp.ma.balance))}</strong></td></tr>
                </tbody></table>
              </div>
            </div>
            {wp.safeHarbor && (
              <p className={wp.safeHarbor.met ? 'ok' : 'warn'}>
                {wp.safeHarbor.met
                  ? `Withholding covers the safe-harbor amount (${formatCents(wp.safeHarbor.requiredCents)}, ${wp.safeHarbor.basis}), so an underpayment penalty is unlikely even if you owe at filing.`
                  : `Withholding is below the safe-harbor amount (${formatCents(wp.safeHarbor.requiredCents)}, ${wp.safeHarbor.basis}). You could owe an underpayment penalty unless you add withholding or pay estimates.`}
              </p>
            )}
            {wp.federal.balance < 0 && (
              <div className="card">
                <strong>To close the {formatCents(wp.estimatedPaymentCents)} federal gap</strong>
                <ul>
                  {wp.extraPerCheck.map((e) => <li key={e.personId}>{personName(e.personId)}: add <strong>{formatCents(e.cents)}</strong> of extra federal withholding to each of the {wp.remaining.find((r) => r.personId === e.personId)?.checks} remaining paychecks (W-4 step 4(c)).</li>)}
                  <li>Or make an estimated payment of {formatCents(wp.estimatedPaymentCents)} before the next due date: {estimatedDueDates(year).filter((d) => d >= today).slice(0, 2).join(' or ') || 'the January deadline'}.</li>
                </ul>
                <p className="muted">Withholding counts as paid evenly through the year no matter when it comes out, so late-year extra withholding can still avoid a penalty.</p>
              </div>
            )}
            {wp.federal.balance >= 0 && <p className="muted">You are on track for a refund, so no extra withholding is needed. To keep more of each paycheck, you could lower withholding slightly, keeping the safe-harbor amount above in mind.</p>}
          </Collapsible>

          <Collapsible id="taxplan.harvest" title="Tax-loss harvesting">
            <p className="muted">
              Selling a lot that is worth less than you paid creates a loss that offsets gains, and up to $3,000 a year of other income. You can buy something similar right away, but
              not the same security within 30 days before or after (the wash-sale rule, which also counts purchases in your IRAs).
            </p>
            <p>
              Realized so far in {year}: <strong>{formatCents(realized.shortTermCents)}</strong> short-term, <strong>{formatCents(realized.longTermCents)}</strong> long-term.
            </p>
            {candidates.length === 0 ? <p className="muted">No taxable lots are below their cost (or prices and costs are missing).</p> : (
              <>
                <div className="scroll-x">
                  <table>
                    <thead><tr><th /><th>Holding</th><th>Account</th><th className="num">Shares</th><th className="num">Loss</th><th>Term</th></tr></thead>
                    <tbody>
                      {candidates.slice(0, 15).map((c) => (
                        <tr key={c.lot.id}>
                          <td><input type="checkbox" aria-label={`Include ${c.ticker} lot`} checked={picked.has(c.lot.id!)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(c.lot.id!); else n.delete(c.lot.id!); setPicked(n); }} /></td>
                          <td>{c.ticker}{c.washRisk && <span className="warn" title="Also held in a tax-sheltered account"> ⚠ wash sale risk</span>}</td>
                          <td>{c.accountName}</td>
                          <td className="num">{Math.round(c.shares * 1000) / 1000}</td>
                          <td className="num neg">{formatCents(c.lossCents)}</td>
                          <td>{c.longTerm ? 'long' : 'short'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {chosen.length > 0 && (
                  <div className="card">
                    Selling the {chosen.length} selected lot{chosen.length === 1 ? '' : 's'} would realize <strong>{formatCents(chosen.reduce((s, c) => s + c.lossCents, 0))}</strong> of losses and lower your{' '}
                    {year} federal and MA tax by about <strong className="pos">{formatCents(Math.max(0, saved))}</strong>.
                    {afterGains.lossDeductionCents > 0 && <> Only {formatCents(afterGains.lossDeductionCents)} of a net loss can be used against other income this year; the rest carries forward.</>}
                    {chosen.some((c) => c.washRisk) && <div className="warn">Some picks are also held in an IRA or 401(k): avoid buying more of them there for 30 days.</div>}
                    <div className="muted">Log the sale on the Investments tab when you make it; the estimate then updates on its own.</div>
                  </div>
                )}
              </>
            )}
          </Collapsible>

          <Collapsible id="taxplan.checklist" title="Before December 31">
            <ul className="checklist">
              {checklist.map((c) => (
                <li key={c.id} className={`check ${c.status}`}>
                  <span className="mark" aria-hidden="true">{c.status === 'ok' ? '✓' : c.status === 'todo' ? '!' : 'i'}</span>
                  <div>
                    <strong>{c.title}</strong>
                    <div className="muted">{c.detail}</div>
                  </div>
                  {c.to && <Link to={c.to}>Open →</Link>}
                </li>
              ))}
            </ul>
            {gainLots.filter((g) => g.longTerm).length > 0 && (
              <p className="muted">Shares with the largest long-term gains (good to give to charity instead of cash): {gainLots.filter((g) => g.longTerm).slice(0, 3).map((g) => `${g.ticker} (${formatCents(-g.lossCents)} gain)`).join(', ')}.</p>
            )}
          </Collapsible>
        </>
      )}
    </>
  );
}
