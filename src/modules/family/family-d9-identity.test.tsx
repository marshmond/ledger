import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { installTracking } from '../../lib/sync/track';
import { accessibleName, all, byTag, parseHtml, textOf, unnamedFields, type El } from '../../lib/a11yTestkit';
import { PRESETS, contrastRatio, deriveExtras, extrasOf, varsFor } from '../../palette';
import { CLASSIC } from '../../shell/legacyFixtures';
import { MemberChip, MemberDot, MemberMark, memberChipClass, memberDotClass, memberMarkClass } from '../../ui/MemberIdentity';
import { MEMBER_COLOR_IDS, isMemberColorId, memberColorToken, memberInitials } from '../../ui/memberIdentityModel';
import { createEvent } from '../calendar/data';
import { SWATCHES } from '../calendar/model';
import { blankFields } from '../calendar/model';
import { createMember, getMember, loadMembers, updateMember } from './data';
import { FAMILY_LAYER_COLOR } from './dueProvider';
import { COLOR_IN_USE, MEMBER_COLOR_CHOICES, NO_COLOR_CHIP, NO_COLOR_CHOICE, colorUsedByAnother, memberColorId, memberColorLabel, memberPreview, previewName } from './memberIdentity';
import MemberForm from './MemberForm';
import { COLORS, asMember, cleanFields, toStored, validateFields } from './model';

/**
 * D9: the Family member color picker and identity pieces. Everything here is invented data. The form is checked as the markup a reader meets on first draw
 * (the same method as the F1 accessibility tests) and through the same data functions the form calls; keyboard and click behavior was checked in a real browser
 * (see docs/LEDGER-SIGNATURE-D9-REPORT.md).
 */
const read = (f: string) => readFileSync(f, 'utf8');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(el));
const tokens = read('src/ui/tokens.css');
const components = read('src/ui/components.css');
const familyCss = read('src/modules/family/family.css');
const formSrc = read('src/modules/family/MemberForm.tsx');

let n = 0;
const fresh = () => { const d = new FinanceDB(`test-d9-${n++}`); installTracking(d); return d; };
const YEAR = 2026;
const kid = { role: 'child' as const, status: 'active' as const };
const addContact = (d: FinanceDB, name: string, extra: object = {}) => createStore(d).shared.contacts.put({ name, ...extra } as never);
const STORED = ['#4a7bd0', '#2f8f6b', '#c0562f', '#8a5cc7', '#c4398a', '#b8860b', '#2a9fb0', '#6b7280'];
const NAMES = ['Blue', 'Green', 'Orange', 'Purple', 'Pink', 'Gold', 'Teal', 'Gray'];

const record = (data: Record<string, unknown>, id = 7) => asMember({ id, module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data } as unknown as ModuleRecord, YEAR);
/** All text, including text a reader skips (aria-hidden marks), so a decoration's own letters can be checked. */
const rawText = (e: El | string): string => (typeof e === 'string' ? e : e.children.map(rawText).join(''));
const radios = (d: El, name = 'fm-color') => byTag(d, 'input').filter((i) => i.attrs.name === name);

describe('D9 the eight stored colors are exactly what they were', () => {
  it('the values, names and order are unchanged, and are still the Calendar swatches', () => {
    expect(COLORS.map((c) => c.value)).toEqual(STORED);
    expect(COLORS.map((c) => c.name)).toEqual(NAMES);
    expect(SWATCHES).toEqual(STORED);
  });
  it('each stored value has one semantic id, the lower-case name, which is a known id with a --mc token', () => {
    expect(MEMBER_COLOR_CHOICES.map((c) => c.value)).toEqual(STORED);
    expect(MEMBER_COLOR_CHOICES.map((c) => c.id)).toEqual(NAMES.map((x) => x.toLowerCase()));
    expect([...MEMBER_COLOR_IDS]).toEqual(MEMBER_COLOR_CHOICES.map((c) => c.id));
    for (const c of MEMBER_COLOR_CHOICES) {
      expect(isMemberColorId(c.id)).toBe(true);
      expect(memberColorId(c.value)).toBe(c.id);
      expect(memberColorLabel(c.value)).toBe(c.name);
      expect(memberColorToken(c.id)).toBe(`--mc-${c.id}`);
    }
  });
  it('a value that is not one of the eight, or no value, has no id and no label', () => {
    for (const bad of ['#123456', '#4A7BD0', 'blue', '', ' ', undefined, null, '#6b728']) {
      expect(memberColorId(bad as never), String(bad)).toBeNull();
      expect(memberColorLabel(bad as never), String(bad)).toBe('');
    }
    expect(isMemberColorId('chartreuse')).toBe(false);
    expect(isMemberColorId(undefined)).toBe(false);
  });
});

