# Ledger CS-2: Secure Publishing and Retrieval (report)

**Status (2026-11-16): APPROVED, COMMITTED AND DEPLOYED (`ef5b14e`, GitHub Pages run #129 succeeded). LIVE PUBLISHING IS NOT CONFIGURED: no repository, key or tablet exists, and nothing publishes until the owner sets it up. NOT REAL-DEVICE TESTED.** CS-3 is not started.

## A. Executive summary

CS-2 makes the approved family schedule able to travel safely from Ledger to a separate tablet:

1. **Ledger can publish.** It builds the CS-1 projection, encrypts it with a separate display passphrase, and writes one file (`display.bin`) to a private GitHub repository, using the safety protocol from the CS-0.1 design (fresh sync, a check that this device knows every privacy decision the last publisher knew, a re-check, then a compare-and-swap write). A stale or restored device cannot republish something that was revoked.
2. **A separate tablet app can read it.** It pairs once with a code, fetches the file every three minutes, decrypts and fully validates it, keeps an encrypted saved copy, shows how fresh it is, and deletes the copy after 24 hours, 3 days (default) or 7 days without a successful refresh. Its only screen is a diagnostics page (counts and times, never a title). It is built separately and shares no code with Ledger beyond the display contract and transport.
3. **The older-build risk is closed.** Events made by a current build carry a stamp bound to their own record id. After the owner's first-publication review, an event that is shown only because its calendar is shared, and was added later by something that did not stamp it, is held back for the owner to review instead of being published.
4. **Settings > Family display** gained a Publishing section: set-up, the full first-publication review, status, Publish now, errors, key-expiry warnings, recovery, pairing, key and passphrase changes, and an activity log.

Because the owner deferred the repository and keys, everything is verified against a **fake GitHub** (in memory, with injected failures) and, for the screens, against a stand-in GitHub inside the browser page. **Nothing was sent to GitHub or anywhere else.**

## B. Baseline and gates

| Gate | Result |
|---|---|
| A: CS-1 released | `main` = `origin/main` = `f82554f` (`feat(display): add secure display eligibility and projection preview`), includes the editor Save/Cancel correction. Pages run #128 succeeded (public API; `gh` is not installed). Only the three protected untracked files were present. |
| B: G2 | **Owner-reported complete** (recorded as such; no per-device evidence, none requested, none fabricated). |
| C: decisions | **Approved by the owner with the recommended defaults:** L-1 (separate private encrypted display repository), L-5 (tablet app on its own origin, a separate free GitHub organization preferred), L-7 (three-minute polling, 15 minutes / 2 hours / 24 hours freshness steps, 3-day default retention with 24 hours and 7 days offered), L-8 (fresh sync, causal-history check, fail closed). |
| D: infrastructure | **Deferred by the owner.** No repository, organization, key or hosted resource was created or requested. |

The first attempt stopped at gates B to D (`docs/LEDGER-CS-2-G2-GATE-REPORT-2026-11-16.md`, kept as written). The owner then resolved B and C and deferred D, with direction to build everything that can be tested locally. Phase kept as one CS-2 (no sub-phases).

## C. Architecture

```
Ledger device (publisher)                         private GitHub repo "display"               tablet (separate app, separate origin)
 approved items --> CS-1 projection                +------------------------+                  +--------------------------------------+
   --> encrypt (display passphrase)  --PUT (CAS)-->|  display.bin           |<--GET (read key)-|  pair once; fetch every 3 min;       |
   [write key + passphrase: this device only]      |  (one encrypted file)  |                  |  decrypt+validate; encrypted copy;   |
                                                   +------------------------+                  |  expiry; diagnostics page            |
                                                                                               +--------------------------------------+
```

New code, by folder:

| Folder | What | Imports |
|---|---|---|
| `src/display/transport/` | The encrypted file (`envelope.ts`), the GitHub file client (`githubFile.ts`), the pairing code (`pairing.ts`), byte helpers. Test kits: `githubTestkit.ts` (fake GitHub), `envelopeTestkit.ts` | only `../contract` and itself. **Shared by Ledger and the tablet.** |
| `src/display/publish/` | `protocol.ts` (the publication protocol), `runner.ts` (wiring, triggers, set-up, review), `config.ts` (this device's settings and activity), `status.ts` (plain-words status), `signals.ts`, `keys.ts`, `start.ts` | Ledger |
| `src/display/compat.ts` | The older-build safeguard | Ledger |
| `src/tablet/` + `tablet-app/` + `vite.tablet.config.ts` | The tablet app: `retrieval.ts`, `freshness.ts`, `storage.ts`, `App.tsx` (diagnostics), its own build (`npm run build:tablet`) | tablet, contract, transport, React only |
| `src/pages/FamilyDisplayPublishing.tsx`, `src/display/DisplayPreview.tsx` | The Settings screens; the preview moved out of the page so the first-publication review can reuse it | Ledger |

Credential boundaries (all by construction and tested):

| Secret | Lives | Never |
|---|---|---|
| **Publishing (write) key**: fine-grained token, Contents read and write, the display repository only | this Ledger device's browser storage | in the database, backup, sync, the tablet, a URL, a log or an error |
| **Display passphrase** (generated by Ledger, 160 bits) | this Ledger device's browser storage; the owner's password manager; inside the pairing code | in the database, backup or sync; derived keys never leave Web Crypto |
| **Tablet (read-only) key**: fine-grained token, Contents read-only, the display repository only | the tablet; typed into Ledger only to build a pairing code, **not stored by Ledger** (checked in the browser) | in the publisher's settings |
| **Ledger's sync token and passphrase** | unchanged | Ledger **refuses** a display repository, key or passphrase equal to the sync ones |

## D. Encryption contract

- **File:** `"LDP1" | version 1 | revision (u32, big-endian) | salt (16) | iv (12) | AES-GCM-256 ciphertext` of the gzip of canonical JSON `{ v:1, publisher:{id,mode}, projection }`. The first nine bytes are **authenticated** (AES-GCM additional data), so changing the version or revision, or swapping a header, makes decryption fail. A fresh random salt and iv are made for every file (tested: 20 files, 20 distinct salts and 20 distinct ivs).
- **Keys:** `PBKDF2-SHA256(passphrase, fixed domain salt, 310,000 rounds)` gives a **non-extractable HKDF master key** (once). From it, by HKDF with distinct labels: the **file key** (AES-GCM, salt = the file's own salt) and the **id key** (HMAC-SHA256 for opaque ids). Different from the sync and backup keys (different passphrase, different derivation labels).
- **Opaque ids are now stable.** The id key comes from the display passphrase, so every publishing device with the passphrase produces identical ids and `grantsSeen` for identical data (tested with two separate key derivations and two SIMULATED devices, meaning two databases in one test process sharing a passphrase; this is not evidence from physical devices). The CS-1 throwaway key is gone from publishing.
- **Validation:** `openEnvelope` decrypts, checks the publisher block (exact keys), refuses a newer reader or version with its own code, runs the full CS-1 validator, and checks the header revision equals the projection's. `sealProjection` runs the validator first, so nothing invalid is ever written. A decompressed payload over 2 MB is refused before parsing.
- **Contract compatibility:** the projection (version 1) is **unchanged**. Publisher identity (a random per-device id and `sync` or `single` mode) is in the encrypted wrapper, **not** in the projection, with its own strict check. The only plaintext, authenticated metadata is the file version and revision counter.

## E. Publication protocol (design H.5a)

Implemented in `protocol.ts`; every outside dependency is injected so it is tested against a fake GitHub, fake sync failures and real two-device sync.

Order (any failure stops, with a plain message, and leaves the file as it was): 0) set up and reviewed; 1) a **full sync round now** (if sync is set up; an unresolved sync conflict involving a privacy decision also stops); 2) one consistent local read: projection, content digest and the **complete** list of privacy decisions (`grantsSeen`); 3) read the current display file (an unreadable or foreign file is never overwritten; publisher rules apply); if **both** the content and the decision history equal the file's, nothing is written (still after reading the remote); 4) **causal check**: every decision the file knows must be here, else one more sync round, else stop; 5) **re-check** that the sync file and this device's decisions did not move; 6) **compare-and-swap** write; on conflict start again with fresh state (never the earlier payload), at most three rounds, then a clear error. Success is reported only after GitHub confirms the write.

