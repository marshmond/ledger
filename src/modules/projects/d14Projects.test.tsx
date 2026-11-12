import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectSummary } from '../../lib/txnProject';
import { FinancialBand } from './Financials';
import { groupProjects, isLive, OPEN_GROUP_ORDER, progressTone, STATUS_TONE } from './presentation';
import { OPEN_STATUSES, STATUSES, STATUS_LABEL, type ProjectRecord, type ProjectStatus } from './model';

/** D14 Projects redesign: what the new screens must keep (figures, statuses, sections, safeguards) and what they must not add. Invented data only. */
const read = (p: string) => readFileSync(`src/modules/projects/${p}`, 'utf8');
const rec = (id: number, status: ProjectStatus, archived = false): ProjectRecord => ({ id, data: { name: `Project ${id}`, status, archived } } as unknown as ProjectRecord);

const summary = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  budgetCents: 1200000, plannedTotalCents: 1150000, notYetPlannedCents: 50000, agreedCents: 480000, paidCents: 125000, leftToPayCents: 355000,
  expectedTotalCents: 480000, leftInBudgetCents: 720000, cashLeftCents: 0, quotedCents: 0, lines: [], contracts: [], paidByCommitment: {},
  flags: { overBudget: false, linesOverBudget: false, overpaid: [], paidOnDead: [] }, ...over,
} as unknown as ProjectSummary);

describe('presentation helpers', () => {
  it('every status has a chip tone and a label, and the tones are the shared ones', () => {
    for (const s of STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(['neutral', 'overdue', 'warning', 'done', 'info', 'active']).toContain(STATUS_TONE[s]);
    }
    expect(Object.keys(STATUS_TONE).sort()).toEqual([...STATUSES].sort());
  });

  it('grouping puts every open project in exactly one group, in the fixed status order, and keeps the original order inside a group', () => {
    const list = [rec(1, 'on_hold'), rec(2, 'active'), rec(3, 'planning'), rec(4, 'active'), rec(5, 'planning')];
    const groups = groupProjects(list, true);
    expect(groups.map((g) => g.status)).toEqual(OPEN_GROUP_ORDER.filter((s) => list.some((p) => p.data.status === s)));
    expect(groups.flatMap((g) => g.projects.map((p) => p.id))).toEqual([2, 4, 3, 5, 1]);
    expect(new Set(groups.flatMap((g) => g.projects.map((p) => p.id))).size).toBe(list.length);
  });

  it('a list that is not grouped stays one group, and an empty list has none', () => {
    const list = [rec(1, 'completed'), rec(2, 'cancelled')];
    expect(groupProjects(list, false)).toEqual([{ status: null, projects: list }]);
    expect(groupProjects([], true)).toEqual([]);
    expect(groupProjects([], false)).toEqual([]);
  });

  it('a project with an unexpected status is never dropped by grouping', () => {
    const odd = rec(9, 'completed');
    expect(groupProjects([odd, rec(1, 'active')], true).flatMap((g) => g.projects).map((p) => p.id).sort()).toEqual([1, 9]);
  });

  it('live means open and not archived, the same rule the Open tab uses', () => {
    expect(isLive(rec(1, 'active'))).toBe(true);
    expect(isLive(rec(2, 'active', true))).toBe(false);
    for (const s of STATUSES) expect(isLive(rec(3, s))).toBe(OPEN_STATUSES.includes(s));
  });

  it('only an overdue progress chip is drawn as overdue', () => {
    expect(progressTone('neg')).toBe('overdue');
    expect(progressTone('muted')).toBe('neutral');
    expect(progressTone(undefined)).toBe('neutral');
  });
});

describe('the money band keeps the four ideas apart and shows the very figures it is given', () => {
  const html = renderToStaticMarkup(<FinancialBand summary={summary()} derived={false} />);

  it('has the Plan, Committed, Spent and Outlook groups, each with its own heading', () => {
    for (const h of ['Plan', 'Committed', 'Spent', 'Outlook']) expect(html).toContain(`>${h}</h2>`);
  });

  it('shows each figure under its own label with the module money format', () => {
    expect(html).toContain('Project budget');
    expect(html).toContain('$12,000.00');
    expect(html).toContain('Agreed (accepted)');
    expect(html).toContain('$4,800.00');
    expect(html).toContain('Paid so far');
    expect(html).toContain('$1,250.00');
    expect(html).toContain('Left to pay');
    expect(html).toContain('$3,550.00');
    expect(html).toContain('Left in budget');
    expect(html).toContain('$7,200.00');
    expect(html).toContain('Not planned in lines');
    expect(html).toContain('$500.00');
  });

  it('agreed, paid and left to pay are separate figures: paid is never folded into agreed', () => {
    const only = renderToStaticMarkup(<FinancialBand summary={summary({ agreedCents: 100000, paidCents: 0, leftToPayCents: 100000 })} derived={false} />);
    expect(only).toContain('$1,000.00');
    expect(only).toContain('Paid so far');
    expect(only).toContain('$0.00');
  });

  it('quotes waiting are shown but described as not counted, and only when there are some', () => {
    expect(html).not.toContain('Quotes waiting');
    const withQuote = renderToStaticMarkup(<FinancialBand summary={summary({ quotedCents: 250000 })} derived={false} />);
    expect(withQuote).toContain('Quotes waiting (not counted)');
    expect(withQuote).toContain('$2,500.00');
  });

  it('a budget made of lines is labeled as such, and over budget is said in words', () => {
    expect(renderToStaticMarkup(<FinancialBand summary={summary()} derived />)).toContain('Budget (total of lines)');
    const over = renderToStaticMarkup(<FinancialBand summary={summary({ leftInBudgetCents: -30000, flags: { overBudget: true } as ProjectSummary['flags'] })} derived={false} />);
    expect(over).toContain('Over budget by');
    expect(over).toContain('$300.00');
  });

  it('the money jump buttons keep their spoken names', () => {
    expect(html).toContain('aria-label="Agreed $4,800.00. Show commitments"');
    expect(html).toContain('aria-label="Paid $1,250.00. Show transactions"');
  });
});

