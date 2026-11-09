import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { accessibleName, all, byTag, parseHtml, textOf, unnamedButtons, unnamedFields } from '../../lib/a11yTestkit';
import { addPickedContact, contactBrief, contactChoiceLabel, sharedNameIds } from '../../core/contactChoice';
import { createDistinctContact } from '../../core/contacts';
import type { Contact } from '../../core/entities';
import { readContactReferences } from '../../core/contactReferences';
import { ContactPickerView } from '../../ui/pickers';
import { createEvent, loadEvents, newEventData } from '../calendar/data';
import { createTask, getTask, loadTasks, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { freshDb, PROVIDERS, snapshot, TODAY } from './c2-testkit';

/** Contacts C2: choosing and adding Contacts in the Calendar and Task "People" box. Invented data only. */
const mk = (id: number, name: string, over: Partial<Contact> = {}): Contact => ({ id, name, createdAt: Date.UTC(2026, 2, id), updatedAt: 1, deletedAt: null, ...over });
const noop = () => undefined;
const view = (props: Partial<Parameters<typeof ContactPickerView>[0]>) => parseHtml(renderToStaticMarkup(createElement(ContactPickerView, {
  contacts: [], value: [], text: '', pending: null, different: false, error: '', busy: false,
  onText: noop, onPick: noop, onRemove: noop, onAdd: noop, onUse: noop, onDifferent: noop, onCancel: noop, ...props,
})));

describe('labels that tell two people with one name apart', () => {
  const sam1 = mk(1, 'Sam Example', { relationship: 'plumber', phone: '555-0101' });
  const sam2 = mk(2, 'Sam Example', { relationship: 'school coach' });
  const sam3 = mk(3, 'sam  example'); // same name apart from case and spacing
  const jo = mk(4, 'Jo Example', { relationship: 'sister' });
  const everyone = [sam1, sam2, sam3, jo];

  it('a name used once is just the name (plus how you know them); a name used more than once always carries details and its place among them', () => {
    expect(sharedNameIds(everyone)).toEqual(new Set([1, 2, 3]));
    expect(contactChoiceLabel(jo, everyone)).toBe('Jo Example (sister)');
    expect(contactChoiceLabel(mk(9, 'Solo'), [mk(9, 'Solo')])).toBe('Solo');
    const labels = [sam1, sam2, sam3].map((c) => contactChoiceLabel(c, everyone));
    expect(new Set(labels).size).toBe(3); // no two read the same
    expect(labels[0]).toContain('plumber');
    expect(labels[1]).toContain('school coach');
    expect(labels[0]).toMatch(/1 of 3 with this name/);
    expect(labels[2]).toMatch(/3 of 3 with this name/);
  });

  it('two entries with identical details are still told apart (by their place in the order they were added)', () => {
    const a = mk(1, 'Twin Example'); const b = mk(2, 'Twin Example', { createdAt: a.createdAt });
    const [la, lb] = [a, b].map((c) => contactChoiceLabel(c, [a, b]));
    expect(la).not.toBe(lb);
  });

  it('a removed Contact is not counted as a same-name Contact', () => {
    expect(sharedNameIds([sam1, mk(7, 'Sam Example', { deletedAt: 9 })]).size).toBe(0);
  });

  it('the brief never includes a note', () => {
    expect(contactBrief({ ...sam1, notes: 'secret' } as Contact)).not.toContain('secret');
  });
});

describe('the picker as drawn', () => {
  const sam1 = mk(1, 'Sam Example', { relationship: 'plumber' });
  const sam2 = mk(2, 'Sam Example', { relationship: 'school coach' });

  it('offers two same-name Contacts as two separate choices, each by its own id', () => {
    const d = view({ contacts: [sam1, sam2] });
    const select = all(d, (e) => e.tag === 'select')[0];
    const opts = all(d, (e) => e.tag === 'option').filter((o) => o.attrs.value);
    expect(opts.map((o) => o.attrs.value)).toEqual(['1', '2']);
    expect(new Set(opts.map((o) => textOf(o))).size).toBe(2);
    expect(accessibleName(d, select)).toBe('Pick an existing person');
  });

  it('shows a chosen Contact as a labelled chip (so the right one is plain) and a Remove button named for it', () => {
    const d = view({ contacts: [sam1, sam2], value: [2] });
    const chip = all(d, (e) => e.attrs.class === 'chip')[0];
    expect(textOf(chip)).toContain('school coach');
    expect(textOf(chip)).not.toContain('plumber');
    expect(accessibleName(d, byTag(d, 'button').find((b) => b.attrs['aria-label']?.startsWith('Remove'))!)).toBe('Remove Sam Example');
    expect(all(d, (e) => e.tag === 'option').filter((o) => o.attrs.value).map((o) => o.attrs.value)).toEqual(['1']); // the chosen one is not offered again
  });

  it('says so when a chosen Contact no longer exists', () => {
    expect(textOf(view({ contacts: [sam1], value: [99] }))).toContain('A contact that no longer exists');
  });

  it('typing a name offers "Add new contact" (it does not say "Add", which used to find-or-create)', () => {
    const d = view({ contacts: [sam1], text: 'New Person' });
    const add = byTag(d, 'button').find((b) => textOf(b) === 'Add new contact')!;
    expect(add.attrs.disabled).toBeUndefined();
    expect(accessibleName(d, byTag(d, 'input')[0])).toBe('Name of a new contact');
  });

  it('a same-name warning lists each match with details, a "Use this one" button per match, and a tick that gates the new contact', () => {
    const pending = { name: 'Sam Example', matches: [sam1, sam2] };
    const off = view({ contacts: [sam1, sam2], text: 'Sam Example', pending });
    expect(textOf(off)).toContain('2 contacts named “Sam Example” already exist');
    const use = byTag(off, 'button').filter((b) => textOf(b) === 'Use this one');
    expect(use).toHaveLength(2);
    expect(use.map((b) => b.attrs['aria-label'])).toEqual([expect.stringContaining('plumber'), expect.stringContaining('school coach')]);
    const create = byTag(off, 'button').find((b) => textOf(b) === 'Add as a new contact')!;
    expect(create.attrs.disabled).toBeDefined(); // not until ticked
    const on = view({ contacts: [sam1, sam2], text: 'Sam Example', pending, different: true });
    expect(byTag(on, 'button').find((b) => textOf(b) === 'Add as a new contact')!.attrs.disabled).toBeUndefined();
    expect(unnamedFields(off)).toEqual([]);
    expect(unnamedButtons(off)).toEqual([]);
    expect(textOf(off)).toContain('different person or organization with the same name');
  });

  it('a match that is already chosen cannot be chosen twice', () => {
    const d = view({ contacts: [sam1, sam2], value: [1], pending: { name: 'Sam Example', matches: [sam1, sam2] } });
    expect(textOf(d)).toContain('Already added');
    expect(byTag(d, 'button').filter((b) => textOf(b) === 'Use this one')).toHaveLength(1);
  });
});

describe('adding a new Contact on purpose', () => {
  it('a new name is created as a new, separate Contact', async () => {
    const d = freshDb();
    const r = await addPickedContact(d, '  New   Person ', false);
    expect(r.status).toBe('created');
    expect(await d.contacts.count()).toBe(1);
    expect((await d.contacts.toArray())[0].name).toBe('New Person');
  });

  it('a name that is already taken creates NOTHING and returns the matches, without confirmation (no silent reuse, no silent create)', async () => {
    const d = freshDb();
    const sam = await createDistinctContact(d, { name: 'Sam Example', relationship: 'plumber' });
    const before = await snapshot(d);
    for (const typed of ['Sam Example', 'sam example', '  SAM   EXAMPLE ', 'Sám Example']) {
      const r = await addPickedContact(d, typed, false);
      expect(r.status, typed).toBe('needs-confirmation');
      if (r.status === 'needs-confirmation') expect(r.matches.map((m) => m.id)).toEqual([sam]);
    }
    expect(await snapshot(d)).toBe(before);
  });

  it('with confirmation it creates a SEPARATE Contact and the original is byte-identical; nothing is merged or filled in', async () => {
    const d = freshDb();
    const sam = await createDistinctContact(d, { name: 'Sam Example', relationship: 'plumber', phone: '555-0101' });
    const original = JSON.stringify(await d.contacts.get(sam));
    const r = await addPickedContact(d, 'Sam Example', true);
    expect(r.status).toBe('created');
    const id = (r as { id: number }).id;
    expect(id).not.toBe(sam);
    expect(await d.contacts.count()).toBe(2);
    expect(JSON.stringify(await d.contacts.get(sam))).toBe(original);
    expect(await d.contacts.get(id)).toMatchObject({ name: 'Sam Example' });
    expect((await d.contacts.get(id))!.relationship).toBeUndefined();
  });

  it('a Contact added a moment ago is still noticed (the check and the create are one transaction)', async () => {
    const d = freshDb();
    const results = await Promise.all([addPickedContact(d, 'Race Example', false), addPickedContact(d, 'Race Example', false)]);
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'needs-confirmation']);
    expect(await d.contacts.count()).toBe(1);
  });

  it('a removed Contact with the same name does not trigger the warning', async () => {
    const d = freshDb();
    const gone = await createDistinctContact(d, { name: 'Old Example' });
    await d.contacts.update(gone, { deletedAt: 5 } as never);
    expect((await addPickedContact(d, 'Old Example', false)).status).toBe('created');
  });

  it('an empty or too-long name is refused with a plain message and nothing is created', async () => {
    const d = freshDb();
    await expect(addPickedContact(d, '   ', false)).rejects.toThrow('Enter a name.');
    await expect(addPickedContact(d, 'x'.repeat(121), false)).rejects.toThrow('too long');
    expect(await d.contacts.count()).toBe(0);
  });
});

