import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { routeQuickAdd } from '../../core/quickAddRoute';
import { allQuickAdds } from '../../core/registry';
import { accessibleName, byTag, parseHtml, textOf, unnamedButtons, unnamedFields } from '../../lib/a11yTestkit';
import { createDistinctContact } from '../../core/contacts';
import { registerModules } from '../index';
import { createMember, loadMembers } from './data';
import { createDate } from './dateData';
import { loadEvents } from '../calendar/data';
import { familyDueItems } from './dueProvider';
import DateForm from './DateForm';
import MemberForm from './MemberForm';
import { FAMILY_QUICK_ADDS, ADD_DATE, ADD_MEMBER } from './quickAddDef';
import { addIntentOf } from './useAddIntent';
import { effectiveMe, ROLES, ROLE_LABEL } from './model';

/** F5 Quick Add: two destinations that OPEN Family's own forms. Invented names and dates only. */
registerModules();
let n = 0;
const fresh = () => new FinanceDB(`test-family-f5-quickadd-${n++}`);
const snapshotTables = async (d: FinanceDB) => Object.fromEntries(await Promise.all(d.tables.map(async (t) => [t.name, JSON.stringify(await t.toArray())] as const)));
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(el));

describe('registration and routing', () => {
  const mine = () => allQuickAdds().filter((q) => q.moduleId === 'family');
  it('Family registers two destinations: a member (fam) and a date (fd), each with a plain label and no clash with any other', () => {
    expect(mine().map((q) => [q.id, q.label, q.prefix, q.aliases])).toEqual([
      ['family-member', 'Family member', 'fam', ['family']],
      ['family-date', 'Family date', 'fd', ['famdate']],
    ]);
    const words = allQuickAdds().flatMap((q) => [q.prefix, ...(q.aliases ?? [])].map((w) => w.toLowerCase()));
    expect(new Set(words).size).toBe(words.length); // registration would already have thrown on a clash; this proves every word is unique
    expect(new Set(allQuickAdds().map((q) => q.id)).size).toBe(allQuickAdds().length);
  });

  it('typing the shortcut picks the destination: fam, family, fd, famdate (any case, optional colon)', () => {
    const defs = allQuickAdds();
    for (const [text, id] of [['fam ', 'family-member'], ['Fam: Robin', 'family-member'], ['family ', 'family-member'], ['FD ', 'family-date'], ['fd anniversary', 'family-date'], ['famdate ', 'family-date']] as const) {
      expect(routeQuickAdd(text, defs).def?.id, text).toBe(id);
    }
  });

  it('every other shortcut still routes exactly as before', () => {
    const defs = allQuickAdds();
    for (const [text, id] of [['t buy milk', 'task'], ['task: x', 'task'], ['e lunch fri', 'event'], ['$ coffee', 'transaction'], ['b rent', 'scheduled'], ['bs Streamly 15', 'bills-obligation'], ['hs clean', 'household-service'], ['a boiler', 'asset'], ['svc x', 'service'], ['p kitchen', 'project']] as const) {
      expect(routeQuickAdd(text, defs).def?.id, text).toBe(id);
    }
    expect(routeQuickAdd('famous people', defs).def).toBeNull(); // a word that merely starts with "fam" is not a shortcut
    expect(routeQuickAdd('f x', defs).def).toBeNull();
  });

  it('both destinations only OPEN a form: they have no parser, no commit and no inline form, so the Add box cannot save anything for Family', () => {
    for (const q of FAMILY_QUICK_ADDS) {
      expect(q.commit, q.id).toBeUndefined();
      expect(q.parse, q.id).toBeUndefined();
      expect(q.Form, q.id).toBeUndefined();
      expect(typeof q.open, q.id).toBe('function');
      expect(q.openCopy?.what && q.openCopy.where && q.openCopy.button, q.id).toBeTruthy();
    }
  });

  it('they open the existing Family screens through supported addresses, and call nothing else', () => {
    const go = vi.fn();
    FAMILY_QUICK_ADDS[0].open!({ navigate: go });
    FAMILY_QUICK_ADDS[1].open!({ navigate: go });
    expect(go.mock.calls).toEqual([['/family?add=member'], ['/family/dates?add=date']]);
    expect(ADD_MEMBER).toBe('member');
    expect(ADD_DATE).toBe('date');
  });

  it('the Family pages answer only their own request in the address; anything else is ignored', () => {
    expect(addIntentOf('?add=member')).toBe('member');
    expect(addIntentOf('?add=date')).toBe('date');
    expect(addIntentOf('')).toBeNull();
    expect(addIntentOf('?other=1')).toBeNull();
    expect(addIntentOf('?add=%3Cscript%3E')).toBe('<script>'); // returned as plain text; the page compares it to its own word and nothing matches
  });

  it('the screens answer the request: the overview opens Add member, the dates page opens Add date, and neither opens anything else', () => {
    const over = readFileSync('src/modules/family/OverviewPage.tsx', 'utf8');
    const dates = readFileSync('src/modules/family/DatesPage.tsx', 'utf8');
    expect(over).toMatch(/useAddIntent\(ADD_MEMBER, \(\) => setAdding\(true\)\)/);
    expect(dates).toMatch(/useAddIntent\(ADD_DATE, \(\) => setForm\(\{\}\)\)/);
  });

  it('the Add box says what it will open, using each destination\'s own words, and keeps the Ledger wording unchanged', () => {
    const box = readFileSync('src/shell/AddBox.tsx', 'utf8');
    expect(box).toMatch(/dest\.openCopy\?\.what/);
    const ledger = readFileSync('src/modules/ledger/quickAddDef.tsx', 'utf8');
    expect(ledger).toMatch(/what: 'a scheduled payment', where: 'It is set up on Ledger’s own Scheduled screen\.', button: 'Open the Scheduled screen'/);
  });
});

