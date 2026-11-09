# Ledger: your acceptance checklist and recovery guide

**For:** the owner (no programming knowledge needed). **Date:** 2026-11-09. **Why this exists:** Claude tested Ledger as far as a computer alone can (see `docs/LEDGER-STABILIZATION-ST-S5-ACCEPTANCE-2026-11-09.md`). Claude has **no phone, no second device, no screen reader and cannot go into airplane mode**, so the things below are the ones only you can check. Until you tick them, they are **not** counted as passed.

**Golden rule for this whole document: never delete your real browser data, your real accounts or your real backups to run a test.** Every "start from nothing" step uses a private or guest window, which starts empty and throws itself away when you close it. Your real Ledger is never touched.

How long: about 90 minutes for everything. You can do it in pieces. Steps are in order of importance (1 to 8 matter most).

---

## Part A. Before you start

### A1. What you need
- Your phone (and, if you use both, an iPhone **and** an Android phone).
- Your computer.
- A place to write results: the table in Part D.
- 15 minutes of quiet for the screen-reader step (step 14), and a second device for the two-device steps (9 and 10).

### A2. How to get a throw-away "empty Ledger" (called a *test window* below)
A test window has its own empty storage. Whatever you do in it disappears when you close it.
- **Computer, Chrome:** menu (three dots) > **New Incognito window**, or click your profile picture > **Guest**. Open the Ledger address in it.
- **Computer, Edge:** menu > **New InPrivate window**.
- **Computer, Safari:** File > **New Private Window**.
- **iPhone:** in Safari tap the tabs button > **Private** > **+**. Open the Ledger address.
- **Android:** in Chrome menu (three dots) > **New Incognito tab**.
Note: a test window is **not** the installed home-screen app, so it cannot test the installed app. It is for "empty start" tests only.

### A3. A make-believe household (do this once, in a test window, takes 5 minutes)
In a test window: open Ledger, go to **Ledger > Accounts**, add an account called **Test checking**; add three transactions (for example **Coffee -4.50**, **Pay +100.00**, **Test rent -50.00**); go to **Tasks** and add a task called **ZZ test task**. This is your make-believe household. Use only invented names and amounts.

### A4. Where the Ledger address is
`https://marshmond.github.io/ledger/` (the address you already use).

### A5. Passphrases for the test only
Use a made-up passphrase for the test, for example `test only 123`. **Never** type your real backup passphrase, sync passphrase or GitHub token into a test window, and never send them to anyone (including Claude).

---

## Part B. The steps

Each step says: **Do**, **Good looks like**, **Bad looks like**, **Safe on your normal device?** and **Test window needed?** If something looks bad, write down what you saw and the time, take a screenshot if you can, and tell Claude. Do not try to fix it by clearing anything.

### Step 1. Open every part of Ledger on your phone
- **Do:** open Ledger on your phone. Use the menu at the top to open, in turn: Today, Ledger, Calendar, Tasks, Projects, Home & Assets, Household Services, Bills & Subscriptions, Household finances, Settings. Turn the phone sideways and back once.
- **Good looks like:** every screen opens in a second or two; nothing runs off the right edge so you have to slide sideways; text is readable; buttons are easy to hit with your thumb without hitting the wrong one.
- **Bad looks like:** a blank screen; a message saying a part "did not load" that stays after you press **Try again**; text too small; tapping one button hits its neighbour; the on-screen keyboard hides the box you are typing in.
- **Safe on your normal device?** Yes (only looking).
- **Test window needed?** No.

### Step 2. Search and Quick Add on your phone
- **Do:** tap **Search**, type part of a word you know exists (a store name or a task), tap a result. Then tap **Quick add**, choose **Task**, type `ZZ phone test`, and add it.
- **Good looks like:** results appear as you type; tapping opens the right page; the new task shows up in Tasks.
- **Bad looks like:** no results for something you know exists; the keyboard covers the Add button; the task is not saved.
- **Safe on your normal device?** Yes. It adds one harmless task; delete **ZZ phone test** afterwards.
- **Test window needed?** No.