- **Revocation:** a hide or the hide-everything switch triggers an immediate attempt (no debounce). Until a publication succeeds the page says **"Hidden in Ledger. The family display has not been updated yet."** After it, it says the latest choices are in the published file and that a tablet that is off or offline may still hold an older copy. It never claims the tablet has the new version.
- **Restore:** a device restored from an older backup lacks decisions the file knows, so it is blocked (`behind-history`). **Review and recover** compares what the published file shows with what this device would publish (what would come back, what would go) and needs an explicit tick before it publishes.
- **No sync:** one publisher; the file records its id; another device is refused until the owner chooses **Make this device the publisher**. A device without sync cannot publish into a file kept by synced devices.
- **First publication:** the full prospective dataset is shown (counts and every item, titles as typed), with a required confirmation, **per device**. Entering credentials never publishes by itself.
- **Triggers:** relevant Calendar, Task, Family, Services, Maintenance, contact and decision changes (10-second debounce), immediately after a hide, on opening or showing Ledger, on coming online, every 10 minutes while open, and Publish now. Quiet triggers skip the whole sync-and-publish run when nothing changed here and the file in GitHub is still the version this device wrote (a judgment call, section K). No background publishing is assumed.
- **Errors:** 401, 403, 404, 429 and rate limits (with the wait GitHub gives), 5xx, no network and conflicts are told apart; automatic retries wait (3 minutes for network and server errors; the given time for rate limits); a refused key stops automatic attempts and shows **Disconnected**.

