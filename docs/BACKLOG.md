# Change backlog (from the owner's first-use notes)

**Working rule (still in effect for NEW notes):** collect notes tab by tab, ask clarifying questions up front, and wait for the owner's go-ahead before building.

Status key: `[ ]` not started, `[x]` built.

## STATUS 2026-10-29 (newest): RSU vests left out of budgeting income BUILT ("go"), pushed

Verified with 798 automated tests (2 new: pay by month without vests, and the Forecast per-person switch), a type check and a production build, plus a browser check with invented people and vests (since removed). Checked: the Budget page's projected take-home fell from $27,464 to $14,486 for a month with two vests (paychecks only), and on the Forecast page switching each person's vests off lowered "Money in" by that person's vests, one at a time. NOT checked: a month with a bonus by eye, dark mode and the other colour palettes, phone width.

Judgment calls (please review):
1. **Budget page:** projected take-home and the paycheck count now exclude vests. Wording otherwise unchanged and no note about vests. Ready to Assign, Home and Reports are untouched (they only count what you enter).
2. **Forecast page:** under Assumptions, one tick box per person who has vests: "Count NAME's stock vests as cash coming in". Ticked (the starting value) keeps today's behavior; unticked removes that person's vests from cash coming in. Paychecks and bonuses always stay. Shares you keep stay out as before.
3. **Taxes on the Forecast** (tax due or refund next spring) still include the vest income, because the tax is real whether or not you budget the cash.
4. The switch is saved with the other Forecast settings, so it follows your devices if you sync. Older saved settings work unchanged.
5. The Income page and the money-flow diagram still show vests (they report real pay).

Not built: a switch for the Budget page, a way to ignore a single grant instead of a whole person.

---

## STATUS 2026-10-29: expandable split transactions BUILT ("go"), not committed

Verified with 796 automated tests (unchanged: this is screen-only), a type check and a production build, plus a browser check with an invented split (since removed): account page and Transactions tab at desktop width, Transactions tab at 375px (no sideways scroll). Checked: opening and closing, the amounts lining up under Category and Amount on desktop, a phone list of category and amount. NOT checked: phone view of an account page by eye, dark mode and the other colour palettes, keyboard use.

Judgment calls (please review):
1. **The toggle** is the Category text itself (e.g. "▸ Split: Rent / Mortgage, Utilities"). On phones, where Category is hidden, a "Show split amounts" link sits under the payee.
2. **Open state** is remembered only while you stay on the page; it resets on leaving, and a filter or sort change keeps rows open.
3. **Opening a row** does not affect selection, sorting or totals. The parts always add up to the row amount shown above them.
4. Transfers and ordinary rows have no arrow.

Not built: per-part notes (parts have none), expand all / collapse all.

---

## STATUS 2026-10-29: Amount filter box right-aligned BUILT (after a yes), not committed

Ask: in the Amount filter box under the column header, the placeholder text ("45 or >100") is left-aligned, but the Amount header and amounts are right-aligned. Right-align the box's text (placeholder and what you type) so it lines up with the header and data.

Applies to: the Amount box on the Transactions tab and on account pages (a small style change; the phone block above the list is unchanged).

Verified in the browser on the Transactions tab (the box and the header both report right alignment) and the existing 796 tests are unaffected (style only). Judgment call: only the Amount box changed; Date, Payee and Category stay left-aligned like their data. NOT checked: account page by eye, phone width, dark mode.

---

## STATUS 2026-10-29: account filters, column boxes and Reconcile move BUILT ("go"), pushed

Verified with 796 automated tests (6 new, for the column boxes), a type check and a production build, plus a browser check with invented data (since removed): an account page and the Transactions tab at desktop width, and the Transactions tab at 375px (no sideways scroll). Checked: typing "logan" under Payee, "45" under Amount (finds $45.00 and $45.82, not $145.99), "2026-04" under Date, the true running balance staying put while filtering, Reconcile in its new spot. NOT checked: dark mode and the other colour palettes, a real phone touch, the Filters panel and chips on an account page by hand (same component as the Transactions tab), and an account page at 375px after the final styling fix.

Judgment calls (please review):
1. **Boxes** are under Date, Payee, Category and Amount. On the Transactions tab there are no boxes for Account or Status (Account is in the toolbar; Status is in Filters).
2. **Category box** matches the text shown in the column, so it also finds splits ("Split: Groceries, Dining Out") and transfers ("↔ Checking").
3. **Date box:** a 4-digit number is the year; otherwise month, then day ("03/15"). A lone "03" matches month 03 (and day 03 if no year was typed). A lone "0" is ignored until the next digit. Month names ("March") are not understood.
4. **Amount box:** "45" matches whole dollars exactly ($450 does not match). "45.8" matches $45.80 to $45.89. Ignores minus signs, $ and commas. Also understands >100, <50, >=100, <=50 (size of the amount).
5. **Account pages** got a search box, a date range menu, the Filters button and panel, chips, and a "Showing X of Y" note. No saved filters there. Balance column keeps the true running balance; the top Balance/Cleared/Pending figures and Reconcile are not affected by filters.
6. **On phones** the table header is hidden, so the four boxes appear as a small block above the list.
7. **Reconcile** moved up on account pages (under the credit-left box, above Add transaction; for accounts with no credit box it follows the Possible transfers box).
8. Saved filters from before still load (the new boxes simply start empty); saved filters do remember the column boxes from now on.
9. Column box text is not kept when you leave the page (same as the other filters).

Not built: boxes for Account/Status, month names in the Date box, remembering filters between visits.

---

## STATUS 2026-10-29: assets/liabilities bar chart with a net worth line BUILT ("go"), pushed

Verified with 790 automated tests (3 new, for the chart numbers), a type check and a production build, plus a browser check with invented data on Home and the Net worth page at desktop width and 375px (no sideways scroll). Checked: stacked bars, the net worth line, hover values (the parts add up to the total), a total-only past point, and the label spacing on a narrow card. NOT checked: dark mode and the other colour palettes, a real phone touch, keyboard arrow keys on the chart.

Judgment calls (please review):
1. **Same chart on both screens.** Home shows the last 12 months; the Net worth page shows up to the last 60. It replaces the old plain line on Home and the old three-line chart on the Net worth page.
2. **Colours:** up bars are cash (blue), investments (green), property (purple); down bars are credit cards (pink) and loans (orange). The net worth line is dark. Colour is never the only signal: hovering lists every amount.
3. **A month with only a total** (a past point you typed in) shows as a dot on the line with no bars, and its hover says "Total only".
4. **A negative cash, investments or property figure** is left out of the bars (the net worth line still counts it).
5. **Net worth page table:** the single "Debts" column is now separate "Cards" and "Loans" columns.
6. **The chart redraws at the card's real width**, so labels stay readable instead of shrinking on phones. Month labels thin out when space is tight.
7. The old Home trend line piece (`Sparkline`) is no longer used on Home.

Not built: choosing a time period, entering a past point part by part, a "last 12 months / all" switch on the Net worth page.

### Decisions it was built from (originally queued 2026-10-29)

Ask: on Home, show assets as upward bars and liabilities as downward bars, with net worth as a line on top. On the Net worth page, break the history out and track it the same way (cash, investments, property, cards, loans).

Today: Home shows a bare line of total net worth (monthly snapshots, no axes). The Net worth page has a three-line chart (net worth, assets, debts) that only appears once two months are saved.

Decisions:
1. Bars are stacked by type: up = cash, investments, property; down = credit cards and loans (each its own colour).
2. The chart has month labels, a dollar scale, and hover/tap values.
3. Both screens use the same chart. The Net worth page's table of saved points keeps its columns, with cards and loans shown separately.
4. No database change: snapshots already store cash, investments, property, cards and loans separately.
5. To settle while building: the Net worth page's "Add a past point" only records a total (the parts are saved as zero), so those points would show as a net worth dot with no bars. Expected: show them that way, and offer parts-by-part entry as a later option. Also what the chart shows with fewer than two months saved (expected: the same hint text as today).

## STATUS 2026-10-28 (newest): customizable Home page with charts BUILT ("go"), awaiting your review (not committed)

Verified with 787 automated tests (9 new, for the layout rules and the chart numbers), a type check and a production build, plus a browser check with invented data: desktop (two columns) and 375px (one column, no sideways scroll). Checked: every chart drawing, Edit Home, moving a card, removing a card (and it appearing under "Add a card"), making a card wider and saving it across a reload. NOT checked: dark mode and the other colour palettes, a real phone touch, and the Reset to default button (simple, covered only by the default-layout test).

Judgment calls (please review):
1. **Default layout:** same cards as before in a two-column grid (one column on phones), with the four new chart cards added. Get started is full width at the top and hides itself when finished or dismissed.
2. **Net worth card** now shows the number and trend only; the cash/investments/property/cards/loans figures moved to the new "What you own and owe" card (ring of assets, plus a bar of what is owed against them). The "add your home's value" hint was dropped.
3. **"This month"** (October and so on) replaces the text figures with Income and Spent bars, plus Ready to assign.
4. **Budget progress** shows the six most used-up categories. A category with spending but no money set aside shows as full red ("none set aside"). Card payment lines are left out. Bars turn amber past 85% and red when overspent.
5. **Income vs spending** is the last six months, same rules as the existing month figures (transfers and the "Initial setup" category left out).
6. **Spending by category** shows the top five plus "Other".
7. **Check-in** is a progress ring; **Goals** are bars by how many years away each starts (longer = further out). Goals have no cost or funding shown here because the Home card never had it.
8. **Needs attention, Recent transactions and Coming up** stay as lists. Coming up on Home no longer shows the calendar download link or footnote (still on its own use elsewhere, if any).
9. **Editing:** "Edit Home" in the page header. Arrows reorder, a wider/narrower button (computer screens only), Remove, and an "Add a card" row; "Reset to default" restores everything. Cards that are not showing right now (finished setup, no check-in) appear greyed in edit mode so you can still move or remove them.
10. **Saved on this device only** (browser storage); nothing synced, no backup change. Clearing site data resets it. Cards added in a future version will appear under "Add a card", not automatically.