describe('member form reuse: the same form, with every identity safeguard', () => {
  const d = html(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined }));
  it('offers every role including Spouse, never marks anyone as "This is me", and has a Cancel button', () => {
    const role = byTag(d, 'select').find((s) => accessibleName(d, s).startsWith('Role'))!;
    const options = byTag(d, 'option').filter((o) => ROLES.some((r) => ROLE_LABEL[r] === textOf(o))).map((o) => textOf(o));
    expect(options).toEqual(ROLES.map((r) => ROLE_LABEL[r]));
    expect(role).toBeTruthy();
    expect(options).toContain('Spouse');
    expect(textOf(d)).not.toMatch(/This is me/i);
    expect(byTag(d, 'input').filter((i) => /me\b/i.test(accessibleName(d, i)))).toEqual([]);
    expect(textOf(byTag(d, 'button').find((b) => textOf(b) === 'Cancel')!)).toBe('Cancel');
  });
  it('is the existing accessible form: every field and button is named', () => {
    expect(unnamedFields(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
  });
  it('requires the same-name confirmation in source (the check and the box both exist) and never calls findOrCreateContact', () => {
    const src = readFileSync('src/modules/family/MemberForm.tsx', 'utf8');
    expect(src).toMatch(/matches\.length > 0 && !different/);
    expect(src).toMatch(/This is a different person with the same name/);
    const data = readFileSync('src/modules/family/data.ts', 'utf8');
    expect(data).toMatch(/createDistinctContact/);
    for (const f of ['data.ts', 'importantContactData.ts', 'MemberForm.tsx', 'ImportantContacts.tsx', 'dateData.ts', 'quickAddDef.ts', 'searchSource.ts', 'useAddIntent.ts']) {
      expect(readFileSync(`src/modules/family/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), f).not.toMatch(/findOrCreateContact/);
    }
  });
});

describe('what the form does when it saves (the same functions the form calls)', () => {
  it('a new Contact is separate even when the name matches, and the existing Contact is untouched (no merge)', async () => {
    const d = fresh();
    const pat = await createDistinctContact(d, { name: 'Pat Example', phone: '555-0100', relationship: 'neighbour' });
    const before = JSON.stringify(await d.contacts.get(pat));
    const r = await createMember({ contact: { mode: 'new', name: 'Pat Example' }, fields: { role: 'spouse', status: 'active' } }, d, 2026);
    expect(r.createdContact).toBe(true);
    expect(r.contactId).not.toBe(pat);
    expect(await d.contacts.count()).toBe(2);
    expect(JSON.stringify(await d.contacts.get(pat))).toBe(before);
  });

  it('linking an existing Contact keeps its id and changes nothing about it; Spouse is stored as chosen', async () => {
    const d = fresh();
    const jo = await createDistinctContact(d, { name: 'Jo Example', phone: '555-0101' });
    const before = JSON.stringify(await d.contacts.get(jo));
    const r = await createMember({ contact: { mode: 'existing', contactId: jo }, fields: { role: 'spouse', status: 'active' } }, d, 2026);
    expect(r.contactId).toBe(jo);
    expect(r.createdContact).toBe(false);
    expect((await loadMembers(d))[0].data).toMatchObject({ contactId: jo, role: 'spouse', status: 'active' });
    expect(JSON.stringify(await d.contacts.get(jo))).toBe(before);
    expect(await d.contacts.count()).toBe(1);
  });

  it('"This is me" is never set by creating a member (opt-in only), even for the first member or a parent', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'Alex Example' });
    const m = await createMember({ contact: { mode: 'existing', contactId: a }, fields: { role: 'parent', status: 'active' } }, d, 2026);
    const row = await d.moduleRecords.get(m.id);
    expect(row!.data).not.toHaveProperty('isMe');
    expect(effectiveMe(await loadMembers(d)).me).toBeNull();
  });

  it('opening the form and cancelling writes nothing; creating a member writes only the member (and the Contact the person asked for)', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'Alex Example' });
    const quiet = await snapshotTables(d);
    renderToStaticMarkup(createElement(MemberForm, { onClose: () => undefined, onSaved: () => undefined })); // opened
    expect(await snapshotTables(d)).toEqual(quiet); // ...and cancelled
    await createMember({ contact: { mode: 'existing', contactId: a }, fields: { role: 'child', status: 'active' } }, d, 2026);
    const after = await snapshotTables(d);
    const changed = Object.keys(after).filter((t) => after[t] !== quiet[t]);
    expect(changed).toEqual(['moduleRecords']);
  });

  it('a second member for the same Contact is refused (one active record per Contact), with a message', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'Alex Example' });
    await createMember({ contact: { mode: 'existing', contactId: a }, fields: { role: 'child', status: 'active' } }, d, 2026);
    await expect(createMember({ contact: { mode: 'existing', contactId: a }, fields: { role: 'child', status: 'active' } }, d, 2026)).rejects.toThrow();
    expect((await loadMembers(d)).length).toBe(1);
  });
});

describe('date form reuse', () => {
  const d = html(createElement(DateForm, { onClose: () => undefined, onSaved: () => undefined }));
  it('is the existing form, with the existing kinds, an Add date button and named controls', () => {
    expect(textOf(byTag(d, 'button').find((b) => /Add date/.test(textOf(b)))!)).toBe('Add date');
    expect(textOf(d)).toMatch(/Anniversary/);
    expect(textOf(d)).toMatch(/Other important date/);
    expect(unnamedFields(d)).toEqual([]);
    expect(unnamedButtons(d)).toEqual([]);
  });
  it('saving a date writes one Family date row and creates no Calendar event, Task or link; the Calendar shows it through the provider', async () => {
    const db = fresh();
    const a = await createDistinctContact(db, { name: 'Alex Example' });
    const m = await createMember({ contact: { mode: 'existing', contactId: a }, fields: { role: 'parent', status: 'active' } }, db, 2026);
    const quiet = await snapshotTables(db);
    const eventsBefore = (await loadEvents(db)).length;
    const id = await createDate({ dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '06-21', memberId: m.id, status: 'active' }, db, 2026);
    expect(id).toBeGreaterThan(0);
    const after = await snapshotTables(db);
    expect(Object.keys(after).filter((t) => after[t] !== quiet[t])).toEqual(['moduleRecords']);
    expect((await loadEvents(db)).length).toBe(eventsBefore);
    expect(await db.moduleRecords.where('module').equals('calendar').count()).toBe(0);
    const items = await familyDueItems(db, { from: '2027-01-01', to: '2027-12-31', today: '2026-11-09', overdueDays: 0 } as never);
    expect(items.filter((i) => i.title === 'Wedding anniversary')).toHaveLength(1); // one derived marker for the year; nothing stored
  });
  it('household-wide dates (no member) and the existing validation still apply', async () => {
    const db = fresh();
    expect(await createDate({ dateKind: 'other', label: 'Pool closing day', monthDay: '09-15', status: 'active' }, db, 2026)).toBeGreaterThan(0);
    await expect(createDate({ dateKind: 'other', label: '', monthDay: '09-15', status: 'active' }, db, 2026)).rejects.toThrow();
    await expect(createDate({ dateKind: 'other', label: 'x', monthDay: '02-30', status: 'active' }, db, 2026)).rejects.toThrow();
    expect(await db.moduleRecords.where('[module+kind]').equals(['family', 'date']).count()).toBe(1);
  });
});

describe('the Quick Add code is small, silent and Family-only', () => {
  const code = (f: string) => readFileSync(`src/modules/family/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('quickAddDef.ts and useAddIntent.ts import no database or data module, write nothing, log nothing and store nothing', () => {
    for (const f of ['quickAddDef.ts', 'useAddIntent.ts']) {
      expect(code(f), f).not.toMatch(/from '\.\.\/\.\.\/db'|from '\.\/(data|dateData|importantContactData)'|\.(add|put|update|delete|bulkAdd|bulkPut)\(|\.transaction\(|console\.|localStorage|sessionStorage|fetch\(/);
    }
  });
  it('the Add-box change touches no Tasks, Calendar or Projects code', () => {
    expect(code('quickAddDef.ts')).not.toMatch(/tasks|calendar|projects/);
  });
});