describe('what the Calendar and Task editors store (their real data path)', () => {
  it('a Task keeps the intended Contact id between two people with one name, across editing and re-saving', async () => {
    const d = freshDb();
    const first = await createDistinctContact(d, { name: 'Sam Example', relationship: 'plumber' });
    const second = await createDistinctContact(d, { name: 'Sam Example', relationship: 'school coach' });
    const id = await createTask(blankTask({ title: 'Call the coach', contactIds: [second] }), [], d);
    // The editor opens the stored Task, shows its chips, and saves the same list back: nothing re-resolves by name.
    const t = (await getTask(id, d))!;
    await saveTask(id, { ...t.data, title: 'Call the coach about Friday', notes: 'edited' }, d);
    expect((await getTask(id, d))!.data.contactIds).toEqual([second]);
    expect(await d.contacts.count()).toBe(2);
    const refs = (await readContactReferences([first, second], d, PROVIDERS, TODAY)).byContact;
    expect(refs.get(second)!.map((r) => r.title)).toEqual(['Call the coach about Friday']);
    expect(refs.get(first)).toBeUndefined(); // the other Sam was never substituted
  });

  it('an event keeps the intended Contact ids and a second save changes nothing about them', async () => {
    const d = freshDb();
    const first = await createDistinctContact(d, { name: 'Sam Example', relationship: 'plumber' });
    const second = await createDistinctContact(d, { name: 'Sam Example', relationship: 'school coach' });
    const data = newEventData(
      { title: 'Coach meeting', allDay: true, startDate: '2026-12-03', endDate: '2026-12-03', startAt: null, endAt: null, location: '', notes: '', priority: 'medium', reminders: [] } as never,
      { calendarId: 1, tagIds: [], contactIds: [second, first], recurrence: null, trackDone: false } as never,
    );
    const id = await createEvent(data, d);
    const stored = (await loadEvents(d)).find((e) => e.id === id)!;
    expect(stored.data.contactIds).toEqual([second, first]);
    const refs = (await readContactReferences([first, second], d, PROVIDERS, TODAY)).byContact;
    expect(refs.get(first)!.map((r) => r.title)).toEqual(['Coach meeting']);
    expect(refs.get(second)!.map((r) => r.title)).toEqual(['Coach meeting']);
    expect((await loadTasks(d)).length).toBe(0);
    expect(await d.contacts.count()).toBe(2);
  });
});

