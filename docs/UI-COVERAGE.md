# Ledger UI coverage tracker (Ledger Signature rollout)

Created in **D5** (2026-11-10, uncommitted until the owner approves). Source of the inventory: the D4 blueprint (`D4-APPLICATION-COVERAGE.md`, 2026-11-10, counted at commit `8ab1789`), re-checked against the source in D5. This file holds route names, file names and ticks only. No data, no balances, no screenshots.

The goal is **every page, surface, view and dialog in Ledger**, including every Ledger financial sub-page, looking and behaving as one application. Nothing is "done" until it is accepted in both themes at phone and desktop width and its functions are unchanged.

## How to read it

**Status** (one value per row): `NS` not started, `INH` inherited look verified, `BLT` built (uncommitted), `CMT` committed, `DEP` deployed (Actions green), `ACC` accepted.

**Acceptance columns**, filled with `Y` when recorded and `.` when not:
`L` light, `D` dark, `375` phone width, `1440` desktop width, `Kbd` keyboard and focus, `Func` functional acceptance (existing tests plus the flow check passed, nothing about behaviour changed).
A row reaches `ACC` only when **L, D, 375, 1440, Kbd and Func are all `Y`**. The visual checklist V1 to V12 and functional checklist F1 to F6 are in the D4 roadmap (section 6).

**D5 left everything at `NS` / `.`. D6 (2026-11-11, built, uncommitted) restyled the shared component layer, so a few GLOBAL SURFACES now read `BLT` with the marks that were actually recorded (section 1.1 says what each mark rests on).** No routed page, in-page view, workflow or dialog call site is beyond `NS`, and nothing is `ACC`: a page that merely inherits the shared look has not been redesigned, and no page has all six marks. The Signature preset is opt-in; the pages have not been redesigned for it.

**Phases** are those of the D4 roadmap (D5 to D21). D5 itself is the foundation (tokens, preset, this tracker, guards). D6 is the shared controls; D7 header and switcher; D8 Ledger navigation (gated); D9 Family colour picker; D10 Quick Add; D11 Today and Tasks; D12 Ledger Home, Family overview, Household Finances; D13 Calendar; D14 Projects, Home & Assets, Contacts; D15 Services, Bills, Family detail; D16 Ledger everyday money; D17 Ledger analysis and Invest; D18 Ledger Plan; D19 Ledger More, documents, Settings; D20 dialogs and states sweep; D21 finishing.

## Roll-up

| Inventory | Total | Accepted |
|---|---|---|
| Routed page destinations | 59 | 0 |
| Global surfaces | 23 | 0 |
| In-page views | 31 | 0 |
| Dialogs (`<Modal>` call sites) | 62 | 0 |
| Named workflows | 37 | 0 |

A guard test (`src/shell/uiCoverage.test.ts`) fails if a registered route is missing from section 2, if an ID is duplicated, if a referenced file no longer exists, or if any total above stops matching the rows below. Add the row **in the same change** that adds the page.

---

## 1. Global surfaces (23)

