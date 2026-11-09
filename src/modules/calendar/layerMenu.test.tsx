import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { accessibleName, all, byId, byTag, parseHtml, textOf, unnamedButtons, unnamedFields, type El } from '../../lib/a11yTestkit';
import { createCalendar, ensureCalendarSeed, loadLayers, updateCalendar } from './data';
import {
  ALL_ON, deselectAll, isLayerVisible, parseVisibility, selectAll, serializeVisibility, toggleLayer, visibleCount, visibleIds, type Visibility,
} from './layerVisibility';
import LayerMenu from './LayerMenu';
import { countSentence, layerRowName, NEUTRAL_COLOR, shownCount, swatchColor, triggerLabel, triggerSpeech, type LayerMenuLayer } from './layerMenuModel';
import { FAMILY_ID, PERSONAL_ID, TASKS_ID } from './model';

/** F2.1: the "Calendars & Layers" menu. Invented layers only. */
const L = (id: number, name: string, color = '#4a7bd0', derived = false): LayerMenuLayer => ({ id, name, color, derived });
const SIX: LayerMenuLayer[] = [L(1, 'Personal', '#4a7bd0'), L(2, 'Finance', '#2e9e6b', true), L(3, 'Tasks', '#d0793a', true), L(4, 'Family', '#b04ab0', true), L(5, 'Trips', '#c9a227'), L(6, 'School', '#2aa5b3')];
const ids = (ls: LayerMenuLayer[]) => ls.map((l) => l.id);

const draw = (layers: LayerMenuLayer[], isVisible: (id: number) => boolean, over: { open?: boolean; manage?: boolean } = {}) =>
  parseHtml(renderToStaticMarkup(createElement(LayerMenu, {
    layers, isVisible, onToggle: () => undefined, onSelectAll: () => undefined, onDeselectAll: () => undefined,
    onManage: over.manage === false ? undefined : () => undefined, defaultOpen: over.open ?? true,
  })));
const checks = (d: El) => all(d, (e) => e.tag === 'input' && e.attrs.type === 'checkbox');
/** What a sighted person reads on the button: the aria-hidden spans (a screen reader gets the spoken sentence instead). */
const visibleWords = (t: El) => all(t, (e) => e.tag === 'span' && e.attrs['aria-hidden'] === 'true').map((e) => e.children.join('')).join(' ');
const trigger = (d: El) => all(d, (e) => e.tag === 'button' && 'aria-haspopup' in e.attrs)[0];

describe('F2.1 the words and small decisions', () => {
  it('the closed button reads "Layers (shown/total)" and speaks the full name with the count', () => {
    expect(triggerLabel(5, 8)).toBe('Layers (5/8)');
    expect(triggerLabel(0, 8)).toBe('Layers (0/8)');
    expect(triggerSpeech(5, 8)).toBe('Calendars & Layers: 5 of 8 shown');
  });
  it('the sentence under the list covers none, some, all, one and no layers', () => {
    expect(countSentence(0, 8)).toBe('None of the 8 calendars are shown.');
    expect(countSentence(0, 1)).toBe('None of the 1 calendar is shown.');
    expect(countSentence(3, 8)).toBe('3 of 8 calendars shown.');
    expect(countSentence(8, 8)).toBe('All 8 calendars are shown.');
    expect(countSentence(1, 1)).toBe('The calendar is shown.');
    expect(countSentence(0, 0)).toBe('No calendars to show.');
  });
  it('a plain #RRGGBB colour is used as is; anything else falls back to a neutral grey and never throws', () => {
    expect(swatchColor('#4a7bd0')).toBe('#4a7bd0');
    for (const bad of ['', 'blue', 'rgb(1,2,3)', '#12', 'url(javascript:1)', undefined, null, 5]) expect(swatchColor(bad)).toBe(NEUTRAL_COLOR);
  });
  it('an automatic layer is named as read-only for a screen reader; a calendar of your own is just its name', () => {
    expect(layerRowName(L(1, 'Personal'))).toBe('Personal');
    expect(layerRowName(L(2, 'Finance', '#000000', true))).toBe('Finance (automatic, read-only)');
  });
  it('shownCount counts only the layers handed in', () => {
    expect(shownCount(SIX, (id) => id < 4)).toBe(3);
    expect(shownCount([], () => true)).toBe(0);
  });
});