describe('guards on the code', () => {
  it('the shared picker no longer finds-or-creates by a typed name, and creates only through the explicit path', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/ui/pickers.tsx', 'utf8');
    const a = src.indexOf('export function ContactPickerView');
    const picker = src.slice(a, src.indexOf('const refKey'));
    expect(picker).not.toMatch(/toLowerCase\(\) === /);
    expect(picker).not.toMatch(/findOrCreateContact|contacts\.put\(|contacts\.add\(/);
    expect(picker).toContain('addPickedContact');
  });

  it('the picker is used by exactly the Calendar event editor and the Task editor (no hidden caller)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const hits: string[] = [];
    const walk = (dir: string) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name) && !/\.test\./.test(f.name) && /\bContactPicker\b/.test(fs.readFileSync(p, 'utf8'))) hits.push(p.replace(/\\/g, '/')); } };
    walk('src');
    expect(hits.sort()).toEqual(['src/modules/calendar/EventEditor.tsx', 'src/modules/tasks/TaskEditor.tsx', 'src/ui/pickers.tsx']);
  });

  it('the remaining name-matching creation paths are exactly the documented ones (not changed in C2)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const hits: string[] = [];
    const walk = (dir: string) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name) && !/\.test\./.test(f.name) && /\bfindOrCreateContact\b/.test(fs.readFileSync(p, 'utf8'))) hits.push(p.replace(/\\/g, '/')); } };
    walk('src');
    expect(hits.sort()).toEqual([
      'src/core/contacts.ts', 'src/modules/assets/AssetForm.tsx', 'src/modules/assets/ServiceForm.tsx', 'src/modules/assets/WarrantyForm.tsx',
      'src/modules/bills/data.ts', 'src/modules/bills/discoveryData.ts', 'src/modules/projects/CommitmentForm.tsx', 'src/modules/projects/data.ts', 'src/modules/services/data.ts',
    ]);
  });
});

