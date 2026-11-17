import type { IconName } from '../ui/icons';

/**
 * The words and links of the Getting Started & Help page, kept as plain data so a test can check every address and so the
 * page component only lays them out. Read-only product documentation: nothing here reads or writes household data.
 * Addresses are written like the rest of the app writes them (`/ledger/accounts`); the page puts `#` in front for the hash router.
 * American English, plain words, and no internal phase names.
 */

export interface HelpLink { label: string; path: string }

export interface HelpStep {
  id: string;
  icon: IconName;
  title: string;
  /** Paragraphs, in order. */
  body: string[];
  links?: HelpLink[];
  /** A step that opens the Add box instead of an address (the page draws a button; opening it saves nothing). */
  addBox?: boolean;
}

export const WELCOME = {
  lead: 'Your money, calendar, tasks, home, and household, all in one place.',
  body: [
    'Ledger helps you organize the things you need to manage without jumping between spreadsheets, calendars, and lists.',
    'You don’t need to set everything up at once. Start with what matters to you, and Ledger becomes more useful as you add information.',
  ],
};

export const STEPS: HelpStep[] = [
  {
    id: 'today',
    icon: 'calendar',
    title: 'Explore Today',
    body: ['Today brings together what is coming up: events, tasks, deadlines, and things that need your attention. It fills in as you add information.'],
    links: [{ label: 'Open Today', path: '/today' }],
  },
  {
    id: 'add',
    icon: 'plus',
    title: 'Add something useful',
    body: [
      'Use the Add button at the top of the screen (the round + button on a phone, or press N on a computer keyboard). You can start with an event, a task, a transaction, or a household record such as a bill or a family member.',
      'You see what will be saved, and nothing is saved until you confirm it.',
    ],
    addBox: true,
  },
  {
    id: 'finances',
    icon: 'wallet',
    title: 'Set up your finances (optional)',
    body: [
      'Money is one part of Ledger, not a requirement. Everything else works without it. When you are ready, you can create accounts, bring in transactions from a CSV file your bank provides, sort spending into categories, and build a budget.',
      'Ledger reads CSV files. It does not read other bank file types such as QFX or QIF.',
    ],
    links: [
      { label: 'Accounts', path: '/ledger/accounts' },
      { label: 'Import transactions', path: '/ledger/import' },
      { label: 'Budget', path: '/ledger/budget' },
    ],
  },
  {
    id: 'household',
    icon: 'home',
    title: 'Organize your household',
    body: ['Begin with the area you actually need. You do not have to fill in all of them.'],
    // Rendered as a short list: the link label is the name, `hint` is what it is for.
  },
  {
    id: 'data',
    icon: 'folder',
    title: 'Protect your data',
    body: [
      'Ledger keeps your information in this browser, on this device. It does not copy anything to another browser or device unless you set up sync.',
      'Backups and sync do different jobs. A backup is a separate copy you can restore if something goes wrong. Sync is an optional way to keep your phone and computer in step, and it needs to be set up first.',
      'Automatic weekly backups are optional too. They are off until you turn them on, and they need sync to be set up first. Until then, a backup is a file you save yourself.',
      'If you clear this browser’s data, or use a different browser, and you have no backup or synced copy, your information cannot be recovered. A recent backup is the safe habit.',
    ],
    links: [
      { label: 'Data & Backups', path: '/settings/backup' },
      { label: 'Sync devices', path: '/settings/sync' },
    ],
  },
];

/** The household areas named in step 4. */
export const HOUSEHOLD_AREAS: (HelpLink & { hint: string })[] = [
  { label: 'Family', path: '/family', hint: 'The people in your household, birthdays, and important dates.' },
  { label: 'Contacts', path: '/contacts', hint: 'People and businesses you deal with.' },
  { label: 'Bills & Subscriptions', path: '/bills', hint: 'What you pay regularly, and when it is due.' },
  { label: 'Household Services', path: '/services', hint: 'Cleaners, lawn care, and other regular help.' },
  { label: 'Home & Assets', path: '/assets', hint: 'Your home, appliances, and vehicles, with repairs and warranties.' },
  { label: 'Projects', path: '/projects', hint: 'Bigger efforts, such as a renovation.' },
];

export type ConnectionKind = 'auto' | 'link';
export interface Connection {
  id: string;
  from: string;
  to: string;
  kind: ConnectionKind;
  text: string;
}

/** The label that goes with each kind, as words (never colour alone). */
export const KIND_LABEL: Record<ConnectionKind, string> = { auto: 'Shows up on its own', link: 'You choose the link' };

