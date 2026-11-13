import { readFileSync } from 'node:fs';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { routeQuickAdd } from '../core/quickAddRoute';
import { allModules, allQuickAdds, type QuickAddDef } from '../core/registry';
import { all, byTag, parseHtml, textOf, unnamedButtons, type El } from '../lib/a11yTestkit';
import { registerModules } from '../modules';
import { ICON_NAMES, Icon } from '../ui/icons';
import { wantsAddShortcut } from './GlobalFrame';
import AddBoxView, { type AddBoxViewProps } from './AddBoxView';
import {
  FEATURED, SPECIAL_ACTIONS, destIcon, destKind, feedbackKind, layoutDestinations, orderDestinations, primaryAction, resolveDestination, shortcutHint, showsInput,
} from './addBoxModel';
import { KEYBOARD_PX, SHEET_QUERY, attachSheet, lockScroll, scrollLocksHeld, sheetInsets, type BackdropLike, type LockTarget, type WindowLike } from './sheetBehavior';

/**
 * D10: Quick Add. The model, the view and the sheet behaviour are checked here without a browser; the real-browser checks (every creation path, the
 * phone sheet, the keyboard resize, Escape and focus return) are in the D10 report. Nothing here changes what Quick Add creates or how a line is read.
 */
registerModules();
const read = (f: string) => readFileSync(f, 'utf8');
const css = read('src/styles.css');
const components = read('src/ui/components.css');
type Def = QuickAddDef & { moduleId: string };
const defs = (): Def[] => orderDestinations(allQuickAdds());

/** The eleven destinations as the code defines them today (shortcut, then the other words that pick it). A change here must be a deliberate change to Quick Add itself. */
const ELEVEN: Record<string, { prefix: string; aliases: string[]; module: string }> = {
  task: { prefix: 't', aliases: ['task'], module: 'tasks' },
  event: { prefix: 'e', aliases: ['event'], module: 'calendar' },
  transaction: { prefix: '$', aliases: ['txn', 'transaction', 'expense'], module: 'ledger' },
  scheduled: { prefix: 'b', aliases: ['bill', 'scheduled'], module: 'ledger' },
  project: { prefix: 'p', aliases: ['project'], module: 'projects' },
  asset: { prefix: 'a', aliases: ['asset', 'item'], module: 'assets' },
  service: { prefix: 'svc', aliases: ['service', 'repair'], module: 'assets' },
  'household-service': { prefix: 'hs', aliases: ['household'], module: 'services' },
  'bills-obligation': { prefix: 'bs', aliases: ['subscription', 'sub'], module: 'bills' },
  'family-member': { prefix: 'fam', aliases: ['family'], module: 'family' },
  'family-date': { prefix: 'fd', aliases: ['famdate'], module: 'family' },
};

describe('D10 the eleven destinations are all still registered, with the same shortcuts, words and owning modules', () => {
  it('registers exactly the eleven, each owned by the module that always owned it', () => {
    expect(allQuickAdds().map((d) => d.id).sort()).toEqual(Object.keys(ELEVEN).sort());
    for (const d of allQuickAdds()) {
      expect(d.prefix, d.id).toBe(ELEVEN[d.id].prefix);
      expect([...(d.aliases ?? [])].sort(), d.id).toEqual([...ELEVEN[d.id].aliases].sort());
      expect(d.moduleId, d.id).toBe(ELEVEN[d.id].module);
    }
  });
  it('every shortcut and every alias picks its destination, with or without the colon, in any case, and leaves the rest of the line alone', () => {
    const list = defs();
    for (const d of list) {
      for (const word of [d.prefix, ...(d.aliases ?? [])]) {
        for (const typed of [`${word} buy milk`, `${word}: buy milk`, `${word.toUpperCase()} buy milk`]) {
          const r = routeQuickAdd(typed, list);
          expect(r.def?.id, typed).toBe(d.id);
          expect(r.rest, typed).toBe('buy milk');
        }
      }
    }
  });
  it('a word that is not a shortcut, or has no space after it, still picks nothing (the box never guesses)', () => {
    const list = defs();
    expect(routeQuickAdd('buy milk', list).def).toBeNull();
    expect(routeQuickAdd('tomorrow buy milk', list).def).toBeNull();
    expect(routeQuickAdd('t', list).def).toBeNull();
    expect(routeQuickAdd('xyz buy milk', list).def).toBeNull();
  });
  it('the kinds are as before: seven typed lines, Transaction is a form, the other three open another screen', () => {
    const kinds = Object.fromEntries(allQuickAdds().map((d) => [d.id, destKind(d)]));
    expect(kinds).toEqual({
      task: 'text', event: 'text', project: 'text', asset: 'text', service: 'text', 'household-service': 'text', 'bills-obligation': 'text',
      transaction: 'form', scheduled: 'open', 'family-member': 'open', 'family-date': 'open',
    });
    expect(destKind(null)).toBe('none');
  });
  it('the chooser still reads Task, Event, Transaction, Scheduled payment first', () => {
    expect(defs().slice(0, 4).map((d) => d.id)).toEqual(['task', 'event', 'transaction', 'scheduled']);
  });
});