### E.1 Focused reliability check: remote-only changes (added after review)

**Scenario:** Device A is the publisher, idle, with no local changes. Device B edits an approved event, or revokes one, and syncs to Ledger's sync repository, but does not publish. A reaches its next quiet re-evaluation.

**Finding:** the quiet shortcut did NOT handle this. It compared only A's own data and the display file, so with automatic sync off A would never pull B's change and would skip every re-check indefinitely. (With automatic sync on, A's own sync would eventually change A's data and the shortcut would stop applying.)

**Fix (small):** the quiet check now also asks whether the sync file is still the version A last merged (one small request, `syncUpToDate`). If not, the shortcut is not taken and the full protocol runs: a fresh full sync, the `grantsSeen` causal check, the re-check and the compare-and-swap write. Nothing in the protocol itself changed. It runs whenever publishing is set up, whether or not automatic sync is on, because the publisher's own sync step is a full round, not the automatic one.

**Tests (4, `protocol.test.ts`):** nothing changed so the shortcut still skips; B edits an event and syncs, the shortcut now says no, and A publishes the updated projection as revision 2; B revokes and syncs, A notices and the revocation reaches the file; and, as a control, without the sync-state check the shortcut would have missed it. Simulated devices with the real SyncEngine, as elsewhere.

## F. Older-build privacy mitigation (release blocker)

**Problem (CS-1 M.4):** an older build's "this and following" copies no display decision and leaves no link to the old event, so a private continuation inherits a shared calendar. A version number cannot help (an older build ignores it), and no predecessor pointer exists to find.

**Chosen mitigation** (`src/display/compat.ts`, no change to recurrence):
1. A current build stamps every event it creates, and the new half of every split, with `prov: { v:1, id: <that record's own id> }`.
2. An older build's split copies the whole old record, stamp included; the copy carries the **old** id, so it is not a valid stamp for the new record. An event made by an older build has no stamp.
3. Confirming the first publication records a synced **baseline** time (`display/compat`, earliest wins; no migration).
4. An event that is eligible **only through its shared calendar**, created after the baseline, with no valid stamp, is **withheld**: it is not published, it is listed under "Needs your review before it can appear", and the owner chooses Show or Keep private (ordinary decisions). Events the owner approved one by one, and anything made before the baseline (it was in the reviewed list), are not withheld.

