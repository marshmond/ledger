import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { accessibleName, all, parseHtml, textOf, unnamedButtons, unnamedFields } from '../../lib/a11yTestkit';
import type { Contact } from '../../core/entities';
import { ContactField, ContactSelect, NewContactBoxView, NO_PICK, PendingNewContact, pickChanged, pickOf, pickToChoice, BLANK_FIELDS } from '../../ui/ContactChoice';

/** Contacts U2: the shared "use an existing contact / create a new one" choice, as drawn. No browser needed. Invented data only. */
const mk = (id: number, name: string, over: Partial<Contact> = {}): Contact => ({ id, name, createdAt: Date.UTC(2026, 2, id), updatedAt: 1, deletedAt: null, ...over });
const noop = () => undefined;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(el));
const box = (props: Partial<Parameters<typeof NewContactBoxView>[0]> = {}) => html(createElement(NewContactBoxView, {
  idp: 't', fields: { ...BLANK_FIELDS, name: 'Sam Example' }, matches: null, different: false, error: '', busy: false, submitLabel: 'Create new contact', showRelationship: false,
  onField: noop, onSubmit: noop, onUse: noop, onDifferent: noop, onCancel: noop, ...props,
}));
const sam1 = mk(1, 'Sam Example', { relationship: 'plumber', phone: '555-0101' });
const sam2 = mk(2, 'Sam Example', { relationship: 'school coach' });
const jo = mk(3, 'Jo Example');

describe('the existing-Contact menu', () => {
  const sel = (props: Partial<Parameters<typeof ContactSelect>[0]> = {}) => html(createElement(ContactSelect, { idp: 't', label: 'Provider', contacts: [sam1, sam2, jo], value: null, onChange: noop, noneLabel: 'No provider', ...props }));

  it('offers every live Contact as its own choice BY ID; two same-name Contacts read differently', () => {
    const d = sel();
    const opts = all(d, (e) => e.tag === 'option');
    expect(opts.map((o) => o.attrs.value)).toEqual(['', '1', '2', '3']);
    const texts = opts.map((o) => textOf(o));
    expect(new Set(texts).size).toBe(4);
    expect(texts[1]).toContain('plumber');
    expect(texts[2]).toContain('school coach');
    expect(texts[1]).toMatch(/1 of 2 with this name/);
    expect(texts[2]).toMatch(/2 of 2 with this name/);
    expect(texts[3]).toBe('Jo Example');
    expect(accessibleName(d, all(d, (e) => e.tag === 'select')[0])).toBe('Provider');
  });

  it('a removed Contact is not offered, and a stored id that no longer exists stays selected as "(contact removed)" (never swapped for a same-name one)', () => {
    const gone = mk(9, 'Sam Example', { deletedAt: 5 });
    const d = sel({ contacts: [sam1, gone], value: 9 });
    const opts = all(d, (e) => e.tag === 'option');
    expect(opts.map((o) => o.attrs.value)).toEqual(['', '9', '1']);
    expect(textOf(opts[1])).toBe('(contact removed)');
    expect(opts[1].attrs.selected).toBeDefined();
    expect(opts.some((o) => o.attrs.selected !== undefined && o.attrs.value === '1')).toBe(false);
  });

  it('can leave a Contact out of the list (the current provider cannot replace itself)', () => {
    const d = sel({ exclude: [2] });
    expect(all(d, (e) => e.tag === 'option').map((o) => o.attrs.value)).toEqual(['', '1', '3']);
  });
});