describe('D10 the featured three and the groups', () => {
  it('Task, Event and Transaction are the three cards, in that order, each with a one-line description', () => {
    const l = layoutDestinations(defs(), allModules());
    expect(l.featured.map((f) => f.def.id)).toEqual(['task', 'event', 'transaction']);
    expect(FEATURED.map((f) => f.id)).toEqual(['task', 'event', 'transaction']);
    for (const f of l.featured) expect(f.sub.length).toBeGreaterThan(5);
  });
  it('the other eight are grouped by the module that owns them, using the module switcher\'s own groups (nothing stored, nothing re-listed here)', () => {
    const l = layoutDestinations(defs(), allModules());
    expect(l.groups.map((g) => [g.label, g.defs.map((d) => d.id)])).toEqual([
      ['Productivity', ['project']],
      ['Household', ['asset', 'service', 'household-service', 'bills-obligation', 'family-member', 'family-date']],
      ['Finances', ['scheduled']],
    ]);
  });
  it('every destination appears exactly once: as a card or in one group', () => {
    const l = layoutDestinations(defs(), allModules());
    const shown = [...l.featured.map((f) => f.def.id), ...l.groups.flatMap((g) => g.defs.map((d) => d.id))];
    expect(shown.sort()).toEqual(Object.keys(ELEVEN).sort());
    expect(new Set(shown).size).toBe(shown.length);
  });
  it('a module that is not registered degrades: its card or row is simply absent, and a destination from an unknown module lands in "Other" instead of being hidden', () => {
    const noTasks = layoutDestinations(defs().filter((d) => d.moduleId !== 'tasks'), allModules());
    expect(noTasks.featured.map((f) => f.def.id)).toEqual(['event', 'transaction']);
    const stray: Def = { id: 'future', label: 'Future thing', prefix: 'ft', moduleId: 'not-a-module' };
    const withStray = layoutDestinations([...defs(), stray], allModules());
    expect(withStray.groups[withStray.groups.length - 1]).toMatchObject({ key: 'other', label: 'Other' });
    expect(withStray.groups[withStray.groups.length - 1].defs.map((d) => d.id)).toEqual(['future']);
    expect(destIcon('future')).toBe('plus');
    expect(layoutDestinations([], allModules())).toEqual({ featured: [], groups: [] });
  });
  it('the display grouping reads the registered module metadata: no group table of its own', () => {
    const src = read('src/shell/addBoxModel.ts');
    expect(src).toMatch(/groupModules\(mods\)/);
    expect(src).not.toMatch(/moduleId === '|moduleId == '/); // no destination is placed by name
  });
});

describe('D10 which destination is chosen, and what the box asks for next', () => {
  const list = () => defs();
  it('maps a request to state: a typed shortcut wins, then the chosen destination, else nothing', () => {
    expect(resolveDestination(list(), 't buy milk', null)).toMatchObject({ dest: { id: 'task' }, body: 'buy milk' });
    expect(resolveDestination(list(), 'buy milk', 'event')).toMatchObject({ dest: { id: 'event' }, body: 'buy milk' });
    expect(resolveDestination(list(), 'e lunch', 'task')).toMatchObject({ dest: { id: 'event' }, body: 'lunch' }); // the typed shortcut wins over a stale choice
    expect(resolveDestination(list(), 'buy milk', null).dest).toBeNull();
    expect(resolveDestination(list(), 'buy milk', 'not-a-destination').dest).toBeNull();
    expect(resolveDestination(list(), '', 'transaction')).toMatchObject({ dest: { id: 'transaction' }, body: '' });
  });
  it('the text field is shown with no choice and for a typed destination, and hidden for a form or another screen (as before)', () => {
    const by = (id: string) => list().find((d) => d.id === id)!;
    expect(showsInput(null)).toBe(true);
    for (const id of ['task', 'event', 'project', 'asset', 'service', 'household-service', 'bills-obligation']) expect(showsInput(by(id)), id).toBe(true);
    for (const id of ['transaction', 'scheduled', 'family-member', 'family-date']) expect(showsInput(by(id)), id).toBe(false);
  });
  it('the line under the field says what to do next', () => {
    const task = list().find((d) => d.id === 'task')!;
    const txn = list().find((d) => d.id === 'transaction')!;
    const preview = task.parse!('buy milk fri')!;
    expect(feedbackKind({ dest: null, text: '', body: '', preview: null })).toBe('choose');
    expect(feedbackKind({ dest: null, text: 'buy milk', body: 'buy milk', preview: null })).toBe('ask');
    expect(feedbackKind({ dest: task, text: '', body: '', preview: null })).toBe('type');
    expect(feedbackKind({ dest: task, text: 'buy milk fri', body: 'buy milk fri', preview })).toBe('preview');
    expect(feedbackKind({ dest: task, text: '   ', body: '   ', preview: null })).toBe('type');
    expect(feedbackKind({ dest: txn, text: '', body: '', preview: null })).toBe('panel');
  });
  it('the primary button is ready only when the destination\'s own parser has produced a preview', () => {
    const task = list().find((d) => d.id === 'task')!;
    const ready = task.parse!('buy milk fri');
    expect(ready).not.toBeNull();
    expect(primaryAction({ dest: task, preview: ready, busy: false })).toEqual({ kind: 'submit', label: 'Add task', disabled: false });
    expect(primaryAction({ dest: task, preview: null, busy: false })).toEqual({ kind: 'submit', label: 'Add task', disabled: true });
    expect(primaryAction({ dest: task, preview: ready, busy: true })).toEqual({ kind: 'submit', label: 'Adding…', disabled: true });
    expect(primaryAction({ dest: null, preview: null, busy: false })).toEqual({ kind: 'submit', label: 'Add', disabled: true });
    expect(task.parse!('')).toBeNull(); // nothing typed, nothing to add
  });
  it('every typed destination names its action "Add <thing>"', () => {
    for (const d of list().filter((x) => x.parse)) expect(primaryAction({ dest: d, preview: null, busy: false }).label, d.id).toBe(`Add ${d.label.toLowerCase()}`);
  });
  it('Transaction has no footer button (its own form has the Save); the three open-another-screen destinations use their own button words and are never disabled', () => {
    const by = (id: string) => list().find((d) => d.id === id)!;
    expect(primaryAction({ dest: by('transaction'), preview: null, busy: false }).kind).toBe('none');
    expect(primaryAction({ dest: by('scheduled'), preview: null, busy: false })).toEqual({ kind: 'open', label: 'Open the Scheduled screen', disabled: false });
    expect(primaryAction({ dest: by('family-member'), preview: null, busy: false })).toEqual({ kind: 'open', label: 'Open the Add member form', disabled: false });
    expect(primaryAction({ dest: by('family-date'), preview: null, busy: false })).toEqual({ kind: 'open', label: 'Open the Add date form', disabled: false });
  });
  it('the shortcut hint names the three featured shortcuts', () => {
    expect(shortcutHint(layoutDestinations(defs(), allModules()))).toBe('t task · e event · $ transaction');
  });
});

