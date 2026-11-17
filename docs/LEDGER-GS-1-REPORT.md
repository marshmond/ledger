# Ledger GS-1, Getting Started & Help: implementation report

Date: 2026-11-17. Status: **BUILT AND TESTED LOCALLY; UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED; awaiting ChatGPT review; NOT REAL-DEVICE TESTED.** Proposed commit: `feat(help): add getting started and household guide`.

## 1. Baseline (verified first)

`main` = `origin/main` = `a65c806` (`docs(calendar): record CAL-G1 release and deployment result`), GitHub Pages run **#135** `completed` / `success` (public Actions API; `gh` is not installed). CAL-G1 (`5cbb3c0`, run #134) is therefore released and nothing of it is mixed in. Only the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`) were present; they are untouched.

## 2. What was built

A read-only page titled **Getting Started & Help** at `#/help`, plus three small ways in. No financial calculation, household record, sync, backup, schema or module behavior was touched. No table, migration, dependency, network call or setting was added.

### 2.1 Page structure

| Part | What it is |
|---|---|
| Header | Shared `PageHeader`: title and one line, "A two-minute guide to what Ledger does, how to begin, and where things are." |
| A. Welcome to Ledger | The lead sentence and two short paragraphs. |
| B. Getting started | Five numbered steps with an icon each and working links (below). |
| C. How everything connects | Lead sentence, one short paragraph, seven connection cards each labeled in words "Shows up on its own" or "You choose the link", and a closing note. |
| D. Where do I go when…? | Ten rows, each with one or two links. |
| Show me an example | A closed `<details>` with three fictional scenarios. Read-only. |

The words live in `src/shell/helpContent.ts` as plain data (so a test can check every address); `src/shell/HelpPage.tsx` only lays them out; `src/shell/help.css` is tokens only.

### 2.2 Final user-facing content

**Welcome to Ledger.** *Your money, calendar, tasks, home, and household, all in one place.* Ledger helps you organize the things you need to manage without jumping between spreadsheets, calendars, and lists. You don’t need to set everything up at once. Start with what matters to you, and Ledger becomes more useful as you add information.

**Getting started**

1. **Explore Today.** Today brings together what is coming up: events, tasks, deadlines, and things that need your attention. It fills in as you add information. Link: Open Today.
2. **Add something useful.** Use the Add button at the top of the screen (the round + button on a phone, or press N on a computer keyboard). You can start with an event, a task, a transaction, or a household record such as a bill or a family member. You see what will be saved, and nothing is saved until you confirm it. Button: Open the Add box.
3. **Set up your finances (optional).** Money is one part of Ledger, not a requirement. Everything else works without it. When you are ready, you can create accounts, bring in transactions from a CSV file your bank provides, sort spending into categories, and build a budget. Ledger reads CSV files. It does not read other bank file types such as QFX or QIF. Links: Accounts, Import transactions, Budget.
4. **Organize your household.** Begin with the area you actually need. You do not have to fill in all of them. Family (the people in your household, birthdays, and important dates); Contacts (people and businesses you deal with); Bills & Subscriptions (what you pay regularly, and when it is due); Household Services (cleaners, lawn care, and other regular help); Home & Assets (your home, appliances, and vehicles, with repairs and warranties); Projects (bigger efforts, such as a renovation).
5. **Protect your data.** Ledger keeps your information in this browser, on this device. It does not copy anything to another browser or device unless you set up sync. Backups and sync do different jobs. A backup is a separate copy you can restore if something goes wrong. Sync is an optional way to keep your phone and computer in step, and it needs to be set up first. Automatic weekly backups are optional too. They are off until you turn them on, and they need sync to be set up first. Until then, a backup is a file you save yourself. If you clear this browser’s data, or use a different browser, and you have no backup or synced copy, your information cannot be recovered. A recent backup is the safe habit. Links: Data & Backups, Sync devices.

**How everything connects.** *Enter information where it belongs. Ledger helps show it where it’s useful.* Each record lives in one place. Some modules then show it in another place, and a few records are linked by you. These are the connections that matter most.

