import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import {
  ALL_ON, deselectAll, isLayerVisible, parseVisibility, selectAll, serializeVisibility, toggleLayer, visibleCount, visibleIds, type Visibility,
} from './layerVisibility';
import { ASSETS_ID, BILLS_ID, FINANCE_ID, PERSONAL_ID, PROJECTS_ID, SERVICES_ID, TASKS_ID } from './model';
import { ensureCalendarSeed } from './data';

const SEVEN = [PERSONAL_ID, FINANCE_ID, TASKS_ID, PROJECTS_ID, ASSETS_ID, SERVICES_ID, BILLS_ID];
const NEW_LAYER = 9_000_000_000_000_999; // a made-up layer for the tests; never a real built-in id (Family took ..._108 in F2)
/** What a screen would store and read back after a reload. */
const reload = (v: Visibility) => parseVisibility(serializeVisibility(v));
const shown = (v: Visibility, avail = SEVEN) => visibleIds(v, avail);

describe('B3.0B Calendar layer visibility: the states', () => {
  it('a fresh configuration (nothing stored) shows every available layer, Bills & Subscriptions included', () => {
    const v = parseVisibility(null);
    expect(shown(v)).toEqual(SEVEN);
    expect(visibleCount(v, SEVEN)).toBe(7);
    expect(shown(parseVisibility(undefined))).toEqual(SEVEN);
    expect(shown(parseVisibility(''))).toEqual(SEVEN);
  });

  it('unreadable stored values mean "everything on", never an error and never an accidental hide', () => {
    for (const raw of ['not json', '{', '5', 'null', 'true', '{}', '{"only":"x"}', '{"only":null}', '"personal"', '[["a"]]']) {
      expect(() => parseVisibility(raw)).not.toThrow();
    }
    for (const raw of ['not json', '5', 'null', '{}', '{"only":"x"}', '"personal"']) expect(shown(parseVisibility(raw))).toEqual(SEVEN);
    // junk inside a list is ignored, the numbers that are there are kept
    expect(parseVisibility('[1,"x",null,2,2]')).toEqual({ mode: 'all-but', hidden: [1, 2] });
  });

  it('reads every value the earlier version wrote (a plain list of layers switched OFF) exactly as before, with no migration', () => {
    const legacy = parseVisibility(JSON.stringify([FINANCE_ID, PROJECTS_ID]));
    expect(shown(legacy)).toEqual(SEVEN.filter((x) => x !== FINANCE_ID && x !== PROJECTS_ID));
    expect(parseVisibility('[]')).toEqual(ALL_ON);
    // All on is still stored as the old plain array, so an older build reads it correctly
    expect(serializeVisibility(ALL_ON)).toBe('[]');
    expect(serializeVisibility(legacy)).toBe(JSON.stringify([FINANCE_ID, PROJECTS_ID]));
  });

  it('Deselect all hides every layer, and that valid empty state survives a reload', () => {
    const v = deselectAll();
    expect(shown(v)).toEqual([]);
    expect(visibleCount(v, SEVEN)).toBe(0);
    expect(shown(reload(v))).toEqual([]);
    for (const id of SEVEN) expect(isLayerVisible(reload(v), id)).toBe(false);
  });

  it('Deselect all, then Personal Calendar: only Personal is shown, and it is still only Personal after a reload', () => {
    let v = deselectAll();
    v = toggleLayer(v, PERSONAL_ID, SEVEN);
    expect(shown(v)).toEqual([PERSONAL_ID]);
    expect(shown(reload(v))).toEqual([PERSONAL_ID]);
    // other layers can then be added one by one, in any order
    v = toggleLayer(v, BILLS_ID, SEVEN);
    expect(shown(reload(v))).toEqual([PERSONAL_ID, BILLS_ID]);
    // and switched off again
    expect(shown(toggleLayer(v, PERSONAL_ID, SEVEN))).toEqual([BILLS_ID]);
  });

  it('Select all restores every registered layer (Bills & Subscriptions too), whatever the state before', () => {
    for (const before of [deselectAll(), toggleLayer(deselectAll(), PERSONAL_ID, SEVEN), parseVisibility(JSON.stringify([FINANCE_ID])), ALL_ON]) {
      const v = selectAll();
      expect(shown(v)).toEqual(SEVEN);
      expect(shown(reload(v))).toEqual(SEVEN);
      expect(before).toBeDefined();
    }
  });

  it('switching one layer off from "everything on" keeps exactly the others on (every other checkbox untouched)', () => {
    const v = toggleLayer(ALL_ON, FINANCE_ID, SEVEN);
    expect(shown(v)).toEqual(SEVEN.filter((x) => x !== FINANCE_ID));
    expect(shown(reload(v))).toEqual(SEVEN.filter((x) => x !== FINANCE_ID));
    // switching it back on returns to the "everything on" state, so new layers appear again by themselves
    expect(toggleLayer(v, FINANCE_ID, SEVEN)).toEqual(ALL_ON);
  });

  it('switching on every layer by hand, one at a time, returns to the "everything on" state', () => {
    let v = deselectAll();
    for (const id of SEVEN) v = toggleLayer(v, id, SEVEN);
    expect(v).toEqual(ALL_ON);
  });
});

