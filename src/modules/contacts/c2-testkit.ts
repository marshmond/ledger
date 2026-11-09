/**
 * Contacts C2 test kit: invented data for every module that stores a Contact id, written as plain rows (the same shape the modules store).
 * Used by the reader, removal and sync tests so they all speak about the same relationships.
 */
import { FinanceDB } from '../../db';
import { createDistinctContact } from '../../core/contacts';
import type { ContactReferenceProvider } from '../../core/contactReferences';
import { allContactReferenceProviders } from '../../core/registry';
import { installTracking } from '../../lib/sync/track';
import { registerModules } from '../index';

export const TODAY = '2026-11-09';
// The readers exactly as the application registers them (so these tests also prove the registration).
registerModules();
export const PROVIDERS: ContactReferenceProvider[] = allContactReferenceProviders();

let n = 0;
export const freshDb = (prefix = 'c2') => { const d = new FinanceDB(`test-${prefix}-${n++}`); installTracking(d); return d; };

export const row = (d: FinanceDB, module: string, kind: string, data: unknown, deleted = false) =>
  d.moduleRecords.add({ module, kind, createdAt: 1, updatedAt: 1, deletedAt: deleted ? 5 : null, data } as never) as Promise<number>;

/** Every table as text, for "nothing changed" checks. */
export const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));

export interface Seeded {
  /** The Contact every record below names. */
  c: number;
  ids: Record<string, number>;
}

/** Gives one Contact a record in every module that can hold one. */
export async function seedEverywhere(d: FinanceDB, name = 'Pat Example'): Promise<Seeded> {
  const c = await createDistinctContact(d, { name, relationship: 'neighbour' });
  const kid = await createDistinctContact(d, { name: 'Kai Example' });
  const ids: Record<string, number> = {};
  ids.member = await row(d, 'family', 'member', { contactId: c, role: 'spouse', status: 'active' });
  ids.kidMember = await row(d, 'family', 'member', { contactId: kid, role: 'child', status: 'active' });
  ids.important = await row(d, 'family', 'contact', { memberId: ids.kidMember, contactId: c, purpose: 'Soccer coach', status: 'active' });
  ids.importantOld = await row(d, 'family', 'contact', { memberId: ids.kidMember, contactId: c, purpose: 'Old tutor', status: 'archived' });
  ids.task = await row(d, 'tasks', 'task', { title: 'Book the dentist', status: 'todo', dueDate: '2026-12-01', contactIds: [c], tagIds: [], checklist: [] });
  ids.event = await row(d, 'calendar', 'event', { title: 'Parent meeting', allDay: true, startDate: '2026-12-02', endDate: '2026-12-02', contactIds: [c], tagIds: [], calendarId: 1 });
  ids.project = await row(d, 'projects', 'project', { name: 'Kitchen refit', status: 'active', vendorContactIds: [c], archived: false });
  ids.commitment = await row(d, 'projects', 'commitment', { projectId: ids.project, vendorContactId: c, title: 'Cabinet quote', status: 'accepted', amountCents: 123400, budgetLineId: null, parentId: null, notes: '' });
  ids.asset = await row(d, 'assets', 'asset', { name: 'Boiler', type: 'appliance', status: 'active', contacts: [{ contactId: c, role: 'installer' }] });
  ids.service = await row(d, 'assets', 'service', { assetId: ids.asset, providerContactId: c, title: 'Annual service', date: '2026-03-01', kind: 'maintenance' });
  ids.warranty = await row(d, 'assets', 'warranty', { assetId: ids.asset, providerContactId: c, title: 'Boiler warranty', endDate: '2027-01-01' });
  ids.arrangement = await row(d, 'services', 'arrangement', { title: 'House cleaning', status: 'active', providerContactId: c, providerNameSnapshot: 'Old Name Ltd', extraContactIds: [] });
  ids.visit = await row(d, 'services', 'visit', { title: 'Cleaning visit', providerContactId: c, providerNameSnapshot: 'Old Name Ltd', date: '2026-03-10', status: 'completed', arrangementId: ids.arrangement });
  ids.bill = await row(d, 'bills', 'obligation', { title: 'Example Power', type: 'utility', providerContactId: c, providerNameSnapshot: 'Old Name Ltd', status: 'active' });
  return { c, ids };
}