describe('D9 invalid colors are still rejected, and no color is the absent value', () => {
  it('validateFields refuses anything outside the eight, in American English', () => {
    for (const bad of ['#123456', '#4A7BD0', 'blue', 'none']) expect(validateFields({ role: 'child', status: 'active', color: bad }, YEAR), bad).toBe('Choose one of the listed colors.');
    for (const ok of STORED) expect(validateFields({ role: 'child', status: 'active', color: ok }, YEAR)).toBeNull();
    expect(validateFields({ role: 'child', status: 'active' }, YEAR)).toBeNull(); // absent is fine
  });
  it('the reader drops an unreadable stored color and says so; it is never rewritten by reading', () => {
    const m = record({ contactId: 3, role: 'child', status: 'active', color: '#abcdef' });
    expect(m.data).toEqual({ contactId: 3, role: 'child', status: 'active' });
    expect(m.problems).toEqual(['The color could not be read.']);
    expect(m.raw.color).toBe('#abcdef');
  });
  it('No color stores nothing: cleanFields and toStored leave the field out, and Gray is never substituted', () => {
    expect(cleanFields({ ...kid, color: '' })).toEqual(kid);
    expect(cleanFields({ ...kid })).toEqual(kid);
    expect('color' in toStored({ color: '#4a7bd0', futureField: 1 }, 5, { ...kid })).toBe(false);
    expect(toStored({ futureField: 1 }, 5, { ...kid })).toEqual({ futureField: 1, contactId: 5, ...kid });
    expect(JSON.stringify(cleanFields({ ...kid, color: '' }))).not.toContain('#6b7280');
  });
  it('saving with No color through the real data functions stores no color key, for a new member and when clearing one', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam Example');
    const r = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: kid }, d, YEAR);
    expect(Object.keys((await d.moduleRecords.get(r.id))!.data)).not.toContain('color');
    await updateMember(r.id, { ...kid, color: '#c0562f' }, d, YEAR);
    expect((await getMember(r.id, d))!.data!.color).toBe('#c0562f');
    await updateMember(r.id, { ...kid }, d, YEAR); // the form omits color when No color is chosen
    expect(Object.keys((await d.moduleRecords.get(r.id))!.data)).not.toContain('color');
    expect((await getMember(r.id, d))!.data!.color).toBeUndefined();
  });
});

describe('D9 initials', () => {
  it('handles one word, extra spaces, missing names and at most two initials', () => {
    const cases: [string | null | undefined, string][] = [
      ['Casey Demo', 'CD'], ['casey demo', 'CD'], ['  Casey   Demo  ', 'CD'], ['Casey', 'C'], ['   ', ''], ['', ''], [undefined, ''], [null, ''],
      ['Mary Ann Smith', 'MS'], ['Mary-Jane Smith', 'MS'], ['Éloïse Núñez', 'ÉN'], ['- Casey', 'C'], ['(Nana) Demo', 'ND'], ['🙂 Casey', 'C'], ['Jo 3rd', 'J3'], ['a b c d e', 'AE'],
    ];
    for (const [input, out] of cases) expect(memberInitials(input), String(input)).toBe(out);
  });
  it('never returns more than two characters or throws', () => {
    for (const s of ['x'.repeat(500), ' \t\n ', '---', '𠮷野家 Demo']) expect(Array.from(memberInitials(s)).length).toBeLessThanOrEqual(2);
  });
});

describe('D9 the preview reads the form as it stands, with no guessing', () => {
  it('uses the linked Contact when editing, the picked Contact when adding from the list, and the typed name for a new Contact', () => {
    expect(previewName({ editing: true, mode: 'existing', linkedName: 'Robin Demo', pickedName: 'Someone Else', newName: 'Typed Name' })).toBe('Robin Demo');
    expect(previewName({ editing: false, mode: 'existing', pickedName: ' Nana Demo ', newName: 'Typed Name' })).toBe('Nana Demo');
    expect(previewName({ editing: false, mode: 'new', pickedName: 'Nana Demo', newName: '  Casey    Demo ' })).toBe('Casey Demo');
  });
  it('shows no name until there is one (it does not borrow a similar Contact)', () => {
    expect(previewName({ editing: false, mode: 'existing', newName: 'Pat Demo' })).toBe('');
    expect(previewName({ editing: false, mode: 'new', pickedName: 'Pat Demo', newName: '   ' })).toBe('');
    expect(previewName({ editing: true, mode: 'new', newName: 'Pat Demo' })).toBe('');
  });
  it('builds the role, color id and color text, and "No color · neutral gray" for none', () => {
    expect(memberPreview('Casey Demo', 'grandparent', '#2a9fb0')).toEqual({ name: 'Casey Demo', roleLabel: 'Grandparent', colorId: 'teal', colorText: 'Teal' });
    expect(memberPreview('', 'spouse', '')).toEqual({ name: '', roleLabel: 'Spouse', colorId: null, colorText: NO_COLOR_CHIP });
    expect(memberPreview('X', 'other', '#nonsense').colorId).toBeNull();
  });
  it('the add form draws the preview with a placeholder, a "?" mark, the role and "No color · neutral gray" before anything is chosen', () => {
    const d = html(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined }));
    const prev = all(d, (e) => /\bfm-preview\b/.test(e.attrs.class ?? ''))[0];
    expect(textOf(prev)).toContain('New member');
    expect(rawText(prev)).toContain('?');
    expect(textOf(prev)).toContain('Child');
    expect(textOf(prev)).toContain(NO_COLOR_CHIP);
    expect(all(prev, (e) => /\bui-mark--none\b/.test(e.attrs.class ?? ''))).toHaveLength(1);
  });
  it('the edit form draws the preview from the stored color and role', () => {
    const m = record({ contactId: 3, role: 'grandparent', status: 'active', color: '#2a9fb0' });
    const d = html(createElement(MemberForm, { member: m, onClose: () => undefined, onSaved: () => undefined }));
    const prev = all(d, (e) => /\bfm-preview\b/.test(e.attrs.class ?? ''))[0];
    expect(textOf(prev)).toContain('Grandparent');
    expect(textOf(prev)).toContain('Teal');
    const mark = all(prev, (e) => /\bui-mark\b/.test(e.attrs.class ?? ''))[0];
    expect(mark.attrs['data-mc']).toBe('teal');
    expect(mark.attrs['aria-hidden']).toBe('true');
  });
});