**Evidence (`compat.test.ts`, 14 tests):** a shared calendar, a repeating event with an explicit Keep Private, an older client splitting it, the publisher finding the successor and withholding it, nothing visible, and the title never appearing in the projection. The test also proves the risk is real (without the safeguard the successor is eligible). Legitimate use is undisturbed: new events by this build, and splits by this build (stamped, carried decision, not withheld). Each edit scope keeps the stamp; a guard test fails if any calendar code writes a new event without it. Mutation checks: removing the hold, or not binding the stamp to the record id, are both caught.

**Limits:** it does not establish lineage for events made before the baseline (the owner reviewed them); an older build merely moving an existing event onto a shared calendar is eligible by design; the baseline uses the creating device's clock; an event the owner shows by hand is never questioned. No general guarantee is claimed.

## G. Publisher settings (Settings > Family display)

Not set up: step-by-step set-up (private repository, publishing key, passphrase generator with "I saved it" and a manager reminder), a connection check that **refuses** a public repository, a read-only key, an archived repository, and anything that equals the sync repository, key or passphrase, and warns about stray files. Then the full review. After set-up: status pill (Not set up, Set up/not published, Waiting to publish, Publishing, Published, Failed or Stopped, Disconnected), last publication, revision, counts, changes waiting, Publish now, errors, expiry warnings (14 days ahead and when expired; the owner's date and GitHub's header when readable), revocation status, recovery buttons that appear for the matching problem (Start a new display file, Review and recover, Make this device the publisher, Replace the publishing key), **Pair a tablet** (read key pasted, never stored; code hidden until shown, hides after 60 seconds; copy), Change the display passphrase (new file, tablet must re-pair), Disconnect this device, and the activity log (times and outcomes only). The local preview, the withheld list and all existing CS-1 controls remain.

## H. Tablet diagnostics

Pairing code `LDPAIR1.…` (repository, **read** key, passphrase; checksum; no URL characters). The tablet stores the repository, the read key, a **non-extractable** HKDF key (not the passphrase), the **encrypted** file as GitHub sent it, and small facts. It decrypts in memory only.

Polling every three minutes with conditional requests (`If-None-Match`); back-off 3, 6, 12, 30 minutes for network and server errors; rate-limit waits; refusals for ten minutes in a row (401, 403, 404) mean revoked or expired: the saved copy is deleted and the page says it was disconnected. A new file replaces the copy only after full validation, as one step; rollback (older revision, or the same revision with different bytes), a wrong passphrase, a damaged file and a newer format are all rejected and leave the last good copy in place. Freshness states: recent (under 15 minutes), delayed (to 2 hours), stale (to 24 hours), extended outage (to the keep time), expired. The keep time is checked at start, every minute, and again before a copy is handed out. A clock set back does not extend a copy's life (expiry counts from the latest time ever seen, including GitHub's `Date` header when readable) and a warning is shown. The diagnostics page shows: paired, connected, last successful check, last publication, data version, revision, counts, validation, saved copy, Check now, Forget this display, and the keep-time choice. **No titles or names appear** (a test checks).

Practical consequences: clearing the browser's site data, or replacing the tablet, means pairing again. A non-extractable key stops a script copying the key bytes; it does **not** protect against a person who can use the unlocked tablet. A tablet that is off or offline cannot erase anything and keeps its copy until the app next runs; Ledger cannot remotely erase it.

## I. Testing