| ID | Surface | Source | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| S-01 | Global header: switcher button, Search, Add, Sync chip, Settings | `src/core/ModuleBar.tsx` | D7 | NS | . | . | . | . | . | . |
| S-02 | Module switcher list (11 modules, 4 groups) | `src/core/moduleGroups.ts` | D7 | NS | . | . | . | . | . | . |
| S-03 | Sync status chip and pop-over | `src/core/SyncChip.tsx` | D7 | NS | . | . | . | . | . | . |
| S-04 | Add button (desktop in-bar, phone round button) | `src/shell/QuickAdd.tsx` | D7, D10 | BLT | Y | Y | Y | Y | Y | . |
| S-05 | Add box (Quick Add) | `src/shell/AddBox.tsx` | D10 | NS | . | Y | . | Y | Y | . |
| S-06 | Search dialog | `src/shell/SearchDialog.tsx` | D6, D20 | NS | . | Y | . | Y | Y | . |
| S-07 | Task creator dialog | `src/modules/tasks/QuickTask.tsx` | D11 | NS | . | . | . | . | . | . |
| S-08 | Shared Modal and ConfirmDialog | `src/shell/Modal.tsx` | D6 | BLT | . | Y | . | Y | Y | Y |
| S-09 | Toasts (Undo) | `src/ui/Toast.tsx` | D6 | BLT | . | Y | . | Y | . | . |
| S-10 | Backup reminder banner | `src/shell/BackupReminder.tsx` | D6 | NS | . | Y | . | Y | . | . |
| S-11 | Module loading and load-failed states | `src/shell/ModuleLoader.tsx` | D6 | NS | . | . | . | . | . | . |
| S-12 | Skip link, route announcer, main focus | `src/shell/SkipAndRoute.tsx` | D7 | NS | . | . | . | . | . | . |
| S-13 | Ledger desktop sidebar | `src/shell/Shell.tsx` | D8 | NS | . | . | . | . | . | . |
| S-14 | Ledger top bar and breadcrumbs | `src/shell/Shell.tsx` | D8 | NS | . | . | . | . | . | . |
| S-15 | Ledger section tabs (below 900 px) | `src/shell/Shell.tsx` | D8 | NS | . | . | . | . | . | . |
| S-16 | Ledger bottom tab bar (below 900 px) | `src/shell/Shell.tsx` | D8 | NS | . | . | . | . | . | . |
| S-17 | Theme toggle (Device, Light, Dark) | `src/pages/ThemeToggle.tsx` | D8, D19 | NS | . | . | . | . | . | . |
| S-18 | Unknown-address fallback and legacy redirects | `src/core/legacy.ts` | all | NS | . | . | . | . | . | . |
| S-19 | Print styles | `src/styles.css` | D19 | NS | . | . | . | . | . | . |
| S-20 | App identity: browser-bar colour, manifest, icons | `src/theme.ts` | D5, D21 | NS | . | . | . | . | . | . |
| S-21 | Shared page pieces: PageHeader, EmptyState, Banner, Stat, Sparkline | `src/ui/components.tsx` | D6 | BLT | Y | Y | . | Y | . | Y |
| S-22 | Pickers and suggestion lists | `src/ui/pickers.tsx` | D6, D15 | NS | . | . | . | . | . | . |
| S-23 | Charts | `src/ui/charts.tsx` | D6, D12, D17 | BLT | . | Y | . | Y | . | . |

S-20 note: D5 deliberately left the browser-bar colour, `index.html` and the manifest alone (the default look is unchanged). When Signature is selected the bar takes the Signature canvas colour at run time; the fixed values move in D21.

### 1.1 D6 evidence behind the marks above, and what was seen on the routed pages (no routed row changed)

Everything below was seen under **Ledger Signature**, in the Claude app's built-in browser, against the fictional D1 demo household (own address, sync off). Screenshots were kept outside the repository.

- **Marks recorded on the surfaces:** `D` = Signature dark, desktop width (about 1280 px); `1440` = the same desktop view (the pane could not be made wider, so 1440 is read as "desktop width", not measured at 1440); `L` = Signature light; `375` = phone width. **S-04** (Add button): navy in light, teal in dark, round on a phone; focus returned to it after the Add box closed. **S-05/S-06/S-08**: opened, Tab kept inside, Escape closed, focus returned to the opener (Add button, Delete account button); in the confirmation Cancel had focus first. **S-09**: seen live in Signature dark on the Tasks page; the Undo path itself was NOT exercised live (the 8-second window passed), so Func stays `.`. **S-10**: the unsaved-data banner on Accounts. **S-21**: gallery and pages in both themes; text and structure pinned by `src/shell/d6Shared.test.tsx`. **S-23**: Reports chart (spending, income) in dark.
- **Routed pages looked at in Signature** (inherited look only, never a redesign): light desktop for Today, Calendar, Tasks, Projects, Home & Assets, Household Services, Bills, Family, Contacts, Ledger Home, Ledger Transactions and Household Finances (all eleven modules); dark desktop for Ledger Transactions, Ledger Accounts, Ledger Reports, Household Finances, Calendar and Family (Family in the older "Deep navy" palette); phone width (375 px) for Tasks, Ledger Transactions and Household Finances. Horizontal-overflow measurement only (no visual check) on 17 addresses at 375 px and 14 at 320 px, light: none overflowed.
- **Not checked:** light mode on Ledger Reports, any page at 320 px visually, Signature dark at phone width, every in-page view and every dialog call site (62), real phones, screen readers, forced-colours mode.