### Step 3. Edit a Budget amount
- **Do:** open **Ledger > Budget**. Write down one category's current "Assigned" amount first. Change it by one dollar, leave the box, then change it back to exactly what you wrote down.
- **Good looks like:** the number saves; the totals at the top change and then change back; you could hit the box without the page jumping.
- **Bad looks like:** the number does not stick; the page jumps around; you cannot tell which box belongs to which category.
- **Safe on your normal device?** Yes **if** you wrote the original down and put it back. If you would rather not touch real numbers, do this in a test window with the make-believe household.
- **Test window needed?** Optional.

### Step 4. Approve or skip a Scheduled item, using make-believe data
- **Do:** in a **test window** with your make-believe household, go to **Ledger > Scheduled**, add a rule called `ZZ test rent`, amount `1.00`, monthly, starting last month, on Test checking. Then **Approve** one due item and **Skip** another.
- **Good looks like:** Approve creates a pending transaction on Test checking; Skip makes the item disappear without creating a transaction; the buttons are large enough to tap.
- **Bad looks like:** a transaction appears on the wrong account or an "Unknown account"; Approve does nothing; you cannot tell which row a button belongs to.
- **Safe on your normal device?** **No: use a test window.** (Approving creates a real transaction.)
- **Test window needed?** **Yes.**

### Step 5. A checkbox in Transactions, and the Calendar
- **Do:** open **Ledger > Transactions**; tap the small box beside one transaction, then tap it again to un-tick. Then open **Calendar**, move to next month and back, switch between Month and Agenda.
- **Good looks like:** the box is easy to tap and toggles cleanly; the Calendar moves smoothly and shows your usual items.
- **Bad looks like:** the box is too small to hit; you tick the wrong row; the Calendar stutters or shows items on the wrong day.
- **Safe on your normal device?** Yes (ticking and un-ticking changes nothing permanent).
- **Test window needed?** No.

### Step 6. A scary confirmation, without deleting anything
- **Do:** in a **test window** with the make-believe household, open the account **Test checking** and tap **Delete account**. Read the box. Then press **Cancel** (or the back gesture).
- **Good looks like:** a box appears naming the account and saying what will happen; **Cancel** is the highlighted button; pressing it closes the box and nothing is deleted. (If the account has Scheduled items, you get a notice saying it cannot be deleted instead, which is also correct.)
- **Bad looks like:** the account disappears without a box; the box does not name the account; Cancel does not close it.
- **Safe on your normal device?** **Do not do this on a real account.** Use a test window.
- **Test window needed?** **Yes.**

### Step 7. Install the app on your home screen
- **iPhone (Safari):** open the Ledger address in Safari > **Share** button > **Add to Home Screen** > Add. Open it from the new icon.
- **Android (Chrome):** menu (three dots) > **Install app** (or **Add to Home screen**). Open it from the new icon.
- **Good looks like:** it opens full screen with no browser bar; it shows the same data as the browser tab (if it shows empty, see the note below).
- **Bad looks like:** it opens to an error; the data is missing.
- **Note for iPhone:** the home-screen app can keep its **own separate storage** from the Safari tab. If you install it for the first time, it may start empty and need a restore or a sync. That is how iPhones work, not a Ledger fault. Take a backup in the Safari tab first (step 12).
- **Safe on your normal device?** Yes, as long as you made a backup first (step 12).
- **Test window needed?** No (it cannot be tested in a test window).

### Step 8. Airplane mode: does it work with no connection?
- **Do:** with the installed app already opened once online, turn on **Airplane mode** (and make sure Wi-Fi is off). Close the app completely and reopen it from the icon. Open Today, Tasks, Calendar, Bills & Subscriptions, Household finances and Settings > Backup.
- **Good looks like:** every screen opens. If a part cannot open, you see a plain message that you are offline and that part is not saved yet, never a blank page.
- **Bad looks like:** a blank white screen; a screen that spins forever; a message telling you to "reload" while you are offline.
- **Then:** still in Airplane mode, add a task called `ZZ offline test` (Quick add > Task). Close and reopen the app and find it with Search.
- **Good looks like:** the task is there. **Bad looks like:** it vanished.
- **Then:** open Settings > Backup and tap **Back up now** (plain). A file should be saved or the share sheet should appear.
- **Safe on your normal device?** Yes. Only the harmless `ZZ offline test` task is added.
- **Test window needed?** No (the installed app is the point).

