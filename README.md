# Ledger

A personal finance and investment planning app that runs entirely in your browser. Your data is stored on your device (in the
browser's local database); there is no server and no account, and nothing is sent anywhere except an optional market-price lookup
to Twelve Data using your own key.

## What it does

**Finding your way around.** On a computer there is a sidebar with five groups: **Home** (net worth, what needs attention, coming-up dates, this month, recent activity), **Money** (Accounts, Transactions, Budget, Scheduled, Forecast, Reports, Rules, Import, Categories), **Invest** (Net worth, Investments, Payoff, Debt), **Plan** (Income, Tax planning, Paycheck, Projections, Retirement, Goals, Protection, Roth), and **More** (Settings, Year in review, If something happens, Tax package, Backup). Click a group's name in the sidebar to collapse or expand it. On a phone the same five groups are a tab bar at the bottom, with each group's pages as a scrolling row at the top. The Home screen's "Coming up" card lists key dates (RSU vests, tax payment deadlines, required distributions, bills, loan payments) and can download them as a calendar file for your phone. Press **Ctrl+K** (or **/**) to search pages, accounts, holdings, loans, and transactions from anywhere, and use the **+** button to add a transaction or jump to logging a trade.

| Page | Purpose |
|---|---|
| **Accounts** | Checking, savings, and credit cards with starting balances; ledger with categories, splits, pending/cleared/reconciled; transfers (a card payment entered from either side creates the matching entry); reconcile to a statement |
| **Transactions** | Every transaction from every account in one place: filter by account, date range, category, payee/memo, and amount (greater than, less than, between), sort by any column, edit or delete rows, bulk-change category/status, export the filtered list to CSV, and save filters |
| **Budget** | Envelope ("every dollar has a job") budget: Ready to Assign, rollover, overspending rules, credit-card payment lines, funding for existing card debt |
| **Income** | Salary, bonuses (entered by month), RSU vests (cash at a set price, or tied to a stock with held/sold choice), 401(k) pre-tax/Roth, employer match, HSA/FSA/ESPP and other deductions, with annual caps applied paycheck by paycheck; federal (married filing jointly) and Massachusetts tax vs withholding |
| **Forecast** | Cash-flow forecast: your checking and savings balance day by day for up to two years, from paychecks, scheduled bills, loan payments, taxes due or refunds, one-off items, and an estimate of everyday spending; warns when cash would dip below a level you set |
| **Reports** | Spending reports: monthly totals, saving rate, category trends and comparisons (vs last month, last year, the 3-month average), what jumped, and top payees, with CSV export |
| **Payoff** | Debt payoff planner: minimum vs avalanche vs snowball across your cards and loans, a refinance break-even calculator, and extra mortgage payments vs investing |
| **Protection** | Emergency-fund runway and rough guidelines for life, disability, and umbrella insurance against policies you enter (including employer coverage) |
| **Year in review** | One printable page: net worth change, income and spending, saving, taxes, investing, debt, and plain-language highlights |
| **If something happens** | A printable guide for your family: contacts, where papers are, your accounts, loans, property, insurance, and bills, and first steps. Never put passwords in it |
| **Net worth** | Net worth now and by month (a point is saved automatically each month), with your home and other property (values you enter, with history and equity against your mortgage/HELOC) |
| **Tax planning** | Year-end dashboard: projected federal/MA tax, bracket room, withholding vs. what you will owe (with extra-withholding or estimated-payment suggestions and a safe-harbor check), tax-loss harvesting from your lots with the tax saved, and a before-December-31 checklist |
| **Rules** | Payee rules that categorize (and rename) transactions on import and in quick add, rules the app suggests from your history, and repeating charges it notices that you can add to Scheduled |
| **Tax package** | A worksheet for your tax preparer: pay and withholding, RSU income, sales by lot (like Form 8949), HSA activity, mortgage interest, and the app's estimate. Print or save as PDF, or download each table as CSV |
| **Paycheck** | Paycheck calculator: copy a person's Income setup (or start blank), change salary, bonuses, and deductions, see one paycheck gross-to-net and the whole year, save scenarios and compare them side by side. Never changes your real setup |
| **Investments** | Brokerage, IRA, 401(k), HSA, and 529 accounts with an owner, holdings, per-holding asset class, allocation, and optional price refresh. Taxable accounts track tax lots: edit cost basis and purchase dates, log buys and sales (choose FIFO, highest cost, average cost, or specific lots), and see realized gains by year, which feed the Income tab's tax estimate. HSAs log qualified and non-qualified withdrawals |
| **Projections** | Long-term growth with contributions: steady-return path and Monte Carlo ranges, today's or future dollars |
| **Retirement** | Does the money last? Spending vs savings, other income, windfalls, sustainable spending |
| **Goals** | Contribution needed for goals like college (529) |
| **Roth** | Roth conversion planner: compares strategies (fill a bracket, fixed amounts, your own table, with optional IRMAA and ACA-cliff limits) using exact yearly federal and MA taxes, Social Security taxation, RMDs, Medicare IRMAA, and the ACA credit; ranks them by lowest lifetime cost, most money left, and best for heirs; simulated futures show how often the money lasts |
| **Debt** | Mortgage, HELOC (interest-only draw period then payback), and other loans: amortization schedules, extra principal in any period, rate changes and what-if rate shocks, new/what-if loans, and an optional link to your ledger that splits payments into principal and interest |
| **Scheduled** | Recurring items that you approve before they post |
| **Import** | CSV import with duplicate protection and undo |
| **Backup** | Encrypted export/restore |

Under **More, Settings** you can choose Light / Dark / Device and a color palette (Calm teal, Deep navy and gold, Forest green and stone, Slate and indigo, or your own colors picked from a color map, with warnings if text would be hard to read). Both are remembered on each device. Sections on the Income, Transactions, and Debt screens can be collapsed, and the app remembers what you collapsed on each device.

Everything is a planning aid, not tax, legal, or investment advice. Return assumptions are yours to set and are not predictions.

## Running it on your computer

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # production build into dist/
```

## Putting it on your phone (GitHub Pages)

The app is a static site, so GitHub Pages can host it for free, and your phone can then install it to the home screen.

1. **Create the repository** at github.com (New repository). GitHub Pages on a free account requires the repository to be **public**.
   That is safe here: the repository holds only the program's code and public tax tables. Your data never goes in it
   (the `.gitignore` also excludes backups and CSV files, as a precaution).
2. **Push the code** from this folder, replacing `YOUR-NAME/YOUR-REPO`:

   ```bash
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
   git push -u origin main
   ```

   Git will ask you to sign in the first time. Do that in the window it opens; never paste a password or token into a chat.
3. **Turn on Pages**: on GitHub open the repository, then **Settings, Pages**, and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. The "Deploy to GitHub Pages" workflow runs the tests, builds, and publishes. When it finishes, your
   address is `https://YOUR-NAME.github.io/YOUR-REPO/`.
5. **Install on your phone**: open that address in the phone's browser. On iPhone use Safari, Share, **Add to Home Screen**. On
   Android use Chrome, menu, **Install app** (or Add to Home screen).

### Important things to know about phone use

- **Each device has its own data.** Data entered on your computer does not appear on your phone, and vice versa. To move it, export an
  encrypted backup on one and restore it on the other (Backup tab). A restore replaces everything on that device.
- **Back up regularly.** Clearing browser data or uninstalling the browser deletes the data. The Accounts tab reminds you when your
  last backup is more than 30 days old. Keep your backup passphrase somewhere safe; it cannot be recovered.
- **Offline use** works after the first load.
- **Anyone can open the published address**, but they would see an empty app: the data is only in your own browser. Lock your phone.

## Every January: update the tax tables

The Income tab calculates nothing for a year without tax tables (it does not guess). Federal, Social Security, 401(k), HSA/FSA, and
Massachusetts figures for **2026** are built in. For a new year, open **Income**, pick the year, choose **Start from 2026 tables**, and
update the numbers (amounts are in cents). Sources: IRS (inflation-adjustments release and the retirement-plan limits notice), SSA
(contribution and benefit base), Massachusetts DOR (personal income tax rates and Form 1 instructions), and Massachusetts DFML
(paid family and medical leave rates). Items marked UNVERIFIED in the notes could not be confirmed from an official source; check them.

The Roth planner has its own rules in `src/data/retirementTax.ts` (capital-gains thresholds, IRMAA tiers, ACA credit, RMD table, senior deduction). Check them each year too; they scale with your inflation assumption in later years, but the law can change.

## Price data (optional)

Investments, Prices. Create a free account at twelvedata.com, copy the API key, paste it in, and click Refresh prices. The key stays on
the device, is never included in backups, and is sent only to twelvedata.com. Without it you can type prices in by hand.

## Project layout

```
src/lib/        calculation engines (budget, payroll/tax, projections, Monte Carlo, retirement, goals) and their tests
src/data/       tax tables by year
src/pages/      the screens
public/         web app manifest, service worker (offline), icons
scripts/        icon generator (npm run icons)
.github/        GitHub Pages deployment workflow
```

Data model changes use versioned database migrations (`src/db.ts`) so existing data upgrades in place, and backups from older
versions still restore.