describe('B3.0B: layers that are registered later or no longer exist', () => {
  it('a newly registered layer is shown automatically only while the configuration is still "everything on"', () => {
    const eight = [...SEVEN, NEW_LAYER];
    expect(shown(ALL_ON, eight)).toEqual(eight);
    expect(shown(reload(selectAll()), eight)).toEqual(eight);
  });

  it('a new layer does NOT disturb an intentional Personal-only choice, and nothing else is reset', () => {
    const personalOnly = toggleLayer(deselectAll(), PERSONAL_ID, SEVEN);
    const eight = [...SEVEN, NEW_LAYER];
    expect(shown(personalOnly, eight)).toEqual([PERSONAL_ID]);
    expect(shown(reload(personalOnly), eight)).toEqual([PERSONAL_ID]);
    // the owner can switch the new layer on, and it joins the choice
    expect(shown(toggleLayer(personalOnly, NEW_LAYER, eight), eight)).toEqual([PERSONAL_ID, NEW_LAYER]);
  });

  it('a new layer does not disturb a deliberate "all but Finance" choice either, and Deselect all stays empty', () => {
    const eight = [...SEVEN, NEW_LAYER];
    const noFinance = toggleLayer(ALL_ON, FINANCE_ID, SEVEN);
    expect(shown(noFinance, eight)).toEqual(SEVEN.filter((x) => x !== FINANCE_ID));
    expect(shown(deselectAll(), eight)).toEqual([]);
  });

  it('a stored layer that was deleted or is unavailable is ignored when reading, and dropped the next time the choice is written', () => {
    const stored = parseVisibility(JSON.stringify({ only: [PERSONAL_ID, 123456789, BILLS_ID] }));
    expect(shown(stored)).toEqual([PERSONAL_ID, BILLS_ID]);
    expect(visibleCount(stored, SEVEN)).toBe(2);
    const next = toggleLayer(stored, BILLS_ID, SEVEN);
    expect(serializeVisibility(next)).toBe(JSON.stringify({ only: [PERSONAL_ID] }));
    // an id that is not an available layer cannot be toggled into the choice
    expect(toggleLayer(stored, 99, SEVEN)).toBe(stored);
    // and a legacy hidden list that names a layer that is gone changes nothing for the layers that exist
    expect(shown(parseVisibility(JSON.stringify([424242])))).toEqual(SEVEN);
  });

  it('with no layers loaded yet nothing is written and nothing is lost: toggling is a no-op', () => {
    expect(toggleLayer(deselectAll(), PERSONAL_ID, [])).toEqual(deselectAll());
    expect(visibleCount(ALL_ON, [])).toBe(0);
  });

  it('an item with no registered layer follows the mode: shown when everything is on, not shown in a chosen set', () => {
    expect(isLayerVisible(ALL_ON, -1)).toBe(true);
    expect(isLayerVisible(deselectAll(), -1)).toBe(false);
  });
});

describe('B3.0B: compatibility with an older build', () => {
  /** The reader the earlier version used, copied verbatim, applied to what this version writes. */
  const oldRead = (text: string | null): number[] => { try { const v = JSON.parse(text ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : []; } catch { return []; } };

  it('an older build reads "everything on" and a hidden list exactly as before, and treats a chosen set as everything on (shows more, never hides unexpectedly)', () => {
    expect(oldRead(serializeVisibility(ALL_ON))).toEqual([]);
    expect(oldRead(serializeVisibility(toggleLayer(ALL_ON, FINANCE_ID, SEVEN)))).toEqual([]);
    expect(oldRead(serializeVisibility(parseVisibility(JSON.stringify([FINANCE_ID]))))).toEqual([FINANCE_ID]);
    expect(oldRead(serializeVisibility(deselectAll()))).toEqual([]);
  });
});

describe('B3.0B: it is one visibility system and it changes nothing but the preference', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('the module is pure: no storage, no database, no React, no network', () => {
    const src = read('./layerVisibility.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const word of ['localStorage', 'sessionStorage', 'indexedDB', "from '../../db'", 'react', 'fetch(', 'XMLHttpRequest', 'moduleRecords', 'import ']) expect(code).not.toContain(word);
  });

  it('every Calendar view draws the same already-filtered list, and only this module decides visibility (no second system)', () => {
    const page = read('./CalendarPage.tsx');
    expect(page).toContain('vis.isVisible(i.layerId)');
    expect((page.match(/items=\{items\}/g) ?? []).length).toBeGreaterThanOrEqual(4); // Month, Agenda, Week/Work week (one grid), Day panel
    for (const file of ['./MonthView.tsx', './AgendaView.tsx', './TimeGrid.tsx']) expect(read(file)).not.toMatch(/layerVisibility|calendar-hidden-layers|hiddenLayers/);
    const stored = read('./useCalendarData.ts');
    expect((stored.match(/localStorage/g) ?? []).length).toBe(2); // one read, one write: the one preference
    expect(stored).toContain("VISIBILITY_KEY");
    expect(read('./layerVisibility.ts')).toContain("'calendar-hidden-layers'"); // the same key as before
  });

  it('Today does not read this preference (its Calendar surfaces are unaffected), and the .ics export only follows the same on/off state of your own calendars', () => {
    expect(read('../today/TodayData.tsx')).not.toMatch(/calendar-hidden-layers|layerVisibility/);
    const dlg = read('./dialogs.tsx');
    expect(dlg).toContain("l.sourceType === 'local' && isVisible(l.id)");
  });

  it('running every operation against a real database changes no row and creates no record, Task or Calendar event', async () => {
    const d = new FinanceDB(`b30b-${Math.random().toString(36).slice(2)}`);
    await ensureCalendarSeed(d);
    const snap = async () => JSON.stringify({ rec: await d.moduleRecords.toArray(), links: await d.links.toArray(), txns: await d.txns.toArray(), settings: await d.settings.toArray() });
    const before = await snap();
    let v: Visibility = ALL_ON;
    for (let i = 0; i < 40; i++) {
      v = i % 5 === 0 ? deselectAll() : i % 5 === 1 ? selectAll() : toggleLayer(v, SEVEN[i % 7], SEVEN);
      v = reload(v);
    }
    expect(await snap()).toBe(before);
  });
});