## 2. Routed page destinations (59)

Addresses are written as they appear after `#` in the browser. Ledger pages are under `/ledger`. The guard compares this column with the app's route registrations.

### 2.1 Today, Calendar, Tasks (3)

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| T-01 | `/today` | `src/modules/today/TodayModule.tsx` | D11 | NS | . | . | . | . | . | . |
| C-01 | `/calendar` | `src/modules/calendar/CalendarPage.tsx` | D13 | NS | . | . | . | . | . | . |
| K-01 | `/tasks` | `src/modules/tasks/TasksPage.tsx` | D11 | NS | . | . | . | . | . | . |

### 2.2 Projects, Home & Assets (5)

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | `/projects` | `src/modules/projects/ProjectsPage.tsx` | D14 | NS | . | . | . | . | . | . |
| P-02 | `/projects/:id` | `src/modules/projects/ProjectPage.tsx` | D14 | NS | . | . | . | . | . | . |
| A-01 | `/assets` | `src/modules/assets/OverviewPage.tsx` | D14 | NS | . | . | . | . | . | . |
| A-02 | `/assets/list` | `src/modules/assets/AssetsPage.tsx` | D14 | NS | . | . | . | . | . | . |
| A-03 | `/assets/:id` | `src/modules/assets/AssetPage.tsx` | D14 | NS | . | . | . | . | . | . |

