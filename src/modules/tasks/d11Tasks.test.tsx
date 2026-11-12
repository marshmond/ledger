import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { blankTask, type TaskData, type TaskRecord } from './model';
import { NO_FILTER, SORTS, VIEWS, buildView, isOverdue, type Filter } from './views';
import { PHONE_PRIMARY, activeFilterCount, describeFilters, dueState, isFiltering, isMoreView, phoneMoreViews, phonePrimaryViews } from './viewModel';
import TaskRow from './TaskRow';
import { FilterFields, PhoneViews, RangeSelect, SortSelect, ViewTabs, type FilterEnv } from './TasksControls';

/**
 * D11. The Tasks screen's new layout. The guards are about what must NOT change: every view stays reachable, the phone's filters and the computer's chips read
 * and write the one filter state, a row still has all its controls and meanings, nothing says a task belongs to a person, and no task rule moved.
 * Every task and name below is invented.
 */

const TODAY = '2026-11-12'; // a Thursday
let id = 1;
const task = (over: Partial<TaskData> = {}): TaskRecord => ({ id: id++, createdAt: id, updatedAt: id, data: blankTask({ title: `Task ${id}`, ...over }) });
const row = (t: TaskRecord, extra: Partial<Parameters<typeof TaskRow>[0]> = {}) => renderToStaticMarkup(
  <ul><TaskRow task={t} lists={[{ id: 1, name: 'Home' }]} tags={[{ id: 5, name: 'house' }]} projects={[]} today={TODAY} selecting={false} selected={false} onSelect={() => undefined} onOpen={() => undefined} onToggle={() => undefined} {...extra} /></ul>);

