# Ledger CAL-N0 + CAL-N1 (core): Calendar Communications (report)

Status (2026-11-16): **BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. AWAITING CHATGPT REVIEW. NOT REAL-DEVICE TESTED. NO EMAIL WAS SENT AND NO EMAIL CAN BE SENT: SENDING IS NOT CONNECTED.** Proposed commit message: `feat(calendar): add opt-in event notification workflow`.

**This phase combines the narrow CAL-N0 decisions with CAL-N1's local implementation foundation**, as the brief directed, rather than adding a separate paperwork-only design phase. The CS-0 / CS-0.1 communications design (section J) was used as the approved starting design and its recommendations were taken as defaults; no new design document was written. **Do not read this as "CAL-N1 delivery is complete": live email delivery is NOT built, NOT configured and NOT tested.** Only the workflow, the state model, the transport abstraction, a test sender and an unused, unverified real-writer are built.

**Baseline gate (verified first):** `main` = `origin/main` = `6647bf6`; GitHub Pages run **#132** `completed` / `success` (public Actions API; `gh` is not installed), so **R4.3 is committed and deployed** (`d4d3eb6`, then the one-line test fix `6647bf6` after run #131 failed on my own earlier test, not on app code). The only uncommitted changes to existing files at the start were two documentation status lines (`docs/CHATGPT-HANDOFF.md`, `docs/LEDGER-R4.3-REPORT.md`) recording that release; they were left exactly as found and are not code. The three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`) were not modified.

**Family Command Station:** CS-3 and the live Family Command Station remain **deferred by the owner**. Nothing of CS-3 was started or configured, and `src/display/` was not touched (the Calendar editor still calls its CS-1 helpers exactly as before).

**RELEASE CORRECTION (2026-11-17, ChatGPT-accepted):** the after-save, after-delete and after-Undo questions are now shown ONLY when a sender is connected (`senderConnected()`), so in the production app, which has none, Save, Delete and Undo never prompt and never write a declined record; the review screen stays available from the event's Messages card, labelled not connected, and Approve only saves an approval. The UI tracker and baseline now record the review screen: Calendar dialogs 9, Modal sites 64 in 43 files. Released as `feat(calendar): add opt-in event notification workflow`; SHA and Pages result are in the completion summary. No plaintext recipient data is published anywhere: no outbox exists.

## 1. What the owner can now do

1. **Create or edit an event and press Save, exactly as before.** The event is saved first. Then, only if the change matters to other people **and** at least one Contact has a usable email, a small non-blocking panel appears at the bottom of the screen: **"Event saved. Email someone about it?"** with **Not now** and **Choose people**. (For a new event: "Event added." There is no separate "saved" toast when the panel appears, so there is not a second save confirmation. If there is nothing to offer, the old toast shows as before.) The Calendar stays fully usable behind the panel.
2. **Not now** records one `declined` entry and nothing else. Closing the review screen with Cancel or the X records and sends nothing.
3. **Choose people** opens the review screen ("Email about this event"): who should know, what to include, how it is sent, and a preview of the exact message per person. Nothing is ticked for the owner.
4. **Delete** (any scope) keeps working with its Undo. The "Delete a repeating event" dialog gains one unticked option, **"Then choose people to email that it is cancelled"**; ticking it opens the (unsent) review right after the delete. Whether or not it is ticked, a delete also offers the same non-blocking question, "Event deleted. Let someone know it is cancelled?" (a one-off event has no confirmation dialog today, so for it the question appears after the delete).
5. **Undo** of a delete that people were already told about offers a **correction** ("Send a correction to the people who were told it was cancelled?"). It is only an offer; the owner still chooses and approves.
6. **Messages** (a collapsed card at the bottom of the event editor, "Messages (n)"): per notification, the date, what it was, each recipient with a status badge in plain words, the reason when something failed, and the action that fits (Send now, Try again, Check status, Send again anyway). "Email people the saved details…" starts a notification for the saved event at any time (used to recover from a stale message, and to make the feature discoverable). Opening it does not send anything.
7. **Today, in the real app, sending is not connected.** The review screen says so in a warning box ("Email sending is not connected yet"), its button reads **Approve** (not Send), and pressing it saves the owner's approval with the exact text and shows **"Approved, not sent"**. Nothing leaves the device.

## 2. What counts as a meaningful change