### 2.3 Household Services, Bills & Subscriptions (9)

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| V-01 | `/services` | `src/modules/services/OverviewPage.tsx` | D15 | NS | . | . | . | . | . | . |
| V-02 | `/services/a/:id` | `src/modules/services/ArrangementPage.tsx` | D15 | NS | . | . | . | . | . | . |
| V-03 | `/services/providers/:contactId` | `src/modules/services/ProviderPage.tsx` | D15 | NS | . | . | . | . | . | . |
| V-04 | `/services/v/:id` | `src/modules/services/VisitPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-01 | `/bills` | `src/modules/bills/OverviewPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-02 | `/bills/list` | `src/modules/bills/ListPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-03 | `/bills/upcoming` | `src/modules/bills/UpcomingPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-04 | `/bills/review` | `src/modules/bills/ReviewPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-05 | `/bills/o/:id` | `src/modules/bills/ObligationPage.tsx` | D15 | NS | . | . | . | . | . | . |

### 2.4 Household Finances, Family, Contacts (6)

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| H-01 | `/household` | `src/modules/household/OverviewPage.tsx` | D12 | NS | . | . | . | . | . | . |
| F-01 | `/family` | `src/modules/family/OverviewPage.tsx` | D12 | NS | . | . | . | . | . | . |
| F-02 | `/family/m/:id` | `src/modules/family/MemberPage.tsx` | D9, D15 | NS | . | . | . | . | . | . |
| F-03 | `/family/dates` | `src/modules/family/DatesPage.tsx` | D15 | NS | . | . | . | . | . | . |
| N-01 | `/contacts` | `src/modules/contacts/DirectoryPage.tsx` | D14 | NS | . | . | . | . | . | . |
| N-02 | `/contacts/c/:id` | `src/modules/contacts/ContactPage.tsx` | D14 | NS | . | . | . | . | . | . |

### 2.5 Settings (5)

The Settings frame (heading and tab row) is `src/pages/SettingsPage.tsx`; each row below is one tab.

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| G-01 | `/settings/general` | `src/pages/GeneralSettings.tsx` | D19 | NS | . | . | . | . | . | . |
| G-02 | `/settings/appearance` | `src/pages/AppearanceCard.tsx` | D5, D19 | NS | . | . | . | . | . | . |
| G-03 | `/settings/backup` | `src/pages/BackupPage.tsx` | D19 | NS | . | . | . | . | . | . |
| G-04 | `/settings/sync` | `src/pages/SyncPage.tsx` | D19 | NS | . | . | . | . | . | . |
| G-05 | `/settings/calendar` | `src/modules/calendar/CalendarSettings.tsx` | D19 | NS | . | . | . | . | . | . |

G-02 note: D5 added the Ledger Signature choice (labelled preview) to this screen. The row stays `NS` because the screen itself has not been restyled; the palette builder and saved themes are unchanged.

### 2.6 Ledger (31)

Ledger has 32 route entries and 31 pages. `/ledger/backup` is a redirect to `/settings/backup` (section 7), not a page. `/ledger/sync` and `/settings/sync` are one component at two addresses (L-31 and G-04).

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| L-01 | `/ledger` | `src/pages/HomePage.tsx` | D12 | NS | . | . | . | . | . | . |
| L-02 | `/ledger/checkin` | `src/pages/CheckinPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-03 | `/ledger/accounts` | `src/pages/AccountsPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-04 | `/ledger/account/:id` | `src/pages/LedgerPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-05 | `/ledger/transactions` | `src/pages/TransactionsPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-06 | `/ledger/budget` | `src/pages/BudgetPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-07 | `/ledger/scheduled` | `src/pages/ScheduledPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-08 | `/ledger/forecast` | `src/pages/ForecastPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-09 | `/ledger/reports` | `src/pages/ReportsPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-10 | `/ledger/rules` | `src/pages/RulesPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-11 | `/ledger/import` | `src/pages/ImportPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-12 | `/ledger/categories` | `src/pages/CategoriesPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-13 | `/ledger/networth` | `src/pages/NetWorthPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-14 | `/ledger/investments` | `src/pages/InvestmentsPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-15 | `/ledger/payoff` | `src/pages/PayoffPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-16 | `/ledger/debt` | `src/pages/DebtPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-17 | `/ledger/income` | `src/pages/IncomePage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-18 | `/ledger/taxplan` | `src/pages/TaxPlanPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-19 | `/ledger/giving` | `src/pages/GivingPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-20 | `/ledger/afford` | `src/pages/AffordPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-21 | `/ledger/paycheck` | `src/pages/PaycheckPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-22 | `/ledger/projections` | `src/pages/ProjectionPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-23 | `/ledger/retirement` | `src/pages/RetirementPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-24 | `/ledger/goals` | `src/pages/GoalsPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-25 | `/ledger/protection` | `src/pages/ProtectionPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-26 | `/ledger/roth` | `src/pages/RothPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-27 | `/ledger/more` | `src/pages/MorePage.tsx` | D19 | NS | . | . | . | . | . | . |
| L-28 | `/ledger/review` | `src/pages/ReviewPage.tsx` | D19 | NS | . | . | . | . | . | . |
| L-29 | `/ledger/guide` | `src/pages/GuidePage.tsx` | D19 | NS | . | . | . | . | . | . |
| L-30 | `/ledger/taxpackage` | `src/pages/TaxPackagePage.tsx` | D19 | NS | . | . | . | . | . | . |
| L-31 | `/ledger/sync` | `src/pages/SyncPage.tsx` | D19 | NS | . | . | . | . | . | . |

Dashboard cards (Today 11, Ledger Home 12) are tracked inside T-01 and L-01.

## 3. In-page views (31)

Views share their page's address. Each needs its page's checks plus its own empty and populated state.