describe('F2.1 the menu draws the list it is given', () => {
  it('closed: only the one button, with the count, aria-expanded false and no list in the page', () => {
    const d = draw(SIX, () => true, { open: false });
    expect(byTag(d, 'button')).toHaveLength(1);
    const t = trigger(d);
    expect(t.attrs['aria-expanded']).toBe('false');
    expect(t.attrs['aria-controls']).toBeUndefined();
    expect(visibleWords(t)).toBe('Layers (6/6) ▾');
    expect(accessibleName(d, t)).toContain('Calendars & Layers: 6 of 6 shown');
    expect(checks(d)).toHaveLength(0);
  });

  it('open: every registered layer appears once, in the order given, each with a checkbox named after it', () => {
    const d = draw(SIX, () => true);
    const boxes = checks(d);
    expect(boxes).toHaveLength(6);
    expect(boxes.map((b) => accessibleName(d, b))).toEqual(['Personal', 'Finance (automatic, read-only)', 'Tasks (automatic, read-only)', 'Family (automatic, read-only)', 'Trips', 'School']);
    expect(unnamedFields(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
  });

  it('open: the trigger points at the popover, which is a labelled dialog', () => {
    const d = draw(SIX, () => true);
    const t = trigger(d);
    expect(t.attrs['aria-expanded']).toBe('true');
    const pop = byId(d, t.attrs['aria-controls']);
    expect(pop).not.toBeNull();
    expect(pop!.attrs.role).toBe('dialog');
    expect(accessibleName(d, pop!)).toBe('Calendars & Layers');
    // Found in the browser: a click on plain text inside the menu hands focus to the page's <main> unless the menu body can take focus itself, and the menu closes when focus leaves it.
    expect(pop!.attrs.tabindex).toBe('-1');
  });

  it('the layers\' own colours are the dots (not re-chosen), and the dots are hidden from a screen reader', () => {
    const html = renderToStaticMarkup(createElement(LayerMenu, { layers: SIX, isVisible: () => true, onToggle: () => undefined, onSelectAll: () => undefined, onDeselectAll: () => undefined, defaultOpen: true }));
    const d = parseHtml(html);
    const dots = all(d, (e) => e.tag === 'span' && (e.attrs.class ?? '').includes('cal-lm-dot'));
    expect(dots).toHaveLength(6);
    expect(dots.every((x) => x.attrs['aria-hidden'] === 'true')).toBe(true);
    for (const [i, l] of SIX.entries()) expect(dots[i].attrs.style).toContain(l.color);
  });

  it('a layer with a missing or unusable colour still draws, in the neutral grey', () => {
    const odd = [L(1, 'Personal', ''), L(2, 'Odd', 'not-a-colour')];
    const d = draw(odd, () => true);
    const dots = all(d, (e) => e.tag === 'span' && (e.attrs.class ?? '').includes('cal-lm-dot'));
    expect(dots.map((x) => x.attrs.style)).toEqual([`background:${NEUTRAL_COLOR}`, `background:${NEUTRAL_COLOR}`]);
  });

  it('checked state follows isVisible, and the count in the closed label and the sentence agree with it', () => {
    const on = new Set([1, 3, 5]);
    const d = draw(SIX, (id) => on.has(id));
    expect(checks(d).map((b) => 'checked' in b.attrs)).toEqual([true, false, true, false, true, false]);
    expect(visibleWords(trigger(d))).toBe('Layers (3/6) ▾');
    expect(accessibleName(d, trigger(d))).toBe('Calendars & Layers: 3 of 6 shown');
    expect(textOf(d)).toContain('3 of 6 calendars shown.');
  });

  it('colour is not the only signal: every row has its name as text next to a real checkbox', () => {
    const d = draw(SIX, (id) => id === 2);
    const rows = all(d, (e) => e.tag === 'label');
    expect(rows).toHaveLength(6);
    for (const [i, r] of rows.entries()) expect(textOf(r)).toContain(SIX[i].name);
  });

  it('zero visible: every box is unchecked, the count says none, and both bulk actions are still there and enabled', () => {
    const d = draw(SIX, () => false);
    expect(checks(d).some((b) => 'checked' in b.attrs)).toBe(false);
    expect(textOf(d)).toContain('None of the 6 calendars are shown.');
    expect(accessibleName(d, trigger(d))).toBe('Calendars & Layers: 0 of 6 shown');
    const names = byTag(d, 'button').map((b) => accessibleName(d, b));
    expect(names).toContain('Select all');
    expect(names).toContain('Deselect all');
    expect(byTag(d, 'button').some((b) => 'disabled' in b.attrs)).toBe(false); // a button that disables under the pointer drops keyboard focus
  });

  it('Select all, Deselect all and Manage calendars are real labelled buttons; Manage is omitted when no handler is given', () => {
    const names = (d: El) => byTag(d, 'button').map((b) => accessibleName(d, b));
    expect(names(draw(SIX, () => true))).toEqual(expect.arrayContaining(['Select all', 'Deselect all', 'Manage calendars', 'Done']));
    expect(names(draw(SIX, () => true, { manage: false }))).not.toContain('Manage calendars');
    for (const b of byTag(draw(SIX, () => true), 'button')) expect(b.attrs.type).toBe('button'); // none can submit a form
  });

  it('a very long list and very long names are all present (the list scrolls inside the menu, it does not grow the page)', () => {
    const many = Array.from({ length: 60 }, (_, i) => L(i + 1, `Calendar number ${i + 1} ${'with a very long descriptive name '.repeat(4)}`, '#4a7bd0'));
    const d = draw(many, (id) => id % 2 === 0);
    expect(checks(d)).toHaveLength(60);
    expect(textOf(d)).toContain('30 of 60 calendars shown.');
    const css = readFileSync(new URL('./calendar.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.cal-lm-list \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.cal-lm-name \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.cal-lm-btn \{[^}]*max-width: 100%/);
  });

  it('no layers at all draws a short message instead of an empty box', () => {
    const d = draw([], () => true);
    expect(checks(d)).toHaveLength(0);
    expect(textOf(d)).toContain('No calendars yet.');
    expect(accessibleName(d, trigger(d))).toBe('Calendars & Layers: 0 of 0 shown');
  });

  it('the narrow-screen rules exist: the menu fits the width, controls are at least 44px tall on a touch screen', () => {
    const css = readFileSync(new URL('./calendar.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.cal-lm-pop \{[^}]*max-width: calc\(100vw/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.cal-lm-pop \{[^}]*position: fixed; left: 12px; right: 12px;[^}]*bottom: 12px;[^}]*max-height: calc\(100dvh - 24px\)/);
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*\.cal-lm-row \{[^}]*min-height: 44px/);
    expect(css).toMatch(/:focus-visible/);
  });
});

/** What a click does is the existing visibility model; these replay a session through the same functions and the same stored text the Calendar uses. */
describe('F2.1 a session of clicks through the existing visibility model', () => {
  const ON = ids(SIX);
  /** Mirrors `useLayerVisibility`: apply a change to the current state, store it as text, and read it back like a reload. */
  const session = (start: string | null = null) => {
    let stored: string | null = start;
    const cur = () => parseVisibility(stored);
    const apply = (f: (v: Visibility) => Visibility) => { stored = serializeVisibility(f(cur())); };
    return {
      get stored() { return stored; },
      cur,
      toggle: (id: number, avail = ON) => apply((v) => toggleLayer(v, id, avail)),
      selectAll: () => apply(() => selectAll()),
      deselectAll: () => apply(() => deselectAll()),
      shown: (avail = ON) => visibleIds(cur(), avail),
      count: (avail = ON) => visibleCount(cur(), avail),
    };
  };

  it('a hidden layer becomes visible and a visible one hidden; every other layer keeps its state', () => {
    const s = session();
    s.toggle(2);
    expect(s.shown()).toEqual([1, 3, 4, 5, 6]);
    s.toggle(2);
    expect(s.shown()).toEqual(ON);
    s.deselectAll();
    s.toggle(5);
    expect(s.shown()).toEqual([5]);
    s.toggle(3);
    expect(s.shown()).toEqual([3, 5]);
  });

  it('several boxes can be changed one after another and the count follows after each', () => {
    const s = session();
    const counts: number[] = [];
    for (const id of [1, 2, 3]) { s.toggle(id); counts.push(s.count()); }
    expect(counts).toEqual([5, 4, 3]);
    expect(s.shown()).toEqual([4, 5, 6]);
  });

  it('Select all makes every layer visible; Deselect all hides every layer; zero visible is a valid, reloadable state', () => {
    const s = session();
    s.deselectAll();
    expect(s.shown()).toEqual([]);
    expect(s.count()).toBe(0);
    expect(parseVisibility(s.stored)).toEqual({ mode: 'only', shown: [] });
    s.selectAll();
    expect(s.shown()).toEqual(ON);
    expect(s.stored).toBe('[]'); // the old plain list, so an older build reads it correctly
  });

  it('rapid toggling lands on the same state as the same clicks done slowly, and double clicks cancel out', () => {
    const fast = session();
    const order = [2, 4, 2, 6, 1, 4, 3, 3, 5, 5, 6];
    for (const id of order) fast.toggle(id);
    const slow = session();
    for (const id of order) { slow.toggle(id); expect(slow.cur()).toEqual(parseVisibility(serializeVisibility(slow.cur()))); }
    expect(fast.shown()).toEqual(slow.shown());
    expect(fast.shown()).toEqual([2, 3, 4, 5, 6]); // only layer 1 was switched an odd number of times
    const dbl = session();
    dbl.toggle(3); dbl.toggle(3);
    expect(dbl.shown()).toEqual(ON);
    expect(dbl.stored).toBe('[]');
  });

  it('what is chosen survives a reload, a change of view and leaving the Calendar (the same stored text is read back)', () => {
    const s = session();
    s.toggle(2); s.toggle(5);
    const text = s.stored;
    const again = session(text); // a refresh, or coming back to the Calendar
    expect(again.shown()).toEqual(s.shown());
    expect(again.stored).toBe(text);
  });

  it('a layer registered later: on after Select all (and after never having chosen); off after Deselect all or a chosen set', () => {
    const NEW = 99;
    const more = [...ON, NEW];
    expect(isLayerVisible(session().cur(), NEW)).toBe(true); // nothing chosen yet
    const allOn = session(); allOn.selectAll();
    expect(allOn.shown(more)).toEqual(more);
    const chosen = session(); chosen.toggle(2);
    expect(chosen.shown(more)).toEqual([1, 3, 4, 5, 6]); // an intentional choice survives a new module
    const none = session(); none.deselectAll();
    expect(none.shown(more)).toEqual([]);
    none.toggle(NEW, more);
    expect(none.shown(more)).toEqual([NEW]);
  });

  it('switching on layers one by one until all are on returns to "everything on" so later layers appear by themselves', () => {
    const s = session();
    s.deselectAll();
    for (const id of ON) s.toggle(id);
    expect(s.stored).toBe('[]');
  });

  it('a stored choice that names a layer that no longer exists, or text that is unreadable, never breaks the menu', () => {
    expect(session('[424242]').shown()).toEqual(ON);
    expect(session('{"only":[1,424242]}').shown()).toEqual([1]);
    for (const junk of ['not json', '{', 'null', '{"only":5}']) expect(session(junk).shown()).toEqual(ON);
  });

  it('the menu does not write by being drawn: parse then serialize of an untouched value is identical', () => {
    for (const raw of ['[]', '[1,2]', '{"only":[3]}', '{"only":[]}']) expect(serializeVisibility(parseVisibility(raw))).toBe(raw);
    expect(ALL_ON).toEqual(parseVisibility(null));
  });
});

describe('F2.1 against the real layer list (a database with the built-in layers, a layer of your own and a renamed one)', () => {
  it('the menu is fed the complete registered list: built-in layers (Family included) and a calendar the owner created, with their real colours', async () => {
    const d = new FinanceDB(`f21-${Math.random().toString(36).slice(2)}`);
    await ensureCalendarSeed(d);
    const own = await createCalendar('Invented trips', '#112233', d);
    const layers = await loadLayers(d);
    const rows: LayerMenuLayer[] = layers.map((l) => ({ id: l.id, name: l.name, color: l.color, derived: l.sourceType === 'derived' }));
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([PERSONAL_ID, TASKS_ID, FAMILY_ID, own]));
    expect(rows.length).toBe(layers.length);
    const html = parseHtml(renderToStaticMarkup(createElement(LayerMenu, { layers: rows, isVisible: () => true, onToggle: () => undefined, onSelectAll: () => undefined, onDeselectAll: () => undefined, defaultOpen: true })));
    expect(checks(html)).toHaveLength(layers.length);
    const names = checks(html).map((b) => accessibleName(html, b));
    for (const l of layers) expect(names.some((n) => n.startsWith(l.name))).toBe(true);
    expect(textOf(html)).toContain('Invented trips');
    const dots = all(html, (e) => e.tag === 'span' && (e.attrs.class ?? '').includes('cal-lm-dot')).map((x) => x.attrs.style);
    for (const l of layers) expect(dots).toContain(`background:${swatchColor(l.color)}`);
    expect(dots).toContain('background:#112233');
    // a recoloured calendar changes the dot, nothing else
    await updateCalendar(own, { color: '#445566' }, d);
    const after = (await loadLayers(d)).find((l) => l.id === own)!;
    expect(swatchColor(after.color)).toBe('#445566');
  });
});

describe('F2.1 it is presentation only', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('the menu and its words touch no storage, database, network or sync, and keep no list of visibility flags of their own', () => {
    for (const f of ['./LayerMenu.tsx', './layerMenuModel.ts']) {
      const src = code(read(f));
      for (const word of ['localStorage', 'sessionStorage', 'indexedDB', "from '../../db'", 'moduleRecords', 'fetch(', 'XMLHttpRequest', 'calendar-hidden-layers', 'useLiveQuery']) expect(src).not.toContain(word);
    }
  });

  it('the Calendar screen wires the menu to the existing visibility functions, keeps Manage calendars, and the old chip row is gone', () => {
    const page = read('./CalendarPage.tsx');
    expect(page).toContain('<LayerMenu');
    for (const w of ['isVisible={vis.isVisible}', 'onToggle={vis.toggle}', 'onSelectAll={vis.selectAll}', 'onDeselectAll={vis.deselectAll}', 'onManage=']) expect(page).toContain(w);
    expect(read('./dialogs.tsx')).not.toContain('export function Legend');
    expect(read('./calendar.css')).not.toContain('.cal-legend-item');
  });

  it('the stored preference is still the one key, still read and written in exactly one place', () => {
    const stored = read('./useCalendarData.ts');
    expect((stored.match(/localStorage/g) ?? []).length).toBe(2);
    expect(read('./layerVisibility.ts')).toContain("'calendar-hidden-layers'");
  });
});