| Prompts | Does not prompt (no panel) |
|---|---|
| a new event | notes |
| title | priority |
| date (including the last day of an all-day span) | reminders |
| start time, end time or length (shown as "the time") | tags |
| all-day on or off | project |
| location | calendar layer, "keep until done" |
| the repeat rule | a save that changes nothing |
| people involved added or removed | |
| a delete or cancel of any scope | |

For **"this one date only"** the repeat rule and the people belong to the whole series, so they are not compared. An edit that only touches the non-prompting items returns no offer (tested field by field). The location change is described as "The place has changed." unless the owner ticked "Include the place" (then "was/now" is shown).

## 3. Recurring events

The wording is computed from the event's real repeat rule and real dates (never the title), using the Calendar's own `describeRule`-style data; the recurrence engine is **not** changed. The scope is taken from what Ledger actually did: "this and following" on the **first** date is really the whole series (Ledger edits all), so it is described as the whole series.

| Case | Subject / main sentence (from the tests) |
|---|---|
| new event | `New: Soccer practice, Wed, Nov 18 (repeats)` / "New repeating event: Soccer practice. Every week on Wednesday, starting Wednesday, November 18." |
| one date changed | `Updated: Soccer practice, Wed, Nov 18 only` / "has changed for Wednesday, November 18 only. The other dates are unchanged." + "Time: now 5:00 PM to 6:00 PM (was 4:30 PM to 5:30 PM)" |
| this and following | `Updated: Soccer practice, from Wed, Nov 18` / "changes from November 18 onward. Dates before November 18 are unchanged." + the new repeat and start date |
| whole series | "has changed for the whole series (Every week on Wednesday)." + the time and repeat |
| one date cancelled | `Cancelled: Soccer practice, Wed, Nov 18` / "Cancelled: Soccer practice on Wednesday, November 18 only. The other dates are unchanged." |
| this and following cancelled | "Cancelled from November 18 onward: Soccer practice. Dates before November 18 are unchanged." |
| series cancelled | "Cancelled: the whole series of Soccer practice (Every week on Wednesday)." |
| correction after Undo | "Correction: Soccer practice on Wednesday, November 18 is on again. The earlier cancellation no longer applies to that date." |

**Split series:** "this and following" makes a **new event id** (existing behavior). The notice records **both ids** (`eventIds`: old and new), the date the range starts (`affectedDate`), and which event the text describes (`factsEventId`: the new one), so history and the stale check can follow the split. The Messages card of the event the owner edited lists the notice.

## 4. Recipient selection