| ID | Page | View | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| IV-01 | C-01 Calendar | Month | D13 | NS | . | . | . | . | . | . |
| IV-02 | C-01 Calendar | Week | D13 | NS | . | . | . | . | . | . |
| IV-03 | C-01 Calendar | Work week | D13 | NS | . | . | . | . | . | . |
| IV-04 | C-01 Calendar | Agenda | D13 | NS | . | . | . | . | . | . |
| IV-05 | K-01 Tasks | Today | D11 | NS | . | . | . | . | . | . |
| IV-06 | K-01 Tasks | Upcoming | D11 | NS | . | . | . | . | . | . |
| IV-07 | K-01 Tasks | Overdue | D11 | NS | . | . | . | . | . | . |
| IV-08 | K-01 Tasks | All | D11 | NS | . | . | . | . | . | . |
| IV-09 | K-01 Tasks | By list | D11 | NS | . | . | . | . | . | . |
| IV-10 | K-01 Tasks | By tag | D11 | NS | . | . | . | . | . | . |
| IV-11 | K-01 Tasks | By priority | D11 | NS | . | . | . | . | . | . |
| IV-12 | K-01 Tasks | Waiting | D11 | NS | . | . | . | . | . | . |
| IV-13 | K-01 Tasks | Completed | D11 | NS | . | . | . | . | . | . |
| IV-14 | K-01 Tasks | Deleted | D11 | NS | . | . | . | . | . | . |
| IV-15 | P-01 Projects | Open | D14 | NS | . | . | . | . | . | . |
| IV-16 | P-01 Projects | Finished | D14 | NS | . | . | . | . | . | . |
| IV-17 | P-01 Projects | Archived | D14 | NS | . | . | . | . | . | . |
| IV-18 | P-01 Projects | All | D14 | NS | . | . | . | . | . | . |
| IV-19 | A-02 Assets list | In use | D14 | NS | . | . | . | . | . | . |
| IV-20 | A-02 Assets list | Stored | D14 | NS | . | . | . | . | . | . |
| IV-21 | A-02 Assets list | Past (with sold, disposed, replaced sub-filter) | D14 | NS | . | . | . | . | . | . |
| IV-22 | A-02 Assets list | Archived | D14 | NS | . | . | . | . | . | . |
| IV-23 | A-02 Assets list | All | D14 | NS | . | . | . | . | . | . |
| IV-24 | L-14 Investments | Accounts | D17 | NS | . | . | . | . | . | . |
| IV-25 | L-14 Investments | Realized gains | D17 | NS | . | . | . | . | . | . |
| IV-26 | L-14 Investments | Prices and assumptions | D17 | NS | . | . | . | . | . | . |
| IV-27 | L-20 Afford | Can I afford it? | D18 | NS | . | . | . | . | . | . |
| IV-28 | L-20 Afford | Rent or buy? | D18 | NS | . | . | . | . | . | . |
| IV-29 | L-09 Reports | Trends | D17 | NS | . | . | . | . | . | . |
| IV-30 | L-09 Reports | Flow diagram | D17 | NS | . | . | . | . | . | . |
| IV-31 | P-02 Project detail | Task filter groups | D14 | NS | . | . | . | . | . | . |

## 4. Dialogs and confirmations

### 4.1 Dialogs: `<Modal>` call sites (62 in 41 files)

