import type { QuickAddDef } from '../../core/registry';
import { DATES_ROUTE, FAMILY_BASE } from './model';

/** The address query that tells a Family page to open its own add form once. The pages read it, open the form and tidy the address. */
export const ADD_PARAM = 'add';
export const ADD_MEMBER = 'member';
export const ADD_DATE = 'date';

/**
 * Family Management F5: what the Add box can start in Family. Both destinations OPEN Family's own forms (the same ones the Family pages use), because
 * adding a person or a date needs a choice the Add box must not guess: which Contact it is (an existing one, or an explicitly separate new one, with
 * the same-name warning), the role (including Spouse), and the date. Nothing is created here, nothing is parsed from typed text and nothing is logged.
 * Nothing is marked "This is me", and no Calendar event, Task or Project is made.
 */
export const FAMILY_QUICK_ADDS: QuickAddDef[] = [
  {
    id: 'family-member',
    label: 'Family member',
    prefix: 'fam',
    aliases: ['family'],
    open: ({ navigate }) => navigate(`${FAMILY_BASE}?${ADD_PARAM}=${ADD_MEMBER}`),
    openCopy: { what: 'a family member', where: 'You choose or create the contact and the role on Family’s own form. Nothing is saved until you press Add member there.', button: 'Open the Add member form' },
  },
  {
    id: 'family-date',
    label: 'Family date',
    prefix: 'fd',
    aliases: ['famdate'],
    open: ({ navigate }) => navigate(`${FAMILY_BASE}${DATES_ROUTE}?${ADD_PARAM}=${ADD_DATE}`),
    openCopy: { what: 'a family date', where: 'An anniversary or other yearly date, on Family’s own form. Nothing is saved until you press Add date there.', button: 'Open the Add date form' },
  },
];