### Step 9. Coming back online and syncing (only if you use Sync)
- **Do:** turn Airplane mode off. Open **Settings > Sync** and tap **Sync now**. Open Ledger on your computer and also tap **Sync now**.
- **Good looks like:** the `ZZ offline test` task appears on the computer; the Sync page shows a recent time and no error.
- **Bad looks like:** an error you cannot understand (write it down); the task never arrives after two syncs; a task appears twice.
- **Safe on your normal device?** Yes if you already use Sync with your real data, because you are only adding and then deleting a harmless task. **If you have never used Sync, skip this step and step 10;** do not set Sync up on real data just for a test.
- **Test window needed?** No.

### Step 10. Two devices change the same thing (conflict handling)
- **Do:** with both devices syncing, make sure both show the task `ZZ conflict test` (add it on one, sync both). Then turn on Airplane mode on the phone. Rename the task to `ZZ phone version` on the phone. On the computer rename the same task to `ZZ computer version`. Turn Airplane mode off. Sync the phone, then the computer, then the phone again.
- **Good looks like:** both devices end with the **same** name (the later edit wins). The top bar shows **Review 1**. Opening Sync shows the version that lost with a **Put that version back** button; pressing it brings that name back on both devices after the next sync. Nothing disappears silently.
- **Bad looks like:** the two devices stay different after three syncs; the edit that lost is nowhere to be found; the task is duplicated.
- **Safe on your normal device?** Yes, it only touches the test task. Delete `ZZ conflict test` afterwards.
- **Test window needed?** No. Do not set up Sync just for this if you have never used it.

### Step 11. Do the household numbers agree on both devices? (only if you use Sync)
- **Do:** after step 9, on both devices open **Household finances** and compare the three headline figures (committed, expected, recorded spending).
- **Good looks like:** identical on both devices.
- **Bad looks like:** different numbers on the two devices after two syncs.
- **Safe on your normal device?** Yes (only looking).
- **Test window needed?** No.

### Step 12. Download a backup
- **Do:** open **Settings > Backup**. Tap the plain backup button, then **Export encrypted backup** (type a passphrase you will remember, and write it in your password manager **before** you export). Look for the downloaded file (for example in Downloads or Files).
- **Good looks like:** you can see a file named like `Ledger Backup ....json` and one ending `.ledgerbackup`; the page shows today as "Last backup".
- **Bad looks like:** nothing downloads; you cannot find the file; the passphrase you typed is not the one you saved.
- **Safe on your normal device?** Yes. This only copies your data out. Keep the files somewhere private (a plain backup is **not** encrypted and can be read by anyone who has it).
- **Test window needed?** No.

### Step 13. Restore an encrypted backup into a test window (the rehearsal that matters)
- **Do:** create a make-believe encrypted backup first: in a **test window** with the make-believe household from A3, go to Settings > Backup, type the test passphrase `test only 123`, tap **Export encrypted backup**. Close that test window. Open a **new** test window (empty). Go to Settings > Backup, type the same passphrase, choose the `.ledgerbackup` file under "Restore an encrypted backup".
- **Good looks like:** a box says the file was decrypted and checked, and lists how many accounts and transactions it holds, and says nothing has changed yet. Pressing **Replace my data** restores Test checking and its three transactions and the `ZZ test task`.
- **Then try a wrong passphrase** in a third test window: it must refuse with "Wrong passphrase or corrupted backup. Nothing was changed."
- **Bad looks like:** it accepts a wrong passphrase; the counts are wrong; the restored data is missing pieces.
- **Safe on your normal device?** Only in a test window. **Never restore over your real data as a test.**
- **Test window needed?** **Yes.**
- **If you want to rehearse with your real weekly copy from GitHub:** download the `.ledgerbackup` file from your private backup repository on GitHub to your computer (you do this yourself in GitHub, signed in as you), then restore it in a **test window** using your real backup passphrase typed only into that test window. Close the test window afterwards. This proves your real backups can really be opened.

