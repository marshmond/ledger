import { useMemo, useState } from 'react';
import { Link } from '../core/router';
import { formatCents, todayISO } from '../lib/money';
import { netForTax } from '../lib/lots';
import { estimatedDueDates, withHarvest } from '../lib/taxPlan';
import Collapsible from './Collapsible';
import { useTaxPlanData } from './useTaxPlanData';
import { PageHeader } from '../ui/components';
import { Kind, Lines, PlanChecks, PlanHero, PlanJump } from './PlanParts';
import './analysis.css';
import './plan.css';

const pct = (r: number) => `${Math.round(r * 100)}%`;
const CHECK_WORDS = { ok: 'Done', warn: 'To do', info: 'For your information' } as const;

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
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Tax planning" description="Where this year’s taxes are heading, and what to do before December 31." about={<>A look at where your {year} taxes are headed and what you can still do about them. It uses the setup on the <Link to="/income">Income</Link> tab, your sales on the{' '}
        <Link to="/investments">Investments</Link> tab, and HSA withdrawals. It is a planning estimate, not tax advice.</>} actions={<><label className="row">Year<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label></>} />

      {!tables && <div className="an-card pl-alert" role="alert"><strong>No tax tables for {year}.</strong> Add them on the Income tab first.</div>}
      {tables && !hh && <p className="warn">Set up income for {year} on the Income tab to see the plan.</p>}

      {hh && room && wp && (
        <>
          <PlanHero
            label={`Projected taxes for ${year}`}
            kind={<Kind k="estimate">Estimate</Kind>}
            amount={formatCents(totalAll)}
            message={<>Worked out from the income set up on the <Link to="/income">Income</Link> page and your sales so far. It is a projection for planning, not a tax return.</>}
            figs={[
              { label: 'Federal income tax', value: formatCents(hh.federal.totalLiability) },
              { label: 'Massachusetts', value: formatCents(hh.ma.totalLiability) },
              { label: 'Social Security, Medicare, PFML', value: formatCents(totalFica) },
              { label: 'Share of gross pay', value: gross > 0 ? `${((totalAll / gross) * 100).toFixed(1)}%` : '—' },
            ]}
          />

          <PlanJump items={[
            { id: 'tax-room', label: 'Bracket room' },
            { id: 'tax-withholding', label: 'Withholding and payments' },
            { id: 'tax-harvest', label: 'Tax-loss harvesting' },
            { id: 'tax-checklist', label: 'Before December 31' },
          ]} />

          <h2 className="an-h2 pl-subhead">Where things stand <Kind k="estimate">Calculated</Kind></h2>
          <div className="an-split an-split--even pl-top">
            <div id="tax-room" className="pl-anchor" tabIndex={-1}>
              <Collapsible id="taxplan.room" title="Bracket room">
                <div className="pl-bignum">
                  <div className="pl-bignum-label">Top federal bracket</div>
                  <div className="pl-bignum-val">{pct(room.rate)}</div>
                </div>
                <p>
                  Your last dollar of ordinary income is taxed at <strong>{pct(room.rate)}</strong>.{' '}
                  {room.roomCents !== null
                    ? <>About <strong>{formatCents(room.roomCents)}</strong> more fits before the {pct(room.nextRate ?? 0)} bracket starts. That is the room for a Roth conversion, extra income, or selling a gain taxed as ordinary income.</>
                    : 'You are in the top bracket.'}
                </p>
                <Lines rows={[
                  { label: 'Taxable income', value: formatCents(hh.federal.taxableIncome) },
                  { label: 'Ordinary income part (taxed by bracket)', value: formatCents(room.ordinaryTaxable) },
                  ...(hh.federal.longTermGains > 0 ? [{ label: 'Long-term gains (taxed at 0/15/20%)', value: formatCents(hh.federal.longTermGains) }] : []),
                  { label: 'Room left in this bracket', value: room.roomCents === null ? '—' : formatCents(room.roomCents), strong: true },
                  { label: 'Room left in the 0% capital-gains band', value: formatCents(room.zeroGainRoomCents) },
                  ...(hh.federal.niit > 0 ? [{ label: 'Net investment income tax (3.8%)', value: formatCents(hh.federal.niit) }] : []),
                ]} />
                <p className="an-note">Try a Roth conversion with this room in the <Link to="/roth">Roth planner</Link>.</p>
              </Collapsible>
            </div>

            <div id="tax-withholding" className="pl-anchor" tabIndex={-1}>
              <Collapsible id="taxplan.withholding" title="Withholding and estimated payments">
                <div className="an-stack-col">
                  <div className="an-split an-split--even">
                    <section className="an-card an-card--soft" aria-labelledby="tp-fed">
                      <h3 className="an-h2" id="tp-fed" style={{ fontSize: 'var(--fs-base)' }}>Federal</h3>
                      <Lines rows={[
                        { label: 'Tax for the year', value: formatCents(wp.federal.owed) },
                        { label: 'Withheld so far', value: formatCents(wp.federal.withheldToDate) },
                        { label: 'Withheld by year end (projected)', value: formatCents(wp.federal.projected) },
                        { label: wp.federal.balance >= 0 ? 'Expected refund' : 'Expected to owe', value: formatCents(Math.abs(wp.federal.balance)), strong: true },
                      ]} />
                    </section>
                    <section className="an-card an-card--soft" aria-labelledby="tp-ma">
                      <h3 className="an-h2" id="tp-ma" style={{ fontSize: 'var(--fs-base)' }}>Massachusetts</h3>
                      <Lines rows={[
                        { label: 'Tax for the year', value: formatCents(wp.ma.owed) },
                        { label: 'Withheld so far', value: formatCents(wp.ma.withheldToDate) },
                        { label: 'Withheld by year end (projected)', value: formatCents(wp.ma.projected) },
                        { label: wp.ma.balance >= 0 ? 'Expected refund' : 'Expected to owe', value: formatCents(Math.abs(wp.ma.balance)), strong: true },
                      ]} />
                    </section>
                  </div>
                  {wp.safeHarbor && (
                    <p className={`pl-status ${wp.safeHarbor.met ? 'pl-status--ok' : 'pl-status--warn'}`} role="status">
                      <strong>{wp.safeHarbor.met ? 'Safe harbor covered. ' : 'Below the safe-harbor amount. '}</strong>
                      {wp.safeHarbor.met
                        ? `Withholding covers the safe-harbor amount (${formatCents(wp.safeHarbor.requiredCents)}, ${wp.safeHarbor.basis}), so an underpayment penalty is unlikely even if you owe at filing.`
                        : `Withholding is below the safe-harbor amount (${formatCents(wp.safeHarbor.requiredCents)}, ${wp.safeHarbor.basis}). You could owe an underpayment penalty unless you add withholding or pay estimates.`}
                    </p>
                  )}
                </div>
              </Collapsible>
            </div>
          </div>

          <h2 className="an-h2 pl-subhead">Things you could do <Kind k="action">Possible actions, not advice</Kind></h2>

          {wp.federal.balance < 0 && (
            <section className="an-card pl-action" aria-labelledby="tp-gap">
              <h3 className="an-h2" id="tp-gap" style={{ fontSize: 'var(--fs-base)' }}>To close the {formatCents(wp.estimatedPaymentCents)} federal gap</h3>
              <ul>
                {wp.extraPerCheck.map((e) => <li key={e.personId}>{personName(e.personId)}: add <strong>{formatCents(e.cents)}</strong> of extra federal withholding to each of the {wp.remaining.find((r) => r.personId === e.personId)?.checks} remaining paychecks (W-4 step 4(c)).</li>)}
                <li>Or make an estimated payment of {formatCents(wp.estimatedPaymentCents)} before the next due date: {estimatedDueDates(year).filter((d) => d >= today).slice(0, 2).join(' or ') || 'the January deadline'}.</li>
              </ul>
              <p className="an-note">Withholding counts as paid evenly through the year no matter when it comes out, so late-year extra withholding can still avoid a penalty.</p>
            </section>
          )}
          {wp.federal.balance >= 0 && <p className="an-note pl-info">You are on track for a refund, so no extra withholding is needed. To keep more of each paycheck, you could lower withholding slightly, keeping the safe-harbor amount above in mind.</p>}

          <div id="tax-harvest" className="pl-anchor" tabIndex={-1}>
            <Collapsible id="taxplan.harvest" title="Tax-loss harvesting">
              <p className="an-note" style={{ marginTop: 0 }}>
                Selling a lot that is worth less than you paid creates a loss that offsets gains, and up to $3,000 a year of other income. You can buy something similar right away, but
                not the same security within 30 days before or after (the wash-sale rule, which also counts purchases in your IRAs).
              </p>
              <p>
                Realized so far in {year}: <strong>{formatCents(realized.shortTermCents)}</strong> short-term, <strong>{formatCents(realized.longTermCents)}</strong> long-term.
              </p>
              {candidates.length === 0 ? <p className="muted">No taxable lots are below their cost (or prices and costs are missing).</p> : (
                <>
                  <div className="an-tablewrap">
                    <table className="an-table an-stack" aria-label="Lots worth less than their cost">
                      <thead><tr><th><span className="pl-vh">Include</span></th><th>Holding</th><th>Account</th><th className="num">Shares</th><th className="num">Loss</th><th>Term</th></tr></thead>
                      <tbody>
                        {candidates.slice(0, 15).map((c) => (
                          <tr key={c.lot.id}>
                            <td className="an-lead"><input type="checkbox" aria-label={`Include ${c.ticker} lot`} checked={picked.has(c.lot.id!)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(c.lot.id!); else n.delete(c.lot.id!); setPicked(n); }} /></td>
                            <td className="an-full"><span className="an-title">{c.ticker}</span>{c.washRisk && <span className="an-kind an-kind--unknown" title="Also held in a tax-sheltered account"> ⚠ wash sale risk</span>}</td>
                            <td data-label="Account">{c.accountName}</td>
                            <td className="num" data-label="Shares">{Math.round(c.shares * 1000) / 1000}</td>
                            <td className="num" data-label="Loss">{formatCents(c.lossCents)}</td>
                            <td data-label="Term">{c.longTerm ? 'long' : 'short'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {chosen.length > 0 && (
                    <div className="an-result" role="status" style={{ marginTop: 'var(--sp-3)' }}>
                      <strong>If you sold the selected lots <Kind k="estimate">Estimate</Kind></strong>
                      <p style={{ margin: 0 }}>
                        Selling the {chosen.length} selected lot{chosen.length === 1 ? '' : 's'} would realize <strong>{formatCents(chosen.reduce((s, c) => s + c.lossCents, 0))}</strong> of losses and lower your{' '}
                        {year} federal and MA tax by about <strong>{formatCents(Math.max(0, saved))}</strong>.
                        {afterGains.lossDeductionCents > 0 && <> Only {formatCents(afterGains.lossDeductionCents)} of a net loss can be used against other income this year; the rest carries forward.</>}
                      </p>
                      {chosen.some((c) => c.washRisk) && <div className="warn">Some picks are also held in an IRA or 401(k): avoid buying more of them there for 30 days.</div>}
                      <div className="muted">Log the sale on the Investments tab when you make it; the estimate then updates on its own.</div>
                    </div>
                  )}
                </>
              )}
            </Collapsible>
          </div>

          <div id="tax-checklist" className="pl-anchor" tabIndex={-1}>
            <Collapsible id="taxplan.checklist" title="Before December 31">
              <PlanChecks
                label="Year-end checklist"
                words={CHECK_WORDS}
                items={checklist.map((c) => ({ id: c.id, level: c.status === 'ok' ? 'ok' : c.status === 'todo' ? 'warn' : 'info', title: c.title, detail: c.detail, to: c.to }))}
              />
              {gainLots.filter((g) => g.longTerm).length > 0 && (
                <p className="an-note">Shares with the largest long-term gains (good to give to charity instead of cash): {gainLots.filter((g) => g.longTerm).slice(0, 3).map((g) => `${g.ticker} (${formatCents(-g.lossCents)} gain)`).join(', ')}.</p>
              )}
            </Collapsible>
          </div>
        </>
      )}
    </div>
  );
}