/** A view with sensible defaults, over the real registered destinations. */
function view(over: Partial<AddBoxViewProps> = {}, destId: string | null = null): { html: string; root: El } {
  const list = defs();
  const dest = list.find((d) => d.id === destId) ?? null;
  const noop = () => undefined;
  const props: AddBoxViewProps = {
    layout: layoutDestinations(list, allModules()), destId, dest, showInput: showsInput(dest), value: '', inputRef: createRef<HTMLInputElement>(),
    inputLabel: dest ? `New ${dest.label.toLowerCase()}` : 'What do you want to add?', placeholder: 'Type here, or pick a type below',
    feedback: dest ? feedbackKind({ dest, text: '', body: '', preview: null }) : 'choose', hint: 't task · e event · $ transaction', preview: null, plain: false, panel: null,
    error: '', primary: primaryAction({ dest, preview: null, busy: false }), formId: 'ab-test', expanded: false,
    onInput: noop, onSubmit: noop, onPick: noop, onClear: noop, onPlain: noop, onPrimary: noop, onCancel: noop, onToggleAll: noop, onGo: noop, ...over,
  };
  const html = renderToStaticMarkup(createElement(AddBoxView, props));
  return { html, root: parseHtml(html) };
}
const buttonTexts = (root: El) => byTag(root, 'button').map((b) => textOf(b).replace(/\s+/g, ' ').trim());

describe('D10 the view: command field first, three cards, groups, specialised actions', () => {
  it('the command field is the first interactive thing, and it is a plain text input (so the N shortcut already ignores it)', () => {
    const { root } = view();
    const first = all(root, (e) => ['input', 'button', 'a', 'select', 'textarea'].includes(e.tag))[0];
    expect(first.tag).toBe('input');
    expect(first.attrs['aria-label']).toBe('What do you want to add?');
    expect(first.attrs.autoComplete).toBe('off');
  });
  it('shows the three cards (as toggle buttons) and every one of the other eight, plus both specialised actions', () => {
    const { root } = view();
    const pressed = byTag(root, 'button').filter((b) => 'aria-pressed' in b.attrs).map((b) => textOf(b).replace(/\s+/g, ' ').trim());
    expect(pressed.length).toBe(11);
    for (const label of ['Task', 'Event', 'Transaction', 'Project', 'Asset', 'Service', 'Household service', 'Bill or subscription', 'Family member', 'Family date', 'Scheduled payment'])
      expect(pressed.some((t) => t.startsWith(label)), label).toBe(true);
    const texts = buttonTexts(root);
    expect(texts).toContain('Log a trade');
    expect(texts).toContain('New paycheck scenario');
    expect(texts).toContain('Cancel');
  });
  it('the cards come first and are in a labeled group; the other types are in three labeled sections', () => {
    const { root } = view();
    const cards = all(root, (e) => e.tag === 'button' && /\bab-card\b/.test(e.attrs.class ?? ''));
    expect(cards.map((c) => textOf(c).trim().split(' ')[0])).toEqual(['Task', 'Event', 'Transaction']);
    const sections = all(root, (e) => e.tag === 'section' && /\bab-grp\b/.test(e.attrs.class ?? ''));
    expect(sections.map((s) => textOf(all(s, (e) => e.tag === 'h3')[0]).trim())).toEqual(['Productivity', 'Household', 'Finances']);
  });
  it('Log a trade and New paycheck scenario sit in a group named "Opens another screen", apart from the types that create something', () => {
    const { root, html } = view();
    const go = all(root, (e) => e.attrs.class === 'ab-go')[0];
    expect(go.attrs['aria-labelledby']).toBe('ab-go-note');
    expect(html).toContain('Opens another screen');
    expect(byTag(go, 'button').map((b) => textOf(b).trim())).toEqual(['Log a trade', 'New paycheck scenario']);
    expect(SPECIAL_ACTIONS.map((a) => a.path)).toEqual(['/ledger/investments', '/ledger/paycheck']);
  });
  it('a chosen destination is shown as a token with its own clear button, and the card shows it is pressed', () => {
    const { root, html } = view({ value: 'buy milk' }, 'task');
    expect(html).toContain('class="ab-tok"');
    expect(byTag(root, 'button').some((b) => b.attrs['aria-label'] === 'Clear type: Task')).toBe(true);
    const card = byTag(root, 'button').find((b) => /\bab-card\b/.test(b.attrs.class ?? '') && textOf(b).startsWith('Task'))!;
    expect(card.attrs['aria-pressed']).toBe('true');
    expect(card.attrs.class).toContain('on');
    expect(byTag(root, 'input').find((i) => i.attrs['aria-label'] === 'New task')?.attrs.value).toBe('buy milk');
  });
  it('every button has a name, and the dialog text is American English', () => {
    for (const id of [null, 'task', 'transaction', 'family-member']) {
      const { root, html } = view({}, id);
      expect(unnamedButtons(root), String(id)).toEqual([]);
      expect(html).not.toMatch(/colour/i);
    }
  });
});

