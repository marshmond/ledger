# Ledger CAL-G1: Direct Gmail Integration (report)

Status (2026-11-17): **BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. AWAITING CHATGPT REVIEW. NOT REAL-DEVICE TESTED. NO REAL GOOGLE AUTHORIZATION WAS REQUESTED AND NO REAL EMAIL WAS SENT. NOTHING WAS CREATED IN GOOGLE CLOUD.** Proposed commit message: `feat(calendar): connect Gmail for approved event notifications`.

**Architecture decisions retained (not reopened):** single-user, browser-only app; the current GitHub Pages address `https://marshmond.github.io/ledger/` is retained; a custom domain, moving hosting, multiuser accounts and the Family Command Station (CS-3) all remain **deferred** by the owner. No backend, no unattended sender, no new database table, no migration, no new dependency.

**Baseline gate (verified first):** `main` = `origin/main` = `3490ea0` (`feat(calendar): add opt-in event notification workflow`), GitHub Pages run **#133** `completed` / `success` (public Actions API; `gh` is not installed). So **CAL-N1 is committed and deployed.** Only the three protected untracked files were present (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`); none was touched.

## 1. Implementation summary

The owner can now (once Google is set up, section 12): open Settings > Calendar, enter the public Google client ID, press **Connect Gmail**, approve Google's own window, then use the existing Calendar notification screens. The review screen's button reads **Send**, each person gets their own message through the Gmail API, and each message's outcome is recorded honestly. Everything that existed in CAL-N1 is reused: the after-save question, recipient picker, composer, recurrence wording, cancellation and Undo corrections, history, limits, stale-message protection, retry rules. **The production app is still "not connected" until the owner connects Gmail**, and while it is not connected (or after it expires) Save, Delete and Undo ask nothing, exactly as in CAL-N1.

New (`src/modules/calendar/gmail/`): `config.ts` (the one scope, the two Google addresses, client-ID check), `clientId.ts` (the only file that touches browser storage), `auth.ts` (Google Identity Services wrapper and the in-memory token), `transport.ts` (the Gmail sender), `mime.ts` (message builder), `words.ts` (plain-language text and setup steps), `useGmail.ts`, `GmailConnect.tsx`, `GmailSettings.tsx`. New `notify/useTransport.ts`. Edited: `notify/transport.ts`, `send.ts`, `records.ts`, `types.ts`, `words.ts`, `NoticeComposer.tsx`, `MessagesSection.tsx`; `CalendarSettings.tsx`; `shell/csp.ts` (+ its test); `lib/devicePrefs.ts`; `pages/settings.css`. **Not touched:** `EventEditor.tsx`, `CalendarPage.tsx`, the Calendar data layer, recurrence code, Finance, sync, backup, the display layer, `public/sw.js`, the GitHub outbox writer (still unused and unconfigured).

## 2. Gmail OAuth approach and scopes