Each site is a form, a question or a detail view. Counted from the source in D5 (the number below must equal the guard's recorded baseline in `src/shell/uiBaseline.ts`).

| ID | Module | Sites | Files | Phase | Status |
|---|---|---|---|---|---|
| DL-01 | Shell (Add box, Search, ConfirmDialog base) | 3 | `AddBox`, `SearchDialog`, `ConfirmDialog` | D6, D10 | NS |
| DL-02 | Tasks | 3 | `TaskEditor`, `QuickTask`, `ListsDialog` | D11 | NS |
| DL-03 | Calendar | 8 | `EventEditor` (2), `dialogs` (5), `HandoffDialog` | D13 | NS |
| DL-04 | Projects | 3 | `ProjectForm`, `CommitmentForm`, `DeleteProject` | D14 | NS |
| DL-05 | Home & Assets | 7 | `AssetForm`, `AddMaintenance`, `ServiceForm` (2), `WarrantyForm`, `LifecycleDialog`, `DeleteAsset` | D14 | NS |
| DL-06 | Contacts | 2 | `ContactForm`, `RemoveContact` | D14 | NS |
| DL-07 | Household Services | 13 | `ArrangementForm`, `Dialogs` (3), `PaymentUI`, `ProviderPage`, `S4Dialogs` (4), `VisitDialogs` (3) | D15 | NS |
| DL-08 | Bills & Subscriptions | 17 | `ObligationForm`, `Dialogs` (3), `CycleDialogs` (2), `LifecycleDialogs` (2), `PaymentUI`, `RepairDialogs` (2), `ScheduledUI` (3), `ContractCard` (2), `DiscoverCard` | D15 | NS |
| DL-09 | Family | 3 | `MemberForm`, `DateForm`, `ImportantContacts` | D9, D15 | NS |
| DL-10 | Ledger pages | 3 | `LedgerPage`, `ScheduledPage`, `TxnDeleteDialog` | D16 | NS |
| | **Total** | **62** | 41 files | | |

Inline (non-modal) forms in Ledger pages (transaction form, income setup, scenario editors, loan forms) are covered by their page rows.

### 4.2 Confirmation styles

| ID | Style | Sites | Phase | Status |
|---|---|---|---|---|
| CF-01 | Shared `ConfirmDialog` (`RemoveContact`, `DatesPage`, `ImportantContacts`, `MemberPage`, `BackupPage`, `LedgerPage`, `SyncPage` x2) | 8 in 7 files | D6 | NS |
| CF-02 | Bills-local confirm component (`src/modules/bills/LifecycleCard.tsx`) | 1 | D15 | NS |
| CF-03 | **Browser-native `confirm()`**: cannot be styled; replacing it changes behaviour (decision OD-6, gated, D20) | 37 in 24 files | D20 | NS |

### 4.3 Pop-overs and suggestion lists (5)

Module switcher list (S-02), Sync status pop-over (S-03), Calendar layer menu (`src/modules/calendar/LayerMenu.tsx`, D13), picker pop-ups and payee suggestions (S-22).

## 5. Named workflows (37)

A workflow is accepted when its pages and dialogs are accepted and the flow check for it has passed.

| ID | Workflow | Phase | Status |
|---|---|---|---|
| W-01 | Quick Add: typed shortcut, preview, Add (Task, Event, Project, Asset, Service, Household service, Bill or subscription) | D10 | NS |
| W-02 | Quick Add: Transaction (Ledger's form with its own Save) | D10 | NS |
| W-03 | Quick Add: Scheduled payment (opens `/ledger/scheduled`) | D10 | NS |
| W-04 | Quick Add: Family member, Family date (open Family's own forms via `?add=`) | D10 | NS |
| W-05 | Quick Add specialised actions: Log a trade, New paycheck scenario | D10 | NS |
| W-06 | Global search (Ctrl/Cmd+K, `/`) and its 7 actions | D6 | NS |
| W-07 | Add-a-task dialog (from search or `requestTask`) | D11 | NS |
| W-08 | Module switching, "open where I left off" landing | D7 | NS |
| W-09 | Calendar events: create, edit, delete, repeating-event scope | D13 | NS |
| W-10 | Calendars manager, layer menu, .ics export | D13 | NS |
| W-11 | Calendar event handed to Ledger as a scheduled item | D13, D16 | NS |
| W-12 | Tasks: create, edit, complete, bulk select, lists | D11 | NS |
| W-13 | Today: edit layout, hide amounts | D11 | NS |
| W-14 | Monthly check-in | D16 | NS |
| W-15 | Transactions: add, edit, split, reconcile, bulk category, delete with dependency check | D16 | NS |
| W-16 | CSV import and undo import | D16 | NS |
| W-17 | Scheduled items: create, post, skip, delete recurring | D16 | NS |
| W-18 | Rules and detect-recurring | D16 | NS |
| W-19 | Budget assign, targets, reorder | D16 | NS |
| W-20 | Trades, lots, prices, realized gains | D17 | NS |
| W-21 | RSU grants and vest schedule | D18 | NS |
| W-22 | Income setup per person, HSA log, paycheck scenarios | D18 | NS |
| W-23 | Planning calculators: tax plan, afford, projections, retirement, Roth, giving, protection, goals | D18 | NS |
| W-24 | Loans and payoff | D17 | NS |
| W-25 | Net-worth valuations and snapshots | D17 | NS |
| W-26 | Documents: Year in review, If something happens guide, Tax package (print and export) | D19 | NS |
| W-27 | Backup and restore (plain and encrypted), auto-backup | D19 | NS |
| W-28 | Device sync set-up and conflicts | D19 | NS |
| W-29 | Appearance: palette, custom palette builder, saved themes | D5, D19 | NS |
| W-30 | General and Calendar settings | D19 | NS |
| W-31 | Projects: create, edit, delete (plan), budget lines, commitments, vendors | D14 | NS |
| W-32 | Assets: add, maintenance, service, warranty, lifecycle, delete | D14 | NS |
| W-33 | Household Services: arrangements, visits, payments, schedule changes, contract dates, hand-offs | D15 | NS |
| W-34 | Bills: add/edit, periods and payments, lifecycle, discovery, review list, links | D15 | NS |
| W-35 | Family: member add/edit (contact choice, colour), dates, important contacts, removal | D9, D15 | NS |
| W-36 | Contacts: add/edit/remove, where used | D14 | NS |
| W-37 | Household Finances review: period, disclosures, hide amounts | D12 | NS |

W-29 note: D5 added the Signature choice to Appearance and left the rest of the flow untouched; the flow is re-accepted in D19.

## 6. Residue baseline (report only)

Measured by `src/shell/uiBaseline.ts` at commit `8ab1789` plus the D5 change. The aim is for them to go **down**; `src/shell/uiResidue.test.ts` prints each count against this baseline on every run and **never fails** because one moved (D5 release correction). The targets are the D4 roadmap (section 7) and are reached phase by phase, not in D5.

| Measure | D4 baseline | D5 measured | D6 measured | Target |
|---|---|---|---|---|
| Static inline `style={{` (non-test screens) | 307 in 83 files | 307 in 83 files | 308 in 84 files (one data-driven bar width in `Figure.tsx`) | only data-driven values |
| Raw `border-radius` pixel values in CSS (including 999px pills) | 67 | 67 | 69 (two in the new stylesheet: a 4px bar, a 2px sheet handle) | 0 outside token files and chart geometry |
| Raw `font-size` px or rem values in CSS | 36 | 36 | 38 (two date-tile day sizes in the new stylesheet) | tokens only |
| Font sizes below 12 px (px only / px and rem) | 9 | 9 / 11 | 9 / 11 | none except the date-tile label |
| Hex colours in CSS | 152 | 152 | 150 | only palettes and chart sets |
| Hex colours in module CSS | 56 | 56 | 56 | 0 |
| Own `<h1>` instead of `PageHeader` (files) | 13 | 13 | 13 | listed exceptions only |
| `className="card…"` uses | 395 | 395 | not re-measured | n/a (restyled in place) |
| Browser-native `confirm()` calls | 37 in 24 files | 37 in 24 files | 37 in 24 files | 0, or owner-accepted list (OD-6) |
| `<Modal>` sites | 62 in 41 files | 62 in 41 files | 62 in 41 files | not above 62 |
| `!important` | 11 | 11 | 11 | not above 11 |

Discrepancies found while re-measuring (none changed the baseline): D4's "9 font sizes below 12 px" counts `px` values only; the two further `rem` values (0.7rem and 0.68rem) make 11. D4's "37 confirm()" counts calls with a message; the source also has five local functions named `confirm` (not the browser's) which are not counted.

## 7. Aliases and redirects (not pages)

1. `/ledger/backup` redirects to `/settings/backup`.
2. `/settings/<anything else>` redirects to `/settings/backup`.
3. In Assets, Bills, Contacts, Family, Household, Projects and Services an unknown sub-address shows the module's first page; in Ledger it shows Home; Today, Calendar and Tasks have a single screen.
4. Old addresses from before modules (for example `#/budget`) forward to the owning module (`src/core/legacy.ts`).
5. An address with no module opens the landing module (Settings > General choice, else the last module used).

## 8. Not authorised (kept out of every phase)

Family "This week by person"; a per-row Tasks menu; Household Finances overlap markers; a Household Services block on Today; milestone flag icons on Tasks; new derived Ledger figures and per-member counts (OD-9); Quick Add personalisation or new shortcuts; "used by" badges on Family swatches; member colours in Tasks, Calendar or Today rows; Ledger phone navigation redesign (OD-2); wording changes (OD-7); a tablet command centre.

## 9. Keeping this file complete

- Adding a page: add its row to section 2 in the same change, or `src/shell/uiCoverage.test.ts` fails.
- How the guard finds routes (and what it cannot): Ledger pages come from the registry list `LEDGER_ROUTE_PATHS`; every other module's addresses are declared in the test as an explicit list and checked against the `<Route path>` lines of the eight files that declare them. A tenth file that declares routes fails the guard. Today, Calendar and Tasks have no sub-routes. Query-string states (`?new=1`, `?add=member`) and views inside a page are not routes and are tracked in section 3.
- Final sweep (D21): every ID opened in both themes at 375 and 1440 against fictional demo data; the roll-up must read 59/59, 23/23, 31/31.
