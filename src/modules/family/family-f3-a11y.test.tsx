import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { accessibleName, all, byTag, headingSkips, headings, parseHtml, textOf, unnamedButtons, unnamedFields } from '../../lib/a11yTestkit';
import { ModuleBase } from '../../core/router';
import { ToastProvider } from '../../ui/Toast';
import { ContactForm, ImportantContactsSection } from './ImportantContacts';
import { MemberDatesSection, ProjectsSection, ScheduleSection, TodoSection } from './MemberSections';

/**
 * F3 core accessibility, in the same static-markup method as F1/F2: structure a screen reader meets on first draw. Behaviour (focus, dialogs, the
 * list rows with real data, 320 and 375 px layout, light and dark) was checked in a real browser; see the F3 report.
 */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(el));

describe('add / change an important contact', () => {
  const d = html(createElement(ContactForm, { memberId: 1, ownContactId: 2, onClose: () => undefined, onSaved: () => undefined }));
  it('is a labelled dialog with a grouped choice and a plain caution', () => {
    const dialog = all(d, (e) => e.attrs.role === 'dialog')[0];
    expect(dialog.attrs['aria-modal']).toBe('true');
    expect(accessibleName(d, dialog)).toBe('Add an important contact');
    expect(all(d, (e) => e.tag === 'fieldset').length).toBeGreaterThanOrEqual(2);
    expect(textOf(d)).toMatch(/Do not put health details, identity numbers, passwords or account details here/);
  });
  it('every field and button has a name, and the purpose box is described by its caution', () => {
    expect(unnamedFields(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
    const purpose = byTag(d, 'input').find((i) => accessibleName(d, i) === 'What is this contact for?')!;
    expect(purpose.attrs['aria-describedby']).toBe('fm-ic-help');
    expect(all(d, (e) => e.attrs.id === 'fm-ic-help')).toHaveLength(1);
  });
  it('the two ways to identify the contact are explicit radio choices', () => {
    const radios = byTag(d, 'input').filter((i) => i.attrs.name === 'fm-ic-mode');
    expect(radios.map((r) => accessibleName(d, r))).toEqual(['Use an existing contact', 'Create a new contact']);
  });
  it('changing a purpose names the action and offers no way to swap the Contact', () => {
    const e = html(createElement(ContactForm, { memberId: 1, ownContactId: 2, record: { id: 5, createdAt: 1, updatedAt: 1, raw: {}, problems: [], data: { memberId: 1, contactId: 3, purpose: 'Coach', status: 'active' } }, onClose: () => undefined, onSaved: () => undefined }));
    expect(accessibleName(e, all(e, (x) => x.attrs.role === 'dialog')[0])).toBe('Change purpose');
    expect(byTag(e, 'input').filter((i) => i.attrs.type === 'radio')).toEqual([]);
    expect(unnamedFields(e)).toEqual([]);
  });
});

describe('the new member-page sections', () => {
  const page = html(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/family' }, createElement(ToastProvider, null, createElement('div', null,
    createElement('h1', null, 'Sam'),
    createElement(ScheduleSection, { contactId: 1, today: '2026-11-09', nameOfContact: () => 'x' }),
    createElement(TodoSection, { contactId: 1, today: '2026-11-09', nameOfContact: () => 'x', otherContacts: new Set<number>() }),
    createElement(ProjectsSection, { contactId: 1 }),
    createElement(ImportantContactsSection, { memberId: 1, ownContactId: 1, memberName: 'Sam' }),
    createElement(MemberDatesSection, { memberId: 1 }),
  )))));
  it('each section is a named region with an h2, and no heading level is skipped', () => {
    expect(headings(page).filter((h) => h.level === 2).map((h) => h.text)).toEqual(['Schedule', 'To do', 'Projects', 'Important contacts', 'Important dates']);
    expect(headingSkips(page)).toEqual([]);
    for (const s of all(page, (e) => e.tag === 'section')) expect(s.attrs['aria-labelledby']).toBeTruthy();
  });
  it('no unnamed button or link while loading', () => {
    expect(unnamedButtons(page)).toEqual([]);
  });
});