describe('final verification probes (picker)', () => {
  const sam = (id: number, over: Partial<Contact> = {}) => mk(id, 'Sam Example', over);
  it('a chosen Contact that was removed elsewhere is not silently replaced by a same-named one', () => {
    const d = view({ contacts: [sam(2, { relationship: 'new entry' })], value: [1] });
    const chip = all(d, (e) => e.attrs.class === 'chip')[0];
    expect(textOf(chip)).toContain('A contact that no longer exists');
    expect(textOf(chip)).not.toContain('new entry');
    expect(all(d, (e) => e.tag === 'option').filter((o) => o.attrs.value).map((o) => o.attrs.value)).toEqual(['2']); // still only a choice, never auto-chosen
  });

  it('the same-name confirmation is a real checkbox with a full spoken name, reachable by keyboard', () => {
    const d = view({ contacts: [sam(1), sam(2)], pending: { name: 'Sam Example', matches: [sam(1), sam(2)] } });
    const box = all(d, (e) => e.tag === 'input' && e.attrs.type === 'checkbox')[0];
    expect(accessibleName(d, box).trim()).toBe('This is a different person or organization with the same name');
    expect(box.attrs.tabindex).toBeUndefined(); // in the normal tab order
    expect(box.attrs.disabled).toBeUndefined();
  });
});