describe('D10 the footer: one primary button that says what it does', () => {
  const footer = (root: El) => all(root, (e) => /\bab-foot\b/.test(e.attrs.class ?? ''))[0];
  it('a typed destination: "Add task", disabled until there is a preview, and tied to the field\'s own form so Enter and the button do the same thing', () => {
    const { root } = view({}, 'task');
    const primary = byTag(footer(root), 'button').find((b) => /ab-primary/.test(b.attrs.class ?? ''))!;
    expect(textOf(primary).trim()).toBe('Add task');
    expect(primary.attrs.type).toBe('submit');
    expect(primary.attrs.form).toBe('ab-test');
    expect('disabled' in primary.attrs).toBe(true);
    const form = all(root, (e) => e.tag === 'form')[0];
    expect(form.attrs.id).toBe('ab-test');
  });
  it('a typed destination with a preview: the button is enabled', () => {
    const task = defs().find((d) => d.id === 'task')!;
    const preview = task.parse!('buy milk fri')!;
    const { root } = view({ preview, feedback: 'preview', primary: primaryAction({ dest: task, preview, busy: false }), value: 'buy milk fri' }, 'task');
    const primary = byTag(footer(root), 'button').find((b) => /ab-primary/.test(b.attrs.class ?? ''))!;
    expect('disabled' in primary.attrs).toBe(false);
    expect(textOf(root)).toContain('Will add:');
  });
  it('Transaction: the footer holds only Cancel, so the transaction form\'s own Save is the only Save', () => {
    const { root } = view({ panel: createElement('div', { className: 'ab-formbox' }, createElement('button', { type: 'button' }, 'Save')) }, 'transaction');
    expect(byTag(footer(root), 'button').map((b) => textOf(b).trim())).toEqual(['Cancel']);
    expect(all(root, (e) => /ab-primary/.test(e.attrs.class ?? ''))).toEqual([]);
    expect(byTag(root, 'input').some((i) => /ab-input/.test(i.attrs.class ?? ''))).toBe(false); // no text field for a form
    expect(textOf(root)).toContain('Details are filled in below');
  });
  it('Scheduled payment, Family member and Family date: the footer button is a plain button with the destination\'s own words (it opens a screen, it saves nothing), and there is no text field', () => {
    for (const [id, label] of [['scheduled', 'Open the Scheduled screen'], ['family-member', 'Open the Add member form'], ['family-date', 'Open the Add date form']] as const) {
      const { root } = view({}, id);
      const primary = byTag(footer(root), 'button').find((b) => /ab-primary/.test(b.attrs.class ?? ''))!;
      expect(textOf(primary).trim(), id).toBe(label);
      expect(primary.attrs.type, id).toBe('button');
      expect(primary.attrs.form, id).toBeUndefined();
      expect(byTag(root, 'input').some((i) => /ab-input/.test(i.attrs.class ?? '')), id).toBe(false);
      expect(textOf(root), id).toContain('Opens on its own screen');
    }
  });
  it('an error is announced as an alert', () => {
    const { html } = view({ error: 'Could not save that: No asset is named "X". Nothing was added.' }, 'service');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Nothing was added.');
  });
});

