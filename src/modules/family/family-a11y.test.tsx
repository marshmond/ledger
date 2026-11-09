import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { accessibleName, all, byTag, headingSkips, headings, parseHtml, textOf, unnamedButtons, unnamedFields } from '../../lib/a11yTestkit';
import { ModuleBase } from '../../core/router';
import MemberForm from './MemberForm';
import OverviewPage from './OverviewPage';
import { COLORS } from './model';

/**
 * F1 core accessibility. These render the real screens to static markup (the same method the ST-S3 tests use): they check the structure a
 * screen reader meets on first draw. Behaviour (focus, reveal, keyboard) was checked in a real browser; see the F1 report.
 */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(el));

describe('add-member form', () => {
  const d = html(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined }));
  it('is a labelled dialog with grouped choices and a form-level caution', () => {
    const dialog = all(d, (e) => e.attrs.role === 'dialog')[0];
    expect(dialog.attrs['aria-modal']).toBe('true');
    expect(accessibleName(d, dialog)).toBe('Add a family member');
    expect(all(d, (e) => e.tag === 'fieldset').length).toBeGreaterThanOrEqual(3);
    expect(textOf(d)).toMatch(/Do not store health details, identity numbers, passwords or account details here/);
  });
  it('every field and button has a name; a placeholder is not relied on', () => {
    expect(unnamedFields(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
  });
  it('the two ways to identify the person are explicit radio choices, and "existing" is not silently chosen for a new contact', () => {
    const radios = byTag(d, 'input').filter((i) => i.attrs.name === 'fm-mode');
    expect(radios.map((r) => accessibleName(d, r))).toEqual(['Use an existing contact', 'Create a new contact']);
  });
  it('every colour is offered by NAME, plus "None", so colour is never the only cue', () => {
    const names = byTag(d, 'input').filter((i) => i.attrs.name === 'fm-color').map((i) => accessibleName(d, i).trim());
    expect(names).toEqual(['None', ...COLORS.map((c) => c.name)]);
  });
  it('the note box is described by its length and caution text', () => {
    const ta = byTag(d, 'textarea')[0];
    expect(ta.attrs['aria-describedby']).toBe('fm-note-help');
    expect(all(d, (e) => e.attrs.id === 'fm-note-help')).toHaveLength(1);
  });
});

describe('overview', () => {
  it('draws one h1 and no skipped heading levels while loading, and nothing private', () => {
    const d = html(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/family' }, createElement(OverviewPage))));
    expect(headings(d).filter((h) => h.level === 1).map((h) => h.text)).toEqual(['Family']);
    expect(headingSkips(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
  });
});