describe('the new-Contact box', () => {
  it('has labelled fields and buttons, a disabled submit while the name is blank, and no same-name warning when nothing matches', () => {
    const d = box();
    expect(unnamedFields(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
    const names = all(d, (e) => e.tag === 'input').map((i) => accessibleName(d, i));
    expect(names).toEqual(['Name', 'Phone (optional)', 'Email (optional)']);
    expect(textOf(d)).not.toMatch(/already exists/);
    const blank = box({ fields: BLANK_FIELDS });
    expect(all(blank, (e) => e.tag === 'button').find((b) => textOf(b) === 'Create new contact')!.attrs.disabled).toBeDefined();
    expect(all(d, (e) => e.tag === 'button').find((b) => textOf(b) === 'Create new contact')!.attrs.disabled).toBeUndefined();
  });

  it('shows "What they do" only where the form wants it', () => {
    expect(all(box({ showRelationship: true }), (e) => e.tag === 'input').map((i) => i.attrs.id)).toContain('t-rel');
    expect(all(box(), (e) => e.tag === 'input').map((i) => i.attrs.id)).not.toContain('t-rel');
  });

  it('a taken name: lists EVERY match with details, a "Use existing contact" button for each, and blocks creation until "different person" is ticked', () => {
    const d = box({ matches: [sam1, sam2] });
    const text = textOf(d);
    expect(text).toContain('This name already exists.');
    expect(text).toMatch(/2 contacts named “Sam Example” are already in your contacts/);
    expect(text).toContain('plumber');
    expect(text).toContain('school coach');
    const use = all(d, (e) => e.tag === 'button' && /^Use existing contact/.test(e.attrs['aria-label'] ?? ''));
    expect(use.map((b) => b.attrs['aria-label']).every((l) => /plumber|school coach/.test(l))).toBe(true);
    expect(new Set(use.map((b) => b.attrs['aria-label'])).size).toBe(2); // distinguishable by a screen reader
    expect(textOf(use[0])).toBe('Use this contact');
    const check = all(d, (e) => e.tag === 'input' && e.attrs.type === 'checkbox')[0];
    expect(accessibleName(d, check)).toBe('This is a different person or organization with the same name');
    expect(unnamedFields(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
    const create = all(d, (e) => e.tag === 'button').find((b) => textOf(b) === 'Create new contact')!;
    expect(create.attrs.disabled).toBeDefined();
    const ticked = box({ matches: [sam1, sam2], different: true });
    expect(all(ticked, (e) => e.tag === 'button').find((b) => textOf(b) === 'Create new contact')!.attrs.disabled).toBeUndefined();
  });

  it('one match reads in the singular; a warning and an error are announced; Cancel is always there', () => {
    const d = box({ matches: [sam1], error: 'That email address does not look right.' });
    expect(textOf(d)).toMatch(/A contact named “Sam Example” is already in your contacts/);
    expect(all(d, (e) => e.attrs.role === 'alert').length).toBeGreaterThanOrEqual(2);
    expect(all(d, (e) => e.tag === 'button').some((b) => textOf(b) === 'Cancel')).toBe(true);
  });

  it('a match never carries a note (only how you know them, how to reach them and when it was added)', () => {
    const d = box({ matches: [{ ...sam1, notes: 'secret note' } as Contact] });
    expect(textOf(d)).not.toContain('secret note');
    expect(textOf(d)).toMatch(/added/);
  });
});

describe('one Contact field (menu plus new)', () => {
  const field = (value = NO_PICK, contacts = [sam1, sam2]) => html(createElement(ContactField, { idp: 'f', label: 'Provider', contacts, value, onChange: noop, noneLabel: 'No provider' }));

  it('starts with the menu and a plain link-button to create a new contact; no box is open', () => {
    const d = field();
    expect(all(d, (e) => e.tag === 'select')).toHaveLength(1);
    expect(all(d, (e) => e.tag === 'button').map((b) => textOf(b))).toEqual(['Create a new contact instead']);
    expect(all(d, (e) => e.attrs.role === 'group')).toHaveLength(0);
  });

  it('a new contact waiting to be saved is described plainly with Change and Do not create; the menu says "New contact (below)" and the link is hidden', () => {
    const d = field({ contactId: null, newContact: { name: 'Fresh Cleaners', phone: '555-0100', confirmedDifferent: true } });
    const text = textOf(d);
    expect(text).toContain('New contact to be created when you save: Fresh Cleaners');
    expect(text).toContain('a different person or organization');
    expect(all(d, (e) => e.tag === 'option').map((o) => textOf(o))[0]).toBe('New contact (below)');
    expect(all(d, (e) => e.tag === 'button').map((b) => b.attrs['aria-label'])).toEqual(['Change the new contact Fresh Cleaners', 'Do not create the new contact Fresh Cleaners']);
    expect(unnamedButtons(d)).toEqual([]);
  });

  it('an existing choice is the selected option by id', () => {
    const d = field(pickOf(2));
    const selected = all(d, (e) => e.tag === 'option' && e.attrs.selected !== undefined);
    expect(selected.map((o) => o.attrs.value)).toEqual(['2']);
  });

  it('the pending-contact line stands alone too (accessible, status role)', () => {
    const d = html(createElement(PendingNewContact, { choice: { name: 'Fresh Cleaners' }, onChange: noop, onRemove: noop }));
    expect(all(d, (e) => e.attrs.role === 'status')).toHaveLength(1);
  });
});

describe('the choice helpers', () => {
  it('pickToChoice: a new contact wins, else the id, else nobody', () => {
    expect(pickToChoice(NO_PICK)).toBeNull();
    expect(pickToChoice(pickOf(5))).toEqual({ contactId: 5 });
    expect(pickToChoice({ contactId: 5, newContact: { name: 'X' } })).toEqual({ name: 'X' });
  });
  it('pickChanged: an unchanged id is not a change (so the save leaves the stored Contact alone); a new contact or a different id is', () => {
    expect(pickChanged(pickOf(5), 5)).toBe(false);
    expect(pickChanged(pickOf(null), null)).toBe(false);
    expect(pickChanged(pickOf(6), 5)).toBe(true);
    expect(pickChanged(pickOf(null), 5)).toBe(true);
    expect(pickChanged({ contactId: null, newContact: { name: 'X' } }, null)).toBe(true);
  });
});

describe('guards on the code (identity safety)', () => {
  const read = async (p: string) => (await import('node:fs')).readFileSync(p, 'utf8');
  const walk = async (dir: string, out: string[] = []) => {
    const fs = await import('node:fs'); const path = await import('node:path');
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) await walk(p, out); else if (/\.tsx?$/.test(f.name) && !/\.test\.tsx?$/.test(f.name)) out.push(p.replace(/\\/g, '/')); }
    return out;
  };

  it('every form that picks or creates a Contact in the four modules goes through the shared choice', async () => {
    const forms = [
      'src/modules/assets/AssetForm.tsx', 'src/modules/assets/ServiceForm.tsx', 'src/modules/assets/WarrantyForm.tsx',
      'src/modules/bills/ObligationForm.tsx',
      'src/modules/projects/CommitmentForm.tsx', 'src/modules/projects/Vendors.tsx',
      'src/modules/services/ArrangementForm.tsx', 'src/modules/services/Dialogs.tsx', 'src/modules/services/VisitDialogs.tsx',
    ];
    for (const f of forms) expect(await read(f), f).toMatch(/ui\/ContactChoice/);
  });

  it('no form decides a Contact by comparing names, and none creates a Contact by a direct table write', async () => {
    const files = [
      'src/modules/assets/AssetForm.tsx', 'src/modules/assets/ServiceForm.tsx', 'src/modules/assets/WarrantyForm.tsx', 'src/modules/bills/ObligationForm.tsx',
      'src/modules/projects/CommitmentForm.tsx', 'src/modules/projects/Vendors.tsx', 'src/modules/services/ArrangementForm.tsx', 'src/modules/services/Dialogs.tsx', 'src/modules/services/VisitDialogs.tsx',
      'src/ui/ContactChoice.tsx',
    ];
    for (const f of files) {
      const t = await read(f);
      expect(t, f).not.toMatch(/findOrCreateContact/);
      expect(t, f).not.toMatch(/\.name\.trim\(\)\.toLowerCase\(\)\s*===|c\.name\.toLowerCase\(\)\s*===|toLowerCase\(\) === typed/);
      expect(t, f).not.toMatch(/contacts\.(put|add|bulkPut|bulkAdd|update)\(/);
    }
  });

  it('the shared choice creates a Contact only through resolveContactChoice, and never imports a module', async () => {
    const t = await read('src/ui/ContactChoice.tsx');
    expect(t).toMatch(/resolveContactChoice\(db,/);
    expect(t).not.toMatch(/from '\.\.\/modules\//);
  });

  it('Quick Add never creates or links a Contact: its commit passes no provider choice, only a name for the record', async () => {
    const bills = await read('src/modules/bills/quickAddDef.ts');
    const services = await read('src/modules/services/quickAddDef.ts');
    expect(bills).toMatch(/createObligation\(\{ data: p\.data, provider: null \}\)/);
    expect(bills).not.toMatch(/provider:\s*\{\s*name/);
    expect(services).toMatch(/createArrangement\(\{ data: p\.data, provider: null,/);
    expect(services).toMatch(/providerNameOnly: o\.providerName/);
    expect(services).not.toMatch(/provider:\s*\{\s*name/);
  });

  it('no application file uses the old name-matching helper, and the data layers take identity only from the shared boundary', async () => {
    const files = await walk('src');
    const users: string[] = [];
    for (const f of files) if (/\bfindOrCreateContact\b/.test(await read(f))) users.push(f);
    expect(users).toEqual(['src/core/contacts.ts']);
    for (const f of ['src/modules/bills/data.ts', 'src/modules/services/data.ts', 'src/modules/projects/data.ts']) expect(await read(f), f).toMatch(/resolveContactChoice/);
  });

  it('the Bills form no longer pre-selects a Contact because a Finance payee name matches', async () => {
    const t = await read('src/modules/bills/ObligationForm.tsx');
    expect(t).not.toMatch(/useEffect/);
    expect(t).not.toMatch(/seed\.providerName\.trim\(\)\.toLowerCase\(\)/);
    expect(t).toMatch(/pickChanged\(pick, d\.providerContactId\)/);
  });
});
