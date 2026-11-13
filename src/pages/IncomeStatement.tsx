import { useId, type ReactNode } from 'react';
import type { Person } from '../types';
import { formatCents } from '../lib/money';
import { Kind } from './PlanParts';
import {
  householdCell, type ColumnId, type PersonStatement, type StatementCell, type StatementColumn, type StatementSchema,
} from './incomeStatementModel';

/**
 * D18.2: the gross-to-net pieces of the Income page. Everything here only DRAWS a statement built by `incomeStatement.ts` from the income model's own totals.
 * It has no inputs, no save buttons and no database access; the pay setup, bonus and stock award forms stay where they were and remain the only way to change a stored value.
 *
 * Alignment rule: every person is drawn from the same schema, so a category is always in the same place. A person with no item gets a blank cell (empty space, with a spoken
 * label for screen readers), never a "$0" and never a shifted neighbor.
 */

const STATUS_WORD: Record<'not-set-up' | 'not-calculated', string> = { 'not-set-up': 'Not set up', 'not-calculated': 'Not calculated' };

/** One amount. A value shows the money; a blank is empty space with a spoken label; an unavailable person shows a short status word where it matters (totals). */
function Amount({ cell, label, who, statusWord }: { cell: StatementCell; label: string; who: string; statusWord?: string }) {
  if (cell.state === 'value') return <span className="is-amt">{formatCents(cell.cents)}</span>;
  if (cell.state === 'unavailable') {
    return statusWord
      ? <span className="is-status">{statusWord}</span>
      : <span className="is-blank"><span className="sr-only">{label} for {who}: not calculated</span></span>;
  }
  return <span className="is-blank"><span className="sr-only">{label} for {who}: none entered</span></span>;
}

function StatementLine({ col, st, who, strong }: { col: StatementColumn; st: PersonStatement; who: string; strong?: boolean }) {
  const cell = st.cells[col.id];
  return (
    <div className={`is-line${strong ? ' is-line--strong' : ''}`} data-col={col.id} data-state={cell.state}>
      <dt>{col.label}{col.help && <span className="is-help">{col.help}</span>}</dt>
      <dd><Amount cell={cell} label={col.label} who={who} /></dd>
    </div>
  );
}

function Big({ col, st, who, caption }: { col: StatementColumn; st: PersonStatement; who: string; caption?: ReactNode }) {
  const cell = st.cells[col.id];
  const word = st.status === 'ready' ? undefined : STATUS_WORD[st.status];
  return (
    <div className="is-big" data-col={col.id} data-state={cell.state}>
      <span className="is-big-v"><Amount cell={cell} label={col.label} who={who} statusWord={word} /></span>
      {caption && <span className="is-big-c">{caption}</span>}
    </div>
  );
}

function Col({ id, className, heading, op, children }: { id: string; className: string; heading: ReactNode; op?: string; children: ReactNode }) {
  return (
    <section className={`is-col ${className}`} aria-labelledby={id}>
      <h4 className="is-colhead" id={id}>{op && <span className="is-op" aria-hidden="true">{op}</span>}{heading}</h4>
      {children}
    </section>
  );
}

/**
 * One person's statement: Income sources, Gross compensation, Employee deductions, Taxes withheld, Cash take-home, from left to right on a computer and stacked in the
 * same order on a phone. Employer contributions are a separate, lighter section because they never reduce take-home.
 */
export function PersonStatementView({ person, year, schema, statement }: { person: Person; year: number; schema: StatementSchema; statement: PersonStatement }) {
  const uid = useId();
  const who = person.name;
  const col = (id: ColumnId) => schema.columns[schema.index[id]];
  const lines = (g: keyof StatementSchema['detail']) => schema.detail[g].map((c) => <StatementLine key={c.id} col={c} st={statement} who={who} />);
  const ready = statement.status === 'ready';
  const rc = statement.reconciliation;
  return (
    <section className="pw-section is-statement" aria-label={`${who}: ${year} gross-to-net statement`} data-person={person.id}>
      <h3 className="pw-h3">{year} gross to net <Kind k="estimate">Estimate</Kind></h3>
      <p className="an-note pw-note">
        Yearly totals from the pay setup below, from gross pay to the cash that reaches you. This summary is read-only; change a value in the forms further down. Paycheck-by-paycheck detail is at the bottom of this workspace.
      </p>
      {!ready && <p className="is-banner" role="status">{statement.reason}. The layout below stays the same so it lines up with everyone else; nothing is counted as zero.</p>}

      <div className="is-stmt">
        <Col id={`${uid}-inc`} className="is-col--income" heading="Income sources">
          <dl className="is-lines">{lines('income')}</dl>
        </Col>
        <Col id={`${uid}-gross`} className="is-col--gross" heading="Gross compensation" op="=">
          <Big col={col('gross')} st={statement} who={who} caption="before deductions and taxes" />
        </Col>
        <Col id={`${uid}-ded`} className="is-col--ded" heading="Employee deductions" op="−">
          <dl className="is-lines">{lines('deductions')}</dl>
          <dl className="is-lines is-lines--total"><StatementLine col={col('deductions')} st={statement} who={who} strong /></dl>
        </Col>
        <Col id={`${uid}-tax`} className="is-col--tax" heading="Taxes withheld" op="−">
          <dl className="is-lines">{lines('taxes')}</dl>
          <dl className="is-lines is-lines--total"><StatementLine col={col('taxes')} st={statement} who={who} strong /></dl>
          <p className="is-fine">Taken from paychecks. Not the same as the tax you will owe for the year.</p>
        </Col>
        <Col id={`${uid}-net`} className="is-col--net" heading="Cash take-home" op="=">
          <Big col={col('net')} st={statement} who={who} caption="estimated cash for the year" />
          <dl className="is-lines is-lines--kept">
            <StatementLine col={col('kept')} st={statement} who={who} />
          </dl>
          <p className="is-fine">Equity kept as shares is the value left after tax on stock awards you hold. It is not cash and is not in the figure above.</p>
        </Col>
      </div>

      <section className="is-employer" aria-labelledby={`${uid}-er`}>
        <h4 className="is-colhead is-colhead--quiet" id={`${uid}-er`}>Employer contributions</h4>
        <dl className="is-lines is-lines--row">{lines('employer')}</dl>
        <p className="is-fine">Paid by the employer into your accounts. They are not part of gross compensation and do not reduce your take-home.</p>
      </section>

      {ready && rc.negativePaychecks > 0 && (
        <p className="warn pl-warn">{rc.negativePaychecks === 1 ? 'One paycheck has' : `${rc.negativePaychecks} paychecks have`} more deductions and taxes than pay. The model counts the shortfall as negative cash, so cash take-home is lower than gross minus the lines above.</p>
      )}
      {ready && rc.difference !== 0 && (
        <p className="warn pl-warn" role="status">These lines are {formatCents(Math.abs(rc.difference))} {rc.difference > 0 ? 'more' : 'less'} than the model’s cash figure plus the equity kept as shares. The model’s own cash figure is the one shown; nothing was adjusted to make it add up.</p>
      )}
      {ready && rc.deductionPlacementGap !== 0 && (
        <p className="warn pl-warn" role="status">Some deductions could not be placed in a category, so the category lines differ from the total by {formatCents(Math.abs(rc.deductionPlacementGap))}.</p>
      )}
    </section>
  );
}