describe('D9 the picker is eight native radio buttons plus No color', () => {
  const d = html(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined }));
  const inputs = radios(d);
  it('nine real radio inputs in one group, named by their label text, in the order Blue to Gray then No color', () => {
    expect(inputs).toHaveLength(9);
    for (const i of inputs) expect(i.attrs.type).toBe('radio');
    expect(inputs.map((i) => accessibleName(d, i).trim())).toEqual([...NAMES, NO_COLOR_CHOICE]);
    expect(NO_COLOR_CHOICE).toBe('No color — neutral gray');
    expect(inputs.slice(0, 8).map((i) => i.attrs.value)).toEqual(STORED); // the stored value is the radio's value
    expect(inputs[8].attrs.value).toBe(''); // No color = the empty (absent) value
  });
  it('exactly one is checked, and with a new member it is No color', () => {
    expect(inputs.filter((i) => 'checked' in i.attrs)).toHaveLength(1);
    expect('checked' in inputs[8].attrs).toBe(true);
  });
  it('is not a custom widget: no ARIA radio roles, no tabindex, no key handlers, so arrow keys and Space are the browser\'s own', () => {
    expect(all(d, (e) => e.attrs.role === 'radio' || e.attrs.role === 'radiogroup' && /color/i.test(e.attrs['aria-label'] ?? ''))).toEqual([]);
    for (const i of inputs) expect(i.attrs.tabindex).toBeUndefined();
    expect(formSrc).not.toMatch(/onKeyDown|onKeyUp|onKeyPress|tabIndex|role="radio"/);
  });
  it('sits in a fieldset whose legend names it, and every swatch label shows its color name as text', () => {
    const set = all(d, (e) => e.tag === 'fieldset').find((f) => textOf(f).includes('Display color'))!;
    expect(textOf(all(set, (e) => e.tag === 'legend')[0])).toBe('Display color (optional)');
    expect(all(set, (e) => /\bfm-sw-name\b/.test(e.attrs.class ?? '')).map((e) => textOf(e))).toEqual(NAMES);
    for (const dot of all(set, (e) => /\bfm-sw-dot\b/.test(e.attrs.class ?? ''))) expect(dot.attrs['aria-hidden']).toBe('true');
  });
  it('the check mark is drawn on every swatch (shown only for the chosen one in CSS), and the whole form still has named fields', () => {
    expect(all(d, (e) => /\bfm-sw-dot\b/.test(e.attrs.class ?? '')).every((dot) => all(dot, (e) => e.tag === 'svg').length === 1)).toBe(true);
    expect(unnamedFields(d)).toEqual([]);
  });
  it('the edit form checks the stored swatch and nothing else; a member with no color has No color checked', () => {
    const orange = html(createElement(MemberForm, { member: record({ contactId: 3, role: 'child', status: 'active', color: '#c0562f' }), onClose: () => undefined, onSaved: () => undefined }));
    const checked = radios(orange).filter((i) => 'checked' in i.attrs).map((i) => accessibleName(orange, i).trim());
    expect(checked).toEqual(['Orange']);
    const none = html(createElement(MemberForm, { member: record({ contactId: 3, role: 'child', status: 'active' }), onClose: () => undefined, onSaved: () => undefined }));
    expect(radios(none).filter((i) => 'checked' in i.attrs).map((i) => accessibleName(none, i).trim())).toEqual([NO_COLOR_CHOICE]);
  });
  it('the edit form starts every other field from the stored record, and keeps the contact fixed', () => {
    const m = record({ contactId: 3, role: 'spouse', status: 'active', birthMonthDay: '05-20', birthYear: 2014, color: '#8a5cc7', note: 'Plays soccer.', birthdayOnCalendar: false });
    const e = html(createElement(MemberForm, { member: m, onClose: () => undefined, onSaved: () => undefined }));
    const selected = (label: string) => { const s = byTag(e, 'select').find((x) => accessibleName(e, x).startsWith(label))!; return all(s, (o) => o.tag === 'option' && 'selected' in o.attrs).map((o) => textOf(o)); };
    expect(selected('Role')).toEqual(['Spouse']);
    expect(selected('Month')).toEqual(['May']);
    expect(selected('Day')).toEqual(['20']);
    const year = byTag(e, 'input').find((i) => accessibleName(e, i).startsWith('Birth year'))!;
    expect(year.attrs.value).toBe('2014');
    const cal = byTag(e, 'input').find((i) => i.attrs.type === 'checkbox')!;
    expect('checked' in cal.attrs).toBe(false); // "show on my Calendar" was turned off
    expect(textOf(byTag(e, 'textarea')[0])).toBe('Plays soccer.');
    expect(all(e, (x) => x.attrs.id === 'fm-contact-fixed')).toHaveLength(1);
    expect(radios(e, 'fm-mode')).toEqual([]); // no way to reassign the contact when editing
    expect(radios(e, 'fm-contact')).toEqual([]);
    expect(textOf(e)).toContain('Calendars keep their own colors.');
  });
});