| From → to | Kind | Text |
|---|---|---|
| A Task with a date → Today and Calendar | Shows up on its own | Add a date to a Task and it appears on Today and in the Calendar’s Tasks layer. You can turn a Calendar layer on or off. |
| A recurring Household Service → Calendar and Tasks | Shows up on its own | The schedule puts expected visits on the Calendar. Ledger also keeps one Task for the next visit, so you have something to act on without a year of Tasks. |
| A Bill or Subscription → Calendar, Today, and reminders | Shows up on its own | Due dates, renewal dates, and cancel-by dates show on the Calendar and on Today. A reminder Task is something you can turn on for a bill; it is not made for you. |
| A payment in Ledger → A Bill or Service | You choose the link | Entering a bill does not create or pay a transaction. When you record the payment in Ledger, you can link it to the bill. Ledger may suggest a match, and you decide. |
| A Family member → A Contact and important dates | You choose the link | A member is based on a Contact you pick, so a name and phone number are kept in one place. Birthdays and important dates then show on the Calendar. |
| A Project → Tasks, events, and spending | You choose the link | A Project gathers the Tasks, milestones, and Calendar events you attach to it. Its budget and commitments sit beside the Ledger transactions you link to it. |
| Financial transactions → Balances, spending, and budgets | Shows up on its own | Transactions you enter or import are what account balances, spending reports, and budgets are worked out from. |

Closing note: Ledger does not connect records just because their names match. A link exists only where you made one, or where a module is built to show another module’s dates.

**Where do I go when…?** I want to see what’s coming up: Today, Calendar. I need to remember something: Tasks. I want to understand my spending: Ledger, Reports. I need to track a subscription: Bills & Subscriptions. I need to manage a household service: Household Services. I need to track repairs or warranties: Home & Assets. I’m organizing a renovation or another big effort: Projects. I want to manage family dates: Family. I want to use Ledger on another device: Sync devices. I need a copy of my information: Data & Backups.

**Show me an example** (closed until opened; "Three made-up households, for reading only. Opening this section does not add or change anything in Ledger.")

- **House cleaning.** "I have cleaners who come every other Friday." (1) In Household Services, add an arrangement for your cleaners. (2) Record the schedule: every 2 weeks, on Friday. (3) Expected visits appear on the Calendar. (4) Ledger keeps the next visit as one Task, instead of creating a whole year of Tasks. When you log a visit, the next one is scheduled.
- **A recurring bill.** "I pay for a subscription every month." (1) In Bills & Subscriptions, add the subscription. (2) Record how often it bills, the usual date, and any renewal details. (3) Its due dates and renewal date appear on the Calendar and on Today. (4) If you pay it through Ledger, you can link that payment to the bill afterward. Note: Adding a subscription does not create a transaction and does not pay anything.
- **A home improvement project.** "I’m renovating a bathroom." (1) In Projects, create the project. (2) Add the Tasks and milestones, and any Calendar events. (3) Record the budget and what you have agreed to pay, and link the expenses you actually spend from Ledger. (4) Follow progress and upcoming dates on the project’s page, and on Today and the Calendar.

## 3. Navigation integration

| Entry point | Where | Behavior |
|---|---|---|
| Header Help link | `src/core/ModuleBar.tsx`, between the sync status and Settings | A small icon-only link (the existing `help` icon) named "Help", with a tooltip, `aria-current="page"` on the page. Shown at 641 px and wider. Not a twelfth module: the module list, its groups and the registry are unchanged. |
| Phone module list | `ModuleFoot`, beside Settings | The header link is hidden at phone width (the bar is already full); the open list carries "Help" next to Settings. 44 px tall. |
| Finance Home checklist | `src/pages/HomePage.tsx`, the "Get started" row | One text link, "Read the guide", beside "Show all steps" and "Dismiss". The checklist's steps, progress, saved dismissal key (`ledger.onboarding.dismissed`) and visibility rule are unchanged (pinned by a test). |

Route: `/help` is a **shell page** like Settings, Quick Answers and Records: added to `SHELL_PATHS` (so the module router never prefixes it with `/ledger`), registered in `App.tsx` as a lazily loaded page behind the standard load/error boundary, and preloaded when a bookmark opens it. It is available whether or not setup is finished, and reads and writes no data (no database, no settings, no "seen it" flag). There is no first-run popup, wizard, forced onboarding, permission or account.

## 4. Links and destinations

