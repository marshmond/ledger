import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { accessibleName, all, byTag, headingSkips, headings, parseHtml, textOf, unnamedButtons } from '../../lib/a11yTestkit';
import { readContactReferences, unlistedMentions, type ContactReference } from '../../core/contactReferences';
import { readContactUsage } from '../../core/contactUsage';
import { createDistinctContact } from '../../core/contacts';
import { ModuleBase } from '../../core/router';
import { filterContacts } from './model';
import { factsFor, FILTERS, matchesFilter, MAX_LISTED, PREVIEW, type FilterId } from './references';
import RemoveContact from './RemoveContact';
import WhereUsed, { MentionCounts } from './WhereUsed';
import { freshDb, PROVIDERS, row, TODAY } from './c2-testkit';

/** Contacts C2: the Contact page's "Where this contact is used", the directory filters, and the removal card. Invented data only. */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(el));
const ref = (over: Partial<ContactReference> = {}): ContactReference => ({ contactId: 1, module: 'tasks', kind: 'task', recordId: '1', role: 'person', title: 'Task one', relation: 'Listed under People on this task', href: '/tasks?task=1', ...over });
const none = { total: 0, kinds: [] };

describe('Where this contact is used', () => {
  it('groups by module in reading order, each with a heading, real titles, the relationship in words, a date and a status', () => {
    const d = html(createElement(WhereUsed, {
      unlisted: none, unverified: [],
      refs: [
        ref({ module: 'family', kind: 'member', recordId: '9', title: 'Household member', relation: 'Spouse in the household', href: '/family/m/9', status: 'In the household' }),
        ref({ module: 'tasks', recordId: '2', title: 'Book the dentist', date: '2026-12-01', status: 'To do', href: '/tasks?task=2' }),
        ref({ module: 'bills', kind: 'obligation', recordId: '3', title: 'Example Power', relation: 'Provider of this bill', href: '/bills/o/3', status: 'Active' }),
      ],
    }));
    expect(headings(d).map((h) => `${h.level}:${h.text}`)).toEqual(['2:Where this contact is used', '3:Family 1', '3:Tasks 1', '3:Bills & Subscriptions 1']);
    expect(headingSkips(d)).toEqual([]);
    const text = textOf(d);
    expect(text).toContain('Book the dentist');
    expect(text).toContain('Listed under People on this task');
    expect(text).toContain('Dec 1, 2026 · To do');
    const links = all(d, (e) => e.tag === 'a').map((a) => a.attrs.href);
    expect(links).toEqual(['#/family/m/9', '#/tasks?task=2', '#/bills/o/3']);
  });

  it('a reference with no address is shown as plain text, not a dead link', () => {
    const d = html(createElement(WhereUsed, { unlisted: none, unverified: [], refs: [ref({ href: undefined, title: 'Handed over' })] }));
    expect(all(d, (e) => e.tag === 'a')).toHaveLength(0);
    expect(textOf(d)).toContain('Handed over');
  });

  it('keeps long lists short: a preview with a named "Show all" button, and a hard limit that says how many are not shown', () => {
    const many = Array.from({ length: PREVIEW + 3 }, (_, i) => ref({ recordId: String(i), title: `Task ${i}`, href: `/tasks?task=${i}` }));
    const d = html(createElement(WhereUsed, { unlisted: none, unverified: [], refs: many }));
    expect(all(d, (e) => e.tag === 'li')).toHaveLength(PREVIEW);
    const show = byTag(d, 'button').find((b) => b.attrs['aria-label']?.startsWith('Show all'))!;
    expect(accessibleName(d, show)).toBe(`Show all ${PREVIEW + 3} in Tasks`);
    expect(unnamedButtons(d)).toEqual([]);
    expect(MAX_LISTED).toBe(100);
    const small = html(createElement(WhereUsed, { unlisted: none, unverified: [], refs: many.slice(0, PREVIEW) }));
    expect(byTag(small, 'button')).toHaveLength(0);
  });

  it('shows a useful empty state, and never one when something could not be checked or could not be named', () => {
    const empty = textOf(html(createElement(WhereUsed, { unlisted: none, unverified: [], refs: [] })));
    expect(empty).toContain('No record in Ledger names this contact yet');
    const partial = textOf(html(createElement(WhereUsed, { unlisted: none, unverified: [{ label: 'Tasks', message: 'x' }], refs: [] })));
    expect(partial).not.toContain('No record in Ledger names');
    expect(partial).toContain('could not check Tasks');
    const more = textOf(html(createElement(WhereUsed, { unlisted: { total: 2, kinds: [{ module: 'shared', kind: 'attachment', count: 2 }] }, unverified: [], refs: [] })));
    expect(more).not.toContain('No record in Ledger names');
    expect(more).toContain('2 more stored records');
    expect(more).toContain('Other stored references may exist');
    expect(more).toContain('2 attachments');
  });

  it('says it is still checking while it loads', () => {
    expect(textOf(html(createElement(WhereUsed, { unlisted: none, unverified: [], refs: [], loading: true })))).toContain('Checking every module');
  });

  it('the cross-check card keeps the conservative counts and says a difference never means "unused"', () => {
    const d = html(createElement(MentionCounts, { entries: [{ module: 'tasks', kind: 'task', count: 2 }], approximate: false }));
    expect(textOf(d)).toContain('Tasks: 2 tasks');
    expect(textOf(d)).toContain('never means a contact is unused');
  });
});

