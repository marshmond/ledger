import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { allAnswerReaders } from '../core/registry';
import { answerPath, exampleQuestions, matchAnswers, type AnswerResult } from '../core/answers';
import { all, byTag, parseHtml, textOf } from '../lib/a11yTestkit';
import { registerModules } from '../modules';
import { maskMoney } from '../ui/TxnRefs';
import AnswersPage, { AnswerBody } from './AnswersPage';
import { answerHits, looksLikeQuestion } from './searchAnswers';
import { formatFigure, headlineText, rowAmountText } from './answersModel';

/**
 * R3.2: how an answer is drawn, with no browser. Hide amounts, "not known is never zero", read-only (no controls that type or save), links that stay inside Ledger, and the
 * Search rows. The browser walk-through (desktop and 375 px) is in the R3.2 report.
 */
registerModules();
const TODAY = '2026-11-16';

const result = (over: Partial<AnswerResult> = {}): AnswerResult => ({
  status: 'answered',
  headline: ['The most over is ', { money: 123456 }, ' above budget for Kitchen $1,200.00 refresh.'],
  period: { label: 'As of today $5.00', from: null, to: null },
  figures: [
    { id: 'a', label: 'Over by', value: { kind: 'money', cents: 300000, certainty: 'known' }, note: 'Note with $77.00' },
    { id: 'b', label: 'Estimate', value: { kind: 'money', cents: 4200, certainty: 'estimated' } },
    { id: 'c', label: 'Unknown amount', value: { kind: 'money', cents: null } },
    { id: 'd', label: 'Count', value: { kind: 'count', n: 3 } },
  ],
  groups: [{
    id: 'g', heading: 'Rows', rows: [{
      id: 'r1', title: 'Kitchen $1,200.00 refresh', detail: 'Budget was $900.00', date: '2026-11-20', dateLabel: 'Due', href: '#/projects/4', source: 'Projects',
      amounts: [{ label: 'Over by', cents: 300000, strong: true }, { label: 'Unknown', cents: null, certainty: 'unknown' }, { label: 'Est', cents: 1000, certainty: 'estimated' }],
      chips: [{ text: 'Over $5.00', tone: 'overdue' }], links: [{ label: 'Open task', href: '#/tasks?task=3' }],
    }],
  }],
  assumptions: ['Assumes $10.00 is fine.'], limitations: ['Leaves out $20.00.'],
  sources: [{ module: 'projects', label: 'Projects', href: '#/projects' }], fullView: { label: 'Open Projects', href: '#/projects' },
  ...over,
});
const draw = (r: AnswerResult, hide: boolean) => renderToStaticMarkup(<AnswerBody result={r} hide={hide} />);

describe('Hide amounts', () => {
  it('on: no digit of money appears anywhere, including amounts typed into a record name, a note, an assumption or the period', () => {
    const html = draw(result(), true);
    const text = textOf(parseHtml(html));
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).toContain('$••••');
    expect(html).not.toMatch(/1,234\.56|3,000\.00|42\.00|1,200\.00/); // ids-ok: invented amounts in a fixture, never an id
  });
  it('off: the same amounts are shown', () => {
    const text = textOf(parseHtml(draw(result(), false)));
    expect(text).toContain('$1,234.56');
    expect(text).toContain('$3,000.00');
    expect(text).toContain('$1,200.00');
  });
  it('the headline, a figure and a row amount follow the same switch', () => {
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(headlineText(result().headline, money, (t) => t)).toContain('$1234.56');
    expect(headlineText(result().headline, () => '$••••', maskMoney)).not.toMatch(/\d{2,}/);
  });
});

describe('not known is never zero', () => {
  it('a missing amount reads "Not known" and no zero is drawn', () => {
    const text = textOf(parseHtml(draw(result(), false)));
    expect(text).toContain('Not known');
    expect(text).not.toMatch(/\$0\.00/);
    expect(rowAmountText({ cents: null }, (c) => `$${c}`)).toBe('Not known');
    expect(rowAmountText({ cents: null, certainty: 'disputed' }, (c) => `$${c}`)).toBe('In dispute');
    expect(rowAmountText({ cents: 1000, certainty: 'estimated' }, (c) => `$${c / 100}`)).toBe('about $10');
    expect(formatFigure({ id: 'x', label: 'x', value: { kind: 'money', cents: null } }, { money: (c) => `$${c}`, text: (t) => t, day: (d) => d })).toEqual({ value: undefined, certainty: 'unknown' });
  });
});

