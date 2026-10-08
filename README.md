# Ledger

A personal finance and investment planning app that runs entirely in your browser. Your data is stored on your device (in the
browser's local database); there is no server and no account, and nothing is sent anywhere except an optional market-price lookup
to Twelve Data using your own key.

## What it does

| Tab | Purpose |
|---|---|
| **Accounts** | Checking, savings, and credit cards with starting balances; ledger with categories, splits, pending/cleared/reconciled; transfers (a card payment entered from either side creates the matching entry); reconcile to a statement |
| **Budget** | Envelope ("every dollar has a job") budget: Ready to Assign, rollover, overspending rules, credit-card payment lines, funding for existing card debt |
| **Income** | Salary, bonuses (entered by month), 401(k) pre-tax/Roth, employer match, HSA/FSA/ESPP and other deductions, with annual caps applied paycheck by paycheck; federal (married filing jointly) and Massachusetts tax vs withholding |
| **Investments** | Brokerage, IRA, 401(k), and 529 accounts with holdings, per-holding asset class, allocation, and optional price refresh |
| **Projections** | Long-term growth with contributions: steady-return path and Monte Carlo ranges, today's or future dollars |
| **Retirement** | Does the money last? Spending vs savings, other income, windfalls, sustainable spending |
| **Goals** | Contribution needed for goals like college (529) |
| **Scheduled** | Recurring items that you approve before they post |
| **Import** | CSV import with duplicate protection and undo |
| **Backup** | Encrypted export/restore |

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
