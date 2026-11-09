import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { accessibleName, all, byTag, headingSkips, headings, parseHtml, textOf, unnamedButtons, unnamedFields } from '../../lib/a11yTestkit';
import { ModuleBase } from '../../core/router';
import ContactForm from './ContactForm';
import ContactPage from './ContactPage';
import DirectoryPage from './DirectoryPage';

/** Contacts C1 accessibility: the structure a screen reader meets on first draw (static markup, as the Family and ST-S3 tests do). Behaviour was checked in a real browser. */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(el));
const inModule = (el: unknown, props: object) => createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/contacts' }, createElement(el as never, props)));

describe('add-contact form', () => {
  const d = html(createElement(ContactForm, { onClose: () => undefined, onOpen: () => undefined, onSaved: () => undefined }));
  it('is a labelled dialog with named fields and buttons', () => {
    const dialog = all(d, (e) => e.attrs.role === 'dialog')[0];
    expect(dialog.attrs['aria-modal']).toBe('true');
    expect(accessibleName(d, dialog)).toBe('Add a contact');
    expect(unnamedFields(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
    expect(byTag(d, 'input').map((i) => accessibleName(d, i).trim())).toEqual([
      'Name', 'How you know them, or what they do (optional)', 'Phone (optional)', 'Email (optional)',
    ]);
  });
  it('says plainly that nothing is merged', () => {
    expect(textOf(d)).toMatch(/Nothing existing is changed or merged/);
  });
});

describe('edit form', () => {
  const contact = { id: 1_780_000_000_000_001, name: 'Jordan Miller', relationship: 'coach', createdAt: 1, updatedAt: 2, deletedAt: null };
  const d = html(createElement(ContactForm, { contact, onClose: () => undefined, onOpen: () => undefined, onSaved: () => undefined }));
  it('is a labelled dialog that starts with the current values and explains the shared contact', () => {
    expect(accessibleName(d, all(d, (e) => e.attrs.role === 'dialog')[0])).toBe('Edit contact');
    expect(byTag(d, 'input')[0].attrs.value).toBe('Jordan Miller');
    expect(textOf(d)).toMatch(/one shared contact/);
    expect(unnamedFields(d)).toEqual([]);
  });
});

describe('screens', () => {
  it('the directory draws one h1 and no skipped heading levels while loading', () => {
    const d = html(inModule(DirectoryPage, {}));
    expect(headings(d).filter((h) => h.level === 1).map((h) => h.text)).toEqual(['Contacts & Relationships']);
    expect(headingSkips(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
  });
  it('a contact page draws one h1 while loading', () => {
    const d = html(inModule(ContactPage, { id: 1 }));
    expect(headings(d).filter((h) => h.level === 1)).toHaveLength(1);
    expect(headingSkips(d)).toEqual([]);
  });
});
