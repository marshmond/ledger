import { describe, expect, it } from 'vitest';
import { exampleQuestions, matchAnswers, periodCaveat, readerProblem, resultProblem, stems, type AnswerReader, type AnswerResult } from './answers';
import { allAnswerReaders, allModules } from './registry';
import { registerModules } from '../modules';

/**
 * R3.2: the catalog's matching rules and its promises, with no database. Readers here are stand-ins; the real catalog is checked against the registry at the end.
 */
const reader = (id: string, phrases: string[], over: Partial<AnswerReader> = {}): AnswerReader => ({ id, question: `Question ${id}?`, title: id, phrases, defaultPeriod: 'today', run: async () => { throw new Error('not called'); }, ...over });
const R = [
  { moduleId: 'projects', reader: reader('projects.overBudget', ['projects over budget', 'over budget projects']) },
  { moduleId: 'assets', reader: reader('assets.warrantiesExpiring', ['warranties expiring soon', 'expiring warranties']) },
  { moduleId: 'household', reader: reader('household.payments', ['payments coming up', 'upcoming payments', 'payments due soon']) },
  { moduleId: 'services', reader: reader('services.upcoming', ['household services coming up', 'upcoming services']) },
  { moduleId: 'today', reader: reader('today.week', ['happening this week', 'week ahead']) },
  { moduleId: 'today', reader: reader('today.needs', ['needs attention', 'what needs my attention']) },
];
const TODAY = '2026-11-16';
const ids = (q: string) => matchAnswers(q, R, TODAY).suggestions.map((s) => s.reader.id);

describe('stems', () => {
  it('drops filler and reduces plurals and a few irregular words', () => {
    expect(stems('Which projects are over budget?')).toEqual(['project', 'over', 'budget']);
    expect(stems('What have we spent on maintenance')).toEqual(['we', 'spend', 'maintenance']);
    expect(stems('bills that went up')).toEqual(['bill', 'go', 'up']);
  });
});

describe('matching a typed question to a reader', () => {
  it('several wordings of one question resolve to the same reader', () => {
    for (const q of ['Over budget projects', 'Projects over budget', 'Which projects are over budget?', 'are any projects over budget', 'projects over budget?', 'PROJECTS OVER BUDGET']) expect(ids(q), q).toEqual(['projects.overBudget']);
  });
  it('a different word order and extra words still match, because the suggestion shows its own fixed question', () => {
    expect(ids('tell me which of our projects went over budget')).toEqual(['projects.overBudget']);
    expect(ids('what warranties are expiring soon in the house')).toEqual(['assets.warrantiesExpiring']);
  });
  it('a lone keyword never matches (it would hijack ordinary searches)', () => {
    for (const q of ['budget', 'projects', 'payments', 'warranty', 'week', 'needs', 'bills']) expect(ids(q), q).toEqual([]);
  });
  it('an unsupported question matches nothing and invents nothing', () => {
    for (const q of ['what is the meaning of life', 'how much is my net worth', 'who owes me money', 'xyz', '']) expect(matchAnswers(q, R, TODAY)).toEqual({ suggestions: [], ambiguous: null });
  });
  it('ranks the closer phrase first and offers at most three', () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({ moduleId: 'x', reader: reader(`x.r${n}`, ['alpha beta']) }));
    expect(matchAnswers('alpha beta', many, TODAY).suggestions).toHaveLength(3);
    const two = [{ moduleId: 'x', reader: reader('x.long', ['alpha beta gamma']) }, { moduleId: 'x', reader: reader('x.short', ['alpha beta']) }];
    expect(matchAnswers('alpha beta gamma', two, TODAY).suggestions[0].reader.id).toBe('x.long');
  });
});

describe('ambiguous questions', () => {
  it('"what is due" offers several readers instead of picking one', () => {
    for (const q of ['What is due?', 'due', 'due soon', "what's coming up", 'upcoming', 'what is upcoming?']) {
      const m = matchAnswers(q, R, TODAY);
      expect(m.suggestions, q).toEqual([]);
      expect(m.ambiguous?.choices.map((c) => c.reader.id), q).toEqual(['household.payments', 'services.upcoming', 'today.week', 'today.needs']);
    }
  });
  it('a specific question is never captured by the ambiguous rule', () => {
    expect(ids('payments due soon')).toEqual(['household.payments']);
    expect(matchAnswers('payments due soon', R, TODAY).ambiguous).toBeNull();
  });
  it('offers only readers that are registered, and nothing when fewer than two exist', () => {
    expect(matchAnswers('due', R.slice(2, 4), TODAY).ambiguous?.choices.map((c) => c.reader.id)).toEqual(['household.payments', 'services.upcoming']);
    expect(matchAnswers('due', R.slice(0, 2), TODAY).ambiguous).toBeNull();
  });
});

describe('a period Ledger does not answer', () => {
  it('still suggests the reader, with a plain note that the answer is for its own period', () => {
    for (const q of ['projects over budget last year', 'projects over budget in 2024', 'projects over budget next month', 'projects over budget since march']) {
      const s = matchAnswers(q, R, TODAY).suggestions[0];
      expect(s.reader.id).toBe('projects.overBudget');
      expect(s.caveat, q).toMatch(/fixed period/);
    }
    expect(matchAnswers('projects over budget', R, TODAY).suggestions[0].caveat).toBeNull();
    expect(periodCaveat('maintenance spending in 2026', '2026-11-16')).toBeNull();
    expect(periodCaveat('maintenance spending in 2025', '2026-11-16')).not.toBeNull();
  });
});