- **People involved** (`contactIds`), **notification recipients** (chosen per message) and **calendar invitees** (not built) are three separate things; the code never infers one from another.
- **Nobody is pre-selected** (tested: an event with involved people yields zero recipients until the owner ticks someone). Involved people are listed first as a convenience; **"Select all involved people with email"** is one button; **"Add someone else"** adds any other Contact with a usable address; chosen people appear as chips with an X, and the checkboxes also remove.
- A Contact with **no or an invalid address is listed as unavailable with the reason** ("No email address.", "The email address does not look right."); the count of other unusable Contacts is shown. **Two Contacts with the same address are never both emailed** ("Same address as ..."; comparison ignores case and spaces). **At most 10 recipients** per notification (the control stops at 10 and says so).
- A person already emailed about the same change shows "Already emailed about this (Waiting)" and cannot be chosen again; someone whose last attempt failed can be chosen (a new attempt).
- No Contact consent field was added (the brief: only if it solves a concrete problem; each message's recipients are approved by the owner anyway).

## 5. State model, history and duplicate suppression

**History** is append-only `moduleRecords` rows (`module: 'calendar'`, `kind: 'notice'`): **no new table and no migration** (backup, restore and sync already carry `moduleRecords` and `settings`; verified in `lib/backup.ts` and `lib/sync`). Three record types, never edited: `declined`, `send` (written when the owner presses Send/Approve, **before anything is handed over**, holding the exact text approved for each recipient and the address used), and `progress` (what the sender reported or Ledger could tell, with the sender that produced it). The current state is worked out by folding the records, with the best-informed record winning (`confirmed` < `unknown` < `queued` < `failed` < `accepted`), so two devices can never overwrite each other. Unreadable records are ignored and never counted as sent.

| State | Meaning on screen |
|---|---|
| Declined | "You chose not to email: ..." (final; nothing ever sends from it) |
| Drafted | the review screen is open (screen only, never stored) |
| Confirmed | "Approved" (sender connected) or "Approved, not sent" (not connected); exact text on record |
| Queued | "Waiting": handed to the outbox; the mail service has not confirmed |
| Accepted | "Accepted by mail service" (a live sender), or "Accepted by test sender" with "Nothing was really sent", or "Accepted (sender unknown)" if the sender was not recorded. **Never "delivered", "received" or "read"** (a test scans the screen text) |
| Failed | "Not sent" + a plain reason (address refused, mail service refused, daily limit, not allowed, **event changed**, never received) |
| Outcome unknown | "Ledger cannot tell whether this was sent. Sending it again could send a second copy." |

**Deterministic identity** (`notify/identity.ts`): `noticeKey` = SHA-256 of one change to one event (event ids, kind, scope, affected date, what changed, the before and after text the message depends on, what the owner chose to disclose; **not** the personal note). **`requestId` = SHA-256(noticeKey | address)** is the unit that is sent at most once, so the same person is never told twice about the same change even if the owner later picks a different group. The outbox file is named by that id (attempt 1) or `<id>.a2`, `.a3` (a deliberate manual retry), so a double press, a reopened dialog, a second device and a reload all derive the **same file name** and the outbox refuses the copy. Within one device the second press finds the first press's record inside a database transaction and sends nothing new (tested with two simultaneous presses; also checked in the real browser database: exactly one `send` record). A genuinely revised event or a different recipient produces a new key or id, on purpose.

**Retry** is only ever a button press. After a **definite failure**, "Try again" re-sends the **same approved text** as attempt n+1. After an **unknown** outcome, "Check status" first asks the sender; "Send again anyway…" opens a confirmation that says "This may send a second copy". A message that failed because the event changed is **never retried as it was** (it must be reviewed again). There is no timer, no loop, no start-up job and no sync hook anywhere in the folder (a test scans for `setInterval`, `setTimeout`, online listeners and sync listeners). "Check status" asks the sender what became of waiting or uncertain messages once and never re-sends.

**Stale protection:** before anything is handed to a transport, Ledger re-reads the event and compares it with what the owner approved (a digest of exactly what the message says, so a change to a place the message does not mention is not a false alarm; for a cancellation, whether it is still cancelled). If it differs, nothing is handed over and each message is recorded as **failed: "The event changed after you approved this message, so it was not sent. Review it again."** This applies to "Send now" later and to a message approved while sending was not connected (tested: change after approval, undo of an approved cancellation, no false alarm in any scope).

**Limits:** 10 recipients per notification and 30 approved messages per rolling 24 hours, checked by Ledger before approving (CS-0 J.8 rule 7). The sender service must enforce the same limit where it runs.

## 6. Privacy and safety

- **Nothing sends on Save, Undo, sync or start-up.** The only code that records an approval or calls a transport is behind the Send, Send now, Try again and Check status buttons. A test proves `EventEditor.tsx` and `CalendarPage.tsx` import nothing that sends, and that the Undo path only offers a correction.
- **A message can only contain what its data shape can hold.** The text is built from `EventFacts` (title, times, place, repeat, names), which has no field for notes, tags, priority, reminders, project, amounts or other events; the test uses an event whose notes, amounts and an account number contain sentinels and confirms none appears, in the message **or in the stored history**. Place and the names of people involved appear only when the owner leaves them on for that message; other recipients' addresses and names never appear (each person gets their own message with their own first name).
- **Recipient addresses stay out of logs:** a test fails if any notify file calls `console` or `debugger`. Addresses are stored only in the history records (which travel in the owner's encrypted backup and sync, as Contacts already do) and in an outbox request when a real sender exists. No public file ever holds one.
- **No email-provider secret or token exists in the browser or the repository.** No UI stores a token; the real writer takes its configuration as an argument and nothing supplies it.
- **No broad permission was introduced.** The outbox design asks for a Contents-only token on a dedicated private repository (see section 8).

## 7. Sending architecture: what is implemented and what is not

Chosen provisional architecture (CS-0 J.7, E4), unchanged: a **dedicated private outbox repository** (separate from the sync repository, the display repository and GitHub Pages) with a workflow that invokes a **send-only** email service; the provider key lives in a repository secret, never in the browser.

| Part | State |
|---|---|
| Request and result **file formats** (canonical JSON, deterministic file name, defensive result reader) | **Built and tested** (`notify/transport.ts`) |
| `NoticeTransport` interface (`submit`, `status`; outcomes queued / accepted / duplicate / rejected / unknown) | **Built and tested** |
| **Fake sender** (modes accept, queue, reject, unreachable, lost-reply, quota; idempotent by id; sends nothing) | **Built**; used by tests and by a **development-only** console switch `__ledgerFakeMail(mode)` that is removed from the production build (checked: the string is absent from `dist/`) |
| `githubOutboxTransport`: writes `requests/<id>.json` and reads `results/<id>.json` through the GitHub contents API (modelled on the verified CS-2 display client) | **Built, unit-tested with a fake `fetch` only; UNVERIFIED against a live repository; used by no screen; no token is stored anywhere** |
| The outbox repository, the workflow, the email provider, the sender identity, any credential | **NOT created.** Nothing external was created and nothing was sent. |
| `getTransport()` | returns **null** in the real app, so the screens say "Email sending is not connected yet" and nothing can leave |

Sender-dependent choices are configurable and not hardcoded: the owner's **display name** (required) and an optional **reply address** are asked once on the review screen and kept in one `settings` row (`calendarNotices`); the sender **address**, provider and domain belong to the (not yet existing) sender service. `mailto:` was **not** substituted.

## 8. What remains before a real message can be sent

1. **Owner decisions:** the email provider and the sender identity (a dedicated send-only address, Reply-To the owner, per CS-0 J.7), the outbox repository name, and whether to seal the request body (see deviation 11).
2. **Create (by the owner, never in chat):** the private outbox repository; a fine-grained, Contents-only token for it; the provider's send-only key stored as a repository secret.
3. **Write and review the workflow** that reads `requests/*.json`, sends one message, writes `results/<id>.json` in the format `parseResult` reads, enforces the 10-per-message and 30-per-day limits, and refuses an id it has already answered.
4. **Connect Ledger:** a way to enter the token on a device (device-only storage decided with the owner, as CS-2 did for its display token), register `githubOutboxTransport`, and verify the contents-API behaviours marked UNVERIFIED (create-only refusal of an existing file, result read-back).
5. **Dry run to the owner's own addresses only**, recorded as an owner check, then a real-device check on phone and computer. Delivery to an inbox cannot be proved by tests.
6. Gate G3 from CS-0 (CS-2's credential practice proven on a real device) applies if this transport is kept.

## 9. Tests and browser verification

**Tests:** new `src/modules/calendar/notify/notify.test.ts`, **62 tests**, written first for the behaviors that could produce a wrong or unwanted message, with invented people (`.test` addresses) and the fake sender, covering the thirteen areas of the brief:
1. saving never depends on notifications (an offer that throws is swallowed; the editor calls the offer only after the save and wrapped);
2. Not now and Cancel send nothing; building an offer or a preview writes nothing;
3. nobody is selected; unavailable reasons; shared addresses; the 10 limit; no offer when nobody has an address;
4. each meaningful change prompts, and notes, priority and reminders do not;
5. every recurring scope's wording (one, following with the new id, whole series, first-date following, new repeating event, multi-weekday rule with end date);
6. every cancellation scope (one, following, whole series, first-date following, single event) and that the delete still works;
7. private notes, tags, amounts, other events and other recipients' addresses are excluded from the message **and the stored history**; place and people only when allowed;
8. duplicate suppression (two simultaneous presses, a second device, the same person with a different group, a revised event, a reload, the daily limit);
9. queued, failed, lost reply, unreachable, "unknown becomes a definite failure", retry text identical, double retry press, and honest wording (a message accepted by the **test** sender is never described as really sent, even if it was approved while no sender was connected; no "delivered/received/read");
10. stale protection (change after approval, undo of an approved cancellation, unchanged goes out, hidden place changes do not trigger, no false alarm in any scope);
11. the Undo correction offer, and "details" for one date or one event;
12. approving, sending, retrying, checking and declining leave every event, contact, transaction, account and setting exactly as they were (only history rows are added);
13. the request format, the result reader, and the GitHub writer (key only in the Authorization header; 201 queued, 422 duplicate, 401 rejected, 5xx or a dropped connection unknown).

**Run results:** focused file, then the Calendar, display, contacts and shell suites (59 files, 1,456 tests, all pass), then **one full run on the finished code (section 11)**; `npx tsc --noEmit` clean; `npm run build` succeeds (the existing chunk-size warning only). The existing editor guards that read `EventEditor.tsx` as text (five section headings, the exact `saveEdit(...)` and `createEvent(...)` call text, the Save/Cancel markup, the Contact picker used by exactly three files) all still pass; the Messages card therefore deliberately does not use the `cal-sec-title` heading class and the recipient chooser is not named like the shared Contact picker.

**Browser verification** (built-in browser, the invented demo household on `localhost:5173`, sync off, 1024 px desktop and 375 px phone):
- Created a repeating "Soccer practice" through the real editor with Coach Example as a person involved. The prompt appeared after Save: "Event added. Email someone about it?" with the Calendar usable behind it.
- **Choose people** showed the warning "Email sending is not connected yet", an unchecked involved person, "7 other contacts have no usable email address", the Approve button disabled as "Choose someone first". After "Select all involved people with email", a name, and the preview (correct text, "Eastern Standard Time"), **Approve** showed "Approved, not sent" and recorded exactly one `send` record. The event's Messages card showed it.
- With the dev switch on (`accept`): **Send now** worked; a first run **exposed a real defect** (a message accepted by the *test* sender was labelled "Accepted by mail service" because the wording read the sender recorded at approval time, none). **Fixed** (each step now records the sender that produced it; unknown sender reads "Accepted (sender unknown)") and covered by tests. Re-run: "Accepted by test sender. Nothing was really sent."
- Edited one date to 5:00 PM ("This event"): prompt, then review showed "Test mode", the remembered sender name, and "Soccer practice has changed for Wednesday, November 18 only..." with "Time: now 5:00 PM to 6:00 PM (was 4:30 PM to 5:30 PM)". **Delete** dialog showed the new unticked option; ticking it and choosing "This event" opened the cancellation review ("Cancelled: Soccer practice on Wednesday, November 18 only...") and **Cancel left the history count unchanged**.
- `queue` mode: **pressing Send twice in a row produced exactly one `send` record and one queued request**; the screen said "Waiting: Handed to the sender. The mail service has not confirmed it yet."
- **375 px:** the prompt (16 to 359 px wide, two large buttons) and the review screen (a bottom sheet) fit with no sideways scroll (page scroll width 375, dialog overflow 0); a Contact with no address showed "No email address." and a disabled box. **Dark mode** at desktop width checked for the review screen. Console: no errors.
- **Not verified:** a keyboard-only walk and a screen reader; light mode at 375 px; Safari and Firefox; a real phone; the whole-series and "this and following" cases and the Undo-correction prompt **in the browser** (all three are covered by unit tests and a source guard, not by a browser run); failure and unknown states **in the browser** (unit-tested); and, of course, anything about real email.
- The demo household in the browser profile was changed by this check (a "Soccer practice" event, its history rows, a renamed "Dentist appointment (new office)", a test sender name). Invented data only; nothing was committed.

## 10. Files

New, in `src/modules/calendar/notify/`: `types.ts`, `facts.ts` (facts, meaningful-change detection, state text), `wording.ts` (all message text), `recipients.ts`, `identity.ts`, `records.ts` (history records, folding), `transport.ts` (formats, interface, fake sender, GitHub writer), `offers.ts` (when to offer, from the saved event), `send.ts` (approve, deliver, retry, check, stale check), `settings.ts`, `words.ts` (status words), `devSwitch.ts`, `NoticePrompt.tsx`, `NoticeComposer.tsx`, `MessagesSection.tsx`, `notify.test.ts`. Edited: `EventEditor.tsx` (an `onNotify` prop, the offer after save and delete, the Undo offer, the delete option, the Messages card), `CalendarPage.tsx` (holds the prompt and review), `calendar.css` (a block of `.cal-np*` and `.cal-msgs*` rules using tokens only). Documents: this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `docs/UI-COVERAGE.md` (a paragraph; no row changed). **No table, migration, dependency, backup or sync change; one new `settings` key (`calendarNotices`) and one new record kind (`notice`).** Events, recurrence code (`series.ts`, `occurrences.ts`, the recurrence module), Finance and the display layer were not changed.

## 11. Final verification totals

**One full run on the finished code: 323 files, 6,419 tests, all pass** (before this phase: 322 files, 6,357 tests, so +1 file and +62 tests, all in `notify.test.ts`). `npx tsc --noEmit` clean. `npm run build` succeeds (existing chunk-size warning only); the development-only sender switch is absent from `dist/`. The Calendar, display, contacts and shell suites were also run on their own (59 files, 1,456 tests, pass). No existing test was edited or re-pointed; no flake was seen in this run.

**UI residue report (informational, never fails):** the review screen adds one `<Modal>` call site, so the source count is now **64 sites in 43 files** against the recorded D5/D11 baseline of 63 in 42 (`src/shell/uiBaseline.ts`). I did **not** change the baseline or the UI-COVERAGE dialog table (the table and its guard stay at 63 / 42), because moving a ratchet is a design-phase decision; the new dialog is described in `docs/UI-COVERAGE.md` as an addition outside the tracker's count. No inline style, hex colour, native `confirm()` or `!important` was added (the new CSS uses tokens only; the "send again" question uses the shared `ConfirmDialog`).

## 12. Judgment calls and deviations (please review)

1. **"Drafted" is screen-only.** Storing a record every time the review opens would leave a trail of abandoned drafts; the stored states start at Confirmed. (Declined is stored.)
2. **Approve while sending is not connected** records the approval and exact text as **Confirmed ("Approved, not sent")**, to be sent later with "Send now" (re-checked for staleness). This is what Approve does in the real app today. The alternative (refusing to approve until a sender exists) would have left nothing to test or review end to end.
3. **Per-recipient ids** rather than one id per batch: the same person is never emailed twice about one change, even if the group differs next time. The cost: choosing "A" then "A and B" sends only to B the second time (A shows "Already emailed about this").
4. **The personal note is not part of the notification identity** (so retyping it is still "the same notification"); the two disclosure switches (place, people) are part of it.
5. **A stale message is recorded as Failed with the reason "event changed"**, not as a new state, and is never retried as it was. The brief's seven states are kept as written.
6. **Delete:** the option in the scope dialog is an unticked pre-answer; the after-delete question appears regardless (and is the only route for a one-off event, which has no confirmation dialog; adding one would have changed existing delete behavior). The correction after Undo is offered only when people were actually told (queued, accepted or unknown), not when the cancellation was only approved.
7. **"Email people the saved details…"** (kind `details`) is an addition beyond the brief: the natural way to recover from a stale message, to tell someone later, and to make the feature discoverable. It is easy to remove.
8. **Sender name and reply address** are asked on the review screen and remembered in one settings row; there is no Settings page for them yet. The sender address and provider are deliberately absent.
9. **The 30-per-day limit** (CS-0 J.8) is enforced by Ledger before approving, in addition to the 10-recipient limit the brief names.
10. **The GitHub writer exists but is unused and UNVERIFIED.** Writing it now was judged grounded (same documented API as the verified CS-2 client) and safe (no credential, no screen uses it); it can be deleted if the transport decision changes.
11. **The request body is plain JSON in a private repository, not sealed.** CS-0 J.7 spoke of an "encrypted request file". Sealing needs a key shared with the workflow, which cannot be designed without the workflow; the format carries room for it. This is an **open decision before live sending** (recipient addresses and message text would otherwise sit readable in the owner's private repository).
12. **Only the event editor offers a notification.** Events created from Quick Add, the Add box, Today or the Tasks module are not prompted (they use other code paths), and neither are events changed by another module.
13. **Messages about a whole series speak of the time of day and the repeat rule, not one date** ("When: 5:00 PM to 6:00 PM", "Repeats: Every week on Wednesday, starting ..."), so a message about a series that began months ago does not quote an old date.
14. **The time zone in a message is the device's** at that moment ("Eastern Standard Time"); all-day events say "all day, no time zone". The clock is 12-hour US style, matching the app.
15. **No Contact consent flag** and no "OK to email" memory (per the brief).
16. **Dates and words are US English**; no translation.
17. **A development-only switch** (`__ledgerFakeMail`) exists to try the flow in a browser; it is compiled out of production.

## 13. What is NOT built

Live email delivery (provider, sender identity, outbox repository, workflow, credentials, token entry, request sealing); calendar invitations, RSVP, `METHOD:REQUEST` or `ATTENDEE`; two-way calendar sync; inbound mail or bounce handling; automatic reminders or digests; attachments; a household messaging module or inbox; push notifications; a cross-event Messages list in Settings (CS-0 J.8.8's second place); a Settings page for sender details; prompts from Quick Add and the other event creators; real-device and real-inbox testing; any change to the Family Command Station.

## 14. Release recommendation

**Ready for ChatGPT review. Not committed, staged, pushed or deployed.** If approved, and only after the owner's explicit go-ahead: commit as `feat(calendar): add opt-in event notification workflow`, push, and check the Actions run (the app deploys on every push to `main`). **Safe to release as the opt-in workflow it is**: with no transport the real app cannot send anything and says so on every screen that matters; it should be described to the owner as "ready to connect", **not** as "email works". Before any real sending: sections 8 and 12 (item 11) first. CS-3 and the live Family Command Station stay deferred.