describe('it is an answer, not a conversation', () => {
  it('has no field to type in, no button that saves, and no bubble, typing indicator or confidence word', () => {
    const html = draw(result(), false);
    const root = parseHtml(html);
    expect(byTag(root, 'input')).toHaveLength(0);
    expect(byTag(root, 'textarea')).toHaveLength(0);
    expect(byTag(root, 'form')).toHaveLength(0);
    expect(byTag(root, 'button')).toHaveLength(0);
    expect(html).not.toMatch(/typing|confidence|bubble|chat/i);
  });
  it('says where it came from, what was assumed and what is left out, and that nothing is changed', () => {
    const text = textOf(parseHtml(draw(result(), false)));
    expect(text).toContain('Where this came from');
    expect(text).toContain('What was assumed');
    expect(text).toContain('What is left out or uncertain');
    expect(text).toContain('Quick Answers only read your records');
    expect(text).toContain('Period:');
  });
  it('every link in an answer stays inside Ledger (a hash address)', () => {
    const links = all(parseHtml(draw(result(), false)), (e) => e.tag === 'a').map((a) => a.attrs.href);
    expect(links.length).toBeGreaterThan(3);
    for (const h of links) expect(h, String(h)).toMatch(/^#\/[a-z]/);
  });
  it('a limited answer, a "nothing found" answer and a "not enough information" answer each say so in words', () => {
    expect(textOf(parseHtml(draw(result({ status: 'limited', limitations: ['x'] }), false)))).toContain('Answered, with limits');
    expect(textOf(parseHtml(draw(result({ status: 'none' }), false)))).toContain('Checked: nothing found');
    const ins = textOf(parseHtml(draw(result({ status: 'insufficient', missing: { what: 'Service history', where: 'Home & Assets: add an asset.', href: '#/assets' } }), false)));
    expect(ins).toContain('Not enough information');
    expect(ins).toContain('Missing:');
    expect(ins).toContain('Where to add it:');
  });
  it('a complete answer carries no status chip', () => {
    const text = textOf(parseHtml(draw(result(), false)));
    expect(text).not.toMatch(/Answered, with limits|Checked: nothing found|Not enough information/);
  });
});

describe('the list of questions', () => {
  it('lists every question in the catalog with its period, each linking to its own address, and says it is not a chat', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/']}><AnswersPage /></MemoryRouter>);
    const text = textOf(parseHtml(html));
    expect(text).toContain('What can I ask?');
    expect(text).toContain('Quick Answers are not a chat');
    for (const { reader } of allAnswerReaders()) { expect(text, reader.id).toContain(reader.question); expect(html, reader.id).toContain(`href="#${answerPath(reader.id)}"`); }
    expect(all(parseHtml(html), (e) => e.tag === 'li' && /Period:/.test(textOf(e))).length).toBe(allAnswerReaders().length);
  });
  it('an unknown question id says so and offers the list', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/nonsense.thing']}><AnswersPage /></MemoryRouter>);
    expect(textOf(parseHtml(html))).toContain('Ledger does not have that question');
  });
});

describe('the Answers rows in Search', () => {
  const real = allAnswerReaders();
  const hits = (q: string) => answerHits(q, matchAnswers(q, real, TODAY), exampleQuestions(real));
  it('an empty box suggests three questions and "What can I ask?" without taking over the box', () => {
    const h = hits('');
    expect(h.heading).toBe('Questions you can ask');
    expect(h.items.map((i) => i.kind)).toEqual(['Answer', 'Answer', 'Answer', 'Page']);
    expect(h.items[3].to).toBe('/answers');
    for (const i of h.items.slice(0, 3)) expect(i.to).toMatch(/^\/answers\/[a-z]+\.[A-Za-z]+$/);
  });
  it('a matching question shows the reader\'s OWN question and period, not an echo of what was typed', () => {
    const h = hits('projects over budget');
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({ title: 'Which projects are over budget?', subtitle: 'as of today', kind: 'Answer', to: answerPath('projects.overBudget') });
  });
  it('a period Ledger does not answer is flagged on the row', () => {
    expect(hits('projects over budget last year').items[0].caveat).toMatch(/fixed period/);
  });
  it('an ambiguous question gives a note and several answers, not one authoritative answer', () => {
    const h = hits('what is due');
    expect(h.note).toMatch(/could mean several things/);
    expect(h.items.length).toBeGreaterThanOrEqual(2);
    expect(new Set(h.items.map((i) => i.key)).size).toBe(h.items.length);
  });
  it('an unsupported or ordinary search adds nothing: Search behaves as it did', () => {
    for (const q of ['groceries', 'budget', 'what is the weather', 'VTI', '45.20']) expect(hits(q).items, q).toEqual([]);
  });
  it('only a question-shaped search is told that Ledger answers a fixed set of questions', () => {
    expect(looksLikeQuestion('What is the weather?')).toBe(true);
    expect(looksLikeQuestion('how much is my net worth')).toBe(true);
    expect(looksLikeQuestion('groceries')).toBe(false);
    expect(looksLikeQuestion('budget')).toBe(false);
  });
  it('Search keeps every existing source, action and key: the dialog still lists Actions then module groups, and Answers sit between them', () => {
    const src = readFileSync('src/shell/SearchDialog.tsx', 'utf8');
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain("e.key === 'Enter'");
    expect(src).toContain('allSearchSources()');
    expect(src.indexOf('actions.map(')).toBeLessThan(src.indexOf('answers.map('));
    expect(src.indexOf('answers.map(')).toBeLessThan(src.indexOf('groups.map('));
  });
});
