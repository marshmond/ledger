/**
 * R3.2 Quick Answers for Projects. READ ONLY. "Which projects are over budget?" is the list the weekly review already uses (`readOverBudgetProjects`, built on the project
 * summary's own `flags.overBudget`). Nothing is recalculated: the budget, the expected total cost and the difference are that summary's figures, worded as the project page words them.
 * Expected total cost = what has been paid so far + what is still to pay on agreements that were accepted. A quote, a plan or a budget line that nobody agreed to is not in it.
 */
import { db, type FinanceDB } from '../../db';
import { plural, type AnswerContext, type AnswerResult, type AnswerRow } from '../../core/answers';
import { readOverBudgetProjects, type OverBudgetProject } from './overBudget';

const SOURCE = 'Projects';

export function overBudgetResult(list: readonly OverBudgetProject[]): AnswerResult {
  const rows: AnswerRow[] = list.map((p) => ({
    id: `project:${p.id}`, title: p.name, href: p.href, source: SOURCE,
    detail: p.budgetFromLines ? 'No overall budget is set, so the budget is the total of its budget lines.' : undefined,
    amounts: [
      { label: 'Over by', cents: p.overCents, strong: true },
      { label: 'Budget', cents: p.budgetCents },
      { label: 'Expected total cost', cents: p.expectedTotalCents },
    ],
    chips: [{ text: 'Over budget', tone: 'overdue' }],
  }));
  return {
    status: list.length === 0 ? 'none' : 'answered',
    headline: list.length === 0
      ? ['No planning or active project is over its budget.']
      : [`${plural(list.length, 'project is', 'projects are')} over budget. The most over is `, { money: list[0].overCents }, ' above its budget.'],
    period: { label: 'As of today', from: null, to: null },
    figures: [{ id: 'count', label: 'Projects over budget', value: { kind: 'count', n: list.length } }],
    groups: [{ id: 'projects', heading: list.length === 0 ? 'Projects' : 'Over budget, most first', rows }],
    assumptions: [
      'Only projects that are planning or active, and not archived, are checked.',
      'Expected total cost is what has been paid plus what is still to pay on agreements you accepted: the same figure the project page shows. A quote that was not accepted is not included.',
      'Budget is the project\'s overall budget when one is set; otherwise the total of its budget lines.',
    ],
    limitations: ['A project with no budget and no budget lines has nothing to compare with, so it is never listed as over budget.'],
    sources: [{ module: 'projects', label: 'Projects', href: '#/projects' }],
    fullView: { label: 'Open Projects', href: '#/projects' },
  };
}

export async function overBudgetAnswer(_ctx: AnswerContext, d: FinanceDB = db): Promise<AnswerResult> {
  return overBudgetResult(await readOverBudgetProjects(d));
}