### Step 14. Screen-reader smoke test (15 minutes)
A screen reader speaks what is on the screen. Try one: **VoiceOver** (iPhone), **TalkBack** (Android), or **NVDA** (free, Windows). Test **Budget** and **Scheduled** first.
- **iPhone, VoiceOver:** Settings > Accessibility > VoiceOver > on. Swipe right to move to the next item, double-tap to activate, swipe with two fingers up-and-back (a "Z" scrub) to go back/close. To turn it off the same way.
- **Android, TalkBack:** Settings > Accessibility > TalkBack > on. Swipe right/left to move, double-tap to activate.
- **Windows, NVDA:** free from nvaccess.org; press Ctrl+Alt+N to start. Use Tab to move between controls and the arrow keys to read.
- **Do (Budget):** go to Ledger > Budget and move through the "Assigned" boxes.
- **Good looks like:** each box is read with its purpose and category, for example "Assigned amount for Groceries, edit text". It must **not** say just "edit text" or "edit text 0.00".
- **Do (Scheduled):** go to Ledger > Scheduled and move through a row.
- **Good looks like:** you hear which item each date box, amount box and button belongs to ("Posting date for Rent, scheduled ...", "Approve ..."), and what will happen.
- **Do (errors):** type something invalid (for example leave a required box empty and try to save).
- **Good looks like:** the problem is spoken, and focus lands on the box that needs fixing.
- **Do (Hide Amounts):** on Today, switch on **Hide amounts**, then move through Today, Calendar, Bills, Household Services and Household finances.
- **Good looks like:** **no dollar amount is spoken** anywhere on those screens. (Ledger's own pages such as Accounts and Budget still show amounts: that is documented, not a bug.)
- **Bad looks like:** boxes read as just "edit text"; buttons read as "button" with no record; an error appears but is not spoken; a dollar amount is spoken while Hide amounts is on. Write down the screen and the exact words.
- **Safe on your normal device?** Yes (reading only, do not save changes).
- **Test window needed?** No.

### Step 15. Recovery after a browser is wiped, safely
- **Do:** this uses a test window so no real data is at risk. In a test window, restore the make-believe encrypted backup (step 13). Confirm the data is there. **Close the window** (this wipes it, which is the point). Open a **new** test window: it is empty. Restore again from the saved file.
- **Good looks like:** you are back to the same make-believe household in under two minutes using only the file and the test passphrase.
- **Then check:** in the restored window, open **Settings > Sync**. It should ask you to set Sync up again (the sync token and passphrase are **not** in a backup, on purpose).
- **Bad looks like:** the data comes back incomplete; you needed something you did not have.
- **Safe on your normal device?** Only in a test window. **Never wipe your real browser to run this.**
- **Test window needed?** **Yes.**

### Step 16. Are your secrets stored outside Ledger?
- **Do:** open your password manager (or the paper you use). Check that all of these are stored there **by name**, not in Ledger: (1) the GitHub sign-in and its two-factor recovery codes, (2) the GitHub **token** for Ledger's private repository and the date it expires, (3) the **sync passphrase**, (4) the **backup passphrase**, (5) where your encrypted backups are kept, (6) that a trusted person knows where to find the password manager (Ledger's "If something happens" guide page says how).
- **Good looks like:** every item is there, and you can read the backup passphrase without opening Ledger.
- **Bad looks like:** any of them exists only in your head, or only inside Ledger. **A lost passphrase cannot be recovered by anyone, including Claude.**
- **Safe on your normal device?** Yes. **Never paste a token or passphrase into a chat.**
- **Test window needed?** No.

### Step 17. Read two numbers on the Sync page (only if you use Sync)
- **Do:** open **Settings > Sync** and read **file size** and **uploads in the last 30 days**. Write both down.
- **Good looks like:** the file is a few hundred KB, and uploads are a few dozen a month.
- **Bad looks like:** the file is several MB or uploads are in the hundreds (tell Claude; there is a cheap fix).
- **Safe on your normal device?** Yes (only reading).
- **Test window needed?** No.

### Step 18. The one-time first update on your phone (do this the next time a new version is published)
- **Do:** after the next release, open Ledger on Wi-Fi and wait a minute. The first update on each device downloads the whole app once (about 2.4 MB). Then check Ledger still opens in Airplane mode.
- **Good looks like:** nothing visibly changes; Airplane mode still works.
- **Bad looks like:** after the update a part will not open offline.
- **Safe on your normal device?** Yes.
- **Test window needed?** No.