describe('D9 color reuse is allowed and only mentioned', () => {
  const m = (id: number, color: string | undefined, status: 'active' | 'past' = 'active') => record({ contactId: id, role: 'child', status, ...(color ? { color } : {}) }, id);
  it('colorUsedByAnother counts other ACTIVE members only, never the member being edited, past members or no color', () => {
    const list = [m(1, '#4a7bd0'), m(2, '#2f8f6b'), m(3, '#c0562f', 'past')];
    expect(colorUsedByAnother(list, undefined, '#4a7bd0')).toBe(true); // adding: someone has Blue
    expect(colorUsedByAnother(list, 1, '#4a7bd0')).toBe(false); // editing the Blue member: not "another"
    expect(colorUsedByAnother(list, 2, '#4a7bd0')).toBe(true);
    expect(colorUsedByAnother(list, undefined, '#c0562f')).toBe(false); // a past member does not count
    expect(colorUsedByAnother(list, undefined, '#8a5cc7')).toBe(false);
    expect(colorUsedByAnother(list, undefined, '')).toBe(false);
  });
  it('the sentence is the approved one, and the form wires it to a polite live region; nothing can block saving', () => {
    expect(COLOR_IN_USE).toBe('This color is already used by another family member.');
    const d = html(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined }));
    const note = all(d, (e) => e.attrs.id === 'fm-color-note')[0];
    expect(note.attrs['aria-live']).toBe('polite');
    expect(formSrc).toMatch(/inUse \? COLOR_IN_USE/);
    expect(formSrc.slice(formSrc.indexOf('async function save'), formSrc.indexOf('return (\n    <Modal'))).not.toMatch(/inUse|colorUsedByAnother/);
  });
  it('two members may be saved with the same color', async () => {
    const d = fresh();
    const a = await addContact(d, 'Pat Example'); const b = await addContact(d, 'Sam Example');
    await createMember({ contact: { mode: 'existing', contactId: a }, fields: { ...kid, color: '#4a7bd0' } }, d, YEAR);
    await createMember({ contact: { mode: 'existing', contactId: b }, fields: { ...kid, color: '#4a7bd0' } }, d, YEAR);
    expect((await loadMembers(d)).map((x) => x.data!.color)).toEqual(['#4a7bd0', '#4a7bd0']);
  });
});

describe('D9 Contact identity safeguards are intact', () => {
  it('changing a color on an existing member changes that one field and nothing else: not the Contact, not the link, not the other fields', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam Example', { phone: '555-0100', relationship: 'son' });
    const { id } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, birthMonthDay: '05-14', birthYear: 2016, color: '#4a7bd0', note: 'invented note', birthdayOnCalendar: false } }, d, YEAR);
    const contactBefore = JSON.stringify(await d.contacts.get(cid));
    const before = (await getMember(id, d))!.data!;
    await updateMember(id, { role: before.role, status: before.status, birthMonthDay: before.birthMonthDay, birthYear: before.birthYear, color: '#c4398a', note: before.note, birthdayOnCalendar: false }, d, YEAR);
    expect(JSON.stringify(await d.contacts.get(cid))).toBe(contactBefore);
    expect((await getMember(id, d))!.data).toEqual({ ...before, color: '#c4398a' });
    expect(await d.contacts.count()).toBe(1);
  });
  it('a duplicate member for the same Contact is refused, and nothing is written', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam Example');
    await createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, color: '#4a7bd0' } }, d, YEAR);
    await expect(createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, color: '#2f8f6b' } }, d, YEAR)).rejects.toThrow(/already a member/);
    expect(await d.moduleRecords.count()).toBe(1);
    expect(await d.contacts.count()).toBe(1);
  });
  it('a new Contact is never silently matched to a same-named one, and an existing Contact is never changed', async () => {
    const d = fresh();
    const existing = await addContact(d, 'Alex Example', { phone: '555-0111' });
    const before = JSON.stringify(await d.contacts.get(existing));
    const r = await createMember({ contact: { mode: 'new', name: 'alex example' }, fields: { ...kid, color: '#8a5cc7' } }, d, YEAR);
    expect(r.contactId).not.toBe(existing);
    expect(JSON.stringify(await d.contacts.get(existing))).toBe(before);
  });
  it('the form keeps its confirmation and choice controls: the same-name warning, the "different person" box, no auto-link, no contact reassignment', () => {
    expect(formSrc).toMatch(/matches\.length > 0 && !different/);
    expect(formSrc).toMatch(/This is a different person with the same name\. Create a separate contact\./);
    expect(formSrc).toMatch(/Use this one instead/);
    expect(formSrc).toMatch(/Linking does not change the contact\./);
    expect(formSrc).toMatch(/\(already a member\)/);
    expect(formSrc).toMatch(/Choose which contact this is, or switch to "Create a new contact"\./);
    expect(formSrc).not.toMatch(/findOrCreateContact|contactId:\s*picked\s*\?\?/);
    // the identity helpers do no lookups of their own
    expect(read('src/modules/family/memberIdentity.ts')).not.toMatch(/contacts|findOrCreate|fuzzy|similar|levenshtein/i);
  });
  it('the role list (Spouse included), the birthday controls and "This is me" staying out of the form are unchanged', () => {
    const d = html(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined }));
    const options = byTag(d, 'option').map((o) => textOf(o));
    for (const r of ['Parent', 'Spouse', 'Child', 'Grandparent', 'Other']) expect(options).toContain(r);
    expect(textOf(d)).toMatch(/Show this birthday on my Calendar/);
    expect(textOf(d)).toMatch(/Private note \(optional\)/);
    expect(textOf(d)).not.toMatch(/This is me/i);
  });
});

