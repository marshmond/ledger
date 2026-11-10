/**
 * TEST HELPER ONLY (nothing in the application imports this file; a test pins that). Many older tests build several records for one provider ("Rosa's Cleaning")
 * and need them to share ONE Contact. Since U2 a name never selects a Contact, so a test says so on purpose: `providerNamed(d, "Rosa's Cleaning")` finds the live
 * Contact with that name in THIS test database or makes it once, and returns the explicit-id choice the data functions now require.
 */
import type { FinanceDB } from '../db';
import { createDistinctContact, nameKey, type ContactInput } from './contacts';
import type { ContactChoice } from './contactIdentity';
import { isLive } from './store';

export async function providerNamed(d: FinanceDB, name: string, extra: Partial<Omit<ContactInput, 'name'>> = {}): Promise<ContactChoice & { contactId: number }> {
  const found = (await d.contacts.toArray()).find((c) => isLive(c) && nameKey(c.name) === nameKey(name));
  const contactId = found?.id ?? await createDistinctContact(d, { name, ...extra });
  return { contactId: contactId as number };
}