Not built: drag and drop, per-chart settings (period, number of categories), chart tooltips on hover, a synced layout.

### Decisions it was built from

Ask: make Home a set of cards you can add, remove and reorder, and use more visuals and less text.

Decisions:
1. Editing: an "Edit Home" mode. Each card gets move up/down, half/full width, and remove; an "Add card" picker lists the cards not on the page. Arrows, no drag and drop (works the same on phone and desktop).
2. Saving: per device (browser storage), not synced. No database change, backup or sync work. A "Reset to default" button restores today's layout.
3. New chart cards: spending by category (this month), budget progress bars (spent vs budgeted, overspent in red), income vs spending (last 6 months), net worth breakdown (cash / investments / property / debts). Charts are hand-drawn SVG like the existing ones (no chart library).
4. Less text: lists become visuals (Top categories, net worth parts, goals, check-in as rings and progress bars). Needs attention and Coming up stay as short lists because they are action items.
5. Existing cards (net worth, month summary, recent transactions, check-in, goals, needs attention, coming up, get started) all become cards in the same system.
6. To settle while building: default order (expected: today's layout with the new charts added below), and what an empty chart shows when there is no data.

## QUEUED 2026-10-26: reconciled / not reconciled badges on the Accounts list (decisions made, waiting for "go")

Ask: on the main Accounts page (Money > Accounts), mark each account as reconciled or not.

Decisions:
1. Meaning: green "reconciled" when no transaction dated today or earlier is still pending or cleared (all are locked as reconciled, or there are none). Amber "N to reconcile" otherwise. Uses existing statuses; no database change, no sync/backup work.
2. Look: a coloured badge with words beside the account name, like the existing "primary" and "closed" badges. No row tint.
3. Scope: checking, savings, and credit cards that are open. Loans and closed accounts get no badge.
4. To settle while building: whether transactions before an account's "as of" date count (the app treats them as already in the starting balance, so expected: they do not), and how future-dated transactions are handled (expected: ignored until their date).

## STATUS 2026-10-26 (newest): visual redesign across the whole app BUILT, awaiting your review (not committed)

Ask: a calmer, less clunky look and better navigation, from a design brief. Verified with 778 automated tests (none new; presentation only), a type check and a production build, plus a browser check with invented data at desktop and 375px, light and dark, of Home, Transactions, Budget, Accounts, an account ledger, Income, Reports, Forecast, Investments, More, and a no-sideways-scroll check of all 32 pages at 375px. NOT checked: every page's every state, a real phone keyboard or touch, 768px width.

Judgment calls (please review):
1. **One design system** (`src/ui/tokens.css`, `src/ui/components.tsx`, `src/ui/Toast.tsx`, plus `src/styles.css`): six type sizes, 4px spacing, two corner sizes, three shadows, one control height (40px, 44px on phones). Your palettes and saved themes still drive the colors.
2. **Contrast:** Classic's blue, amber and dark-mode button text were slightly darkened to pass AA. Other palettes are unchanged.
3. **Every page has the same header** (title, one-line description, main action on the right). Pages that had a long explanation keep it under a collapsed "About this page". Only Accounts, Transactions and Budget-style pages got a real primary action; the rest have none or their old year/print controls.
4. **Sidebar** stays collapsible (your choice) but opens the group of the page you are on. Headings are larger and fully readable.
5. **Add** is a top-bar button on desktop and a round button on phones, kept clear of content. Ctrl K also runs actions.
6. **Home** is a dashboard: net worth with trend line, needs attention, then cards. "Quick links" removed. The first-run list is a dismissible card. The low-cash alert now needs a checking or savings account.
7. **Transactions and account ledgers:** two-line rows on phones, sticky headers, filters behind a Filters button with removable chips. Filters open as a panel, not a pop-up. Bulk status change has Undo; deletes still ask first.
8. **Budget:** every group's table shares column widths and a sticky header.
9. Fields and buttons are taller everywhere; content is up to 1120px wide.

Not built: Undo for deletes and bulk category changes; shared column widths on other tables (Debt, Investments holdings); a loading skeleton on pages other than Transactions; a rework of each page's internal layout (forms keep their old order).

## STATUS 2026-10-26: "Refresh prices" button on the Investments > Accounts subtab BUILT ("go")

Verified with 778 automated tests (none new; the change is layout and wiring) and a browser check (desktop and 375px, no sideways scroll). Checked: the button next to the "Accounts" heading, the no-key message, and the link jumping to Prices & assumptions. NOT checked: a real price lookup, because no Twelve Data key was available in the test browser. The button runs the same code as the existing one, so I expect it to behave the same, but I did not see it fetch.

Judgment calls (please review):
1. **Placement:** right of the "Accounts" heading, above the account list.
2. **Same action as before:** one shared refresh, same messages, greyed out while running. The message appears under the heading. It is shared with the Prices & assumptions page, so the same status text shows on both.
3. **No key:** "Save your API key first." plus a "Go to Prices & assumptions" link. That link changes the remembered tab for the Investments page, like clicking the tab yourself.
4. The old button on Prices & assumptions stays.

Not built: a "prices as of" date next to the button.

## STATUS 2026-10-24 (newest): move a transaction's account, keystroke-style amounts, primary payment account BUILT ("go")

Verified with 778 automated tests (21 new) and a browser check (desktop and 375px) using invented data: real keystrokes 1, 2, 4, 5 gave 0.01, 0.12, 1.24, 12.45; Backspace; saving with Enter; Quick add starting on the primary account; moving an ordinary, a reconciled, and a transfer transaction; the same-account error; the Settings switch off and on. NOT checked: typing on a real phone keyboard (the entry reads the whole text of the box, not individual keys, to work with phone keyboards, but I could only test with a computer keyboard).

Judgment calls (please review):
1. **Account on edit:** an "Account" box on the edit form (ledger and the all-transactions page). Offers open non-loan accounts plus the one it is on now. The Type labels (Charge, Inflow and so on) follow the chosen account's kind. Everything else on the transaction stays, and balances, budget, and reports follow because they read the transactions.
2. **Transfers:** either side can move. Both payees are renamed to name the right accounts ("Transfer to Test Savings"). Putting both sides on one account is refused. A transfer made in the same edit is set up against the new account.
3. **Reconciled:** a warning shows on the form and a confirmation is asked on Save. The moved entry goes back to Cleared (for a transfer, only the side that moved; the other side keeps its status because its own account's balance did not change).
4. **Imported transactions:** a moved one keeps its bank id and duplicate check, so importing the same file into the old account does not add it again. It is no longer tied to the import batch, so undoing that import will not delete an entry that now lives on another account. It also means the same bank row imported into the NEW account would not be recognised as a duplicate.
5. **Keystroke amounts:** digits shift in from the right, Backspace removes the last, with thousands commas (1,200.50). A typed decimal point or minus sign is ignored (1, 2, ., 4, 5 still gives 12.45, but typing 12.5 gives 1.25, so with this on, type the cents). Pasting a whole amount (12.45 or $1,200.50) works. The inflow/outflow choice stays separate. It is a per-device switch in More (default on), applies to the amount boxes in add, edit, Quick add and split amounts, and nothing else. Editing an existing transaction shows its amount in the box; typing a digit shifts it left, so clear it with Backspace first.
6. **Primary account:** "Make this my primary payment account" on the account's page (with a "primary" badge on the Accounts list); shared between devices and in backups. Quick add starts on it; with none set (or if it is closed or deleted) it falls back to the account you used last, then the first, as before. Loans and closed accounts cannot be primary.

Not built: a primary choice per device, and keystroke entry for other money boxes (budget, loans, and so on).

## STATUS 2026-10-21: Investments tab: accounts start collapsed, Add account moved up BUILT

Checked in the browser (desktop and 375px): order, collapsed on load, expanding, no sideways scroll. No new automated tests (layout only); the existing 757 still pass.

Judgment calls (please review):
1. **Collapsed:** each account shows its name, type, owner, and total, with "show" to open it (holdings, cash, buy and sell). It starts collapsed every time the page opens; opening one is not remembered. The uninvested cash box and "Invested" figure are inside the opened account, so they are hidden until you open it.
2. **Add account** now sits right under the allocation chart, above the Accounts list.
3. Not built: a "show all / hide all" button, or remembering which accounts you left open.

## STATUS 2026-10-21: held RSU vests shown in dollars, whole shares into the account BUILT

Verified with 753 automated tests (11 new or changed, 24 + 2 in the RSU file) and a browser check (desktop and 375px: a 33-share held vest at $50: after-tax value, the paycheck detail row, "add to holdings", the resulting holding, lot, basis, and account cash). The browser check used invented data, not yours.

Judgment calls (please review):
1. **Dollars, not shares, in the tables:** the vest table's "After tax" column now shows the after-tax value in dollars for held vests, with "N shares to the account, $X cash" under it. The paycheck detail row keeps Net at $0.00 (it is not cash) and adds "$X kept as shares" under it. Take-home totals, the cash forecast, the budget's expected pay, and Afford it still count cash only, so shares are not treated as spendable money.
2. **Whole shares:** the shares added to the account are the after-tax shares rounded down to a whole number (a tiny allowance stops float noise from rounding a whole number down).
3. **Cost basis:** the lot (taxable account) or holding (IRA, 401(k), HSA, 529) gets the whole shares times the vest price, and adds to what the holding already has. The leftover cash is not part of the basis. Every vest is its own lot (dated on the vest, source "RSU", with its own basis), even two vests on the same day; the holding's shares and basis are always the sum of its lots, and shares already in the holding before keep their basis as their own "opening" lot. Held vests can only be sent to a brokerage account (the pickers list nothing else), which always tracks lots; the IRA-style path in the code (holding only, no lots) cannot be reached from the screens.
4. **Leftover part of a share:** its dollar value is added to the same account's uninvested cash when you press "add to holdings", as a broker would pay cash for a partial share. A vest too small for one share adds only the cash. It does not touch your checking forecast.
5. **Already-recorded vests are left as recorded** (fractional shares and full basis). Nothing in your accounts changes.
6. If the company really rounds the sold shares up instead (so the cash is lower), set the withholding rates on the Income tab to match; the app still assumes the tax comes out of the vest.

Not built: a one-time round-down of vests already recorded, and showing kept value in the Roth planner or retirement pages (they already use vest value from the model).

## STATUS 2026-10-21: RSU grants with a generated vesting schedule BUILT ("go")

Verified with 748 automated tests (20 new) and a browser check (desktop and 375px: your 2/2/26 quarterly example, even fill, editing one row's shares and price, a stock grant with a new ticker and no price key). The browser check used invented test data, not yours. Database is now version 14; backups are version 14 (older backups still restore). NOT tried: the live price lookup against Twelve Data (the tests use a fake response), and changing a grant's schedule after shares are entered in the browser (covered by tests only).

Judgment calls (please review):
1. **Where:** Income tab, Stock awards (RSUs): a new "Grants with a vesting schedule" card above the existing form, which is now titled "Add a single vest (one-off or already vested)" and works exactly as before. Existing vests are untouched.
2. **Dates:** one every period after the start date, on the same day of the month (2/2/26 quarterly: 5/2, 8/2, 11/2, 2/2/27 ...), for the whole length (16 dates for 4 years quarterly). A day a month does not have falls on that month's last day, counted from the start date (Jan 31 monthly: Feb 28, Mar 31). Length is whole years, 1 to 10.
3. **Cliff (optional):** the first vest is on the cliff date and regular dates continue after it. A cliff that is not on a regular date still gets its own vest. The first vest after a cliff normally covers everything earned so far, so you enter a bigger number of shares there; the app does not work that out.
4. **Worksheet:** a table of the dates; type shares on a row to make that vest (zero or blank removes it), or "Fill evenly" from a total (whole totals split into whole shares with the extras on the earliest vests; replaces what is typed, after a confirmation). A price box on each row overrides the grant price for that vest (cash) or is the actual vest price (stock). Blank returns to the grant price.
5. **Vests are real vest rows:** a row exists once it has shares, linked to the grant. Taxes, alerts, the calendar, held-share lots, forecast and the Roth planner see ordinary vests. Vests with no shares do not exist, so nothing shows up with zero value.
6. **Cash grants:** one price per share on the grant. If you change it, vests that were using the old price follow; a vest with its own price keeps it.
7. **Stock grants:** type the ticker. A ticker the app does not know creates a holding vehicle in the first stock asset class (change it on the Investments tab). The price is looked up once when the grant is saved if the vehicle has no price yet, and the "refresh price" link on the grant looks it up again. It uses your own Twelve Data key on this device; with no key the price stays manual and the screen says so. The price is the stock's current price, used to value future vests until you type the actual vest price on that row. The ticker symbol is sent to Twelve Data, as in the Investments refresh. Sold or held, and the brokerage account, are set once on the grant.
8. **Changing a grant:** name, kind, stock, after-vest and account changes carry to its vests, except vests already added to holdings (they keep where they went). Changing the start date, length, frequency, or cliff keeps shares and prices on dates that still exist and removes vests that no longer fall on a date, after a confirmation that lists them. Vests already in holdings are never removed or changed by the worksheet; they show "in holdings".
9. **Deleting a grant** deletes its vests, except those already in holdings, which stay as single vests.
10. **Sync and backup:** grants are a new table, tracked for sync and in backups. A stock grant refers to its security and account by id.
11. A new stock vehicle created by a grant is created on this device; if the other device has its own copy of the same ticker, you may end up with two (the existing Investments page has the same issue).

Not built: ages, generating a worksheet from an existing set of vests, a quarterly "vest on the 15th" style rule other than the start date's day, vesting percentages per date (you type shares), and the "at risk" cash flag.

## STATUS 2026-10-21: year-by-year tables for the savings-through-retirement lines BUILT ("go")

Verified with 728 automated tests (9 new) and a browser check (desktop and 375px: all three lines, today's and future dollars, the money-runs-out year, a by-hand check that a row adds up to the cent). The browser check used invented test data, not yours. Not checked in the browser: the CSV download itself (the CSV text is covered by tests).

Judgment calls (please review):
1. **Chart lines, not one life:** each table is the chart's 10th percentile, median, or 90th percentile line (in each year the simulated futures are sorted and that one is read off), as you chose. The plan's flows (contributions, other income, spending, loan payments, tax, windfalls) are the same in every future, so only growth and balances differ between the three tables. Growth is what bridges one year's line to the next, so start + net flow + growth = end on every row.
2. **Today's dollars:** each year is divided by that year's inflation factor and the start balance by last year's (like the chart), so the growth column is labeled "Growth after inflation" there. Future dollars show nominal figures.
3. **Money running out:** the year it runs out shows the planned amounts (marked "money ran out"; growth is blank because the planned amount was not fully paid, and its withdrawal rate can top 100%). Later years show a zero balance and blank flows ("ran out earlier"). A note above the table names the year.
4. **Other income above spending** is capped at spending and the excess is not added to savings. This is how the existing model already worked; the table now shows it.
5. **Tax column** is the gross-up on withdrawals: (spending + loan payments, less other income) divided by (1 - tax rate), minus what it covers.
6. **Years, not ages:** rows say "working" or "retirement year N". The app does not store birth years.
7. **CSV download** exports the table as shown (the chosen line and dollars), dollars to the cent, blanks where the money had run out.
8. Internal: the retirement model now exposes the pieces of each year's cash flow (`parts`); the numbers it simulates are unchanged.

Not built: ages, a version that follows one real simulated future, and a printable layout.

## STATUS 2026-10-21: Retirement tab: typed confidence percent and monthly Social Security BUILT

Verified with 719 automated tests and a browser check (desktop and 375px: clearing and typing in the box, saved across a reload, 0 and 150, adding a $2,500 monthly benefit). The browser check used invented test data in the preview browser, not yours.

Judgment calls (please review):
1. **"Want the money to last in (% of futures)":** you can now clear the box and type any number. The limit is applied when you click away or press Enter: 0 to 99 (a higher number becomes 99; empty or non-numeric text goes back to the last good value). The old box forced 50 to 99 on every keystroke, which caused the snapping you saw.
2. **0% as a goal** is allowed as you asked; it means any result counts as success, so "Find spending that lasts" at 0% will return a very large number.
3. **Social Security (Other retirement income) is entered per month.** It is stored and projected per year (monthly x 12, in today's dollars), so nothing in the projection engine, database, backups, or sync changed, and entries you already had are untouched. The list now shows each one as a monthly amount (yearly / 12, rounded to the cent), so an old entry whose yearly amount is not a multiple of 12 cents may show a cent off.
4. This applies to all items in that section (pensions, rental income), not only Social Security.

Not built: the Roth planner's own "other income" list still asks for a yearly amount.

## STATUS 2026-10-20: asset class assumptions updated to compound (geometric) returns BUILT

Verified with 718 automated tests (including the update on a database holding the old defaults and two seeds at once) and a browser check of the migration and the table. The figures are the ones you supplied; I did not verify them against a source.

Judgment calls (please review):
1. **Meaning of the return column:** it is now the compound (geometric, CAGR) nominal return. The steady path grows at it. The Monte Carlo draws (Projections, Retirement, Goals, and the Roth planner's simulations) are centred so the typical (median) outcome tracks it; each yearly draw averages a little above it, as it should. Before this, the column was an arithmetic average, and the simulation's median ran below the steady path. The note on Projections and the Investments table heading say so.
2. **Classes:** US stocks, International stocks, Bonds and REITs became US large cap, Intl developed, US aggregate bonds and US REITs (same records, so holdings keep their class). Added US small cap, Emerging markets and High-yield bonds. Balanced / target-date, Cash and Other were not in your table and keep their old numbers (6%, 3%, 5%), which are now read as compound returns.
3. **Existing data:** updated once, only for classes still at the old defaults; an edited class is left alone, and a class you delete afterwards does not return. The three new classes have fixed ids so synced devices do not double up. They sit at the end of the list.
4. **High-yield bonds** are the "bond" kind, the closest the app has, so the simulation treats them as moving mostly apart from stocks. Real high-yield bonds fall with stocks more than that. A new "high-yield" kind with its own correlations is not built.
5. **Mixed portfolios:** the steady path uses the weighted average of the class compound returns. A rebalanced mix can compound slightly higher, so the steady path is a little conservative.
6. Also fixed: seeding the default classes twice at once (React dev mode does this) could fail or leave extras; the check and insert now happen in one transaction.

## STATUS 2026-10-20 (latest): split remaining amount and account renaming BUILT

Type check clean and 708 automated tests pass. Checked in the browser (desktop and phone width): split states (empty, partial, exact, over), rename on both tabs including duplicate rejection and the new name in the Investments allocation dropdown.

1. **Split form:** shows "Allocated $25.00 · Left to allocate $75.00 (of $100.00)" (amber until it reaches $0.00, then green; "Over by $X" if too much). It shows as soon as Split is chosen, and asks for the charge amount first if that is empty.
2. **Rename accounts:** a "rename" link next to the name on each account's page (Accounts tab) and on each card in Investments. Names must be non-empty, 60 characters or fewer, and not match another account of the same kind (case-insensitive). Everything refers to accounts by id, so history, budget, and reports follow the new name.
3. Not built: renaming loans from the Debt tab's loan cards (loans renamed from their ledger page only).

## STATUS 2026-10-20: targets can be set on the budget line itself BUILT

Verified with 708 automated tests and a browser walk-through (set, fund, edit, remove, empty-save message, phone width).

Judgment calls (please review):
1. **Where:** each category line on Budget has "+ set a target" (and "edit" once it has one) that opens a small form right under the line. The Targets section at the bottom still lists every target and can add them too.
2. **Monthly means "set aside another":** a monthly target of $2,400 shows "needs $2,400 this month" until you have assigned $2,400 this month (money left over from earlier months does not count toward it). YNAB's other monthly style, "refill up to $X" (top up what is left), is NOT built; say if you want it.
3. **One target per category from the line:** the inline form edits one target per category (like YNAB). The bottom section can still add a second one.
4. The amount is read when you press Save (or Enter), so you do not have to click out of the box first.

## STATUS 2026-10-19 (final): "Initial setup" category BUILT

Verified with 706 automated tests and a browser walk-through (balances, Home, Budget, Reports, Flow).

Judgment calls (please review):
1. **What it is:** a built-in category "Initial setup" in a "System" group, created at startup if missing, with fixed ids so each device makes the identical records (nothing doubles on sync). It cannot be renamed or deleted, and the group has no "add category" box. It appears in every category dropdown under "System".
2. **Counts as money, not as activity:** entries filed under it change the account's balance, net worth, cash, and Ready to Assign (like an opening balance would), and a card balance entered this way shows as owed and unfunded on the budget.
3. **Left out of:** income and spending in Reports, Year in review, Protection (spending runway), Home's monthly spending and its transaction count, the budget's categories, income, and uncategorized count, the forecast's everyday-spending estimate, retirement's trailing spending, payee rule suggestions, and repeating-charge detection. It still appears in the Transactions list, account ledgers, and CSV export, because they are real entries.
4. **Flow diagram:** left out by default, with a checkbox ("Include Initial setup entries") that shows positive entries as "Initial setup (money in)" and negative as "Initial setup (money out)". The checkbox is part of saved views.
5. **Splits:** a split line filed under it is ignored the same way.
6. Not built: a one-click "set this account's balance to match my bank" helper that would create the entry for you.

## STATUS 2026-10-19 (latest): saved color themes and credit limits BUILT

Verified with 692 automated tests and browser checks (themes: save, update, switch, copy code, import, bad code; credit limit: set, change, over the limit, no limit).

Judgment calls (please review):
1. **Saved themes:** the library (name, light and dark colors) lives in settings, so it is in backups and syncs between devices; which theme is active stays per device (localStorage), as before. Up to 20 themes; names unique (case-insensitive), up to 40 characters. Picking a saved theme copies its colors into the active palette, so a change made to that theme on another device appears here the next time you pick it. "Update" saves edits back; "Save as new" makes another. Deleting a saved theme keeps its colors on until you pick something else.
2. **Theme codes:** "ledger-theme-1:" followed by the name and 24 colors, encoded as text. An imported theme that clashes with a name gets "(2)", "(3)", and so on, and becomes the active theme.
3. **Credit limit:** optional, on credit card accounts only (set when adding the card, or from the card's page). Credit left = limit minus what you owe; a card in credit adds to it. 75% or more of the limit shows as a warning and over the limit in red, with a plain note about the usual 30% guideline. Accounts shows each card's credit left and a total.

## STATUS 2026-10-19 (later): flow (Sankey) diagram and one-open-at-a-time sidebar BUILT

Verified with 667 automated tests and browser checks (numbers hand-checked against test transactions, filters, custom dates, gross view, phone width).

Judgment calls (please review):
1. **Where:** a "Flow diagram" tab on Reports (the existing reports are the "Trends" tab).
2. **Counted:** every expense category, plus the principal part of loan, mortgage, and HELOC payments (they are transfers to the loan account, shown as "Loan principal"). Left out: credit card payments and moves to savings or investments. Card spending counts through its categories.
3. **Left over:** income minus spending shown as "Saved". If any category or account is switched off it is called "Left over" with a warning, since it is no longer true savings. If spending exceeds income, a "Drawn from savings" bar feeds the diagram instead.
4. **Periods:** "Last 3/6/12 months" are the whole months before this one; "This month" and "This year so far" run through today; "All time" starts at your first transaction; custom dates are inclusive and can be entered in either order.
5. **Gross view:** pay, taxes, and deductions come from your Income setup (the paycheck model), not from deposits, so they can differ from what reached your accounts. Spending still comes from your accounts. Taxes are withholding (federal incl. additional Medicare, Social Security and Medicare, state and family leave); deductions are listed by name (401(k), HSA, and so on). Years without a pay setup show a message.
6. **Account filter:** limits income and spending to the accounts you leave on; it does not affect the gross-view pay.
7. **Phone:** the diagram keeps about 200px per column so labels stay readable, so it scrolls sideways inside its box (with a hint).
8. **Sidebar (desktop):** all groups start collapsed and only one stays open at a time; the open one is remembered per device.
9. **Saved views (flow diagram):** a named view remembers net or gross, the period preset, groups or categories, and what is switched OFF (categories and accounts). Storing what is off means categories and accounts you add later appear in your saved views. Custom dates are not part of a view; they are remembered separately, with everything else, as what the page showed last time on this device. Views live in settings, so they are in backups and sync between devices.

## STATUS 2026-10-19: device sync BUILT (via a private GitHub repo)

Verified with 645 automated tests (two simulated devices through an in-memory remote, plus the GitHub client against a fake fetch) and browser checks. NOT yet tried against real GitHub: do the first real sync with a throwaway repo.

Judgment calls (please review):
1. **Where:** one encrypted file (`ledger-sync.bin`) at the root of a private repo you create. Gzip, then AES-GCM with a passphrase (PBKDF2). You create a fine-grained token limited to that repo (Contents: read and write); it and the passphrase are stored in this browser only. The app refuses a public repo.
2. **Merge:** per record, last edit wins (each record now has an `updatedAt`). Deletions are detected against the ids at the last sync and win unless the record was edited afterwards. Both-sides edits are listed on the Sync page (last 50). Budget lines, net worth months, tax settings per year, and scheduled-item log entries are collapsed to one per natural key if two devices made them at once.
3. **Ids:** new records now get time-based ids (about 1.8e15) so two devices cannot collide. Existing small ids are unchanged. The second device must REPLACE its data with the synced copy when it connects (small ids would collide otherwise).
4. **Not synced:** the price-data key (per device) and appearance/palette (per device, already in localStorage).
5. **Restoring a backup** on a synced device re-stamps everything so it wins, and deletes anything not in the backup on all devices (the restore confirmation says so).
6. **Timing:** on open, on return to the app, when back online, 8 seconds after a change, and every 5 minutes while open. Clock differences between devices could pick the wrong "later" edit if clocks are badly off.
7. Deletion markers are kept 365 days; a device offline longer could bring back something deleted elsewhere.

## STATUS 2026-10-17 (latest): monthly check-in, "Can I afford it?", budget targets, and charitable giving BUILT ("build: 1, 2, 3, 7")

Verified with 626 automated tests and browser checks (desktop and 375px phone width, no horizontal overflow). Database is now version 13; backups are version 13.

Judgment calls (please review):
1. **Targets:** monthly = assign a set amount; by date = remaining divided by months left, rounded up; yearly = next occurrence. When money is short, the soonest-due target is funded first.
2. **Giving:** gifts of shares assume a 15% long-term capital-gains rate for tax avoided. The 60% (cash) and 30% (shares) of income limits and carryforwards are not modeled. Gifts feed the Tax package and can set your itemized deduction in Tax planning.
3. **Afford it:** standard guidelines (28% housing, 36% total debt with 43% as a hard limit, car costs 15 to 20% of income and payment under 10%, 3 to 6 months of cash left over, a PMI note under 20% down). Rent vs buy ignores the mortgage-interest and property-tax deductions.
4. **Check-in:** the budget step counts as done when nothing is overspent and unassigned money is under $50. Prices older than 10 days, property values older than a year, and a backup older than 30 days count as to-do. Your own ticks are saved per month in settings. Home nudges you from the 25th if steps remain.

## STATUS 2026-10-20: cash-flow forecast, spending reports, debt payoff, "if something happens" guide, protection check, year in review, collapsible sidebar groups, and color palettes BUILT

Verified with 576 automated tests and browser checks of every new page (desktop and phone width).

Judgment calls (please review):
1. **Forecast:** starts from checking (and, optionally, savings). Everyday spending is the average of the last three full months, leaving out items posted from Scheduled and loan interest/escrow categories (forecast separately), and is editable. Transfers in scheduled rules are ignored (card payments would double-count card spending; loan payments come from the loan schedules). Tax due is placed on April 15 and refunds on March 15 of next year. A low-balance alert on Home looks 90 days ahead.
2. **Reports:** 13 months of data ending at the month you pick; income is whatever lands in income categories (or uncategorized money in), so it is only as complete as your entries.
3. **Payoff:** a mortgage is left out of the plan by default; card APRs and minimums are entered by you (a minimum of 2% or $25 is assumed until you do); loans use their next scheduled payment and current rate. "Extra vs invest" compares final money at the end of the original term, with an optional tax drag on investment returns.
4. **Protection:** guidelines only: life need = income x years + all debts + education goals (optionally minus savings); disability = 60% of pay; umbrella = net worth rounded up to $1M steps; emergency fund target 6 months (one earner) or 4 (two). Policies are entered by you (employer coverage included) and stored in settings, so they are in backups.
5. **Guide:** stores contacts, document locations, notes per account, and free text in settings (in backups). It warns not to store passwords. Balances are hidden by default so a printout shows less.
6. **Year in review:** net worth change uses saved monthly points (the last point of the previous year as the start when available).
7. **Sidebar:** each group's name collapses and expands its pages; the choice is remembered per device.
8. **Palettes:** Classic (original) plus four presets and a custom palette (12 colors, light and dark separately). The palette and mode are stored per device in the browser (not in backups). Charts keep their own validated series colors.
9. Payee matching now ignores store numbers of any length ("WHOLE FOODS #12" = "WHOLE FOODS #99").

Still open: Social Security claiming planner and survivor scenarios, cross-device sync, broker lot import, whole-plan scenarios, guided setup/demo mode, dividend/interest income tracking, rebalancing and asset location.

## STATUS 2026-10-17 (later): all six "larger scope" features BUILT ("go")

Verified with 472 automated tests and browser checks (net worth + property, tax planning page, Home alerts and Coming up, rules and quick add, tax package, phone layout of every new page).

Judgment calls (please review):
1. **Net worth history:** one point per month, updated automatically whenever the app is open (the month's last view is kept). Past months cannot be recomputed, so earlier points are added by hand (total only). Property is only what you enter; a value over a year old raises an alert. Home value is counted in net worth; mortgage/HELOC equity needs the loans ticked on the property.
2. **Tax planning:** estimates use the Income tab's settings plus sales and HSA withdrawals. The safe-harbor test compares total withholding with the smaller of 90% of this year's tax and 100% (110% if income is over $150,000) of last year's. Suggested extra withholding is spread over the remaining paychecks (one person at a time). Loss harvesting shows the tax saved by re-running the estimate with the selected lots sold; wash-sale risk is flagged when the same security is in an IRA/401(k)/HSA. The checklist's RMD estimate uses today's traditional balance, not last year-end.
3. **Alerts** (Home): backup, overspending, owing at tax time, estimated payment within 30 days, scheduled items due, accounts with no owner, missing/stale prices, lots missing cost or date, vests within 30 days, property value over a year old; and in the last 75 days of the year: year-end checklist and harvestable losses.
4. **Calendar:** a snapshot .ics (re-download to refresh), not a live subscription. Items: vests, estimated tax dates (only when you are on track to owe), RMD deadline, Dec 31 year-end reminder, pay-cap dates, scheduled items (next 60 days), next loan payments. Money/tax items include a reminder the day before.
5. **Rules:** a rule applies to a payee that contains its text (longest wins). Rules categorize and can rename on import; the quick-add and full transaction forms fill a category from rules or from how you filed that payee at least twice before (60% majority). Suggested rules need 3+ transactions, 90% the same category. Repeating charges need 3+ occurrences, regular spacing, similar amounts, and not already scheduled; stopped ones are skipped.
6. **Quick add** now opens a fast form (payee suggestions, amount, category, save and add another); splits, transfers, and memos are one click away.
7. **Tax package:** projected pay/withholding from the Income tab (use W-2 figures when you have them); sales by lot only for taxable accounts; mortgage interest from the loan schedule (simple monthly interest), not a 1098. PDF is the browser's print dialog ("Save as PDF"); CSV per table.

Still open: Social Security claiming planner and survivor scenarios, cross-device sync, broker lot import, whole-plan scenarios, guided setup/demo mode, dividend/interest income tracking.

## STATUS 2026-10-17: navigation and Home redesign BUILT (before the larger features below)

The 15-link top banner was replaced by an information architecture: Home / Money / Invest / Plan / More. Desktop: grouped sidebar; phone: bottom tab bar plus a scrolling row of the section's pages. Added: Home screen (net worth, ranked "needs attention" alerts, this month's spending, recent transactions, goals, quick links), global search (Ctrl+K or /), quick-add button (add a transaction from anywhere; shortcuts to trades, paycheck scenario, scheduled item), breadcrumbs, in-page tabs on Investments (Accounts / Realized gains / Prices & assumptions), a Settings page under More. Accounts moved from "/" to "/accounts"; every other address is unchanged.

Judgment calls: Import and Categories sit under Money; Income and Paycheck sit under Plan (with the planners) rather than their own group; the phone tab bar has five tabs; keyboard shortcuts are limited to search; the Home net worth excludes property until home value is added (next item in the queue).

The larger features (net worth history + home value, tax planning dashboard, alerts/Today expansion, calendar export, quick capture + rules, tax-time package) are still queued under "Larger scope" below; Home and alerts are the first slice of them.

## STATUS 2026-10-16: paycheck calculator, HSA accounts, and cost basis / realized gains were BUILT ("go")

Verified with 380 automated tests and a browser walkthrough (new scenario from a copy, live edit, compare; HSA account and withdrawal; lots, buy, sale with FIFO, undo, tax effect on the Income tab; phone layout).

Judgment calls (please review):
1. **Paycheck calculator** copies are independent of the Income tab (editing a scenario never changes the real setup). Scenario edits apply immediately (no Save button). The household yearly tax uses the other person's real income (optional) and your Income tab's tax settings. RSU vests are not part of a scenario (add bonuses to model a lump sum).
2. **HSA** is its own account type. A withdrawal logged as "not qualified" is added to other income on the Income tab with a 20% penalty if the owner is under 65 (no known owner or birth year assumes under 65). Death/disability exceptions are not modeled. Logging a withdrawal takes it out of the account's cash when cash is available. The Roth planner treats the HSA as a tax-free bucket that pays the "medical costs per year in retirement" you enter once everyone has retired; a leftover HSA is taxed at your heirs' rate for heirs.
3. **Tax lots:** existing taxable holdings become one "opening" lot with the recorded basis (or $0 if none was recorded) and an unknown purchase date, which counts as long-term. Fix the date and cost in the lots panel. Taxable holdings' share counts follow the lots (edit lots, not the share box). Adding shares to a taxable holding adds a lot (merged into the same holding).
4. **Sales:** the default method is remembered (FIFO to start); "pick specific lots" is per sale. Average cost allocates in proportion over all lots, and each lot's own date decides short vs long term. Proceeds go to cash only if you tick the box (same for buys). Wash sales and the carried-forward part of a capital loss are not modeled. A net loss deducts up to $3,000 against other income.
5. **Realized gains** feed the Income tab (short-term as ordinary income; long-term stacked at 0/15/20% using the 2026 thresholds for every year; 3.8% NIIT above $250,000; MA taxes them at 5%) and the first year of the Roth planner.
6. **Qualified accounts** (IRA, 401(k), Roth, HSA, 529): a sale only lowers the holding, with no gain or lots. You can edit the holding's total cost basis there.
7. **Held RSU vests** in a taxable account now create a tax lot dated on the vest.

Still open: dividend/interest income tracking (reinvested dividends create lots but the dividend itself is not counted as income), wash sales, the capital-loss carryforward, cost basis for inherited/gifted shares, importing broker lot data.

## STATUS 2026-10-14: the Roth conversion planner and RSU vesting (last two sections of this file) were BUILT ("build all")

Verified with 318 automated tests and a browser walkthrough (entering cash and stock vests, editing a vest price, recording held shares, running the planner and the simulations, phone layout).

Judgment calls (please review):
1. **RSU withholding** defaults to the federal supplemental rate (22%) and the MA flat rate (5%), plus Social Security/Medicare; set the real rates per person under "Withholding on vests". Over-$1M supplemental wages (37%) are not modeled.
2. **Held stock** assumes the tax is covered by selling shares at the vest (sell-to-cover): you keep the net shares, with the net value as cost basis. The paycheck-detail row shows net $0 for it (it is not spendable cash). "Add to holdings" only appears once the vest date has passed and creates or adds to a holding in the chosen brokerage account.
3. **Cash vests** are treated as wages paid on the vest date (taxed through payroll). The "at risk / escrow" flag was never answered, so it was not built.
4. **Roth planner scope:** two people at most; both live through the plan; conversions happen on January 1; a 401(k) rolls into the IRA when its owner retires (that is also when it becomes convertible); no early-withdrawal penalties or Roth 5-year rules; HSA ignored; survivor tax filing not modeled; heirs' tax is one flat rate.
5. **Before everyone has retired**, wages are assumed to cover spending and the ordinary taxes, so only the extra cost caused by a conversion (tax, IRMAA, lost ACA credit) comes out of savings. After that, spending plus all taxes come from Social Security, other income, RMDs, then taxable, traditional, Roth.
6. **Tax tables for the planner** are in `src/data/retirementTax.ts` (2026), with items marked UNVERIFIED (ACA applicable-percentage table, IRMAA dollar amounts, MA 65+ exemption, senior-deduction phase-out). Later years scale indexed amounts by your inflation assumption; non-indexed amounts (Social Security thresholds, NIIT threshold, senior deduction ending 2028) stay fixed.
7. **IRMAA** uses income from two years earlier; for the first two plan years it uses the first year's income. **ACA** credit assumes a two-person household and the "benchmark plan" premium you enter; spending should exclude health premiums before Medicare.
8. **Simulated futures** use one common market return per year for all accounts (lognormal), identical random paths for every strategy.
9. **Bracket-fill** strategies solve each year's conversion exactly for the ordinary-income bracket top (two passes, so withdrawals that change with the conversion are accounted for).

Still open: survivor/death scenarios, HSA, inherited-account 10-year payout, state tax other than MA, "at risk" cash vests, RSU vests feeding the Projections tab as separate cash flows.

## STATUS: everything below (through All Transactions) was BUILT on 2026-10-09 (owner asked "build these now")

Built and verified (242 automated tests, plus a walkthrough in the browser: theme switching, pay schedules and employer cap, ESPP/HSA switches,
collapse memory, price override, every transaction filter/sort/bulk/export, mortgage and HELOC numbers against independent calculations,
ledger link, budget, retirement panel, phone layout of all 13 pages).

### Judgment calls made while the owner was asleep (please review; all are easy to change)

1. **Weekend pay rule is OFF by default** (the box is unchecked on new and existing profiles). Turn it on per person under Pay schedule. Holidays are not considered. With the rule on, a pay day can move across a year boundary (e.g. a Saturday Jan 1 pays on Dec 31), which can make a 25-paycheck year; each paycheck is still salary / 24.
2. **"Last day of the month" is stored as day 31**, and day numbers past a short month's end clamp to its last day (tested for Feb, 30-day months, and leap years). "Last business day" is a separate choice. The **Scheduled** tab's recurring items still use the older day rules (no last-business-day option there yet).
3. **Employer 401(k) contribution** is one section with two formulas (match on contributions, or flat % of pay), an optional yearly dollar maximum, and a key-date line when the maximum is reached. With a match + true-up, the maximum applies to the year-end total.
4. **HSA / ESPP** appear only when switched on ("I have an HSA", "enrolled in ESPP"). Existing data that already has either shows them automatically. Switching one off removes its deduction (after a confirmation).
5. **Collapsible sections** remember per device what you collapsed; everything is open the first time. The Transactions filter panel starts collapsed on phone-width screens.
6. **Theme button** sits at the end of the top navigation bar and cycles Device, Light, Dark.
7. **Manual price**: refreshing prices overwrites a manual price (as asked); a ticker the API cannot price keeps the manual value. The Price cell in each holding row is now editable and always visible (it was hidden on phones).
8. **All Transactions**: totals include transfer rows with a note saying how many (use "Hide transfers" to exclude them). Bulk category skips transfers and replaces splits with the single category (it says how many). Selection only ever counts rows inside the current filter, and clears after a bulk action. The CSV defuses text starting with `= + - @` (prefixes an apostrophe); amounts stay plain numbers.
9. **Debt: interest accrual** is simple monthly (balance x rate / 12), shown in the app; reconcile against a statement.
10. **Debt: "keep my payment" vs "lower my payment"** is a per-loan setting (default: keep the payment and finish sooner). In "lower" mode a large recurring extra can still finish a little before the original end date. A rate change always recalculates the payment over the months that remain.
11. **Debt: ledger link.** A loan becomes a new "Loan" account kind (a balance you owe). Loans are never part of spendable cash. In the Budget a loan gets a "Payment: <loan>" line that you fund by assigning the principal you plan to pay; there is no "unfunded debt" warning for loans. Payments are recorded from the loan card ("Record a payment"): principal as a transfer to the loan, interest/escrow as an expense split across the categories you choose.
12. **Debt: escrow and PMI** are informational (shown in the total monthly payment and recorded as an expense when you record a payment); they do not change the loan balance.
13. **Debt feeds Retirement** through an opt-in checkbox, OFF by default, because a spending figure that already includes the mortgage would be double counted. Net worth (cash + investments - cards - loans) is on the Debt tab; property value is not included.
14. **Phone layout**: tables wider than the screen now scroll sideways inside their own box on every page, and long checkbox sentences wrap. Found and fixed during testing.

### Still open (not built, from the questions listed under the Debt tab below)
- Daily interest accrual; HELOC lifetime/periodic rate caps and prime + margin modeling; lender-specific HELOC minimum payments.
- Adding "last business day" to the Scheduled tab.
- Showing a "no price" holding more helpfully in totals (it still counts as $0, with a warning).

---

## Income tab

Collected 2026-10-08. All decisions below were confirmed by the owner.

- [x] **1. Collapsible sections.**
  - Add collapse/expand to the sections on the Income page: People, each person's setup (and its inner parts: Pay, Salary,
    Deductions, Employer contributions, Income tax withholding), Bonuses, Household tax settings, Results, and the paycheck detail.
  - **Default: open. Remember what the owner collapses** (per device, in browser storage; the page must still work if storage is unavailable).

- [x] **2. Pay setup line is confusing ("Model by / Paid / A real pay date").**
  - Owner's question: is it the start date for annual income? No. Explained to the owner: it picks how paychecks fall in the year; the "real pay date" is only an anchor.
  - **Decision: show only what is needed, with plain labels and a one-line explanation.**
    - Weekly / every 2 weeks: ask for "any past payday" (anchor; explains it decides which dates and which months get 3 paychecks).
    - Twice a month: ask for the two pay days (no anchor date).
    - Monthly: ask for the pay day of the month (no anchor date).
    - Annual numbers mode: no date at all.
  - **Twice-a-month pay days (owner's real case: the 15th and the final business day of the month).**
    - Entering 31 must never break short months (it already clamps to the last calendar day; keep a test for Feb, 30-day months, leap years).
    - Add an explicit **"last business day"** choice (not just 31) and a **"if the pay day lands on a weekend, pay on the prior business day"** option.
    - Assumption to confirm when implementing: weekends only; public holidays are ignored (note this in the UI).
    - Add tests for months ending on a weekend and for a 1st/15th on a weekend.

- [x] **3. Deductions table: spacing of the "reduces" checkboxes is off.**
  - The checkbox and its label (Fed / FICA / MA) sit on separate lines, so it is hard to tell which box goes with which label.
  - Fix: put each checkbox and its label on one line (checkbox directly beside its label), in a tidy aligned group.
  - Also consider clearer wording than "FICA" (e.g. "Social Security & Medicare").

- [x] **4. 401(k) match: add a dollar maximum, and support two formulas.**
  - Owner's example: "my employer matches 10% up to a total of $5,000".
  - **Decision: support both formulas, chosen per person:**
    - **(a) Match on contributions (the more likely case):** employer adds X% of what the employee contributes, up to Y% of pay.
    - **(b) Flat contribution based on pay:** employer contributes a % of pay regardless of what the employee contributes.
    - **Either formula gets an optional yearly dollar maximum** (the cap applies to the employer's total contribution for the year, including with true-up on).
  - Needs: engine change in `simulatePerson` (cap applied as the year progresses, so the match stops once the cap is reached), a new match config shape with a data migration for existing saved profiles, tests (cap reached mid-year; cap with true-up; flat formula; formula (b) with no employee contribution), UI fields, and a milestone line in the results ("employer match cap reached on ...").

- [x] **5. ESPP is lumped in with HSA under "Employer contributions". Only surface ESPP if enrolled; same rule for HSA.**
  - **Decision: each benefit appears only when switched on for that person.**
    - Add an "Enrolled in ESPP" checkbox; only then show the ESPP discount field and the "+ ESPP" deduction button.
    - HSA: show employer HSA contribution and coverage type only once an HSA deduction exists (or an "I have an HSA" switch is on).
  - Edge case to handle: existing saved data that already has an ESPP or HSA deduction must show those controls automatically.
  - Copy-from-last-year should carry the switches forward.
  - Consider renaming the section heading, since it will no longer be a single "Employer contributions" block (401(k) match, plus optional HSA and ESPP details).

---

## New feature: Debt tab

Requested 2026-10-09. Decisions confirmed by the owner. Same working rule: do not build until the owner says all notes are in.

- [x] **Debt tab: mortgage tracking, HELOC planner, and amortization for new or what-if loans.**
  - **What the owner has:** an outstanding mortgage (track amortization) and a HELOC with a **10-year interest-only draw period followed by a
    15-year payback**. Wants amortization tables for existing and new loans, and a calculator to forecast HELOC payments.
  - **Integration decision: tied into the ledger.**
    - Each loan appears as a liability (new account kind). A payment entered in a checking account is **split into interest (an expense,
      for the budget) and principal (reduces the loan balance)**, so budget and loan balances stay in sync.
    - Debts feed the **Retirement** tab (payments and payoff dates as known obligations) and a net-worth view.
    - Reuse the existing transfer machinery where possible; interest expense should land in a user-chosen category.
  - **Mortgage setup: either method, chosen per loan.**
    - Original terms (amount, rate, term, first payment date), or current balance + rate + remaining months.
    - Reconcile against the owner's latest statement balance and show any difference.
  - **HELOC.**
    - Variable rate, and **the owner may keep drawing**: model additional draws (and repayments) by date during the draw period.
    - Rate changes entered by date (a rate-change schedule), plus a **what-if shock** (e.g. +1%, +2%) to see sensitivity of payments and total interest.
    - Draw-period payment is interest only; **repayment period re-amortizes at each rate change** (payment recalculated to pay off the
      remaining balance over the remaining months at the new rate).
    - Make the draw length and repayment length editable (defaults 10 and 15 years).
  - **Extra principal payments in BOTH periods** (the owner corrected an earlier summary that implied interest-only only).
    - Support recurring extra amounts (e.g. monthly) and one-time lump sums by date, on any loan, in either phase.
    - Interest-only period: extra principal lowers the balance, so the interest-only payment falls.
    - Payback period: show the effect on payoff date and total interest.
  - **Outputs.** Full amortization table (month, payment, interest, principal, extra, balance), total interest, payoff date,
    interest saved by extra payments, a balance-over-time chart (base case vs rate shock), and a table view. Same engine for new/what-if
    loans (refinance, auto, student, other) so they can be compared with an existing loan.
  - **Open questions to confirm at implementation time (not yet asked):**
    - Interest accrual convention (simple monthly: balance x annual rate / 12, versus daily accrual). Default to monthly; say so in the UI.
    - Mortgage escrow (property tax / insurance) and PMI: track or ignore? (affects the real monthly payment shown).
    - HELOC rate caps (lifetime and periodic) and prime + margin structure, if the owner wants them modeled.
    - In the payback period, after extra principal: keep the payment the same and finish early, or re-amortize to a lower payment? (Rate changes
      always re-amortize; the choice is how extras behave between rate changes.)
    - HELOC minimum-payment rules during the draw period (interest only versus a lender-specific minimum).
  - **Engineering notes:** new tables (loans, loan rate changes, draws, extra payments) via a new DB version and backup version; pure schedule
    engine with tests (rate change mid-schedule, draw then payback, extra principal in each phase, final-payment rounding, balance reaches
    zero exactly); loans excluded from the budget's cash accounts; links with `createTransfer`-style split logic.

---

## New feature: theme switch (dark mode)

Requested 2026-10-09. Decisions confirmed by the owner. Same working rule: do not build until the owner says all notes are in.

- [x] **Light / Dark / Device theme switch in the top navigation bar.**
  - **Current state:** the app already follows the device's light/dark setting (CSS `prefers-color-scheme`), including the chart palettes.
    There is no way to override it inside the app.
  - **Decision: three choices, Device (default) / Light / Dark.** A small sun/moon button in the top nav, visible on every tab (including phone width),
    that cycles or opens the three choices and shows which is active.
  - **Persistence:** remember per device (browser storage; must still render correctly if storage is unavailable).
  - **Engineering notes:**
    - Today's colors are defined only under `@media (prefers-color-scheme: dark)`, in `src/styles.css` for the app and the `.viz` chart tokens.
      Add explicit `:root[data-theme="dark"]` and `:root[data-theme="light"]` scopes so a forced choice beats the device setting both ways
      (dark values declared under both the media query, guarded with `:root:not([data-theme="light"])`, and the `data-theme="dark"` scope).
    - Set `data-theme` on `<html>` as early as possible (inline script in `index.html`) to avoid a flash of the wrong theme on load.
    - Update `<meta name="theme-color">` to match the active theme, and keep `color-scheme` in sync so form controls and scrollbars follow.
    - Check every page in both modes, especially the budget colors (.pos/.neg/.warn), badges, tooltips, and the allocation/fan charts.

---

## Investments tab

Reported 2026-10-09. Same working rule: do not build until the owner says all notes are in.

- [x] **Manual price override is not available where the owner looks for it.**
  - **What the owner saw:** in an account's holdings table the Price column just says "none", with no way to enter a price.
  - **What exists today:** the editable price box is only in the separate "Holdings vehicles and prices" table near the bottom of the page.
    It is easy to miss, and the commit-on-blur behavior gives no confirmation.
  - **Requested behavior:** let the owner type a price manually, as a stopgap until the API refresh supplies it. **A later price refresh overwrites
    the manual price** (this already matches how `applyPrices` works; keep it, and keep a manual price when the API cannot price that ticker).
  - **Proposed fix (no decision needed unless the owner objects):**
    - Make the Price cell in each holding row an editable field (shown as "Enter price" when empty), saving on Enter or when leaving the field,
      with a brief "saved" confirmation.
    - Show where the price came from: "manual" vs "refreshed" and its date, next to the price.
    - Prices belong to the ticker, so entering one in one account prices every account holding that ticker; say so in a hint.
    - Keep the vehicles table as is.
  - **Related bug found while reviewing:** in the vehicles table, typing something that is not a valid number clears the stored price (invalid
    text is treated the same as an empty box). Invalid input should be rejected with a message and leave the price unchanged. Add a test.
  - Also consider showing the empty-price state more helpfully in the allocation/total (a "no price" holding currently counts as $0).

---

## New feature: All Transactions screen

Requested 2026-10-09 (the owner could not find a transaction history; history today is only per account, on each account's page).
Decisions confirmed by the owner. Same working rule: do not build until the owner says all notes are in.

- [x] **A screen that lists transactions from every account, with filtering and sorting.**
  - **Filters (all combinable):**
    - Account (by name; multi-select).
    - Date and date range (from/to, plus quick ranges such as this month, last month, last 90 days, this year).
    - Category (multi-select, including "uncategorized"; a split transaction matches if any of its parts matches).
    - Payee (text search, "contains"; also search memo).
    - Amount with comparison: **greater than, less than**, equal to, and between; handle inflow vs outflow clearly (filter on absolute amount, or on signed, with a visible choice).
  - **Sorting:** by account name, date, category, payee, and amount, ascending/descending, by clicking the column headers; sensible default is newest first.
  - **Actions (decision: edit/delete plus bulk):**
    - Edit or delete any transaction from this screen, using the same editor as the account page (including transfer handling: editing/deleting one half of a
      transfer keeps the other half in sync; a transfer is shown as one row with both accounts, or clearly marked).
    - Select several rows (with select-all for the current filter) and apply bulk actions: set category, change status (pending/cleared), delete. Confirm before
      deleting; show how many rows will change. Bulk category should skip or warn on transfers and handle splits (set one category and clear splits, with a warning).
  - **Extras (decision: all four):**
    - **Totals for the filtered results:** count, total money out, total money in, net.
    - **Export the filtered list to CSV** (exactly what is on screen, in the current sort; amounts as plain numbers).
    - **Quick filters:** uncategorized, pending only, include/exclude transfers (default: show transfers, since they are real entries, but make it one click to hide them).
    - **Saved filters:** name a combination of filters and sort, recall it with one click, delete it later (per device, in browser storage/DB, included in backups).
  - **Engineering notes:**
    - Needs a new route and nav item ("Transactions"); consider also linking to it from each account page ("see all").
    - Performance: handle thousands of rows (filter in memory with sorting; paginate or virtualize the table; keep the page responsive on a phone).
    - Pure filter/sort function with tests (each filter alone and combined, date boundaries, amount comparisons including negatives, split categories,
      transfers, sort stability and ties); CSV export test (quoting, commas, negative numbers); saved filters round-trip in backup (new settings key or table, backup version bump).
    - Phone layout: filters collapsed behind a "Filters" button; columns reduced to date/payee/amount with the rest in a detail line.
    - Existing CSV-export concerns: neutralize cells starting with `=`, `+`, `-`, `@` that are text (payee/memo) so spreadsheets do not run them as formulas.

---

## Other tabs

_Not yet received._ Accounts, Budget, Scheduled, Import, Categories, Projections, Retirement, Goals, Backup.

---

## New feature: Roth conversion scenario planner

Requested 2026-10-13. Decisions confirmed by the owner. Do not build until the owner says all notes are in.

- [ ] **Compare Roth conversion strategies over the retirement horizon.**
  - **Needs per-account tax type** (traditional / Roth / taxable / HSA) because Retirement currently pools savings. Ask about IRA after-tax basis (pro-rata rule) and after-tax/Roth 401(k) money.
  - **Inputs:** both birth years and retirement years; wages (from Income); Social Security benefit and claiming ages considered; pensions/rental/other income; interest, dividends and gains from taxable holdings; spending need (from Retirement); source of conversion tax (outside money vs from the conversion); growth assumptions reuse the per-asset-class returns; optional heir bracket.
  - **Strategies:** none (baseline); fill to a chosen bracket; fixed dollar per year; gap years only (retirement to Social Security/RMDs); owner's own year-by-year table.
  - **Decisions:** conversion income counts for MA income tax (yes); model the ACA subsidy cliff (yes); exact tax calculation per scenario, not an approximation; compare on all three objectives: lowest lifetime taxes, highest ending wealth, highest after-tax wealth for heirs.
  - **Output:** tax by year per scenario, IRMAA surcharge (two-year lookback), taxable share of Social Security, RMDs with and without conversions, marginal bracket by year with cliffs flagged, ending after-tax wealth, how long money lasts (existing Monte Carlo).

## New feature: RSU vesting

Requested 2026-10-13, for both spouses. Details being clarified.

- [ ] **RSU vest events for each spouse.** Decisions confirmed 2026-10-13:
  - Entry: one row per vest event (date, shares, grant name, which person, ticker).
  - Value: shares x the ticker's price in Investments (manual or refreshed), so projected vests follow the price.
  - Withholding: varies/unknown, so a per-person withholding rate (default federal 22% flat supplemental, plus Social Security/Medicare/MA) compared against actual liability on the Income tab.
  - After vest: shares are held; each vest creates a holding in a brokerage account with the vest-date price as cost basis.
  - Vest income counts as wages (FICA, Social Security wage-base cap, tax estimates) in the vest year.
  - **Update 2026-10-13 (owner):**
    - Past vests (already happened this year) are entered too; they count toward this year's wages and withholding.
    - Future vests are valued at the ticker's current price; each vest can be given its **actual vest price**, which then sets the value and the cost basis for that date.
    - "After vest" is a per-vest choice: **held in a brokerage account** (new holding, vest price as basis) or **sold immediately** (proceeds are cash income, no holding, no gain/loss). The earlier "held" decision is superseded by this.
    - Ticker is set per vest event, so it works whether or not both spouses share a company.
  - **Update 2026-10-13 (owner, supersedes the stock-price, ticker and holding decisions above):** the RSUs are in a private company that was acquired, so there is no market price to pull. Every vest **pays out as cash at a fixed price**. So: no ticker, no price lookup, no holding or cost basis, no held/sold switch. Each vest is a dated cash payment taxed as wages (withholding rate per person, FICA/Social Security cap, MA). Open: enter as dollars per vest or as shares x a per-share deal price; whether the amount is certain or contingent (escrow/holdback).
  - **Update 2026-10-13 (owner, final; replaces the previous update):** both kinds exist. The owner's RSUs are in an acquired private company and pay out as cash; the spouse's are in a public company and vest as shares. Each vest (or grant) therefore has a **type choice: "Vests as cash" or "Tied to common stock"**.
    - **Cash:** ask for the synthetic (deal) price per share; value = shares x that price. No ticker, no price lookup, no holding. The payout is dated cash income taxed as wages.
    - **Common stock:** link to a ticker (price from Investments, manual or refreshed). Future vests use the current price; an optional actual vest price overrides it and sets the cost basis. Per-vest choice of **held in a brokerage account** (new holding at the vest price) or **sold immediately** (cash income, no holding).
    - Both types: past vests this year are entered too; withholding rate set per person (default 22% federal supplemental plus Social Security/Medicare/MA) compared with actual liability; vest income counts as wages (FICA, wage-base cap).
    - Still open: for cash vests, whether any payout is contingent (escrow/holdback) and should be flagged "at risk".

---

## New feature: cost basis and realized gains (Investments)

Requested 2026-10-15. Not built; waiting on answers to clarifying questions.

- [x] (built 2026-10-16) **Update cost basis** on a holding (Investments tab).
- [x] (built 2026-10-16) **Log completed transactions (sales)** so realized gains year to date can be tracked.
  - Open questions: single basis per holding or tax lots; how a sale picks which shares (average cost, FIFO, specific lots); short- vs long-term gains (needs purchase dates); whether a sale reduces the holding's shares and adds proceeds to the account's cash; whether to also log buys; whether the YTD figure feeds the Income/Roth tax estimates.
  - **Decisions (owner, 2026-10-15):**
    - Cost basis is tracked by **tax lots** (date, shares, cost per lot). Taxable (brokerage) accounts show holdings at lot level; existing holdings become one lot the owner can split/edit.
    - Basis is editable (per lot).
    - **Sale method is chosen per sale**: a default method (FIFO, highest cost, or average cost) with the option to pick specific lots. Selling shares sells the associated lot(s) within the Investments tab.
    - **Qualified accounts** (IRA, 401(k), Roth, 529): selling a position does NOT trigger any tax calculation (and needs no lot-level tracking).
    - Logging a sale **reduces the holding's shares** and **feeds the tax estimates** (realized gains YTD count in the Income tab estimate; short vs long term from lot dates).
    - **Buys are logged too** (each buy creates a lot with date and cost; reinvested dividends included).
    - Open: whether net sale proceeds are added to the account's cash balance (not selected, so default is no unless the owner says otherwise); wash sales are not modeled unless asked.

---

## New feature: HSA account type

Requested 2026-10-15. Not built (owner said wait). Details being clarified.

- [x] (built 2026-10-16) **Ability to categorize an account as an HSA** (Investments tab).
  - **Decisions (owner, 2026-10-15):**
    - HSA is its **own investment account type** (holds cash and investments; shows in allocation and net worth).
    - **Contributions link to the Income tab**: payroll HSA saving plus employer HSA money flow into the account in projections (within the yearly limit), like the 401(k) link.
    - **Counts in the Roth planner** as a tax-free bucket for medical costs in retirement.
    - **Track qualified medical withdrawals**: log each withdrawal as qualified (tax-free) or not (taxed, plus penalty before 65).
    - **Included in Projections**, growing with its holdings' assumed returns.
    - Open: how to treat HSA spending in the Roth planner (a yearly medical-cost figure it covers tax-free), and owner per person (self vs family coverage already exists on the Income tab).

---

## Gap: account owner (Investments)

Reported 2026-10-15. The data model has an owner on investment accounts (`InvAccount.personId`), but the Investments tab has no way to set it. The Roth planner depends on it (it assigns each IRA/401(k)/Roth to a person for RMD ages and conversions, and tells the owner to "set the owner on the Investments tab"; unowned accounts are counted as the first person's).

- [x] (built 2026-10-15) Add an **Owner** picker (people from the Income tab, plus "Joint/none") when creating an account and on each account card, editable later.
- [x] (built 2026-10-15) Show the owner on the account card; warn on retirement accounts with no owner.

---

## New feature: paycheck calculator

Requested 2026-10-16. Not built; waiting on clarifying answers.

- [x] (built 2026-10-16) A calculator for a single paycheck, with the option to **carry over existing deductions** from the Income tab's setup, **or enter new deductions manually**.
  - **Decisions (owner, 2026-10-16):**
    - Purpose: what-if on a new salary or raise; try different deductions (401(k), HSA, insurance, etc.).
    - Carry over: pick a person and year from the Income tab; copy their salary, pay schedule, deductions, and withholding into the calculator as an editable starting point (editing never changes the real setup). Or start blank and enter deductions manually.
    - Scope: one paycheck's gross-to-net breakdown plus the year (annual totals, when caps like Social Security and the 401(k) limit are reached, federal and MA liability vs withholding).
    - Scenarios can be saved, named, and compared side by side (e.g. current vs. new job).
    - Not selected: checking against a real pay stub; one-off bonus/vest net (bonuses can still be entered in the scenario).

---

## Larger scope: tax planning, net worth, and usability features

Requested 2026-10-17. Not built; waiting for the owner's go-ahead. Everything below was selected.

- [x] (built 2026-10-17) **Year-end tax planning dashboard.** Bracket room and projected federal/MA tax for the year; withholding vs. estimated payments (on track to owe or be refunded, with W-4 / quarterly payment suggestions); tax-loss harvesting from tax lots (losses available, tax saved, 30-day rebuy warning); year-end checklist (401(k)/HSA room, Roth conversion room, RSU timing, charitable gifts, RMDs due).
- [x] (built 2026-10-17) **Net worth over time + home screen.** Monthly automatic snapshots (cash, investments, home value, debts) with a history chart; home value and equity (value entered and updated over time); goal progress and next actions on one page; spending snapshot (this month's budget status and recent transactions).
- [x] (built 2026-10-17) **Today screen with alerts.** A ranked list of what needs attention across the app (bills due, overspent categories, withholding gap, upcoming RMD or RSU vest, IRMAA/ACA cliff proximity, stale prices, overdue backup).
- [x] (built 2026-10-17) **Calendar export.** Key dates (RSU vests, RMDs, estimated-tax due dates, cap dates, scheduled items) as an .ics file for the phone calendar.
- [x] (built 2026-10-17) **Quick capture and rules.** One-tap add-transaction screen, payee rules that auto-categorize (including on import), and recurring-charge detection.
- [x] (built 2026-10-17) **Tax-time package for the CPA.** One export (PDF and CSV set): wages and withholding, realized gains by lot, HSA activity, RSU income.
- Not selected for now: cross-device sync, guided setup/demo mode, Social Security claiming and survivor scenarios, broker lot import, whole-plan scenarios.