describe('D11 views: every one stays reachable', () => {
  it('the phone shows Today, Upcoming, Overdue, All; the other six are under More; together exactly the ten views once each', () => {
    expect(VIEWS.map((v) => v.id)).toEqual(['today', 'upcoming', 'overdue', 'all', 'lists', 'tags', 'priority', 'waiting', 'completed', 'deleted']);
    expect(phonePrimaryViews().map((v) => v.id)).toEqual(['today', 'upcoming', 'overdue', 'all']);
    expect(phoneMoreViews().map((v) => v.id)).toEqual(['lists', 'tags', 'priority', 'waiting', 'completed', 'deleted']);
    const both = [...phonePrimaryViews(), ...phoneMoreViews()].map((v) => v.id).sort();
    expect(both).toEqual(VIEWS.map((v) => v.id).sort());
    expect(new Set(both).size).toBe(10);
    expect(PHONE_PRIMARY).toHaveLength(4);
  });

  it('isMoreView is true for exactly the six', () => {
    expect(VIEWS.filter((v) => isMoreView(v.id)).map((v) => v.id)).toEqual(['lists', 'tags', 'priority', 'waiting', 'completed', 'deleted']);
  });

  it('the computer draws all ten as one tab list with the current one selected and counts only where they were shown before', () => {
    const html = renderToStaticMarkup(<ViewTabs view="all" counts={{ today: 1, overdue: 2, waiting: 3 }} onGo={() => undefined} />);
    expect((html.match(/role="tab"/g) ?? []).length).toBe(10);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Task views"');
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"[^>]*>All</);
    expect((html.match(/class="count/g) ?? []).length).toBe(3); // Today, Overdue, Waiting
    expect(html).toContain('tk-count--late'); // Overdue's count is red-tinted (the word Overdue is the tab)
  });

  it('the phone draws four view buttons and More; a view chosen from More is named on the More button and pressed', () => {
    const plain = renderToStaticMarkup(<PhoneViews view="today" counts={{ today: 0, overdue: 0, waiting: 0 }} onGo={() => undefined} />);
    expect((plain.match(/<button/g) ?? []).length).toBe(5);
    expect(plain).toContain('aria-pressed="true"');
    expect(plain).toContain('aria-haspopup="true"');
    expect(plain).toContain('aria-label="More task views"');
    expect(plain).not.toContain('id="tk-more"'); // closed until asked for
    const on = renderToStaticMarkup(<PhoneViews view="priority" counts={{ today: 0, overdue: 0, waiting: 0 }} onGo={() => undefined} />);
    expect(on).toContain('By priority');
    expect((on.match(/aria-pressed="true"/g) ?? []).length).toBe(1); // only the More button, which names the active view
    expect(on).not.toContain('aria-label="More task views"'); // its visible words are its name
  });
});

describe('D11 filters: one state, same options on both layouts', () => {
  const env: FilterEnv = {
    filter: NO_FILTER, onChange: () => undefined, lists: [{ id: 1, name: 'Home' }, { id: 2, name: 'Work' }], tags: [{ id: 5, name: 'house' }],
    projects: [{ id: 9, name: 'Kitchen refresh' } as never],
  };
  const options = (html: string) => [...html.matchAll(/<select[^>]*aria-label="([^"]+)"[^>]*>(.*?)<\/select>/g)].map((m) => [m[1], [...m[2].matchAll(/value="([^"]*)"/g)].map((o) => o[1])]);

  it('the chips and the sheet render the same selects with the same option values in the same order', () => {
    const chips = options(renderToStaticMarkup(<FilterFields env={env} />));
    const sheet = options(renderToStaticMarkup(<FilterFields env={env} labelled />));
    expect(sheet).toEqual(chips);
    expect(chips.map((c) => c[0])).toEqual(['Filter by priority', 'Filter by list', 'Filter by tag', 'Filter by project']);
    expect(chips[0][1]).toEqual(['', 'high', 'medium', 'low', 'reminder']);
    expect(chips[1][1]).toEqual(['', 'none', '1', '2']);
    expect(chips[3][1]).toEqual(['', 'none', '9']);
  });

  it('the project filter is absent when there are no projects (as before)', () => {
    expect(options(renderToStaticMarkup(<FilterFields env={{ ...env, projects: [] }} />)).map((c) => c[0])).not.toContain('Filter by project');
  });

  it('a filter that is set is marked on its chip (outline and bold), and one that is not is not', () => {
    const html = renderToStaticMarkup(<FilterFields env={{ ...env, filter: { ...NO_FILTER, priority: 'high' } }} />);
    expect((html.match(/tk-chip on/g) ?? []).length).toBe(1);
    expect(renderToStaticMarkup(<FilterFields env={env} />)).not.toContain('tk-chip on');
  });

  it('the sort and range choices offer the existing options, in Completed too', () => {
    const sort = renderToStaticMarkup(<SortSelect value="due" view="all" onChange={() => undefined} />);
    expect([...sort.matchAll(/value="([^"]+)"/g)].map((m) => m[1])).toEqual(['due', 'priority', 'created', 'title']);
    const done = renderToStaticMarkup(<SortSelect value="completed" view="completed" onChange={() => undefined} />);
    expect([...done.matchAll(/value="([^"]+)"/g)].map((m) => m[1])).toEqual(SORTS.map((s) => s.id));
    expect(renderToStaticMarkup(<SortSelect value="due" view="all" onChange={() => undefined} labelled />)).toContain('Sort by</span>');
    expect([...renderToStaticMarkup(<RangeSelect value={7} onChange={() => undefined} />).matchAll(/value="(\d+)"/g)].map((m) => m[1])).toEqual(['7', '14', '30']);
  });

  it('isFiltering is the page\'s original test, and Clear filters (NO_FILTER) is "off"', () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering({ ...NO_FILTER })).toBe(false);
    expect(isFiltering({ ...NO_FILTER, text: 'a' })).toBe(true);
    expect(isFiltering({ ...NO_FILTER, projectId: 'none' })).toBe(true);
    expect(isFiltering({ ...NO_FILTER, contactId: 4 })).toBe(true);
    const old = (f: Filter) => JSON.stringify(f) !== JSON.stringify(NO_FILTER);
    for (const f of [NO_FILTER, { ...NO_FILTER, tagId: 3 }, { ...NO_FILTER, listId: 'none' as const }]) expect(isFiltering(f)).toBe(old(f));
  });

  it('the Filters button counts every filter except the search words, including those set by a link (contact, project)', () => {
    expect(activeFilterCount(NO_FILTER)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTER, text: 'soccer' })).toBe(0);
    expect(activeFilterCount({ text: '', priority: 'high', listId: 'none', tagId: 3, contactId: 7, projectId: 'none' })).toBe(5);
    expect(activeFilterCount({ ...NO_FILTER, projectId: '' })).toBe(0);
  });

  it('the active filters read out in words, with unknown names handled', () => {
    const names = { lists: [{ id: 1, name: 'Home' }], tags: [{ id: 5, name: 'house' }], projectLabel: (i: number) => `Project ${i}`, contact: 'Pat Demo' };
    expect(describeFilters(NO_FILTER, names)).toEqual([]);
    expect(describeFilters({ text: 'x', priority: 'high', listId: 1, tagId: 5, contactId: 2, projectId: 9 }, names)).toEqual(['Priority: High', 'List: Home', 'Tag: #house', 'Project: Project 9', 'Contact: Pat Demo']);
    expect(describeFilters({ ...NO_FILTER, listId: 'none', projectId: 'none' }, names)).toEqual(['List: none', 'Project: none']);
    expect(describeFilters({ ...NO_FILTER, listId: 99 }, names)).toEqual(['List: unknown']);
  });

  it('the page keeps ONE filter state and draws both layouts from it (no second filter, no mobile-only logic)', () => {
    const page = readFileSync('src/modules/tasks/TasksPage.tsx', 'utf8');
    expect((page.match(/useState<Filter>/g) ?? []).length).toBe(1);
    expect(page).toContain('useState<Filter>(NO_FILTER)');
    expect((page.match(/<FilterFields env=\{env\}/g) ?? []).length).toBe(2); // the chips and the sheet
    expect((page.match(/setFilter\(NO_FILTER\)/g) ?? []).length).toBeGreaterThanOrEqual(3); // every reset goes to the same default
    expect(page).toContain('buildView(view, tasks ?? [], deleted,');
    expect(page).not.toMatch(/matchesMobile|mobileFilter|phoneFilter/);
  });
});