describe('the overview keeps its data, tabs and actions', () => {
  const page = read('ProjectsPage.tsx');

  it('keeps the four tabs with their counts, the New project action and both empty states', () => {
    for (const label of ["'Open'", "'Finished'", "'Archived'", "'All'"]) expect(page).toContain(label);
    expect(page).toContain('New project');
    expect(page).toContain('No open projects. A project holds a budget made of lines');
    expect(page).toContain('No projects yet');
    expect(page).toContain('role="tablist"');
    expect(page).toContain('rovingKeys');
  });

  it('reads the budget from budgetSummary and agreed and paid from the same Finance summary the project page uses', () => {
    expect(page).toContain('budgetSummary(p.data.budgetCents, ls)');
    expect(page).toContain('loadProjectSummary(db, p.id)');
    expect(page).toContain('s.agreedCents');
    expect(page).toContain('s.paidCents');
  });

  it('an unknown budget is worded "No budget yet", never shown as $0.00', () => {
    expect(page).toContain("'No budget yet'");
  });

  it('works out no money itself', () => {
    expect(page).not.toMatch(/Cents\s*[-+*/]\s*\w/);
    expect(page).not.toContain('.reduce(');
  });

  it('opens a project at its own address', () => {
    expect(page).toContain('to={`/${p.id}`}');
  });
});

describe('the project page keeps every section, action and safeguard', () => {
  const page = read('ProjectPage.tsx');

  it('still renders every section that existed before', () => {
    for (const tag of ['<Financials', '<Commitments', '<ProjectTxns', '<BudgetLines', '<Vendors', '<ProjectWork', '<RelatedAssets', '<RelatedServices', '<FinancialBand']) expect(page).toContain(tag);
    expect(page).toContain('Notes');
  });

  it('keeps Edit, Archive, Restore, the status picker and permanent deletion with its own dialog', () => {
    for (const text of ['>Edit</button>', '>Restore</button>', '>Archive</button>', 'Delete permanently…', 'aria-label="Status"']) expect(page).toContain(text);
    expect(page).toContain('<DeleteProject');
    expect(page).toContain('setDeleting(true)');
    expect(page).toContain('setProjectStatus');
  });

  it('deletion is still reached only through the dependency-checked dialog: the page itself never removes a record', () => {
    expect(page).not.toContain('removeProjectRecord');
    expect(page).not.toContain('removeCommitment');
    expect(page).not.toContain('.delete(');
  });

  it('keeps the archived, cancelled and completed note and the deep link by id', () => {
    expect(page).toContain('This project is archived.');
    expect(page).toContain('This project is cancelled.');
    expect(page).toContain('This project is completed.');
    expect(page).toContain("useParams");
    expect(page).toContain('This project does not exist');
  });

  it('uses the shared date tile and status chip, and has a jump row for narrow screens', () => {
    expect(page).toContain("from '../../ui/DateTile'");
    expect(page).toContain("from '../../ui/StatusChip'");
    expect(page).toContain('aria-label="On this page"');
  });

  it('the delete dialog file is unchanged in what it requires: it still lists the records that block or go with a project', () => {
    const del = read('DeleteProject.tsx');
    expect(del).toContain('Delete');
    expect(del).toMatch(/deletion|plan|reasons/i);
  });
});

describe('the stylesheet: layout, phone behavior and tokens', () => {
  const css = read('projects.css');

  it('is two columns on a wide screen and one on a narrow one, with the jump row shown only when narrow', () => {
    expect(css).toMatch(/\.pj-layout \{[^}]*grid-template-columns: minmax\(0, 1\.6fr\) minmax\(0, 1fr\)/);
    expect(css).toMatch(/@media \(max-width: 1000px\) \{[^}]*\.pj-layout \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(css).toMatch(/\.pj-jump \{ display: none;/);
    expect(css).toMatch(/@media \(max-width: 1000px\) \{[\s\S]*?\.pj-jump \{ display: inline-flex; \}/);
  });

  it('phone actions are at least 44px tall and long project names wrap', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pj-head-actions \.btn[^}]*min-height: 44px/);
    expect(css).toMatch(/\.pj-pcard-title \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.pj-head-text h1 \{[^}]*overflow-wrap: anywhere/);
  });

  it('adds no !important and no new hex color', () => {
    expect(css).not.toContain('!important');
    const hex = (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((h) => h.length > 3);
    expect(hex.length).toBeLessThanOrEqual(4); // only the older var(--warn, #...) / var(--pos, #...) fallbacks that were there before D14
  });
});
