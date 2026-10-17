import type { FinanceDB } from '../db';
import { buildCalendar, type CalEvent } from './calendar';
import { hsaYearImpact } from './hsa';
import { buildIncomeModel } from './income';
import { loanView, nextRow } from './loanSchedule';
import type { PersonYear } from './payroll';
import { netForTax, realizedFor } from './lots';
import { formatCents } from './money';
import { rmdStartAge } from '../data/retirementTax';
import { estimatedDueDates } from './taxPlan';
import { dueInstances } from './schedule';

/** Reads the database and builds the key-dates calendar for the next `horizonDays`. */
export async function loadCalendar(d: FinanceDB, today: string, horizonDays = 365): Promise<CalEvent[]> {
  const year = Number(today.slice(0, 4));
  const [people, profiles, bonuses, settings, rsu, securities, sales, hsaW, invAccounts, loans, rates, events, due] = await Promise.all([
    d.people.toArray(), d.incomeProfiles.toArray(), d.bonuses.toArray(), d.taxSettings.toArray(), d.rsuVests.toArray(), d.securities.toArray(), d.sales.toArray(),
    d.hsaWithdrawals.toArray(), d.invAccounts.toArray(), d.loans.toArray(), d.loanRates.toArray(), d.loanEvents.toArray(), dueInstances(d, today, Math.min(horizonDays, 60)),
  ]);
  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? 'Someone';
  const vests: { id: string; date: string; label: string; grossCents: number; person: string }[] = [];
  const milestones: { id: string; date: string; label: string; person: string }[] = [];
  let estimated: { dueDates: string[]; amountCents: number } | null = null;
  const labels: [keyof PersonYear['milestones'], string][] = [['ssCapDate', 'Social Security cap reached'], ['k401LimitDate', '401(k) limit reached'], ['matchCapDate', 'Employer 401(k) maximum reached'], ['hsaLimitDate', 'HSA limit reached']];

  for (const y of [year, year + 1]) {
    const hsa = hsaYearImpact(hsaW, invAccounts, people, y);
    const gains = netForTax(realizedFor(sales, y));
    const m = buildIncomeModel(y, people, profiles, bonuses, settings.find((s) => s.year === y), { vests: rsu, securities }, { taxableCents: hsa.taxableCents, penaltyCents: hsa.penaltyCents }, gains);
    for (const v of m.vests) if (v.vest.date.startsWith(`${y}-`) && v.grossCents > 0) vests.push({ id: String(v.vest.id), date: v.vest.date, label: v.vest.grant || 'RSU', grossCents: v.grossCents, person: personName(v.vest.personId) });
    for (const py of m.years) {
      for (const [key, label] of labels) {
        const date = py.milestones[key];
        if (date) milestones.push({ id: `${y}-${py.personId}-${key}`, date, label, person: personName(py.personId) });
      }
    }
    if (y === year && m.household && m.household.federal.balance < 0) estimated = { dueDates: estimatedDueDates(y), amountCents: -m.household.federal.balance };
  }

  const rmds = people.filter((p) => p.birthYear && year >= p.birthYear + rmdStartAge(p.birthYear)).map((p) => ({ person: p.name, year }));
  const loanItems = loans
    .filter((l) => !l.scenario)
    .flatMap((l) => {
      const v = loanView(l, rates.filter((r) => r.loanId === l.id), events.filter((e) => e.loanId === l.id));
      const r = v.schedule.rows.length ? nextRow(v.schedule, today) : null;
      return r ? [{ id: String(l.id), date: r.date, name: l.name, paymentCents: r.payment }] : [];
    });

  return buildCalendar({
    today,
    horizonDays,
    vests,
    milestones,
    estimated,
    rmds,
    scheduled: due.map((x) => ({ id: String(x.rule.id), date: x.date, payee: x.rule.payee, amountCents: x.rule.amountCents })),
    loans: loanItems,
    yearEndYears: [year],
    fmt: formatCents,
  });
}
