import type { Account, InvAccount, Loan, Person, Property } from '../types';

/**
 * The "if something happens to me" guide: a printable page for the people who would need to take over. The app fills in the accounts,
 * loans, property, insurance, and bills it already knows about; you add contacts, where documents are, and notes.
 * It must never hold passwords or account numbers: it says where things are, not how to get in.
 */

export interface GuideContact {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  note: string;
}

export interface GuideDoc {
  id: string;
  item: string;
  where: string;
}

export interface GuideData {
  contacts: GuideContact[];
  docs: GuideDoc[];
  /** Notes by item key (see `itemKey`): which institution, how to reach it, who the beneficiary is. */
  itemNotes: Record<string, string>;
  digital: string;
  wishes: string;
  showBalances: boolean;
}

export const DEFAULT_GUIDE: GuideData = {
  contacts: [],
  docs: [
    'Will',
    'Trust documents',
    'Power of attorney',
    'Health care proxy and living will',
    'Birth and marriage certificates',
    'Recent tax returns',
    'Deed to the house',
    'Vehicle titles',
    'Safe deposit box (bank and where the key is)',
  ].map((item, i) => ({ id: `d${i}`, item, where: '' })),
  itemNotes: {},
  digital: '',
  wishes: '',
  showBalances: false,
};

export const CONTACT_ROLES = ['Spouse or partner', 'Executor', 'Lawyer', 'Accountant or tax preparer', 'Financial advisor', 'Insurance agent', 'Employer HR or benefits', 'Family or friend', 'Other'];

export type ItemKind = 'bank' | 'card' | 'investment' | 'loan' | 'property';

export interface GuideItem {
  /** Stable key for the notes you write about it. */
  key: string;
  kind: ItemKind;
  title: string;
  /** What the app knows: type, owner, closed. */
  detail: string;
  /** Balance in cents when known (shown only if you choose to). */
  balanceCents?: number;
}

export const itemKey = (kind: ItemKind, id: number) => `${kind}-${id}`;

const KIND_WORD: Record<string, string> = { checking: 'Checking', savings: 'Savings', credit_card: 'Credit card', loan: 'Loan' };
const INV_WORD: Record<string, string> = { brokerage: 'Brokerage', ira: 'IRA', '401k': '401(k)', '529': '529 plan', hsa: 'HSA' };

/** Everything in the app that someone taking over would need to know about. */
export function guideItems(input: {
  accounts: Account[];
  invAccounts: InvAccount[];
  invValue: (a: InvAccount) => number;
  loans: Loan[];
  loanOwed: (l: Loan) => number;
  properties: Property[];
  propertyValue: (p: Property) => number | null;
  people: Person[];
  balance: (a: Account) => number;
}): GuideItem[] {
  const owner = (id?: number | null) => input.people.find((p) => p.id === id)?.name;
  const out: GuideItem[] = [];
  for (const a of input.accounts) {
    if (a.closed) continue;
    out.push({ key: itemKey(a.kind === 'credit_card' ? 'card' : 'bank', a.id!), kind: a.kind === 'credit_card' ? 'card' : 'bank', title: a.name, detail: KIND_WORD[a.kind] ?? a.kind, balanceCents: input.balance(a) });
  }
  for (const a of input.invAccounts) {
    if (a.closed) continue;
    const who = owner(a.personId);
    out.push({ key: itemKey('investment', a.id!), kind: 'investment', title: a.name, detail: `${INV_WORD[a.kind] ?? a.kind}${who ? `, ${who}` : ''}`, balanceCents: input.invValue(a) });
  }
  for (const l of input.loans) {
    if (l.scenario) continue;
    out.push({ key: itemKey('loan', l.id!), kind: 'loan', title: l.name, detail: l.kind === 'heloc' ? 'HELOC' : l.kind === 'mortgage' ? 'Mortgage' : 'Loan', balanceCents: -input.loanOwed(l) });
  }
  for (const p of input.properties) {
    if (p.excluded) continue;
    const v = input.propertyValue(p);
    out.push({ key: itemKey('property', p.id!), kind: 'property', title: p.name, detail: p.kind === 'home' ? 'Home' : p.kind === 'vehicle' ? 'Vehicle' : 'Property', balanceCents: v ?? undefined });
  }
  return out;
}

/** Things to do in the first weeks, in plain language. */
export const FIRST_STEPS: string[] = [
  'Get several certified copies of the death certificate; most accounts and offices will each want one.',
  'Find the will and call the executor named in it. Do not move or close accounts until the executor says to.',
  'Call the employer’s HR or benefits office about final pay, life insurance, health coverage, and the 401(k).',
  'Contact the insurance companies listed here and ask how to file a claim.',
  'Tell Social Security. A surviving spouse may be eligible for a survivor benefit that replaces the smaller of the two benefits.',
  'Keep paying the mortgage, rent, utilities, and insurance on time while things are sorted out; see the bills list.',
  'Do not cancel credit cards or close accounts right away: the estate may need them. Ask the executor and an accountant first.',
  'Ask each credit bureau to place a deceased alert on the credit file to guard against identity theft.',
  'Talk to the accountant or tax preparer: a final income tax return is due, and a surviving spouse may file jointly for the year.',
  'Ask each investment firm and bank how to retitle or claim accounts; accounts with a named beneficiary usually transfer directly.',
];