export const CONNECT = {
  lead: 'Enter information where it belongs. Ledger helps show it where it’s useful.',
  intro: 'Each record lives in one place. Some modules then show it in another place, and a few records are linked by you. These are the connections that matter most.',
  items: [
    { id: 'task', from: 'A Task with a date', to: 'Today and Calendar', kind: 'auto',
      text: 'Add a date to a Task and it appears on Today and in the Calendar’s Tasks layer. You can turn a Calendar layer on or off.' },
    { id: 'service', from: 'A recurring Household Service', to: 'Calendar and Tasks', kind: 'auto',
      text: 'The schedule puts expected visits on the Calendar. Ledger also keeps one Task for the next visit, so you have something to act on without a year of Tasks.' },
    { id: 'bill', from: 'A Bill or Subscription', to: 'Calendar, Today, and reminders', kind: 'auto',
      text: 'Due dates, renewal dates, and cancel-by dates show on the Calendar and on Today. A reminder Task is something you can turn on for a bill; it is not made for you.' },
    { id: 'payment', from: 'A payment in Ledger', to: 'A Bill or Service', kind: 'link',
      text: 'Entering a bill does not create or pay a transaction. When you record the payment in Ledger, you can link it to the bill. Ledger may suggest a match, and you decide.' },
    { id: 'family', from: 'A Family member', to: 'A Contact and important dates', kind: 'link',
      text: 'A member is based on a Contact you pick, so a name and phone number are kept in one place. Birthdays and important dates then show on the Calendar.' },
    { id: 'project', from: 'A Project', to: 'Tasks, events, and spending', kind: 'link',
      text: 'A Project gathers the Tasks, milestones, and Calendar events you attach to it. Its budget and commitments sit beside the Ledger transactions you link to it.' },
    { id: 'money', from: 'Financial transactions', to: 'Balances, spending, and budgets', kind: 'auto',
      text: 'Transactions you enter or import are what account balances, spending reports, and budgets are worked out from.' },
  ] as Connection[],
  note: 'Ledger does not connect records just because their names match. A link exists only where you made one, or where a module is built to show another module’s dates.',
};

export interface WhereTo { id: string; need: string; links: HelpLink[] }

export const WHERE_TO: WhereTo[] = [
  { id: 'upcoming', need: 'I want to see what’s coming up', links: [{ label: 'Today', path: '/today' }, { label: 'Calendar', path: '/calendar' }] },
  { id: 'remember', need: 'I need to remember something', links: [{ label: 'Tasks', path: '/tasks' }] },
  { id: 'spending', need: 'I want to understand my spending', links: [{ label: 'Ledger', path: '/ledger' }, { label: 'Reports', path: '/ledger/reports' }] },
  { id: 'subscription', need: 'I need to track a subscription', links: [{ label: 'Bills & Subscriptions', path: '/bills' }] },
  { id: 'service', need: 'I need to manage a household service', links: [{ label: 'Household Services', path: '/services' }] },
  { id: 'repairs', need: 'I need to track repairs or warranties', links: [{ label: 'Home & Assets', path: '/assets' }] },
  { id: 'project', need: 'I’m organizing a renovation or another big effort', links: [{ label: 'Projects', path: '/projects' }] },
  { id: 'family', need: 'I want to manage family dates', links: [{ label: 'Family', path: '/family' }] },
  { id: 'device', need: 'I want to use Ledger on another device', links: [{ label: 'Sync devices', path: '/settings/sync' }] },
  { id: 'copy', need: 'I need a copy of my information', links: [{ label: 'Data & Backups', path: '/settings/backup' }] },
];

export interface HelpExample { id: string; title: string; story: string; steps: string[]; note?: string }

export const EXAMPLES = {
  title: 'Show me an example',
  intro: 'Three made-up households, for reading only. Opening this section does not add or change anything in Ledger.',
  items: [
    {
      id: 'cleaning',
      title: 'House cleaning',
      story: '“I have cleaners who come every other Friday.”',
      steps: [
        'In Household Services, add an arrangement for your cleaners.',
        'Record the schedule: every 2 weeks, on Friday.',
        'Expected visits appear on the Calendar.',
        'Ledger keeps the next visit as one Task, instead of creating a whole year of Tasks. When you log a visit, the next one is scheduled.',
      ],
    },
    {
      id: 'subscription',
      title: 'A recurring bill',
      story: '“I pay for a subscription every month.”',
      steps: [
        'In Bills & Subscriptions, add the subscription.',
        'Record how often it bills, the usual date, and any renewal details.',
        'Its due dates and renewal date appear on the Calendar and on Today.',
        'If you pay it through Ledger, you can link that payment to the bill afterward.',
      ],
      note: 'Adding a subscription does not create a transaction and does not pay anything.',
    },
    {
      id: 'renovation',
      title: 'A home improvement project',
      story: '“I’m renovating a bathroom.”',
      steps: [
        'In Projects, create the project.',
        'Add the Tasks and milestones, and any Calendar events.',
        'Record the budget and what you have agreed to pay, and link the expenses you actually spend from Ledger.',
        'Follow progress and upcoming dates on the project’s page, and on Today and the Calendar.',
      ],
    },
  ] as HelpExample[],
};

/** Every internal address the page links to (used by the page and by the link test). */
export function allHelpLinks(): string[] {
  return [
    ...STEPS.flatMap((s) => (s.links ?? []).map((l) => l.path)),
    ...HOUSEHOLD_AREAS.map((l) => l.path),
    ...WHERE_TO.flatMap((w) => w.links.map((l) => l.path)),
  ];
}