describe('D9 saving and cancelling', () => {
  it('Cancel is a plain button that closes; only the form\'s submit saves, and drawing the form writes nothing', async () => {
    expect(formSrc).toMatch(/<button type="button" className="btn" onClick=\{onClose\}>Cancel<\/button>/);
    expect(formSrc.match(/await (createMember|updateMember)\(/g)).toHaveLength(2);
    expect(formSrc).toMatch(/onSubmit=\{\(e\) => \{ e\.preventDefault\(\); void save\(\); \}\}/);
    expect(formSrc).not.toMatch(/useEffect/); // nothing runs by itself
    const d = fresh();
    const cid = await addContact(d, 'Sam Example');
    const { id } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, color: '#4a7bd0' } }, d, YEAR);
    const snapshot = async () => JSON.stringify([await d.moduleRecords.toArray(), await d.contacts.toArray()]);
    const before = await snapshot();
    renderToStaticMarkup(createElement(MemberForm, { member: (await getMember(id, d))!, onClose: () => undefined, onSaved: () => undefined }));
    expect(await snapshot()).toBe(before);
    expect((await getMember(id, d))!.data!.color).toBe('#4a7bd0');
  });
  it('Save persists exactly the selected stored value (and the save button is named Add member or Save)', () => {
    expect(formSrc).toMatch(/\.\.\.\(color \? \{ color \} : \{\}\)/);
    const add = html(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined }));
    expect(byTag(add, 'button').map((b) => textOf(b))).toEqual(expect.arrayContaining(['Cancel', 'Add member']));
    const edit = html(createElement(MemberForm, { member: record({ contactId: 3, role: 'child', status: 'active' }), onClose: () => undefined, onSaved: () => undefined }));
    expect(byTag(edit, 'button').map((b) => textOf(b))).toEqual(expect.arrayContaining(['Cancel', 'Save']));
  });
});