describe('D10 the phone sheet: compact first, "All types" opens everything', () => {
  it('starts compact: the button says "All types", is collapsed, and counts the eight other types', () => {
    const { root, html } = view();
    expect(html).toContain('data-expanded="false"');
    const more = byTag(root, 'button').find((b) => /ab-more/.test(b.attrs.class ?? ''))!;
    expect(more.attrs['aria-expanded']).toBe('false');
    expect(more.attrs['aria-controls']).toBe('ab-test-groups');
    expect(textOf(more)).toContain('All types');
    expect(textOf(more)).toContain('8 more');
    expect(all(root, (e) => e.attrs.id === 'ab-test-groups').length).toBe(1);
  });
  it('expanded: the button says "Fewer types" and is expanded, and every type is still in the page (the stylesheet decides what is folded)', () => {
    const { root, html } = view({ expanded: true });
    expect(html).toContain('data-expanded="true"');
    const more = byTag(root, 'button').find((b) => /ab-more/.test(b.attrs.class ?? ''))!;
    expect(more.attrs['aria-expanded']).toBe('true');
    expect(textOf(more)).toContain('Fewer types');
    expect(byTag(root, 'button').filter((b) => 'aria-pressed' in b.attrs).length).toBe(11);
  });
  it('the stylesheet folds the groups only on a phone and only while compact; wider screens always show them, and the "All types" button is hidden there', () => {
    expect(css).toMatch(/button\.ab-more \{ display: none;/);
    const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .modal.ab-modal.modal--sheet'));
    expect(phone).toMatch(/button\.ab-more \{ display: flex; \}/);
    expect(phone).toMatch(/\.ab\[data-expanded='false'\] \.ab-groups \{ display: none; \}/);
    expect(css.match(/data-expanded='false'\] \.ab-groups/g)?.length).toBe(1); // only inside that phone block
  });
  it('the sheet scrolls inside itself: the middle scrolls, the field and footer stay put, and it contains its own scrolling', () => {
    expect(css).toMatch(/\.ab-body \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/);
    expect(css).toMatch(/\.ab-foot \{ flex: none;/);
    expect(css).toMatch(/\.ab-cmd \{ flex: none;/);
  });
  it('the sheet is sized from the backdrop (which follows the visible area), the field is at least 16px on a phone, and the footer honors the safe area', () => {
    expect(css).toMatch(/\.modal\.ab-modal\.modal--sheet \{ max-height: 92%;/);
    expect(css).toMatch(/\.ab-cmd \.ab-input \{ font-size: max\(1rem, var\(--fs-base\)\); \}/);
    expect(css).toMatch(/\.ab-foot \{ padding: var\(--sp-3\) var\(--sp-4\) calc\(var\(--sp-3\) \+ env\(safe-area-inset-bottom\)\); \}/);
    expect(css).toMatch(/\.modal-back\[data-keyboard\] \.ab-foot \{ padding-bottom: var\(--sp-3\); \}/);
    expect(components).toMatch(/\.modal-back\.modal-back--sheet \{ top: var\(--sheet-top, 0px\); bottom: var\(--sheet-bottom, 0px\); overscroll-behavior: contain; \}/);
  });
  it('touch targets: close, footer buttons, chips and the clear button are at least 44px on a phone', () => {
    expect(css).toMatch(/\.ab-modal \.modal-head button\.link \{ min-width: 44px; min-height: 44px; \}/);
    expect(css).toMatch(/\.ab-foot \.ab-cancel, \.ab-foot \.ab-primary \{ min-height: 48px; \}/);
    expect(css).toMatch(/button\.ab-chip \{ min-height: 48px;/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{ button\.ab-tok-x \{ min-width: 44px; min-height: 44px; width: 44px; \} \}/);
  });
});

describe('D10 sheet height follows the visible area (keyboard)', () => {
  it('no visual viewport, or nonsense numbers: nothing is trimmed', () => {
    expect(sheetInsets(null, 800)).toEqual({ top: 0, bottom: 0, keyboard: false });
    expect(sheetInsets(undefined, 800)).toEqual({ top: 0, bottom: 0, keyboard: false });
    expect(sheetInsets({ height: 0, offsetTop: 0 }, 800)).toEqual({ top: 0, bottom: 0, keyboard: false });
    expect(sheetInsets({ height: 500, offsetTop: 0 }, 0)).toEqual({ top: 0, bottom: 0, keyboard: false });
  });
  it('a full-height viewport trims nothing; an on-screen keyboard trims the bottom and is recognized', () => {
    expect(sheetInsets({ height: 812, offsetTop: 0 }, 812)).toEqual({ top: 0, bottom: 0, keyboard: false });
    expect(sheetInsets({ height: 470, offsetTop: 0 }, 812)).toEqual({ top: 0, bottom: 342, keyboard: true });
    expect(sheetInsets({ height: 812 - KEYBOARD_PX, offsetTop: 0 }, 812).keyboard).toBe(false); // a browser toolbar is not a keyboard
  });
  it('when the browser scrolls the visual viewport down, the top is trimmed too, and the numbers never go negative', () => {
    expect(sheetInsets({ height: 400, offsetTop: 60 }, 812)).toEqual({ top: 60, bottom: 352, keyboard: true });
    expect(sheetInsets({ height: 900, offsetTop: 0 }, 812).bottom).toBe(0);
    expect(sheetInsets({ height: 469.6, offsetTop: 0.4 }, 812)).toEqual({ top: 0, bottom: 342, keyboard: true });
  });
});

/** Small stand-ins for the browser, recording what the sheet attaches and removes. */
function fakeEnv(opts: { matches?: boolean; vv?: boolean } = {}) {
  const calls: string[] = [];
  const listeners: Record<string, Set<() => void>> = {};
  const add = (name: string) => (type: string, fn: () => void) => { (listeners[`${name}:${type}`] ??= new Set()).add(fn); calls.push(`add ${name}:${type}`); };
  const remove = (name: string) => (type: string, fn: () => void) => { listeners[`${name}:${type}`]?.delete(fn); calls.push(`remove ${name}:${type}`); };
  const vv = { height: 812, offsetTop: 0, addEventListener: add('vv'), removeEventListener: remove('vv') };
  const mq = { matches: opts.matches ?? true, addEventListener: add('mq') as (t: 'change', f: () => void) => void, removeEventListener: remove('mq') as (t: 'change', f: () => void) => void };
  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  const el: BackdropLike = {
    style: { setProperty: (n, v) => { props.set(n, v); }, removeProperty: (n) => props.delete(n) },
    setAttribute: (n, v) => { attrs.set(n, v); },
    removeAttribute: (n) => { attrs.delete(n); },
  };
  const frames: Array<() => void> = [];
  const win: WindowLike = {
    innerHeight: 812,
    visualViewport: opts.vv === false ? null : vv,
    requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: () => { frames.length = 0; },
    matchMedia: () => mq,
  };
  const doc: LockTarget = { documentElement: { style: { overflow: '', overscrollBehavior: '' } }, body: { style: { overflow: '' } } };
  const flush = () => { const f = frames.splice(0); f.forEach((cb) => cb()); };
  const fire = (name: string, type: string) => [...(listeners[`${name}:${type}`] ?? [])].forEach((fn) => fn());
  return { calls, listeners, vv, mq, props, attrs, el, win, doc, frames, flush, fire };
}

describe('D10 the sheet attaches while open and cleans up completely when it closes', () => {
  it('opening sets the insets once, listens to the visual viewport, and locks the page behind a phone-width sheet', () => {
    const t = fakeEnv();
    const detach = attachSheet(t.el, t.win, t.doc);
    expect(t.props.get('--sheet-top')).toBe('0px');
    expect(t.props.get('--sheet-bottom')).toBe('0px');
    expect(t.calls).toEqual(['add vv:resize', 'add vv:scroll', 'add mq:change']);
    expect(t.doc.documentElement.style.overflow).toBe('hidden');
    expect(t.doc.body.style.overflow).toBe('hidden');
    expect(scrollLocksHeld()).toBe(1);
    detach();
    expect(scrollLocksHeld()).toBe(0);
  });
  it('a keyboard opening and closing moves the backdrop edges, and a burst of resize events is applied in one frame', () => {
    const t = fakeEnv();
    const detach = attachSheet(t.el, t.win, t.doc);
    t.vv.height = 470;
    t.fire('vv', 'resize'); t.fire('vv', 'resize'); t.fire('vv', 'scroll');
    expect(t.frames.length).toBe(1);
    t.flush();
    expect(t.props.get('--sheet-bottom')).toBe('342px');
    expect(t.attrs.get('data-keyboard')).toBe('open');
    t.vv.height = 812;
    t.fire('vv', 'resize'); t.flush();
    expect(t.props.get('--sheet-bottom')).toBe('0px');
    expect(t.attrs.has('data-keyboard')).toBe(false);
    detach();
  });
  it('closing removes every listener, clears the properties and the keyboard mark, and puts the page back exactly as it was', () => {
    const t = fakeEnv();
    t.doc.documentElement.style.overflow = 'scroll';
    t.doc.documentElement.style.overscrollBehavior = 'auto';
    t.doc.body.style.overflow = 'visible';
    const detach = attachSheet(t.el, t.win, t.doc);
    t.vv.height = 470; t.fire('vv', 'resize'); t.flush();
    detach();
    expect(t.calls.filter((c) => c.startsWith('remove')).sort()).toEqual(['remove mq:change', 'remove vv:resize', 'remove vv:scroll']);
    for (const set of Object.values(t.listeners)) expect(set.size).toBe(0);
    expect(t.props.size).toBe(0);
    expect(t.attrs.size).toBe(0);
    expect(t.doc.documentElement.style.overflow).toBe('scroll');
    expect(t.doc.documentElement.style.overscrollBehavior).toBe('auto');
    expect(t.doc.body.style.overflow).toBe('visible');
    expect(scrollLocksHeld()).toBe(0);
  });
  it('a pending frame is cancelled on close, so nothing touches the element after it is gone', () => {
    const t = fakeEnv();
    const detach = attachSheet(t.el, t.win, t.doc);
    t.fire('vv', 'resize');
    expect(t.frames.length).toBe(1);
    detach();
    expect(t.frames.length).toBe(0);
  });
  it('without a visual viewport nothing is trimmed and no viewport listener is added (the stylesheet\'s own sizing applies)', () => {
    const t = fakeEnv({ vv: false });
    const detach = attachSheet(t.el, t.win, t.doc);
    expect(t.props.size).toBe(0);
    expect(t.calls).toEqual(['add mq:change']);
    detach();
  });
  it('on a wide window without touch, the page behind is not locked; turning the window narrow locks it, and widening again lets go', () => {
    const t = fakeEnv({ matches: false });
    const detach = attachSheet(t.el, t.win, t.doc);
    expect(t.doc.body.style.overflow).toBe('');
    expect(scrollLocksHeld()).toBe(0);
    t.mq.matches = true; t.fire('mq', 'change');
    expect(t.doc.body.style.overflow).toBe('hidden');
    t.mq.matches = false; t.fire('mq', 'change');
    expect(t.doc.body.style.overflow).toBe('');
    expect(scrollLocksHeld()).toBe(0);
    detach();
  });
  it('the lock is counted: a second lock does not release the first, and letting go twice is harmless', () => {
    const doc: LockTarget = { documentElement: { style: { overflow: 'auto', overscrollBehavior: '' } }, body: { style: { overflow: '' } } };
    const a = lockScroll(doc);
    const b = lockScroll(doc);
    expect(scrollLocksHeld()).toBe(2);
    a(); a();
    expect(scrollLocksHeld()).toBe(1);
    expect(doc.body.style.overflow).toBe('hidden');
    b();
    expect(scrollLocksHeld()).toBe(0);
    expect(doc.documentElement.style.overflow).toBe('auto');
    expect(doc.body.style.overflow).toBe('');
  });
  it('the query is a phone-width window or any touch screen', () => {
    expect(SHEET_QUERY).toBe('(max-width: 640px), (pointer: coarse)');
  });
});

describe('D10 the Modal: the sheet behaviour is opt-in (D20: the visible-height part now applies to every dialog; the scroll lock stays sheet-only)', () => {
  const modal = read('src/shell/Modal.tsx');
  it('every dialog follows the visible height, but only a "sheet" Modal asks for the page scroll lock (D20)', () => {
    expect(modal).toMatch(/useSheetBehavior\(back, true, variant === 'sheet'\)/);
    expect(modal).toMatch(/className \? ` \$\{className\}` : ''/);
  });
  it('only the Add box asks for the sheet', () => {
    const files = ['src/shell/QuickAdd.tsx', 'src/shell/SearchDialog.tsx', 'src/shell/ConfirmDialog.tsx'];
    for (const f of files) expect(read(f), f).not.toMatch(/variant=/);
    expect(read('src/shell/AddBox.tsx')).toMatch(/<Modal title="Add" onClose=\{close\} variant="sheet" className="ab-modal">/);
  });
  it('the global scroll lock is not applied anywhere else', () => {
    expect(read('src/shell/Modal.tsx')).not.toMatch(/overflow/);
    for (const f of ['src/shell/SearchDialog.tsx', 'src/shell/ConfirmDialog.tsx', 'src/shell/GlobalFrame.tsx', 'src/shell/QuickAdd.tsx']) expect(read(f), f).not.toMatch(/lockScroll|sheetBehavior/);
  });
});

describe('D10 the controller still owns routing, saving and opening; Quick Add never touches Contacts', () => {
  const box = read('src/shell/AddBox.tsx');
  const boxView = read('src/shell/AddBoxView.tsx');
  const model = read('src/shell/addBoxModel.ts');
  it('does not create, find, match or link a Contact', () => {
    for (const [name, src] of [['AddBox.tsx', box], ['AddBoxView.tsx', boxView], ['addBoxModel.ts', model], ['sheetBehavior.ts', read('src/shell/sheetBehavior.ts')]] as const) {
      expect(src, name).not.toMatch(/core\/contacts|createDistinctContact|createContact|findContact|linkContact|nameKey|\bdb\.contacts|useContacts/);
      expect(src, name).not.toMatch(/from '\.\.\/db'|from "\.\.\/db"/);
    }
  });
  it('the view and the model import no module code and know nothing about parsing or saving', () => {
    for (const [name, src] of [['AddBoxView.tsx', boxView], ['addBoxModel.ts', model]] as const) {
      expect(src, name).not.toMatch(/from '\.\.\/modules|from '\.\/QuickTxn|\.commit\(|\.parse\(|\.open\(|useNavigate/);
    }
  });
  it('a record is saved in exactly one place (the Add function), only from a previewed line', () => {
    expect(box.match(/\.commit\(/g)?.length).toBe(1);
    expect(box).toMatch(/if \(!dest\?\.commit \|\| !preview \|\| busy\) return;/);
    expect(box).toMatch(/onSubmit=\{\(e\) => \{ e\.preventDefault\(\); void add\(\); \}\}/);
  });
  it('Cancel, the close button, Escape and a click outside all run the same close, which saves nothing', () => {
    expect(box).toMatch(/const close = \(\) => \{ setOpen\(false\); setBusy\(false\); \};/);
    expect(box).toMatch(/onClose=\{close\}/);
    expect(box).toMatch(/onCancel=\{close\}/);
    const closeBody = box.slice(box.indexOf('const close ='), box.indexOf('const pick ='));
    expect(closeBody).not.toMatch(/commit|add\(/);
  });
  it('the open and navigation destinations still close the box first, then call their own open or navigate', () => {
    expect(box).toMatch(/onPrimary=\{\(\) => \{ if \(dest\?\.open\) \{ close\(\); dest\.open\(\{ navigate: nav \}\); \} \}\}/);
    expect(box).toMatch(/onGo=\{\(to\) => \{ close\(\); nav\(to\); \}\}/);
    expect(box).toMatch(/dest\.openCopy\?\.what/);
    expect(box).toMatch(/<dest\.Form onDone=\{close\} \/>/);
  });
  it('opening starts clean: text, choice, plain title, error, busy and the phone expansion are all reset from the request, so nothing is left from last time', () => {
    const handler = box.slice(box.indexOf('const h = (e: Event)'), box.indexOf('window.addEventListener(OPEN_ADD_EVENT'));
    for (const s of ["setText(req.text ?? '')", 'setChoice(req.dest ?? null)', 'setPlain(false)', "setError('')", 'setBusy(false)', 'setExpanded(false)', 'setOpen(true)']) expect(handler, s).toContain(s);
  });
  it('the typed-line handling is the old one: a typed shortcut picks the destination and is removed, using the one router', () => {
    expect(box).toMatch(/const r = routeQuickAdd\(v, defs\);/);
    expect(box).toMatch(/if \(r\.def\) \{ setChoice\(r\.def\.id\); setText\(r\.rest\); \} else \{ if \(dest\) setChoice\(dest\.id\); setText\(v\); \}/);
  });
  it('the view has no key handler of its own, so it cannot take over a shortcut; the global N rule is unchanged', () => {
    expect(boxView).not.toMatch(/onKeyDown|onKeyUp|onKeyPress|addEventListener/);
    const press = (key: string, o = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, ...o });
    expect(wantsAddShortcut(press('n'), true, false)).toBe(false); // typing "n" in the command field
    expect(wantsAddShortcut(press('n'), false, true)).toBe(false); // while the box (or any dialog) is open
    expect(wantsAddShortcut(press('n'), false, false)).toBe(true);
    expect(read('src/shell/GlobalFrame.tsx')).toMatch(/\/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(t\?\.tagName/);
  });
  it('the requests other screens send still end in the same open event with the same fields', () => {
    expect(read('src/core/globalEvents.ts')).toMatch(/export interface AddBoxRequest \{\s*dest\?: string;\s*text\?: string;\s*\}/);
    expect(read('src/core/eventBridge.ts')).toMatch(/openAddBox\(\{ dest: 'event', text \}\)/);
    expect(read('src/shell/QuickAdd.tsx')).toMatch(/openAddBox\(\{ dest: 'transaction' \}\)/);
  });
});

describe('D10 stylesheet rules for the Add box', () => {
  const block = css.slice(css.indexOf('/* Add box (Phase 3 Part D; laid out again in D10)'), css.indexOf('@media (forced-colors: active) { button.ab-card.on') + 200);
  it('uses tokens only: no color literal, no priority override, no new font', () => {
    expect(block.length).toBeGreaterThan(3000);
    const code = block.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(code).not.toMatch(/!important|@font-face|url\(/);
  });
  it('a selected card or chip has more than color: a heavier ring, bold text on chips, and a check mark on cards; focus is the app-wide visible ring', () => {
    expect(block).toMatch(/button\.ab-card\.on, button\.ab-card\.on:hover:not\(:disabled\) \{[^}]*box-shadow: 0 0 1px var\(--accent\)|box-shadow: 0 0 0 1px var\(--accent\)/);
    expect(block).toMatch(/\.ab-card\.on \.ab-tick \{ display: block; \}/);
    expect(block).toMatch(/font-weight: 600; box-shadow: 0 0 0 1px var\(--accent\)/);
    expect(css).toMatch(/:focus-visible \{ outline: 2px solid var\(--accent\)/);
    expect(block).toMatch(/\.ab-cmd:focus-within \{ box-shadow: var\(--focus-ring\); \}/);
  });
  it('keeps selection visible in Windows high-contrast mode', () => {
    expect(block).toMatch(/@media \(forced-colors: active\)/);
  });
  it('the old chooser classes are gone from the page and the sheet rules use the existing modal class names', () => {
    expect(css).not.toMatch(/\.ab-chooser|^\.ab-chip\.on:hover/m);
    expect(read('src/shell/AddBoxView.tsx')).not.toMatch(/ab-chooser/);
  });
});

describe('D10 icons', () => {
  it('every destination has its own icon, drawn by the shared icon set (plain inline SVG, hidden from assistive technology)', () => {
    const ids = Object.keys(ELEVEN);
    expect(new Set(ids.map(destIcon)).size).toBe(ids.length);
    for (const id of ids) expect(ICON_NAMES).toContain(destIcon(id));
    for (const a of SPECIAL_ACTIONS) expect(ICON_NAMES).toContain(a.icon);
    for (const n of ['chevron-up', 'external', 'command', 'check', 'close'] as const) expect(renderToStaticMarkup(createElement(Icon, { name: n }))).toMatch(/^<svg class="ui-icon" .*aria-hidden="true"/);
  });
});