### Step 19. Decide about the shared web address (hosting isolation)
Ledger lives at `marshmond.github.io/ledger/`, and your two other apps (FBB and Foodventory) live at the same `marshmond.github.io`. A web browser treats all three as **one site**, so a bug in either of the other two could let someone read Ledger's data, including your saved GitHub token. I found no sign this has happened, and I did not test the other apps for bugs. Nothing in Ledger's code can fix it; it needs a change in where Ledger is published.
- **Your options** (details in `docs/LEDGER-HOSTING-ISOLATION-PLAN-2026-11-08.md`):
  - **A. A web domain just for Ledger** (about ten to fifteen dollars a year, my estimate, not confirmed). Keeps everything else the same.
  - **B. A separate free GitHub account or organization for Ledger.** Free; the Ledger repository moves there.
  - **C. Move the other two apps elsewhere.** Free; leaves Ledger as is, but the same problem returns if you ever publish anything else there.
  - **D. Accept the risk** for now. If you choose this, tell Claude in writing, because Family Management (children's information) should not start on this basis unless you have decided so on purpose.
- **Do:** tell Claude (or ChatGPT) which option you choose. **Nothing will be changed until you say so, and I will never ask you for a token or password.** The move would be rehearsed with invented data first, you would back up first, and your old address would keep working as the way back.
- **Safe on your normal device?** Yes, this step is only a decision.
- **Test window needed?** No.

### Part B2. Two short platform checklists (the things that differ between phones)

**iPhone: Safari and the Home Screen app.** Tick each when you have seen it with your own eyes.
- [ ] Opened in **Safari** itself (not another browser) and used Share > Add to Home Screen.
- [ ] Took a backup (step 12) **before** the first launch from the new icon, because the icon app may start with its own empty storage.
- [ ] On **Settings > Backup**, the line about the browser protecting your data says it is protected (if not, tap **Ask the browser to protect it**). Apple may remove a website's stored data from a normal Safari tab after a long time unused; Apple's rule is that a Home Screen app is not treated that way. *This is Apple's documented behavior as I understand it, not something I could check on your iPhone.*
- [ ] Airplane mode: closed the app from the app switcher (swipe it away), reopened it from the icon: opens, modules work (step 8).
- [ ] Sync runs only while Ledger is open on an iPhone (the phone pauses the app in the background). After opening it, give it a few seconds, then check the Sync page.
- [ ] The keyboard does not hide the box you type in, in portrait **and** landscape.

**Android: Chrome and the installed app.**
- [ ] Used the **Install app** menu item (not only a bookmark shortcut); it opens in its own window with no address bar.
- [ ] On **Settings > Backup**, storage is shown as protected (if not, tap the button). Android can clear stored data of apps when the phone runs very low on space; a recent backup is your protection.
- [ ] Airplane mode: swiped the app away from recent apps, reopened: opens, modules work (step 8).
- [ ] The system Back gesture/button inside the installed app goes to the previous Ledger screen and does not close the app on the first press from a sub-page.
- [ ] Rotating the phone keeps what you were typing.

---

## Part C. Recovery guide: what to do if something goes wrong

**The one idea that explains everything:** Ledger keeps your data **only inside the browser on each device**. A saved **backup file** (plus its passphrase if it is encrypted) can rebuild everything on any device. The **GitHub token** and the **sync passphrase** are never inside a backup; they are re-created or remembered.

| What happened | What you need | What to do | Can it be recovered? |
|---|---|---|---|
| **I replaced my phone** | Your sync token and sync passphrase (if you use Sync), **or** a backup file and its passphrase | Open Ledger on the new phone > Settings > Sync > set up with the same private repository, token and passphrase, choose **"use the synced copy"** (a safety copy is saved first). **Or** Settings > Backup > restore your latest backup file. Then add the app to the Home Screen again. | **Yes**, provided you still have the sync passphrase **or** a backup and its passphrase. |
| **I cleared my browser's storage by mistake** | The same as above | The data on that device is gone. Restore from sync ("use the synced copy") or from your latest backup file. | **Yes**, back to your last sync or last backup. Anything done after that is lost. |
| **I lost my computer** | Another device that has Ledger, **or** a backup file | Use any device that still has your data (or the latest backup) to restore onto a new computer, as for a new phone. | **Yes**, if a device, a backup or a sync copy survives. |
| **I forgot or lost my GitHub token** | A GitHub sign-in | The token only lets Ledger reach the private sync repository. Sign in to GitHub, create a **new** token with permission **Contents: read and write** for that one repository only, and enter it in Settings > Sync. Delete the old token on GitHub. **Your data is not lost.** | **Yes.** No data depends on the token. |
| **I forgot the sync passphrase** | A backup file with a passphrase you remember | The synced copy **cannot** be opened without it, by anyone. Restore from a backup file instead, then set up Sync again with a **new** passphrase (a new empty sync copy is created). | **Only through a backup.** The old synced copy is permanently unreadable. |
| **I forgot the backup passphrase** | Nothing can help | An encrypted backup **cannot** be opened without its passphrase. Use sync or another backup that you can open. | **No**, for that file. This is why step 16 matters. |
| **I lost access to GitHub entirely** | A backup file kept outside GitHub (on your computer, a USB stick or a cloud drive) | Your data on your devices is unaffected. Restore from a backup file if a device is wiped. Create a new GitHub account and private repository to start Sync again. Weekly backup copies that lived only on GitHub are not reachable. | **Yes** for data on a device or in a backup you hold elsewhere. **No** for copies that existed only on the lost GitHub account. |
| **I want to go back to an older backup** | The backup file (and passphrase if encrypted) | Settings > Backup > restore it. A safety copy of what you have now downloads first. **If you use Sync, the restored data replaces the data on your other devices at their next sync** (records the backup does not contain are removed there too). | **Yes.** Keep the safety copy until you are sure. |

**Always:** keep at least one recent backup somewhere that is not the same device. Write down the three secrets (token, sync passphrase, backup passphrase) in your password manager.

---

## Part D. Your results (tick as you go)

Write **P** for passed, **F** for failed (and what you saw), or **S** for skipped. Date and device next to each.

| # | Step | iPhone | Android | Computer | Notes (what you saw) |
|---|---|---|---|---|---|
| 1 | Open every part on the phone | [ ] | [ ] | n/a | |
| 2 | Search and Quick Add | [ ] | [ ] | n/a | |
| 3 | Edit a Budget amount | [ ] | [ ] | [ ] | |
| 4 | Approve / skip a Scheduled item (test window) | [ ] | [ ] | [ ] | |
| 5 | Transactions checkbox; Calendar | [ ] | [ ] | [ ] | |
| 6 | Delete confirmation, cancelled (test window) | [ ] | [ ] | [ ] | |
| 7 | Install on the home screen | [ ] | [ ] | n/a | |
| 8 | Airplane mode and offline entry | [ ] | [ ] | n/a | |
| 9 | Back online and syncing | [ ] | [ ] | [ ] | |
| 10 | Two devices edit the same task | [ ] | [ ] | [ ] | |
| 11 | Household numbers agree on both devices | [ ] | [ ] | [ ] | |
| 12 | Backup downloaded (plain and encrypted) | [ ] | [ ] | [ ] | |
| 13 | Encrypted restore into a test window; wrong passphrase refused | [ ] | [ ] | [ ] | |
| 14 | Screen-reader smoke test (Budget, Scheduled, errors, Hide amounts) | [ ] | [ ] | [ ] | which reader: |
| 15 | Wipe-and-recover rehearsal in a test window | [ ] | [ ] | [ ] | |
| 16 | Secrets stored in a password manager | n/a | n/a | [ ] | |
| 17 | Sync page numbers read | n/a | n/a | [ ] | file size: __  uploads/30 days: __ |
| 18 | First update on the phone (next release) | [ ] | [ ] | n/a | |
| 19 | Hosting decision made | n/a | n/a | [ ] | chosen option: A / B / C / D |

**When all of steps 1 to 8, 12, 13 and 16 are ticked P, and step 19 is decided, Claude can recommend a full GO** (steps 9 to 11 if you use Sync, 14 and 15 are strongly advised, 17 and 18 are quick).

## Part E. Decisions Claude needs from you

1. Which hosting option (step 19): A, B, C or D.
2. Whether to authorize one small, separate "sync safety" change: it makes an out-of-date device unable to erase newer kinds of data, and makes two open tabs unable to overwrite each other's saved conflict list. (Claude recommends it before the app grows.)
3. Whether to authorize two tiny look-and-feel fixes (a heading level on the Household Services page and the width of one link on Ledger's Home).
4. Whether to start planning Family Management once the above is settled (it is not started and nothing here begins it).