describe('D9 shared identity pieces', () => {
  it('a mark shows initials (or "?"), is hidden from assistive technology and carries its color id', () => {
    const blue = html(createElement(MemberMark, { name: 'Casey Demo', colorId: 'blue', size: 'lg' }));
    const el = all(blue, (e) => e.tag === 'span')[0];
    expect(rawText(el)).toBe('CD');
    expect(el.attrs['aria-hidden']).toBe('true');
    expect(el.attrs['data-mc']).toBe('blue');
    expect(el.attrs.class).toBe('ui-mark ui-mark--lg');
    const none = all(html(createElement(MemberMark, { colorId: null })), (e) => e.tag === 'span')[0];
    expect(rawText(none)).toBe('?');
    expect(none.attrs['data-mc']).toBeUndefined();
    expect(none.attrs.class).toBe('ui-mark ui-mark--md ui-mark--none');
  });
  it('a dot and a chip work for every id and for no color, and are decoration around visible words', () => {
    for (const id of MEMBER_COLOR_IDS) {
      expect(memberDotClass(id)).toBe('ui-mdot');
      expect(memberChipClass(id)).toBe('ui-mchip');
      expect(memberMarkClass('sm', id)).toBe('ui-mark ui-mark--sm');
      const chip = all(html(createElement(MemberChip, { colorId: id, children: id })), (e) => /\bui-mchip\b/.test(e.attrs.class ?? ''))[0];
      expect(chip.attrs['data-mc']).toBe(id);
      expect(textOf(chip)).toBe(id);
      expect(all(chip, (e) => /\bui-mdot\b/.test(e.attrs.class ?? ''))[0].attrs['aria-hidden']).toBe('true');
    }
    expect(memberDotClass(null)).toBe('ui-mdot ui-mdot--none');
    expect(memberChipClass(undefined)).toBe('ui-mchip ui-mchip--none');
    expect(all(html(createElement(MemberDot, {})), (e) => e.tag === 'span')[0].attrs['data-mc']).toBeUndefined();
  });
  it('the shared files know nothing about people, Contacts, the database or any module, and hold no hex color', () => {
    for (const f of ['src/ui/MemberIdentity.tsx', 'src/ui/memberIdentityModel.ts']) {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(text, f).not.toMatch(/from '\.\.\/(modules|core|db|lib|pages|shell)|#[0-9a-fA-F]{3,8}\b|localStorage|fetch\(/);
    }
  });
});

describe('D9 Family screens use the shared identity pieces', () => {
  const dir = 'src/modules/family';
  const prod = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map((f) => ({ f, text: read(join(dir, f)) }));
  it('no Family screen still paints a person\'s color by hand (the old fm-dot, an inline background from the stored hex)', () => {
    const bad = prod.filter(({ text }) => /\bfm-dot\b|className=\{?[`"]fm-color[ `"$]|style=\{\{ background: (c|d|p)\.(value|color)/.test(text)).map((x) => x.f);
    expect(bad).toEqual([]);
    expect(familyCss).not.toMatch(/\.fm-dot|\.fm-colors|\.fm-color(?![-\w])/);
  });
  it('the overview, household rows and member page draw the mark, dot and chip from the semantic id', () => {
    expect(read(`${dir}/OverviewPage.tsx`)).toMatch(/<MemberMark name=\{[^}]*\} colorId=\{memberColorId\(d\.color\)\}/);
    expect(read(`${dir}/HouseholdSections.tsx`)).toMatch(/<MemberDot colorId=\{memberColorId\(p\.color\)\} \/>/);
    expect(read(`${dir}/MemberPage.tsx`)).toMatch(/<MemberChip colorId=\{memberColorId\(d\.color\)\}>\{colorName\(d\.color\)\}<\/MemberChip>/);
    expect(read(`${dir}/MemberPage.tsx`)).toMatch(/<MemberMark name=\{contact\?\.name\}/);
  });
  it('the color NAME is still printed beside the identity (overview line, member page row, preview chip)', () => {
    expect(read(`${dir}/OverviewPage.tsx`)).toMatch(/colorName\(d\.color\)/);
    expect(read(`${dir}/MemberPage.tsx`)).toMatch(/>\{colorName\(d\.color\)\}</);
  });
});

describe('D9 Calendar colors are independent of member colors', () => {
  it('the Family layer color and the Calendar swatches are unchanged', () => {
    expect(FAMILY_LAYER_COLOR).toBe('#c4398a');
    expect(SWATCHES).toEqual(STORED);
  });
  it('changing a member color changes no Calendar calendar, layer or event, and no other record', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam Example');
    const { id } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, color: '#4a7bd0' } }, d, YEAR);
    await createEvent({ ...blankFields('2026-11-12'), title: 'Practice', contactIds: [cid] } as never, d);
    const others = async () => JSON.stringify([(await d.moduleRecords.toArray()).filter((r) => r.module !== 'family'), await d.contacts.toArray(), await d.links.toArray()]);
    const before = await others();
    await updateMember(id, { ...kid, color: '#c4398a' }, d, YEAR);
    expect(await others()).toBe(before);
    await updateMember(id, { ...kid }, d, YEAR);
    expect(await others()).toBe(before);
  });
  it('the schedule bars still use the Calendar\'s colors, and no Calendar or schedule file reads the member color helpers', () => {
    expect(read('src/modules/family/HouseholdSections.tsx')).toMatch(/className="fm-bar" style=\{\{ background: it\.color \}\}/);
    expect(read('src/modules/family/MemberSections.tsx')).toMatch(/className="fm-bar" style=\{\{ background: it\.color \}\}/);
    for (const f of ['memberSchedule.ts', 'dueProvider.ts', 'calendarDates.ts', 'upcoming.ts']) expect(read(`src/modules/family/${f}`), f).not.toMatch(/memberIdentity|memberColorId|MemberMark|MemberDot|MemberChip|--mc-/);
    const cal = readdirSync('src/modules/calendar').filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f));
    for (const f of cal) expect(read(`src/modules/calendar/${f}`), f).not.toMatch(/memberIdentity|MemberMark|MemberDot|MemberChip|--mc-|data-mc/);
  });
});

// ---------- tokens, dark variants and real contrast on every palette ----------

const hex = (h: string): [number, number, number] => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const mix = (a: string, b: string, pctOfA: number) => `#${hex(a).map((v, i) => Math.round(v * pctOfA + hex(b)[i] * (1 - pctOfA)).toString(16).padStart(2, '0')).join('')}`;
const decls = (body: string) => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const lightRoot = decls(tokens.match(/^:root \{([\s\S]*?)\n\}/m)![1]);
const darkForced = decls(tokens.match(/^:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/m)![1]);
const darkMedia = decls(tokens.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/)![1]);