All 16 distinct destinations exist and were opened in the browser (no redirect, no error): `/today`, `/calendar`, `/tasks`, `/ledger`, `/ledger/accounts`, `/ledger/import`, `/ledger/budget`, `/ledger/reports`, `/family`, `/contacts`, `/bills`, `/services`, `/assets`, `/projects`, `/settings/backup`, `/settings/sync`. A test checks each address against the module registry, the Ledger route list and the Settings pages actually declared in `SettingsPage.tsx`. The guide links only to a module's front screen (plus the named Ledger pages and the two Settings pages), never to a record page that might not exist.

## 5. Accuracy checks (what each claim rests on)

| Claim | Verified against |
|---|---|
| Today collects events, tasks, deadlines, attention items | Today module header comment; due providers feed it |
| Add button, round + on a phone, N shortcut, nothing saved until confirmed | `ModuleBar.tsx`, `GlobalFrame.tsx` (`wantsAddShortcut`), `registry.ts` (`commit` "only called after the user has seen the preview and pressed Add") |
| CSV import exists; no QFX or QIF | `ImportPage.tsx` accepts `.csv,text/csv` only; the page says "bank CSV file or by pasting rows" |
| Browser-local data; sync is optional and set up first | `SyncPage.tsx` ("Sync is not set up on this device"), `BackupPage.tsx` ("Each device keeps its own copy… Without it, move data by exporting a backup") |
| Automatic weekly backups are off until turned on and need sync first | `BackupPage.tsx` `AutoBackupCard` (badge "Needs Sync devices first"; "Off on this device"; "Turn on automatic backups") |
| Task with a date on Today and Calendar's Tasks layer; layers can be turned off | Calendar layer list in `exportR43.test.ts` (`Your calendars, Family, Tasks, Projects, Finance`); Calendar layer controls |
| Recurring service: expected visits on the Calendar plus one next-visit Task | `HOUSEHOLD-SERVICES-S4-REPORT` (`dueProvider.ts`: "Single-next-actionable-Task model"), S3 report (logging creates the next Task) |
| Bill: due, renewal, cancel-by dates on the Calendar; reminder Task is opt-in | `bills/dueProvider.ts` header; `bills/tasks.ts` (`payTask` is true only when set, `effectiveReminders`); `ContractCard.tsx` |
| Entering a bill creates and pays nothing; a payment can be linked; Ledger suggests, you decide | Bills B3 and R2.2 (payment-link suggestions, owner confirms); `dueProvider` "no Task, event or reminder is made" |
| Family member is based on a Contact; birthdays and dates on the Calendar | `family/dueProvider.ts` (name from the linked Contact; "show on Calendar" switch); `MemberPage.tsx` |
| Project gathers Tasks, milestones and events; budget, commitments and linked transactions | `projects/ProjectWork.tsx` ("Tasks, milestones and events of one project"), `Financials.tsx` ("budget… committed… spent (Finance transactions)") |

One precision I chose on purpose: the Family card says "a Contact you pick", not "automatically", and the birthday line says dates "show on the Calendar" without saying every member has the switch on (it is a per-member switch).

## 6. Testing

- New: `src/shell/help.test.tsx`, **19 tests**: route and registration, heading structure, closed examples, every link valid against the registry, Ledger routes and Settings pages, links drawn equal the content, accuracy phrases (no automatic backup or sync claim, CSV yes and QFX/QIF no, finance optional, kind labels, no bill-pays-itself claim), nothing deferred (Gmail, command station, external calendar) described as working, no internal phase names or jargon, American spelling, no database or storage imports and exactly one button that only opens the Add box, header and phone-list entry points and 44 px rules, the Finance checklist unchanged, tokens-only stylesheet.
- Existing tests changed, each for a reason that follows directly from the new link and route: `d7Header.test.tsx` (phone list foot and Tab order now include Help; two stylesheet patterns now include `.modhelp`), `d7SyncAttention.test.tsx` (one stylesheet pattern), `d20Dialogs.test.tsx` (page boundaries counted 4, now 5), `core.test.ts` (the Ledger-address scan skips `/help`, a shell page, like `/settings`), `uiCoverage.test.ts` (26 surfaces, the S-26 row, the `GS-` phase prefix).
- Full suite: **330 files, 6,561 tests, all pass** (was 329 and 6,542). `npx tsc --noEmit` clean. `npm run build` clean (existing chunk-size warning only). The Help screen is a separate lazy file (11.3 kB JS, 3.0 kB CSS); the entry file is 755.27 kB, a small increase from the header link and the Help route only.