describe('D11 rows: every control and meaning is still there', () => {
  it('the title button is the shared left-aligned row and the tick is a named checkbox', () => {
    const html = row(task({ title: 'Pay the plumber', priority: 'high' }));
    expect(html).toContain('class="ui-row tk-main"');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-label="Mark done: Pay the plumber"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('High priority'); // the priority is read out, and drawn as a shape
    expect(html).toContain('tk-row p-high');
  });

  it('a finished task offers to mark it not done and says Done', () => {
    const html = row(task({ title: 'Done thing', status: 'done', completedAt: 1 }));
    expect(html).toContain('aria-label="Mark not done: Done thing"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('>Done<');
    expect(html).toContain('due-done');
  });

  it('selecting swaps the tick for a named check box; the Deleted view swaps it for Restore', () => {
    expect(row(task({ title: 'A' }), { selecting: true })).toContain('aria-label="Select A"');
    expect(row(task({ title: 'A' }), { selecting: true, selected: true })).toMatch(/tk-row p-medium due-none\s+selected/);
    const del = row(task({ title: 'A' }), { restore: () => undefined });
    expect(del).toContain('Restore');
    expect(del).not.toContain('role="checkbox"');
  });

  it('a repeating task shows its repeat mark; status, list, tags, project and steps keep their words', () => {
    const html = row(task({
      title: 'Filter swap', status: 'waiting', listId: 1, tagIds: [5], projectId: 9, isMilestone: true, dueDate: '2026-11-20',
      repeat: { mode: 'fixed', rule: { freq: 'monthly', interval: 1 } as never },
      checklist: [{ id: 1, text: 'a', done: true }, { id: 2, text: 'b', done: false }],
    }), { projects: [{ id: 9, name: 'Kitchen refresh' } as never] });
    expect(html).toContain('aria-label="Repeats"');
    expect(html).toContain('>Waiting<');
    expect(html).toContain('Home');
    expect(html).toContain('#house');
    expect(html).toContain('1/2 steps');
    expect(html).toContain('◆'); // a milestone keeps its mark
    expect(html).toContain('Kitchen refresh');
  });

  it('the five date looks: overdue, due today, tomorrow, upcoming and none, each with its words', () => {
    expect(row(task({ dueDate: '2026-11-09' }))).toContain('Overdue');
    expect(row(task({ dueDate: '2026-11-09' }))).toContain('tk-row p-medium due-overdue  late');
    expect(row(task({ dueDate: TODAY }))).toContain('Due today');
    const tomorrow = row(task({ dueDate: '2026-11-13' }));
    expect(tomorrow).toContain('Tomorrow');
    expect(tomorrow).toContain('Due </span>'); // read out as "Due", the way the old text did
    expect(row(task({ dueDate: '2026-12-02' }))).toContain('datetime="2026-12-02"'.replace('datetime', 'dateTime'));
    expect(row(task({}))).toContain('No due date');
    expect(row(task({ startDate: '2026-11-14' }))).toContain('Do on');
    expect(row(task({ dueDate: TODAY, dueTime: '15:30' }))).toMatch(/3:30\s?PM/);
  });

  it('a date in another year keeps its year, and a date does not move across a month or year end', () => {
    const next = row(task({ dueDate: '2027-01-02' }));
    expect(next).toContain('<b>Sat</b>, Jan 2, 2027');
    expect(next).toContain('dateTime="2027-01-02"');
    expect(dueState(task({ dueDate: '2026-12-01' }), '2026-11-30')).toBe('tomorrow');
    expect(dueState(task({ dueDate: '2027-01-01' }), '2026-12-31')).toBe('tomorrow');
    expect(dueState(task({ dueDate: '2026-03-09' }), '2026-03-08')).toBe('tomorrow'); // clocks go forward that night
  });

  it('dueState restates the module\'s own rules and adds no state', () => {
    const t = (d: Partial<TaskData>) => task(d);
    expect(dueState(t({ status: 'done', dueDate: '2026-01-01' }), TODAY)).toBe('done');
    expect(dueState(t({ dueDate: '2026-11-11' }), TODAY)).toBe('overdue');
    expect(dueState(t({ dueDate: TODAY }), TODAY)).toBe('today');
    expect(dueState(t({ dueDate: '2026-11-13' }), TODAY)).toBe('tomorrow');
    expect(dueState(t({ dueDate: '2026-12-25' }), TODAY)).toBe('upcoming');
    expect(dueState(t({ startDate: '2026-11-20' }), TODAY)).toBe('planned');
    expect(dueState(t({}), TODAY)).toBe('none');
    for (const x of [t({ dueDate: '2026-11-11' }), t({ dueDate: TODAY }), t({ status: 'done', dueDate: '2026-11-01' }), t({})]) {
      expect(dueState(x, TODAY) === 'overdue').toBe(isOverdue(x, TODAY));
    }
  });

  it('a long unbroken title stays inside its row and wraps by letter', () => {
    const html = row(task({ title: 'Supercalifragilisticexpialidocious'.repeat(4) }));
    expect(html).toContain('tk-title-text');
    const css = readFileSync('src/modules/tasks/tasks.css', 'utf8');
    expect(css).toMatch(/\.tk-title-text \{[^}]*overflow-wrap: anywhere/);
  });

  it('nothing says a task is assigned to, owned by or the duty of a person', () => {
    const t = task({ title: 'School form', contactIds: [3, 4] });
    const html = row(t);
    expect(html).not.toMatch(/assign|owner|responsib|belongs to|for (alex|jordan)/i);
    expect(html).not.toContain('Contact'); // a task that names a Contact shows no Contact on the row, as before
    for (const f of readdirSync('src/modules/tasks').filter((x) => /\.(tsx?|css)$/.test(x) && !/\.test\./.test(x))) {
      expect(readFileSync(`src/modules/tasks/${f}`, 'utf8'), f).not.toMatch(/assignee|assignedTo|assigned to|ownerId|responsible for/i);
    }
  });
});

describe('D11 view contents and ordering are the module\'s own', () => {
  const lists = [{ id: 1, name: 'Home' }];
  const ctx = { today: TODAY, days: 7, sort: 'due' as const, filter: NO_FILTER, lists, tags: [] };
  const all = [
    task({ title: 'late', dueDate: '2026-11-09' }), task({ title: 'today', dueDate: TODAY, priority: 'high' }), task({ title: 'tomorrow', dueDate: '2026-11-13' }),
    task({ title: 'later', dueDate: '2026-11-30' }), task({ title: 'undated' }), task({ title: 'finished', status: 'done', completedAt: Date.now() }), task({ title: 'waiting', status: 'waiting' }),
  ];

  it('Today lists overdue, then due today; Upcoming groups by day; Overdue and All are as before', () => {
    expect(buildView('today', all, [], ctx).map((g) => [g.title, g.tasks.map((t) => t.data.title)])).toEqual([['Overdue', ['late']], ['Due today', ['today']]]);
    expect(buildView('upcoming', all, [], ctx).map((g) => g.key)).toEqual(['2026-11-13']);
    expect(buildView('overdue', all, [], ctx)[0].tasks.map((t) => t.data.title)).toEqual(['late']);
    expect(buildView('all', all, [], ctx)[0].tasks.map((t) => t.data.title)).toEqual(['late', 'today', 'tomorrow', 'later', 'undated', 'waiting']);
    expect(buildView('waiting', all, [], ctx)[0].tasks.map((t) => t.data.title)).toEqual(['waiting']);
  });

  it('sorting still changes the order, and a filter still narrows every view the same way', () => {
    expect(buildView('all', all, [], { ...ctx, sort: 'title' })[0].tasks.map((t) => t.data.title)).toEqual(['later', 'late', 'tomorrow', 'today', 'undated', 'waiting'].sort((a, b) => a.localeCompare(b)));
    expect(buildView('all', all, [], { ...ctx, sort: 'priority' })[0].tasks[0].data.title).toBe('today');
    const f = { ...NO_FILTER, text: 'to' };
    expect(buildView('all', all, [], { ...ctx, filter: f })[0].tasks.map((t) => t.data.title)).toEqual(['today', 'tomorrow']);
    expect(buildView('all', all, [], { ...ctx, filter: { ...NO_FILTER, priority: 'high' } })[0].tasks.map((t) => t.data.title)).toEqual(['today']);
  });
});

describe('D11 page structure and style rules', () => {
  const page = readFileSync('src/modules/tasks/TasksPage.tsx', 'utf8');
  const css = readFileSync('src/modules/tasks/tasks.css', 'utf8');

  it('the bulk bar keeps its role, name, count and every control', () => {
    expect(page).toContain('role="toolbar" aria-label="Bulk actions"');
    for (const label of ['New due date', 'Change priority', 'Move to list', 'Put on a project', 'Add a tag']) expect(page, label).toContain(`aria-label="${label}"`);
    for (const word of ['Complete', 'Reschedule', 'Delete', 'selected']) expect(page, word).toContain(word);
    expect(page).toContain('setSelected(new Set(visible.map((t) => t.id)))'); // "All N"
    expect(page).toContain('bulkProject');
    expect(page).toContain('Done selecting');
  });

  it('the bulk bar still sticks just below the global header (the --bar-h that D7 and D8 build)', () => {
    expect(css).toMatch(/\.tk-bulk \{[^}]*position: sticky; top: calc\(var\(--bar-h, 36px\) \+ 4px\)/);
  });

  it('completion, reopening, editing and the bulk functions are the same calls as before', () => {
    expect(page).toContain('await reopenTask(t.id)');
    expect(page).toContain('await completeTask(t.id, today)');
    expect(page).toContain('onOpen={setEditing}');
    expect(page).toContain('<TaskEditor key={editing.id}');
    expect(page).toContain('<ListsDialog');
    expect(page).toContain("const VIEW_KEY = 'tasks-last-view'");
    expect(page).toContain("sp.get('v')");
  });

  it('the page title is the shared PageHeader; the Lists button and the add box are still there', () => {
    expect(page).toContain('<PageHeader title="Tasks"');
    expect(page).toContain('Lists…');
    expect(page).toContain('<QuickAddBar />');
  });

  it('the phone sheet is the shared dialog (focus, Escape and return of focus come with it) and says how many tasks it will show', () => {
    expect(page).toContain('<Modal title="Filters" onClose={() => setSheet(false)} variant="sheet">');
    expect(page).toContain('Show {visible.length} task');
    expect(page).toContain("useMediaQuery('(max-width: 640px)')");
  });

  it('the stylesheet follows the rules: no new colors, no important flag, left-aligned rows, 44px tick area, tokens only', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![^{]*\})/); // no hex outside values below
    expect(css).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(css).not.toContain('!important');
    expect(css).toMatch(/\.tk-row > button\.tk-main \{[^}]*text-align: left/);
    expect(css).not.toMatch(/\.tk-(row|main|title)[^{]*\{[^}]*text-align: center/);
    expect(css).toMatch(/\.tk-row \{ display: grid; grid-template-columns: 44px/);
    expect(css).toContain('.tk-check::after { content: \'\'; position: absolute; inset: -9px; }');
  });

  it('the editor\'s own Due row class was not taken over', () => {
    expect(css).toMatch(/\.tk-due \{ flex-wrap: nowrap/);
    expect(readFileSync('src/modules/tasks/TaskEditor.tsx', 'utf8')).toContain('tk-due');
    expect(readFileSync('src/modules/tasks/TaskRow.tsx', 'utf8')).toContain('tk-duecell');
  });

  it('Task creation and Quick Add are untouched: the same add box, the same creator, the same owning module', () => {
    const quick = readFileSync('src/modules/tasks/QuickTask.tsx', 'utf8');
    expect(quick).toContain('export function QuickAddBar');
    expect(quick).toContain('export function TaskCreator');
    expect(quick).toContain('await createTask(');
    expect(quick).toContain('aria-label="New task"');
    expect(page).not.toMatch(/createTask\(/); // the page still does not create tasks itself
  });
});