- **Google Identity Services, token model** (`google.accounts.oauth2.initTokenClient`, `requestAccessToken`), loaded from `https://accounts.google.com/gsi/client`. This is the supported browser-only flow: the browser holds a short-lived access token and there is no client secret, backend or refresh token. The code model (which can yield a refresh token) is never used; a test fails if `initCodeClient`, `access_type`, `refresh_token`, `offline` or a client secret appears in the Gmail source.
- **One scope: `https://www.googleapis.com/auth/gmail.send`** ("Send email on your behalf"). Google lists it as a *sensitive* (not restricted) scope. It cannot read, list, search or change mail. The request is made with `include_granted_scopes: false` (earlier permissions are not piled on) and `prompt: 'select_account'` (the owner picks the Google account in Google's own window each time). No `login_hint`, hosted domain, state or redirect.
- **Refused if Google returns more:** `hasGrantedAllScopes` must confirm `gmail.send` (the owner can untick it in Google's window); a token carrying any scope other than `gmail.send` or plain identity scopes (for example mailbox read access left over from an earlier grant) is refused, thrown away, and Google is asked to cancel it. Tested for readonly, modify, `mail.google.com`, Drive and Calendar.
- **Identity scope assessment (as the brief asked): not requested.** With only `gmail.send`, Google tells Ledger nothing about which account was chosen (`users.getProfile` needs a mailbox-read scope; Google's own page lists `gmail.send` as not covering it), so **Ledger shows no account label and says so on the settings page rather than guessing.** Adding `https://www.googleapis.com/auth/userinfo.email` would let Ledger read the address through Google's userinfo call without any mailbox access, at the cost of a second line on the consent screen. It was not added because the brief names one scope, because while the Google project is in Testing with only the owner as a test user only the owner's account can authorize at all, and because the first test message to the owner's own address shows the sender plainly. **Owner decision (optional):** add it later if a verified "Connected as ..." label is wanted.
- **Expiry:** Google returns the lifetime (`expires_in`); Ledger stops using the token 30 seconds early and treats an unstated lifetime as five minutes. Google's pages do not state the lifetime in seconds; Ledger uses whatever Google returns. When it runs out, or Gmail answers 401, the state becomes **Authorization expired** and the owner presses **Reconnect Gmail** (a button press is always required; nothing re-authorizes by itself).

## 3. Connection UI

Settings > Calendar gains a section **"Email notifications through Gmail"** (`#cal-gmail`) with a status badge and one sentence for each state:

| State | Badge | What is offered |
|---|---|---|
| No client ID on this device | Not configured | the ID box and Save client ID; no Google request is made at all |
| ID saved, no permission yet | Not connected | **Connect Gmail**, Remove client ID |
| Google's window open | Waiting for Google | Cancel (also gives up by itself after three minutes) |
| Permission held | Connected for this browser session (until about HH:MM) | **Disconnect Gmail** |
| Permission ran out or Gmail said 401 | Authorization expired | **Reconnect Gmail** |

Also: a plain-language error under the buttons for every failure (library cannot load, popup blocked, window closed, access denied, wrong client ID, rejected request such as origin mismatch, "send" box unticked, too-broad token, timeout, offline); a collapsed "How to set up Google (one time)" with the eight steps; the account note; the permission note. A pasted client **secret** (`GOCSPX-...`) is refused by name and never stored. Disconnect forgets the token at once and asks Google to cancel it (best effort, five-second limit) and says honestly whether Google confirmed.

The **review screen** ("Email about this event") adapts: connected shows "Sending through Gmail", the button reads **Send to N people**; configured but not connected (or expired mid-compose) shows "Gmail is not connected / Gmail authorization expired", keeps every choice and the note, offers **Connect Gmail** (primary) beside **Approve for N people** (which only saves the approval, as in CAL-N1); not configured keeps the CAL-N1 text. The **Messages** card shows the same Connect / Reconnect button and never offers "Check status" for Gmail. Connecting never sends: the owner presses Send afterwards. The result screen reports the sender that handled the press ("Result from Gmail"), not whatever is connected a moment later.

## 4. Token-storage audit

| Place | Result | Evidence |
|---|---|---|
| `localStorage` | only the **public client ID** (`ledger-gmail-client-id`); no token | `auth.test.ts` records every write; browser check read all keys |
| `sessionStorage`, cookies | nothing | tests; browser check (`sessionStorage` 0 keys, `document.cookie` empty) |
| IndexedDB (`ledger`, `ledger-sync-meta`) | no token, no `Bearer`, no encoded message | browser scan of every store after connect, send, expire, reconnect, disconnect; `gmailFlow.test.ts` dumps every Dexie table |
| Backup file (`buildBackup`) | no token; the client ID is not in it (`PREFERENCE_KEYS` unchanged) | `gmailFlow.test.ts`; guard test |
| Sync (GitHub synchronization repository) | nothing: no table or setting row was added; the client ID is device-only | guard test: no `src/lib` file names the key except the device-settings list |
| Notification history | holds the exact approved text, the recipient address and (new, optional) Gmail's message id; **never** a token | `gmailFlow.test.ts`; browser scan |
| URLs, logs, errors | never: the token travels only in the `Authorization` header; no `console` call exists in the folder; every failure becomes a fixed reason class | `transport.test.ts` (token absent from URL, other fields and results even when Google echoes it); guard tests |
| Where the token lives | one module variable in `auth.ts`; exported nowhere except `gmailAccessToken()`, which only `gmail/transport.ts` calls, at the moment of sending | guard test scans `src/` |
| Client secret | not in the code; a pasted one is refused | `config.ts`, tests |

Device-settings explanation (`devicePrefs.ts`) now lists the client ID as "stays on this device, not in a backup file" and says the permission itself is never saved.

## 5. Gmail transport behavior

`gmailTransport` is a `NoticeTransport` (id `gmail`, label `Gmail`, live). Call: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, body exactly `{ "raw": "<base64url MIME>" }`, header `Authorization: Bearer <token>`, `cache: 'no-store'`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, a 30-second limit that also covers reading the answer. One request per recipient, only after an explicit Send / Send now / Try again / Send again anyway press.

**Message (`mime.ts`):** one `To` (name and address), optional `Reply-To` (only when an ordinary valid address), `Subject`, `MIME-Version`, `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: base64`; CRLF line ends; body wrapped at 76; every header line at most 76 characters (folded between words; non-ASCII names and subjects are RFC 2047 encoded words of at most 60 characters, split by code point so no character or emoji is cut). **No `From`, `Cc`, `Bcc`, `Date`, `Message-ID` or attachment**: Gmail sends from the account that authorized Ledger, so Ledger cannot name or spoof another sender. Line breaks and control characters are removed from every header value, and an address that is not a plain ASCII mailbox is refused, not repaired. `raw` is base64url without padding. A 64 KB size guard.

**What Gmail answered, and what Ledger records:**

| Gmail says | Recorded as | Notes |
|---|---|---|
| 200 with a message id | **Accepted by Gmail** (`ref` = the id) | never "delivered", "received", "opened" or "read" |
| 200 without a readable id, or 2xx without an id | **Outcome unknown** | a success with no id is not a confirmation |
| 401, or 403 insufficient scope | Not sent: unauthorized | Gmail goes to "Authorization expired" |
| 403 API not enabled (`accessNotConfigured`, `SERVICE_DISABLED`) | Not sent: Gmail API switched off | words tell the owner to enable it |
| 403 rate or daily limit, 429 | Not sent: a sending limit was reached | |
| 400 invalid To header | Not sent: address refused | |
| other 4xx | Not sent: the mail service refused it | |
| 408, 500, 502, 503, 504 | **Outcome unknown** | Gmail may have taken it before the fault |
| connection dropped or timed out after the request was made | **Outcome unknown** | exactly one request; never retried by itself |
| device offline (`navigator.onLine === false`) | Not sent: offline | Gmail is never called |
| no valid token | Not sent: unauthorized | Gmail is never called |
| address unusable in a header | Not sent: address refused | Gmail is never called |

## 6. Message-status behavior

- **Duplicate protection without a server rule.** Gmail cannot refuse a repeat, so `NoticeTransport` gained `serverDedupe` (false for Gmail). Before a Gmail request, `deliver()` writes a **claim** (an "unknown" step) for that attempt inside one database transaction that first checks nobody has acted on it. Two presses, a second tab, "Send now" in another tab: whoever loses the transaction sends nothing. The Gmail answer (accepted, failed) is written afterwards and outranks the claim. **A page that closes mid-send therefore leaves "Outcome unknown", never "not sent" and never a second automatic send.** The existing local protections (deterministic ids, per-recipient identity, approval record first, daily limit of 30 approvals, 10 recipients) are unchanged. **Honest limit:** two tabs in one browser share the database, so the claim protects them at once; a second *device* is protected only after the first device's claim has synced to it (the claim travels with the other notification records), so two devices that are both offline and both press Send for the same attempt could each send once. Gmail offers no server-side rule that could prevent that, which is exactly what the brief warned about; the same limit applies to any approval made on two unsynced devices.
- **Unknown outcome:** badge "Outcome unknown", words "Ledger cannot tell whether Gmail took this. Sending it again could send a second copy. Look in the Sent folder in Gmail first." The only way forward is **Send again anyway…**, which opens the existing confirmation ("This may send a second copy") and sends the same approved text as a new attempt.
- **No status lookup.** `NoticeTransport.status` is now optional; Gmail has none (it would need mailbox-read permission, which Ledger does not request). `refreshStatuses` returns 0 and asks nothing for Gmail, and the Messages card shows no "Check status" button for it. The GitHub outbox writer and the test sender keep theirs.
- **Reconnecting never sends.** Connect, Reconnect and Disconnect only change the in-memory permission. Approved ("Approved, not sent") and unknown messages stay exactly as they were; sending needs the Send or Send now button. Tested across two reconnects.
- **Stale protection** is unchanged and runs before any claim or request: an event changed after approval is recorded as failed "event changed" and nothing is sent, including a message approved while Gmail was not connected.
- **History compatibility:** progress records gained an optional `ref`; two reason classes (`offline`, `api-disabled`) were added. Older records read as before; an older version meeting a new reason shows "The sender did not say why". No record is rewritten.

## 7. Security tradeoffs (residual risk, stated plainly)

1. **Shared GitHub Pages origin (known, owner-accepted).** `marshmond.github.io` is one browser origin for every Pages project under the account, so any other project's page on it can read Ledger's IndexedDB and `localStorage` (this was already true). A token held in this page's memory is *not* readable by another project's page (separate JavaScript realm), but a script that runs inside Ledger itself (a malicious dependency, or a flaw that lets script in) could use it. Blast radius of a stolen token: **send mail as the owner until it expires; it cannot read mail.**
2. **Google's script runs inside the page.** The Google library is third-party code with full page privileges and receives the token itself. Ledger cannot pin it (no subresource integrity for a Google-served, changing file). Trust in Google is assumed. It is loaded **only after a client ID has been saved** (never at start-up, never for an owner who does not use Gmail), from its one address.
3. **Content Security Policy** (production build only; GitHub Pages cannot send headers, so it is a meta tag): added `script-src https://accounts.google.com/gsi/client`, `frame-src https://accounts.google.com/gsi/`, `connect-src https://gmail.googleapis.com https://accounts.google.com/gsi/`. Exact paths only; no wildcard, no whole-domain entry, no `unsafe-eval`; `style-src` and `img-src` unchanged (Google's `/gsi/style`, used by its own sign-in button, is deliberately not allowed). The policy still allows `api.github.com` (sync, existing), so it limits but cannot fully prevent exfiltration by a script already running. `frame-ancestors` cannot be set from a meta tag (existing limitation).
4. **Service worker:** `public/sw.js` was reviewed and not changed: it returns before touching any request that is not a same-origin GET inside the app's folder, so Google's script, the Gmail POST and every answer are never cached or read by it. Tests pin both early returns, and the transport also sends `cache: 'no-store'`.
5. **Sensitive scope.** `gmail.send` needs Google verification only to be offered to the public; for personal use the project stays in **Testing** with the owner as the only test user. Consequences: the "unverified app" warning on each authorization, a 100-test-user cap (irrelevant), and Google's note that a test user's authorization expires after seven days. Because Ledger keeps no permission, that adds little: the owner reconnects each browser session anyway.
6. **Bounces are invisible.** Gmail accepts a message to a mistyped or nonexistent address; the bounce arrives in the owner's own inbox, which Ledger cannot read. "Accepted by Gmail" never means the address exists.
7. **Memory-only token means a reconnect each session.** Because the after-save question appears only while connected (the brief's "quiet when not authorized"), it appears only after the owner has connected in that session. The owner can connect from the review screen (opened from an event's Messages card) as well as from Settings. This is a deliberate cost of not storing a permanent credential.

## 8. Tests and build results

- **New test files:** `gmail/mime.test.ts`, `transport.test.ts`, `auth.test.ts`, `gmailFlow.test.ts`, `gmailGuards.test.ts`, `gmailUi.test.tsx` (121 tests), plus one new CSP assertion and one updated pin in `shell/csp.test.ts`. They use fake OAuth responses, a fake Gmail endpoint and invented people (`.test` addresses); no real Google or Gmail call is made. They cover the fourteen priorities of the brief:
  1. correct send-only scope requested (exact scope, `include_granted_scopes: false`, exact key list, code model never called, widened or extra scopes refused and revoked);
  2. tokens never in storage, database, backup, history, URLs or results (recording storage, table dump, backup text, error echo test);
  3. authorization success and the safe failures (window closed, popup blocked, access denied, wrong client ID, request rejected, no token, scope unticked, library cannot load, offline, double press, cancel with a late answer, three-minute give-up);
  4. no Gmail transport when disconnected, not configured or expired (`getTransport()` is null; no after-save questions);
  5. only explicit Send actions can reach the send endpoint (the address is used by one file; one `submit` call site; connecting is called only from two click handlers);
  6. MIME and base64url: UTF-8 names, subjects, emoji, body, CRLF, line lengths, injection attempts, bad addresses, Reply-To, size;
  7. recipient isolation (one request per person; only their address; no Cc/Bcc/From);
  8. successful responses record acceptance with Gmail's id and claim nothing more;
  9. failed and ambiguous responses give honest status (every row of the table in section 5);
  10. duplicate presses and a second tab produce one request;
  11. stale messages are not sent (also when approved while disconnected);
  12. Save, Delete and Undo are independent (Gmail down, zero calls);
  13. reconnecting never sends approved or unknown messages;
  14. existing CAL-N1, Finance, sync and backup protections: the whole existing suite passes unchanged apart from one deliberately updated CSP pin.
- **Mutation checks:** eight deliberate regressions were applied one at a time and the Gmail, notification and CSP tests run: widening the scope (4 tests failed), removing the claim (3), writing the token to `localStorage` (2), treating a server fault as "not sent" (4), letting granted scopes accumulate (1), counting a success without an id as accepted (2), skipping the stale check (3) were all caught. **One was NOT caught:** removing the line-break stripping from header values alone. It is an equivalent change, because a line break is not printable ASCII and so the encoded-word path wraps it anyway (two layers of defense). Removing **both** layers fails the injection test (3 tests). Every file was restored and compared afterwards.
- **Run results:** see section 14 (final totals). `npx tsc --noEmit` clean. `npm run build` succeeds (the existing chunk-size warning only); the development-only `__ledgerFakeMail` switch is absent from `dist/`; the built page's CSP meta tag was read back and matches section 7.

## 9. Browser observations (built-in browser, `localhost:5173`, invented demo household, sync off; fake Google and fake Gmail)

- **Not configured:** the section renders ("Not configured"), no Google script on the page, no storage key. A pasted fake **client secret** was refused with the plain message and stored nothing. A valid-looking fake client ID saved to the one `localStorage` key, and only then did Ledger add Google's script tag.
- **The real Google library loaded** from `https://accounts.google.com/gsi/client` in the built-in browser. Before any click I replaced `google.accounts.oauth2` with a fake that records what it is asked, so **no real authorization window could open and none did**. Recorded request: one scope (`https://www.googleapis.com/auth/gmail.send`), `include_granted_scopes: false`, `prompt: select_account`, exactly the keys `callback, client_id, error_callback, include_granted_scopes, prompt, scope`; the code model was never called.
- **Failure modes in the real UI:** window closed, pop-up blocked, access denied and a too-broad token each showed their plain-language message and left "Not connected"; the too-broad token was refused and revoked.
- **Success:** "Connected for this browser session ... until about 10:42 AM"; the token was in no `localStorage`, `sessionStorage`, cookie or IndexedDB store (both databases scanned).
- **Send experience (fake Gmail intercepting every call to Gmail's address; nothing real was contacted):** editing the title of "Swim meet" and pressing Save showed "Event saved. Email someone about it?" only because Gmail was connected, with **zero** Gmail calls so far. "Choose people" showed the "Sending through Gmail" banner, nobody ticked. After choosing both involved people and typing a note with accents and an emoji, I expired the authorization from the console while the screen was open: the banner changed to "Gmail authorization expired", the note and choices stayed, the buttons became Reconnect Gmail / Approve. Reconnecting made "Send to 2 people" available **with zero Gmail calls**. A **double-click** on Send (500 ms delayed fake answer) produced **exactly two requests, one per person**; each decoded to its own `To` only, correct subject, no `From/Cc/Bcc`, the note and accents intact. Result: "Result from Gmail", both "Accepted by Gmail" with "Ledger cannot tell whether it reached an inbox ...".
- **Honest failures in the Messages card:** 503 gave "Outcome unknown" with the Sent-folder advice and exactly one request; API-disabled gave "Not sent. The Gmail service is switched off for your Google project ..."; a 401 on "Try again" gave "Not sent ... reconnect", turned Gmail to expired, disabled Try again and Send again, showed Reconnect Gmail; reconnecting made **zero** calls, then Try again succeeded (attempt 3). **No "Check status" button appeared at any point.** "Send again anyway…" showed the duplicate warning; I cancelled it. The notice history showed the expected sequences (claim, then accepted with the id; claim only for the 503).
- **375 px:** the settings section and the review screen fit with no sideways scroll (`scrollWidth` 375). One real defect found and fixed: the long scope address in setup step 5 overflowed its list item; `overflow-wrap: anywhere` was added to `.se-steps li` and re-measured. **Dark mode** checked on the settings section. Console: no errors.
- **Production policy check:** I built the app, served it locally, entered a fake client ID, and let Ledger load Google's real library under the embedded Content-Security-Policy, listening for violations. The library loaded, `initTokenClient` ran, and **no violation was reported**. This does **not** cover the popup sign-in itself (no authorization was requested).
- **Not verified:** a real Google authorization of any kind; real Gmail acceptance; a keyboard-only walk; a screen reader; Safari, Firefox, a real phone (pop-up behavior is browser-specific); light mode at 375 px for the new screens; the offline send in a browser (unit-tested); whole-series and "this and following" notices in a browser (unchanged CAL-N1 code).
- The demo household in the browser profile was changed by this check (the "Swim meet" title, its notice history). Invented data only; the fake client ID was removed again and nothing was committed.

## 10. Files and documents

Source: see section 1. Documents: this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `docs/UI-COVERAGE.md` (a note only: no row, mark or count changed; Modal sites remain 64 in 43 files, no dialog was added). No table, migration, dependency, backup or sync change; no new `settings` row; one new localStorage key (device only).

## 11. Judgment calls (please review)

1. **No identity scope; no account label** (section 2). Optional later: add `userinfo.email`.
2. **`include_granted_scopes: false`, a tolerated-scope allowlist, and refusing any token with extra scopes** (revoking it). Stricter than the brief required.
3. **`prompt: 'select_account'`** on every connect, so the owner always chooses the account in Google's window (a mitigation for the missing account label). One extra click per session.
4. **Client ID in `localStorage`, not the database**, so it is never synced or backed up (the brief allows local storage). A new device needs it entered again.
5. **A claim record before every Gmail request** (the progress history gains an "unknown" step before the answer). The cost is one extra history row per send; the benefit is the cross-tab and mid-send guarantee in section 6.
6. **A plain 503 is "Outcome unknown"**, not "Not sent". Safer against duplicates, at the price of a warning for what may be a harmless fault.
7. **A 2xx answer without a message id is "unknown"** (the brief says success means Gmail returned an identifier).
8. **No `From`, `Date` or `Message-ID` header**; Gmail supplies them. UNVERIFIED (section 13): Google's pages read do not state it.
9. **The after-save question shows only while connected**, as the brief asked, which with a memory-only token means once per session after connecting.
10. **Approve (save approval without sending) stays available** while Gmail is configured but not connected, with Connect Gmail as the primary button.
11. **`ReasonClass` gained `offline` and `api-disabled`; two existing reason sentences were reworded** (`quota`, `unauthorized`) because they said "daily limit" and "key". No test pinned the old wording.
12. **Google's script is preloaded whenever a client ID exists and the settings page or a review screen is open** (so Connect can open Google's window straight from the click; browsers block windows opened late). Not at start-up and not without a client ID.
13. **`NoticeTransport.status` optional and a new `serverDedupe` flag** instead of faking a status method for Gmail; the GitHub writer and test sender were only given `serverDedupe: true`.
14. **CSP: documented paths only; `style-src` for Google deliberately not added** (Google's token flow opens a separate window; its stylesheet is for its sign-in button). If a live test reports a violation, add `https://accounts.google.com/gsi/style`.
15. **A three-minute give-up and a Cancel button** for Google's window, because Google does not always call back when a window is closed.
16. **Gmail's message id is stored** in the progress record (optional, not a secret) as "what Gmail confirmed".
17. **No development switch was added to the source** for Gmail; the browser checks used page-level fakes injected from the console, so the shipped code has no test hooks except `resetGmailForTests` (inert, unused by the app).

## 12. Owner's Google Cloud setup (short, non-technical)

Based on Google's current documentation (Google Identity Services token model, Gmail API, Google Auth Platform pages). **Google may rename screens; the idea stays the same. Never send or paste your Google password, a client secret, an access token or a recovery code into any chat.** Nothing here was done for you.

1. Go to **console.cloud.google.com**, sign in with the Google account you want to send from, and create a **project** (name it "Ledger").
2. In that project open **APIs & Services > Library**, search **Gmail API**, press **Enable**.
3. Open **Google Auth Platform** and complete **Get started**: App name "Ledger", your own email as support and contact email, **Audience: External**.
4. **Audience**: leave **Publishing status: Testing**. Under **Test users** press **Add users** and add **only your own Gmail address**. Save.
5. **Data Access** > **Add or remove scopes**: add exactly one, `https://www.googleapis.com/auth/gmail.send` ("Send email on your behalf"). Save. (It is a "sensitive" scope; that only matters if you ever publish the app to others, which you will not.)
6. **Clients** > **Create client** > **Application type: Web application**. Under **Authorized JavaScript origins** add `https://marshmond.github.io`. **That is the domain only: no `/ledger/` on the end.** Leave **Authorized redirect URIs** empty. Create.
7. Copy the **Client ID** (long text ending in `.apps.googleusercontent.com`). **Do not copy the client secret.**
8. In Ledger: **Settings > Calendar > Email notifications through Gmail**. Paste the Client ID, press **Save client ID**, then **Connect Gmail**. In Google's window choose your account. Google will say it has **not verified this app** (true: it is your own project in Testing). Choose **Advanced**, continue to the app, and keep **Send email on your behalf** ticked. Ledger shows "Connected for this browser session".
9. **Dry run:** add yourself as a Contact with your own email address, give a test event that Contact as a person involved, edit the event, choose **Email someone about it** > **Choose people**, pick yourself and press **Send**. Then look in your Gmail **Sent** folder and inbox. Report what you see (see section 13).

What to expect afterwards: Google limits a Testing app to the test users you list; it may ask you to approve again about every seven days; the permission Ledger holds lasts a short time (Google decides, commonly about an hour) and is forgotten when you close or reload Ledger, so you press **Connect Gmail** once each time you open Ledger and want to send. To remove Ledger's access completely, use **Third-party access** in your Google Account's security page.

## 13. Unverified until the first live Gmail test

The first real owner test should confirm, and the report cannot:
1. **The popup authorization itself**, with the real Google window, under the production CSP (library load and initialization were verified; `requestAccessToken` was never called for real).
2. **That Gmail fills in `From`** (and the account's display name) when the message has none, and that the message looks right in the recipient's mail program (UTF-8, encoded subject).
3. **The error reasons Gmail really returns** for: API not enabled (`accessNotConfigured` / `SERVICE_DISABLED`), invalid recipient ("Invalid To header"), rate limits, an expired token. Ledger's mapping uses Google's documented reasons plus common messages; Google's pages read do not name all of them.
4. **That no CSP violation appears during the popup flow** and that `google.accounts.oauth2.revoke` (Disconnect) works under the policy (it may need an additional address; if so, Disconnect still forgets the token locally and says Google could not be asked).
5. **Pop-up behavior on a real phone and in Safari and Firefox**, and that the click-to-window timing is accepted (the library is preloaded to help).
6. **Gmail's own sending limits for the owner's account** (Google's pages read do not state the consumer daily limit; Ledger's own caps are 10 people per notification and 30 approvals per 24 hours).
7. **That a bounce or a mistyped address** shows up in the owner's inbox (Ledger cannot see it).
8. Keyboard-only and screen-reader use of the new screens.

## 14. Final verification totals

**One full run on the finished code: 329 files, 6,542 tests, all pass** (the CAL-N1 report gave 323 files and 6,419 tests, a figure that may predate the CAL-N1 release-correction tests, so an exact increase is not claimed; six test files are new). `npx tsc --noEmit` clean. `npm run build` succeeds (existing chunk-size warning only). The focused Gmail, notification and CSP suites (7 files) were run repeatedly during the work and again after the mutation checks: 121 tests in the six new Gmail files pass.

## 15. Release recommendation

**Ready for ChatGPT review. Not committed, staged, pushed or deployed.** Proposed commit message: `feat(calendar): connect Gmail for approved event notifications`. Safe to release as an opt-in feature: with no client ID entered the app behaves exactly as CAL-N1 does today (no Google script, no request, no prompt, no sender), and nothing can be sent without the owner creating a Google project, entering the public client ID, connecting, and pressing Send on a specific message. Describe it to the owner as "ready to connect", **not** as "email works": section 13 lists what only a live test can show. After release: check the Actions tab for a green run, then do the dry run in section 12 to the owner's own address. CS-3, the live Family Command Station, a custom domain, hosting changes and multiuser accounts remain deferred.

## 16. What is NOT built

A status or bounce lookup; reading any mail; showing which Google account is connected; silent or background re-authorization, refresh tokens or any stored Gmail credential; attachments; "send as" aliases or a chosen From; more than one Gmail account; any backend, unattended job or scheduled send; after-save questions while Gmail is configured but not connected; calendar invitations or RSVP; a household inbox; CS-3 or any Family Command Station change; a custom domain.