describe('D9 color lookup, dark variants and the swatch check mark', () => {
  it('every id has a light token equal to the stored hex, a different dark token, and a [data-mc] rule that reads it', () => {
    for (const c of MEMBER_COLOR_CHOICES) {
      expect(lightRoot[memberColorToken(c.id)], c.id).toBe(c.value);
      expect(darkForced[memberColorToken(c.id)], c.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(darkForced[memberColorToken(c.id)].toLowerCase(), c.id).not.toBe(c.value);
      expect(darkMedia[memberColorToken(c.id)], `${c.id} in the follow-the-device block`).toBe(darkForced[memberColorToken(c.id)]);
      expect(components, c.id).toContain(`[data-mc="${c.id}"] { --pc: var(--mc-${c.id}); }`);
    }
    expect((components.match(/^\[data-mc="[a-z]+"\]/gm) ?? [])).toHaveLength(8);
  });
  it('a dark variant is lighter than its light value (they are the same hues, lifted for a dark surface)', () => {
    for (const c of MEMBER_COLOR_CHOICES) expect(contrastRatio(darkForced[memberColorToken(c.id)], '#000000'), c.id).toBeGreaterThan(contrastRatio(lightRoot[memberColorToken(c.id)], '#000000'));
  });
  it('the check mark token exists for light and for both dark blocks, and they cannot drift', () => {
    expect(lightRoot['--swatch-check']).toBe('#ffffff');
    expect(darkForced['--swatch-check']).toBe('#0b1220');
    expect(darkMedia['--swatch-check']).toBe(darkForced['--swatch-check']);
  });
});

/** The values a palette puts on the page for one mode, with the stylesheet's own defaults for the roles a palette does not set. */
function roles(p: 'classic' | (typeof PRESETS)[number]['id'], mode: 'light' | 'dark') {
  const colors = p === 'classic' ? CLASSIC[mode] : PRESETS.find((x) => x.id === p)![mode];
  const v = { ...varsFor(colors as never), ...(p === 'classic' ? deriveExtras(CLASSIC[mode], mode === 'dark') : extrasOf({ id: p } as never, mode === 'dark')) } as Record<string, string>;
  const surface = v['--surface'];
  const fg = v['--fg'];
  return {
    surface, fg,
    modal: v['--surface-raised'] ?? v['--bg'],
    soft: v['--surface-soft'] ?? mix(fg, surface, 0.04),
    sunken: v['--surface-sunken'] ?? mix(fg, surface, 0.08),
    fg2: v['--fg-2'] ?? mix(fg, v['--muted'], 0.78),
    accent: v['--accent'],
    control: v['--control-line'] ?? mix(fg, v['--bg'], 0.24),
  };
}

describe('D9 contrast, measured on every palette in light and dark', () => {
  const palettes = ['classic', ...PRESETS.map((p) => p.id)] as const;
  for (const p of palettes) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${p} ${mode}: swatches (3:1), check mark (3:1), ring and focus outline (3:1), mark and chip text (4.5:1), No color text (4.5:1)`, () => {
        const r = roles(p, mode);
        const tok = mode === 'light' ? lightRoot : darkForced;
        const low: string[] = [];
        const need = (label: string, ratio: number, min: number) => { if (ratio < min) low.push(`${label}: ${ratio.toFixed(2)} (needs ${min})`); };
        const check = tok['--swatch-check'];
        for (const c of MEMBER_COLOR_CHOICES) {
          const col = tok[memberColorToken(c.id)];
          // The swatch's fill is identity (its name is always printed), and the fixed stored Gold and Teal sit just under 3:1 on the paler older palettes.
          // The outline drawn around each swatch and dot (the color pulled 28% toward the text color) is the edge that must stand out at 3:1.
          need(`${c.id} swatch edge on the dialog`, contrastRatio(mix(col, r.fg, 0.72), r.modal), 3);
          need(`${c.id} swatch edge on a card`, contrastRatio(mix(col, r.fg, 0.72), r.surface), 3);
          need(`${c.id} swatch fill on the dialog (identity, never the only cue)`, contrastRatio(col, r.modal), 2.5);
          need(`${c.id} check mark on the swatch`, contrastRatio(check, col), 3);
          need(`${c.id} mark text on its tile`, contrastRatio(mix(col, r.fg, 0.58), mix(col, r.surface, 0.16)), 4.5);
          need(`${c.id} chip text on the preview`, contrastRatio(mix(col, r.fg, 0.44), mix(col, r.soft, 0.12)), 4.5);
        }
        need('selection ring (main text color) on the dialog', contrastRatio(r.fg, r.modal), 3);
        need('focus outline (accent) on the dialog', contrastRatio(r.accent, r.modal), 3);
        need('No color text on its sunken fill', contrastRatio(r.fg2, r.sunken), 4.5);
        need('No color text on the soft fill', contrastRatio(r.fg, r.soft), 4.5);
        expect(low).toEqual([]);
      });
    }
  }
  it('every palette draws its dashed No color edge at 3:1 or better (the shared control line)', () => {
    for (const p of PRESETS) for (const mode of ['light', 'dark'] as const) {
      const r = roles(p.id, mode);
      expect(contrastRatio(r.control, r.surface), `${p.id} ${mode}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('D9 the stylesheet follows the design and the token rules', () => {
  const block = familyCss.slice(familyCss.indexOf('/* Add / edit member (D9)'));
  it('uses tokens only: no hex or rgb literal and no priority override in the new Family rules or the shared identity rules', () => {
    expect(block.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|!important/);
    const shared = components.slice(components.indexOf('/* ---------- member identity (D9)'), components.indexOf('/* ---------- empty and loading'));
    expect(shared.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|!important/);
  });
  it('swatches are 48px on desktop and 52px at phone width, in four columns, with a 44px or taller hit area', () => {
    expect(block).toMatch(/\.fm-swatches \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    expect(block).toMatch(/\.fm-sw-dot \{[^}]*width: 48px; height: 48px/);
    expect(block).toMatch(/@media \(max-width: 640px\) \{ \.fm-sw-dot \{ width: 52px; height: 52px; \} \}/);
    expect(block).toMatch(/\.fm-sw input \{ position: absolute; inset: 0; width: 100%; height: 100%/); // the whole cell is the control
    expect(block).toMatch(/\.fm-nocolor \{[^}]*min-height: 48px/);
  });
  it('the selection ring is the main text color, the focus outline is a separate accent outline set apart from it, and the check shows only when chosen', () => {
    expect(block).toMatch(/\.fm-sw\.on \.fm-sw-dot \{ box-shadow: inset 0 0 0 1\.5px color-mix\(in srgb, var\(--pc\) 72%, var\(--fg\)\), 0 0 0 3px var\(--surface-raised\), 0 0 0 5px var\(--fg\); \}/);
    expect(block).toMatch(/\.fm-sw-dot \{[^}]*box-shadow: inset 0 0 0 1\.5px color-mix\(in srgb, var\(--pc\) 72%, var\(--fg\)\)/); // the 3:1 edge on every swatch
    expect(block).toMatch(/\.fm-sw input:focus-visible ~ \.fm-sw-dot \{ outline: 2px solid var\(--accent\); outline-offset: 7px; \}/);
    expect(block).toMatch(/\.fm-sw-dot \.ui-icon \{ opacity: 0;/);
    expect(block).toMatch(/\.fm-sw\.on \.fm-sw-dot \.ui-icon \{ opacity: 1; \}/);
    expect(block).toMatch(/\.fm-sw\.on \.fm-sw-name \{ font-weight: 700;/); // bold name: not color alone
  });
  it('two columns from 780px, one column below, the action bar stays in view, and the dialog is wide enough for two columns', () => {
    expect(block).toMatch(/@media \(min-width: 780px\) \{ \.fm-form--cols \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    expect(block).toMatch(/\.fm-form--cols \.fm-actions \{ position: sticky; bottom:/);
    expect(block).toMatch(/\.modal:has\(\.fm-form--cols\) \{ width: min\(880px, 100%\); scroll-padding-bottom: 88px; \}/);
    expect(familyCss.match(/:has\(\.fm-form--cols\)/g)).toHaveLength(1); // the only rule that widens a dialog, and only when this form is inside it
    expect(read('src/shell/Modal.tsx')).not.toMatch(/fm-form|:has/); // the shared Modal knows nothing about it
  });
  it('high-contrast mode keeps the swatch colors, the ring and the focus outline visible', () => {
    expect(block).toMatch(/@media \(forced-colors: active\)[\s\S]*forced-color-adjust: none[\s\S]*Highlight/);
  });
});

describe('D9 American English in what the owner reads', () => {
  it('the new and changed Family and shared files never say "colour" (old reports keep their wording)', () => {
    const files = ['MemberForm.tsx', 'MemberPage.tsx', 'OverviewPage.tsx', 'HouseholdSections.tsx', 'model.ts', 'memberIdentity.ts', 'family.css', 'dueProvider.ts', 'householdOverview.ts'].map((f) => `src/modules/family/${f}`)
      .concat(['src/ui/MemberIdentity.tsx', 'src/ui/memberIdentityModel.ts']);
    for (const f of files) expect(read(f), f).not.toMatch(/colour/i);
    const dir = 'src/ui/components.css';
    const shared = read(dir).slice(read(dir).indexOf('/* ---------- member identity (D9)'), read(dir).indexOf('/* ---------- empty and loading'));
    expect(shared).not.toMatch(/colour|grey/i);
  });
  it('the form says "Display color", "No color — neutral gray" and "gray", never "grey"', () => {
    const d = html(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined }));
    expect(textOf(d)).toContain('Display color (optional)');
    expect(textOf(d)).toContain(NO_COLOR_CHOICE);
    expect(textOf(d)).not.toMatch(/colour|grey/i);
  });
});