describe('the removal card', () => {
  const contact = { id: 1_780_000_000_000_001, name: 'Spare Person', createdAt: 1, updatedAt: 2, deletedAt: null };
  const draw = (props: { inUse: boolean; checkedAll: boolean }) => html(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/contacts' }, createElement(RemoveContact, { contact, ...props }))));

  it('offers removal only when nothing uses the contact and every module was checked', () => {
    expect(byTag(draw({ inUse: false, checkedAll: true }), 'button').map((b) => textOf(b))).toEqual(['Remove from Ledger…']);
    const used = draw({ inUse: true, checkedAll: true });
    expect(byTag(used, 'button')).toHaveLength(0);
    expect(textOf(used)).toContain('in use, so it cannot be removed');
    const unchecked = draw({ inUse: false, checkedAll: false });
    expect(byTag(unchecked, 'button')).toHaveLength(0);
    expect(textOf(unchecked)).toContain('could not finish checking every module');
  });

  it('is its own clearly named section, separate from editing', () => {
    const d = draw({ inUse: false, checkedAll: true });
    expect(headings(d).map((h) => h.text)).toEqual(['Remove this contact']);
    expect(byTag(d, 'button')[0].attrs.class).toContain('danger');
  });
});

describe('directory filters use stored relationships, never typed words', () => {
  async function world() {
    const d = freshDb();
    const mk = (name: string, relationship?: string) => createDistinctContact(d, { name, relationship });
    const member = await mk('Member Person', 'plumber'); // a typed word "plumber" is not a relationship
    const important = await mk('Important Person');
    const provider = await mk('Provider Person');
    const participant = await mk('Participant Person');
    await mk('Nothing Person');
    const unknownOnly = await mk('Unknown Only');
    const archivedOnly = await mk('Archived Only');
    const kid = await mk('Kid Person');
    const kidMember = await row(d, 'family', 'member', { contactId: kid, role: 'child', status: 'active' });
    await row(d, 'family', 'member', { contactId: member, role: 'parent', status: 'active' });
    await row(d, 'family', 'contact', { memberId: kidMember, contactId: important, purpose: 'Coach', status: 'active' });
    await row(d, 'family', 'contact', { memberId: kidMember, contactId: archivedOnly, purpose: 'Old tutor', status: 'archived' });
    await row(d, 'services', 'visit', { title: 'v', providerContactId: provider, date: '2026-01-01', status: 'completed' });
    await row(d, 'bills', 'obligation', { title: 'b', type: 'utility', providerContactId: member, status: 'active' }); // one Contact in two categories
    await row(d, 'projects', 'commitment', { projectId: 1, vendorContactId: participant, title: 'q', status: 'accepted', amountCents: 1 });
    await row(d, 'futuremodule', 'thing', { who: unknownOnly });
    const contacts = await d.contacts.toArray();
    const r = await readContactReferences(contacts.map((c) => c.id as number), d, PROVIDERS, TODAY);
    const u = await readContactUsage(d);
    const facts = new Map(contacts.map((c) => [c.id as number, factsFor(r.byContact.get(c.id as number), u.byContact.get(c.id as number))]));
    const names = (f: FilterId, checked = r.verified) => contacts.filter((c) => matchesFilter(f, facts.get(c.id as number)!, checked)).map((c) => c.name).sort();
    return { names, r };
  }

  it('each filter lists exactly the Contacts whose stored records say so; a Contact can be in several', async () => {
    const { names, r } = await world();
    expect(r.verified).toBe(true);
    expect(names('all')).toHaveLength(8);
    expect(names('member')).toEqual(['Kid Person', 'Member Person']);
    expect(names('important')).toEqual(['Important Person']); // the archived association is not "important"
    expect(names('provider')).toEqual(['Member Person', 'Provider Person']);
    expect(names('project')).toEqual(['Participant Person']);
  });

  it('"no confirmed references" needs BOTH the named readers and the complete scan to be clear', async () => {
    const { names } = await world();
    const none = names('none');
    expect(none).toEqual(['Nothing Person']);
    expect(none).not.toContain('Unknown Only'); // only the numeric scan sees it: not "none"
    expect(none).not.toContain('Archived Only'); // an archived association is still a stored reference
  });

  it('when a module could not be checked the "no references" list is empty, never wrong', async () => {
    const { names } = await world();
    expect(names('none', false)).toEqual([]);
  });

  it('the labels are the six listed, in order, and the directory search still works inside a filter', () => {
    expect(FILTERS.map((f) => f.label)).toEqual(['All contacts', 'Household members', 'Important Family contacts', 'Service providers', 'Project participants', 'No confirmed references']);
    const people = [{ id: 1, name: 'Sam Example', relationship: 'plumber', phone: '555-0100', createdAt: 1, updatedAt: 1, deletedAt: null }, { id: 2, name: 'Jo Example', createdAt: 1, updatedAt: 1, deletedAt: null }];
    expect(filterContacts(people, '5550100').map((c) => c.id)).toEqual([1]);
  });

  it('the directory filter cannot authorize a removal: the removal card never imports the filters and the plan never reads them', async () => {
    const fs = await import('node:fs');
    expect(fs.readFileSync('src/modules/contacts/RemoveContact.tsx', 'utf8')).not.toMatch(/matchesFilter|FILTERS|references'/);
    expect(fs.readFileSync('src/core/contactRemoval.ts', 'utf8')).not.toMatch(/matchesFilter|FILTERS/);
  });

  it('unlisted mentions are never read as "unused": a record only the scan can see gives a difference, not an empty list', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'futuremodule', 'thing', { who: c });
    const r = await readContactReferences([c], d, PROVIDERS, TODAY);
    const u = await readContactUsage(d, [c]);
    expect(r.byContact.get(c)).toBeUndefined();
    expect(unlistedMentions(u.byContact.get(c), []).total).toBe(1);
  });
});

describe('phone width and themes (styles)', () => {
  it('the new styles wrap long names, keep 44 px targets on phones and use theme colour variables only', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('src/modules/contacts/contacts.css', 'utf8');
    const c2 = css.slice(css.indexOf('/* C2:'));
    expect(c2).toMatch(/\.ct-ref \{[^}]*overflow-wrap: anywhere/);
    expect(c2).toMatch(/@media \(max-width: 480px\)[\s\S]*\.ct-ref-title \{ min-height: 44px/);
    expect(c2).toMatch(/@media \(max-width: 760px\)[\s\S]*\.ct-tools \{ grid-template-columns: 1fr/);
    const cal = fs.readFileSync('src/modules/calendar/calendar.css', 'utf8');
    const pick = cal.slice(cal.indexOf('/* C2: a typed name'), cal.indexOf('.cal-pick-same .as-check') + 200);
    expect(pick).toMatch(/overflow-wrap: anywhere/);
    for (const block of [c2, pick]) expect(block.replace(/var\(--[\w-]+, #[0-9a-f]{3,8}\)/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    expect(cal).toMatch(/\.cal-pick \.btn \{ min-height: 44px/);
  });
});