describe('what a reader and a result must promise', () => {
  it('a reader needs a namespaced id, a question, usable phrases and exactly one way to run', () => {
    expect(readerProblem('projects', reader('projects.overBudget', ['projects over budget']))).toBeNull();
    expect(readerProblem('projects', reader('assets.x', ['projects over budget']))).toMatch(/must be/);
    expect(readerProblem('projects', reader('projects.x', ['budget']))).toMatch(/fewer than two/);
    expect(readerProblem('projects', reader('projects.x', ['projects over budget'], { question: 'Not a question' }))).toMatch(/question/);
    expect(readerProblem('projects', reader('projects.x', ['projects over budget'], { run: undefined }))).toMatch(/exactly one/);
  });
  const ok = (over: Partial<AnswerResult> = {}): AnswerResult => ({
    status: 'answered', headline: ['Fine.'], period: { label: 'Today', from: null, to: null }, figures: [], groups: [], assumptions: [], limitations: [],
    sources: [{ module: 'bills', label: 'Bills', href: '#/bills' }], ...over,
  });
  it('a result needs a period, at least one real source inside Ledger, links inside Ledger and whole cents', () => {
    expect(resultProblem(ok())).toBeNull();
    expect(resultProblem(ok({ sources: [] }))).toMatch(/no sources/);
    expect(resultProblem(ok({ sources: [{ module: 'x', label: 'X', href: 'https://example.com' }] }))).toMatch(/bad source/);
    expect(resultProblem(ok({ period: { label: ' ', from: null, to: null } }))).toMatch(/no period/);
    const row = { id: 'a', title: 'A', href: '#/bills/o/1', source: 'Bills' };
    expect(resultProblem(ok({ groups: [{ id: 'g', heading: 'G', rows: [row] }] }))).toBeNull();
    expect(resultProblem(ok({ groups: [{ id: 'g', heading: 'G', rows: [{ ...row, href: 'javascript:alert(1)' }] }] }))).toMatch(/bad link/);
    expect(resultProblem(ok({ groups: [{ id: 'g', heading: 'G', rows: [row, row] }] }))).toMatch(/duplicate/);
    expect(resultProblem(ok({ groups: [{ id: 'g', heading: 'G', rows: [{ ...row, amounts: [{ label: 'x', cents: 10.5 }] }] }] }))).toMatch(/non-whole/);
    expect(resultProblem(ok({ status: 'insufficient' }))).toMatch(/missing/);
    expect(resultProblem(ok({ status: 'limited' }))).toMatch(/limited without/);
  });
  it('example questions take one reader from each of the first modules', () => {
    expect(exampleQuestions(R, 3).map((x) => x.reader.id)).toEqual(['projects.overBudget', 'assets.warrantiesExpiring', 'household.payments']);
  });
});

describe('the real catalog', () => {
  registerModules();
  const real = allAnswerReaders();
  it('registers the ten questions, one reader each, every reader valid and every id unique', () => {
    expect(real.map((r) => r.reader.id).sort()).toEqual(['assets.maintenanceOverdue', 'assets.maintenanceSpend', 'assets.warrantiesExpiring', 'bills.priceIncreases', 'household.payments', 'household.yearAhead', 'projects.overBudget', 'services.upcoming', 'today.needs', 'today.week']);
    for (const { moduleId, reader: r } of real) expect(readerProblem(moduleId, r), r.id).toBeNull();
    expect(new Set(real.map((r) => r.reader.id)).size).toBe(real.length);
    expect(allModules().length).toBeGreaterThan(0);
  });
  it('every reader\'s own question and defined period resolve to itself and to nothing else', () => {
    for (const { reader: r } of real) {
      const m = matchAnswers(r.question, real, TODAY);
      expect(m.suggestions[0]?.reader.id, r.question).toBe(r.id);
    }
  });
  it('the wordings in the brief resolve to the right readers', () => {
    const first = (q: string) => matchAnswers(q, real, TODAY).suggestions[0]?.reader.id;
    expect(first('What needs my attention?')).toBe('today.needs');
    expect(first("What's happening this week?")).toBe('today.week');
    expect(first('What payments are coming up?')).toBe('household.payments');
    expect(first('What do we need to prepare for over the next year?')).toBe('household.yearAhead');
    expect(first('Which bills have increased recently?')).toBe('bills.priceIncreases');
    expect(first('bills that went up')).toBe('bills.priceIncreases');
    expect(first('Which projects are over budget?')).toBe('projects.overBudget');
    expect(first('What have we spent on home maintenance this year?')).toBe('assets.maintenanceSpend');
    expect(first('home maintenance spending')).toBe('assets.maintenanceSpend');
    expect(first('What maintenance is overdue?')).toBe('assets.maintenanceOverdue');
    expect(first('What warranties are expiring soon?')).toBe('assets.warrantiesExpiring');
    expect(first('What household services are coming up?')).toBe('services.upcoming');
  });
  it('"what is due" is ambiguous in the real catalog and offers four readers', () => {
    const m = matchAnswers('What is due?', real, TODAY);
    expect(m.suggestions).toEqual([]);
    expect(m.ambiguous?.choices).toHaveLength(4);
  });
  it('questions that sound like a neighbour do not match the wrong reader', () => {
    const first = (q: string) => matchAnswers(q, real, TODAY).suggestions[0]?.reader.id;
    expect(first('maintenance tasks due')).toBeUndefined();
    expect(first('how much did the bills cost')).toBeUndefined();
    expect(first('projects')).toBeUndefined();
    expect(first('warranty')).toBeUndefined();
  });
});
