import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { accessibleName, all, byTag, headingSkips, headings, parseHtml, textOf, unnamedButtons, unnamedFields } from '../../lib/a11yTestkit';
import { ModuleBase } from '../../core/router';
import DateForm from './DateForm';
import DatesPage from './DatesPage';
import MemberForm from './MemberForm';

/** F2 core accessibility, on first draw (same method as F1). Behaviour (focus, dialogs, keyboard) was checked in a real browser; see the F2 report. */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(el));

describe('date form', () => {
  const d = html(createElement(DateForm, { onClose: () => undefined, onSaved: () => undefined }));
  it('is a labelled dialog; every field and button has a name; the date is a grouped choice', () => {
    const dialog = all(d, (e) => e.attrs.role === 'dialog')[0];
    expect(dialog.attrs['aria-modal']).toBe('true');
    expect(accessibleName(d, dialog)).toBe('Add a family date');
    expect(unnamedFields(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
    expect(all(d, (e) => e.tag === 'fieldset').length).toBeGreaterThanOrEqual(1);
  });
  it('the title and the Calendar checkbox are described by their help text', () => {
    const name = byTag(d, 'input').find((i) => i.attrs['aria-describedby'] === 'fm-date-label-help')!;
    expect(accessibleName(d, name)).toBe('Name');
    const box = byTag(d, 'input').find((i) => i.attrs.type === 'checkbox')!;
    expect(accessibleName(d, box).trim()).toBe('Show this date on my Calendar');
    expect(all(d, (e) => e.attrs.id === 'fm-date-cal-help')).toHaveLength(1);
    expect(textOf(d)).toMatch(/Birthdays of family members come from their profiles/);
  });
});

describe('member form', () => {
  it('has the birthday Calendar checkbox, named and described, checked by default', () => {
    const d = html(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined }));
    const box = byTag(d, 'input').find((i) => i.attrs['aria-describedby'] === 'fm-cal-help')!;
    expect(accessibleName(d, box).trim()).toBe('Show this birthday on my Calendar');
    expect('checked' in box.attrs).toBe(true);
    expect(unnamedFields(d)).toEqual([]);
  });
});

describe('dates page', () => {
  const d = html(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/family' }, createElement(DatesPage))));
  it('draws one h1 and no skipped heading levels while loading; its button is named', () => {
    expect(headings(d).filter((h) => h.level === 1).map((h) => h.text)).toEqual(['Family dates']);
    expect(headingSkips(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
  });
});