| Area | Result |
|---|---|
| New tests | **118** in 6 files: encryption, GitHub client and pairing 22; publication protocol 29; publisher settings, status wording, credentials and the owner flow 19; older-build safeguard 14; tablet retrieval, freshness and storage 27; isolation 7 |
| Mutation checks | 18 deliberate breakages (causal check removed, no-op ignoring decision history, sync re-check removed, decision re-check removed, conflict handled as success, unreadable remote overwritten, publisher check removed, review gate removed, revision allowed backwards, older-build hold removed, stamp not bound to its id, header not authenticated, nonce reused, rollback accepted, expiry not applied, clock set back extends life, invalid file replaces the copy, success shown before confirmation). **All caught** (one, nonce reuse, first slipped through and its test was strengthened). |
| Required cases covered | A encryption (all listed), B publication (first publish, no-op, content change, **grantsSeen-only change**, **out-of-window revocation with a stale device refused**, failed sync, missing decisions, CAS conflicts, **two publishers**, restore, unauthorized publisher, kill switch, failed validation, rate limits and GitHub errors), C older-build scenario plus Finance exclusions (the CS-1 privacy suite still passes), D retrieval (valid, wrong key, invalid, unsupported, rollback, expired and revoked key, outage, offline expiry, reconnect, cache replacement, forget) |
| Existing integrity | The CS-1 suites (grants, contract, privacy, lifecycle, timezone, pending) pass unchanged. No change to Finance, transactions, balances, sync encryption, backup format, calendar scheduling or Task recurrence semantics, or the R4.2 Family reader. |
| Existing guards | Two tripped and were handled, not bypassed: the date-day guard (fixed in my code: owner-facing days use `localISO`), and the "one `<main>` per screen" scan (it now skips `src/tablet`, a separate app that cannot use Ledger's shell). |
| TypeScript | `npx tsc --noEmit` clean |
| Ledger build | `npm run build` succeeds (existing chunk-size warning). Entry chunk **753.51 kB raw / 236.96 gzip**, not larger than CS-1: the publisher is loaded only on a device where publishing is set up (`start.ts` checks one storage key first). |
| Tablet build | `npm run build:tablet` succeeds: one 248 kB (78.8 kB gzip) script, its own Content-Security-Policy (`connect-src 'self' https://api.github.com`, no inline script), **no Ledger code in the bundle** (checked). It is not part of Ledger's build and not deployed by Ledger's workflow. |
| Full suite | **321 files, 6,334 tests, all pass** (baseline 315 files, 6,216: +6 files, +118 tests). Run once after the last code change; the two guards listed above had failed in the first full run and were fixed. |
| Browser (desktop pane, invented demo data, GitHub replaced by an in-page stand-in; **nothing left the machine**) | Ledger: set-up form, passphrase generation, connection check, the full review dialog (21 items, 1 Task), confirm, publish (revision 1, a file starting `LDP1`, written once), hide an event and see a new revision within a second, status wording, pairing dialog (code hidden then shown; the code contained the **read** key and not the write key; the read key was not saved anywhere), 375 px width with **no horizontal overflow**. Tablet (served on its own port, so its own origin): pairing through the real screen with the real 310,000-round key derivation, a **non-extractable key persisted in IndexedDB and used by a freshly created tablet object afterwards**, offline (saved copy kept, "No connection. Showing the saved copy."), reconnection, a new revision picked up, a refused key shown as disconnected, Forget this display leaving nothing in storage. No console errors seen. |
| **Not verified** | **A live GitHub repository and real keys. A real tablet or iPad (browser storage behavior, wake lock, home-screen app). A 24-hour connected run. Clock-error behavior on a device. Screenshots** (the pane would not capture while the test suite was running, so no visual check was made; layout was checked by measurements and text only). Keyboard-only use and a screen reader on the new screens. 1440 px. |

### Live-GitHub facts that are still UNVERIFIED (coded defensively; the acceptance run settles them)

Browser CORS for these calls with an Authorization header (the existing sync already relies on it for other endpoints); whether the page can read the `ETag`, `Date` and key-expiry headers (the code works without them, with fewer warnings); that a fine-grained key with Contents read-only is enough for the tablet's reads and that `permissions.push` is reported for fine-grained keys; the response for an empty repository's listing (treated as empty); the exact responses for a revoked key; conditional requests not counting against rate limits; the one-megabyte contents limit (the file is far smaller, and a larger one falls back to the blob endpoint).

## J. Security review

- **Credential scope:** the write key only reaches GitHub (a fixed host, header only); the read key never rests in Ledger; the passphrase is only in this device's storage and the owner's manager. A test confirms that neither appears in the database, backups, the activity record or error messages.
- **Isolation:** an import-graph test fails if the tablet, transport or contract reach Ledger's database, modules, sync, storage keys or the Family view (and that Ledger never imports the tablet).
- **Leakage risks:** a title typed with sensitive text will publish if its event is shown (the owner's judgment, as in CS-1; the review lists every title). Anyone with the pairing code and the read key can read the schedule; the code is hidden by default. Old file versions stay in the repository's history, readable only with the old passphrase and old read key.
- **Revocation and recovery:** a lost tablet: delete its read key, change the display passphrase, pair the new tablet. A leaked write key: delete it (the tablet rejects a garbage or old file: it cannot decrypt it and refuses a lower revision). The tablet cannot be erased remotely.
- **Remaining limits:** an offline revoke on one device that never syncs cannot be prevented from being republished by another device (design H.5a); edits and deletions are freshness, not revocation guarantees; a device or script that holds the write key can replace the file with a valid one made from data it can read.
- **Dependencies:** none added.

## K. Decisions and deviations (please review)

1. **A plaintext revision counter in the file header** (design F.6 said "no plaintext header"): AES-GCM cannot authenticate a revision the reader does not know first. It is a publish counter and reveals nothing else.
2. **One key derivation, then per-file keys by HKDF** (design: PBKDF2 straight to the file key). It allows a fresh salt per file *and* a non-extractable key stored on the tablet, and keeps the 310,000-round cost to once per device.
3. **Ledger generates the display passphrase** (160 bits, shown once, with a fixed public domain salt), instead of the owner choosing one. A typed password would make the fixed salt a weakness; a second publishing device needs only the passphrase.
4. **No QR code.** The pairing code is text. Local QR generation and scanning need a library and a camera path that would need real-device testing; the code is long (193 characters) but pasteable. Offered as a follow-up.
5. **Tablet app shell:** no service worker or app-shell cache yet (CS-3). The saved **data** is cached and expires as designed; the page itself needs the network the first time it loads.
6. **Folder placement:** the tablet code is in `src/tablet` (so the type check and tests cover it), with its entry in `tablet-app/`. The shared contract stays in `src/display/contract` as in CS-1.
7. **Older-build safeguard design (section F)** instead of a build-version marker, because a marker is not honored by the clients that cause the risk. It changes the shape of new Calendar events by one additive field (`prov`); older builds keep it on edits.
8. **Review per device:** every publishing device requires its own review before its first publish (cheap, and each device holds its own keys).
9. **Quiet triggers skip the full run** when nothing changed locally and the file is still the one this device wrote, to avoid a full sync round every ten minutes. Anything that changes, the Publish now button, a hide, or a changed remote runs the full protocol.
10. **Household label is fixed to "Family"** in this release (so two devices cannot flip it back and forth); the contract field exists.
11. **Publisher info is per device, `single` or `sync` mode**, as the design's section H.5a "without sync" requires; changing sync on a device means the file's mode changes with its next publication.
12. **Existing tests changed:** one guard scan (`stS3Structure.test.tsx`) now skips `src/tablet`. The calendar `createEvent` and split now allocate the new record's id themselves (to stamp it) instead of letting the store do it; behavior is otherwise identical.
13. **The nav hint** for the page and the preview section's wording changed (they said "local preview" and "not published", which would now be false).

## L. Owner setup and acceptance (nothing here has been done; no key goes in any chat)

When you are ready to go live:

1. **GitHub: the display repository.** Make a new **private** repository (for example `ledger-display`) under your account. Nothing else goes in it. It must be private because it holds your schedule (encrypted, but still).
2. **GitHub: the publishing key.** Settings, Developer settings, Fine-grained personal access tokens, Generate. Resource owner: you. **Only select repositories: `ledger-display`.** Permission **Contents: Read and write**; nothing else. Expiry: pick a date you will remember (Ledger reminds you 14 days before). Copy it once.
3. **Ledger (each phone or computer you schedule from):** Settings, Family display, Publishing. Choose "Make a new one" on the first device, then **save the display passphrase in your password manager** and tick the box. Enter `yourname/ledger-display`, paste the publishing key, add its expiry date, press "Check the connection and review". Read the whole list. Tick the box and publish. On other devices choose "I already have one" and enter the same passphrase.
4. **GitHub: the tablet key.** A second fine-grained token for **only that repository**, **Contents: Read-only**, named after the tablet.
5. **Tablet app hosting (your decision L-5):** a new free GitHub organization with its own public repository that builds the tablet app (`npm run build:tablet`), so the tablet has its own web address. Not done: it needs your approval and a short feasibility check in CS-3. Do not put it under `marshmond.github.io/ledger/`.
6. **Pair the tablet:** in Ledger, "Pair a tablet", paste the read key, show the code, paste it into the tablet's page. Never put it in a message or photo.
7. **Password manager:** add the display passphrase, the publishing key (and its expiry), the read key (and its expiry).
8. **Rotate or revoke:** publishing key: make a new one, "Replace the publishing key", delete the old one. Tablet key: delete it in GitHub; the tablet is refused within about ten minutes. Passphrase: "Change the display passphrase" (on an up-to-date device), then delete the old read key and pair again. **Lost tablet:** delete its read key, change the passphrase, pair the new tablet. Its old saved copy cannot be erased remotely; it deletes itself when the app next runs after the keep time.

**Real-tablet acceptance still to do** (not claimed): pairing, encrypted publication and retrieval, a connected run of about 24 hours, offline and reconnection, credential revocation, re-pairing, clock-error behavior, and a check that no financial or unauthorized data is present. Also a live check of the UNVERIFIED GitHub facts above.

## M. Release recommendation

**Ready for ChatGPT and owner review. Not for live publication.** The code, tests, builds and browser checks support committing it, and nothing in it publishes until the owner sets up a repository, a key and a passphrase on a device and confirms the review. Live publication has **not** been approved and nothing live was tested; real-tablet acceptance is pending. Suggested commit message when authorized: `feat(display): add encrypted publishing and tablet retrieval client`. Per the handoff rules: no commit, push or deploy has been done or will be done without separate approval; after a push, check the Actions tab for a green run.

Questions worth the reviewers' attention: judgment calls 1 to 4 and 7 above.

## N. Release record

- **Approval:** ChatGPT accepted the architecture, encryption, protocol, compatibility mitigation and tablet client, subject to one focused check (section E.1) and one wording correction (section D).
- **Reliability check:** the quiet shortcut missed remote-only changes (a code change was needed, small: the shortcut now also checks the sync file's version). Fixed and tested (4 tests). Affected suites (38 files, 1,016 tests), `tsc`, and both production builds pass; the full suite was not re-run (the change is confined to the publisher's quiet check and its tests; the last full run was 321 files, 6,334 tests, all passing before it).
- **Wording:** the stable-id claim now says simulated devices, not physical ones.
- **Commit:** `ef5b14e` `feat(display): add encrypted publishing and tablet retrieval client`, pushed to `main`. **Deployment:** Pages run #129 for that SHA: success. This record was added in a documentation-only follow-up commit.
- **Checked before commit:** only the intended 48 files; no credentials (the key-looking strings in tests are short made-up placeholders), no household data, the three protected untracked files untouched and not committed. No repository, organization, credential or hosted resource was created; no live publication was configured or started.