### Browser verification (built-in browser, existing invented demo household, light unless stated)

- Loads from `#/help` (also reloaded directly); no console errors.
- **1440 x 900:** reads as a calm single column; no sideways overflow; header Help icon visible between Sync and Settings.
- **375 px:** `scrollWidth` 375, nothing wider than the screen, every link, button and summary at least 44 px tall, the examples opened; the phone module list shows Settings, **Help** (44 px) and the sync status.
- **Dark (375 px):** readable, cards and labels keep their words; no overflow. Desktop dark was not looked at.
- **Keyboard:** a real Tab walk went through the guide links in reading order with a visible focus outline; Enter on "Open the Add box" opened the Add box with focus inside it, Escape closed it and returned focus to the button; route changes move focus to the page's main region (the app's existing behavior).
- **Writes nothing:** the record count of every database table and every saved browser setting were identical before and after opening the page and the Add box.
- **Checklist:** on Ledger Home "Get started" showed "2 of 4 done"; "Show all steps" listed the four steps with their done marks; Dismiss hid it and saved the same key; I then removed that key so the browser is as I found it. "Read the guide" went to `#/help` (not under `/ledger`), and the header Help link marked the page current.
- **All 16 destinations** were opened one after another from the page's own links.

Not checked: a real phone, a screen reader, forced-colors mode, Safari and Firefox, print, desktop dark, a keyboard walk on the phone layout.

## 7. Judgment calls (please review)

1. **Plain anchors, not router links.** Like the Records and Answers pages, the guide uses `href="#/…"`. The repository's guard forbids router links in shell pages outside a short list, and plain anchors behave identically with the hash router.
2. **Step 2 has a button.** "Open the Add box" opens the ordinary Add box (the same box the header button opens) and saves nothing. It is the only control on the page. Easy to remove if you want zero buttons.
3. **Help is an icon in the header** (not a word) so the bar is not crowded; it has an accessible name and a tooltip. On a phone it lives in the open module list beside Settings, not as a new bar button.
4. **Wording of Step 5** is longer than the other steps because the brief asked for five accurate points (browser-local, sync not automatic, sync vs backup, data loss, automatic backups only when configured). I kept each sentence short.
5. **"You choose the link" vs "Shows up on its own"** are shown as words on each connection card, not colors, to answer "be precise about what is automatic". The Family "Contact you pick" and the Project "you attach/link" cases are in the second group.
6. **Reports** is linked next to Ledger under "understand my spending" (the brief said "Ledger"); both exist.
7. **Calendar export and Gmail are not mentioned.** The brief says not every limitation belongs on the page; neither helps a first-time user, and mentioning them risked implying they work out of the box. If you want one line on exports being snapshots, it fits under Step 5.
8. **Examples use the word "Task"** capitalized as the app does, and "every 2 weeks, on Friday" matches the Household Services cadence wording.
9. **UI tracker:** added one global-surface row, S-26 (not a routed-page row, as with Records and Quick Answers), status `BLT`, marks L, D (phone width only), 375, 1440, Kbd (desktop), Func. Nothing is `ACC`.
10. The "Read the guide" link sits inside the checklist row, so it disappears when that row is dismissed or finished; the header Help link stays available. That keeps one completion state, as the brief asks.

## 8. What is NOT built

Searchable articles, a chatbot, interactive tours, analytics, an account system, a separate demo database, a new design system or backend, a new module, any first-run prompt, any change to the checklist's behavior, screenshots in the page, and a "what's new" list. A real-device, screen-reader and Safari or Firefox pass is outstanding.

## 9. Maintenance note for whoever changes a module

The guide describes behavior in seven places (Add box, CSV import, sync and backup, Task dates, Household Services visits, Bill dates, Family and Project links). If one of those changes, update `src/shell/helpContent.ts`; the tests in `src/shell/help.test.tsx` fail if an address stops existing.

## 10. Handoff and backlog

`docs/CHATGPT-HANDOFF.md` updated (top notice, current-phase line, delivered section, risks, change log). `docs/BACKLOG.md` has a new top status entry. `docs/UI-COVERAGE.md` has the S-26 row, roll-up and note. Nothing is committed, pushed or deployed; waiting for ChatGPT review and your go-ahead.