/**
 * The compact household comparison under the Income hero: one row per person, the same columns in the same order for everyone. A person without bonuses, stock awards or
 * kept shares gets an empty cell in that column. Deduction and tax detail lives in each person's statement.
 */
export function HouseholdComparison({ year, people, schema, statements }: { year: number; people: Person[]; schema: StatementSchema; statements: PersonStatement[] }) {
  const uid = useId();
  const income = schema.detail.income;
  const totalsOrder: ColumnId[] = ['gross', 'deductions', 'taxes', 'net', 'kept'];
  const totals = totalsOrder.map((id) => schema.columns[schema.index[id]]);
  const cols = [...income, ...totals];
  const anyReady = statements.some((s) => s.status === 'ready');
  const hh = statements.length > 1 ? statements : [];
  return (
    <section className="an-card is-compare" aria-labelledby={`${uid}-h`}>
      <h2 className="an-h2" id={`${uid}-h`}>Compare people, {year} <Kind k="estimate">Estimate</Kind></h2>
      <p className="an-note pw-note">
        Yearly totals for {year}. Every person has the same columns in the same order; an empty cell means that person has none of that item. Open a person below for the deduction and tax detail.
      </p>
      <div className="an-tablewrap is-scroll" role="region" aria-label={`Income comparison by person, ${year}`} tabIndex={0}>
        <table className="an-table is-table an-stack" aria-label={`Compensation by person, ${year}`}>
          <colgroup>
            <col className="is-c-person" />
            {cols.map((c) => <col key={c.id} className={c.total ? 'is-c-total' : 'is-c-detail'} />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="is-h-person">Person</th>
              <th scope="colgroup" colSpan={income.length} className="is-h-group">Income sources</th>
              {totals.map((c) => <th key={c.id} scope="col" rowSpan={2} className={`num is-h-total is-h-${c.id}`}>{c.label}</th>)}
            </tr>
            <tr>{income.map((c) => <th key={c.id} scope="col" className="num is-h-sub">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {statements.map((st, i) => {
              const p = people[i];
              return (
                <tr key={st.personId} data-person={st.personId}>
                  <th scope="row" className="an-lead is-rowhead">
                    {p.name}
                    {st.status !== 'ready' && <span className="is-state">{st.reason}</span>}
                  </th>
                  {cols.map((c) => (
                    <td key={c.id} className={`num${c.total ? ' is-total' : ''}`} data-label={c.label} data-col={c.id} data-state={st.cells[c.id].state}>
                      <Amount cell={st.cells[c.id]} label={c.label} who={p.name} statusWord={st.status !== 'ready' && (c.id === 'gross' || c.id === 'net') ? STATUS_WORD[st.status] : undefined} />
                    </td>
                  ))}
                </tr>
              );
            })}
            {hh.length > 0 && anyReady && (
              <tr className="is-hhrow" data-person="household">
                <th scope="row" className="an-lead is-rowhead">Household</th>
                {cols.map((c) => (
                  <td key={c.id} className={`num${c.total ? ' is-total' : ''}`} data-label={c.label} data-col={c.id}>
                    <Amount cell={householdCell(statements, c.id)} label={c.label} who="the household" />
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="an-scrollhint">Scroll sideways to see every column.</p>
      <p className="an-note">
        Stock awards count as income the day they vest; shares you keep are shown apart from cash. Employer contributions are not included. Taxes withheld are taken from paychecks, not the year’s tax bill; that stays in the {year} results below.
      </p>
    </section>
  );
}
