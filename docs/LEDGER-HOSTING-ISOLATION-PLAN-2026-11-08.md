# Ledger hosting isolation plan (SE-01): PLAN ONLY, nothing has been done

**Date:** 2026-11-08. **Status:** a proposal for the owner. **No hosting action was taken in ST-S1.** No GitHub account, organization or repository was created, moved or duplicated; no Pages setting, DNS record, remote, redirect or stored credential was touched; FBB and Foodventory were not changed; no real data was migrated. Every step below needs the owner's explicit authorization first, and the code fixes in ST-S1 do not depend on any of it.

**Lettering:** this plan uses the letters from the ST-S1 brief: **A** = a dedicated custom domain for Ledger, **B** = a dedicated GitHub account or organization for Ledger, **C** = move the other applications. (The S0 audit's table listed the same three options in a different order, so use these letters from here on.)

## 1. The problem in two sentences

Ledger is served from `https://marshmond.github.io/ledger/`, and the same account serves two other apps from `https://marshmond.github.io/FBB/` and `https://marshmond.github.io/Foodventory/`. Browsers keep a site's stored data per origin (`https://marshmond.github.io`), not per folder, so a script running on either other app can read Ledger's database and the saved GitHub token and passphrases. One of those apps loads two outside scripts and builds pages with `innerHTML`; I did not test either for vulnerabilities and have no evidence of misuse, so this is a confirmed configuration exposure, not a demonstrated attack.

What fixes it: Ledger running on an origin that no other app shares. What does not: any change inside Ledger's own code, because the other pages' scripts read the storage directly.

## 2. The three options compared

| | **A. Custom domain for Ledger** | **B. Dedicated GitHub account or organization** | **C. Move the other applications** |
|---|---|---|---|
| **What changes** | A domain name you own is attached to the existing `ledger` repository's Pages site; Ledger is then served at that domain's root | The `ledger` repository is transferred to a new, separate account or organization (a free organization is enough); its Pages address becomes that account's `github.io` | FBB and Foodventory are moved to other origins (their own domain or account) or unpublished; Ledger stays where it is |
| **Cost** | A domain, typically around ten to fifteen dollars a year (UNVERIFIED; depends on the registrar and name). HTTPS certificates are provided by GitHub Pages at no charge | Free (public repositories get Pages on a free organization) | Free if they move to another free account; the effort is the owner's, plus any change to links the owner has shared for those apps |
| **Ownership and upkeep** | Owner keeps one more yearly bill and one DNS record; if the domain lapses Ledger's address stops working until renewed | A second account or organization to keep logged in and secure (two-factor on both); the owner remains its owner | Two other apps need a new home and new addresses; the discipline "never publish another project on Ledger's origin" must be kept forever |
| **Effect on the existing repository** | None: same repository, history, Actions and secrets | The repository moves to the new owner: its web address, `origin` remote, any bookmarks to the repo and the `marshmond/ledger` references in documents change (GitHub forwards the old repository address for a time). History and Actions history come with it | None for Ledger |
| **Deployment changes** | Add a `CNAME` setting in Pages (and the DNS record at the registrar). The workflow and `vite.config.ts` need no change (`base` is `./`, routes are hash routes, so the app works at a domain root) | Re-enable Pages for the repository under the new owner; the workflow needs no change. Check the repository's Pages and Actions settings after the transfer | None for Ledger |
| **Data migration** | Yes. The new origin starts with an empty database (see section 3) | Yes, same | **None.** Ledger keeps its origin, its database and its installed shortcut |
| **Home Screen shortcuts** | The old shortcut was installed from the old address. GitHub normally forwards the old project address to the custom domain (confirm in GitHub's documentation at the time); the forwarded app is the new origin with an empty database. Re-install the shortcut from the new address after migrating | Same. The old address stops serving Ledger unless a small forwarding page is left there | None for Ledger |
| **Sync continuity** | The private sync repository is separate and unchanged, so the data is intact. On the new origin the token and passphrases (stored per origin) must be entered again, then "use the synced copy" | Same | Unchanged |
| **Rollback** | Remove the custom domain in Pages; the old address works again, and the old origin's browser data was never deleted | Transfer the repository back (GitHub supports it) and re-enable Pages; the old origin's browser data is untouched | Re-publish the other apps at their old addresses |
| **Isolation check** | Section 5 | Section 5 | Section 5 (only Ledger remains on `marshmond.github.io`) |
| **Remaining weakness** | None for the shared-origin problem | None for it, as long as the new account hosts no other Pages project | Any project the owner publishes under `marshmond.github.io` later puts the problem back |

## 3. What a migration would involve (A or B)

Browsers do not move stored data between origins. The safe route uses what Ledger already has:

1. **Before anything:** on the current address, export an encrypted backup and a plain backup (Settings, Data & Backups), confirm the Sync page shows a recent successful sync, and write down the sync passphrase and backup passphrase (they are not recoverable). Keep the current address working.
2. **Rehearse first with invented data** on the new address, never real data first: open the new address in a private window, add a few sample records, back up and restore them, and confirm sync set-up works.
3. **Switch:** enable the new address (domain or transferred repository). Open it on the main device; set up sync with the same private repository, token and passphrase; choose **"use the synced copy"** (the app saves a safety copy first). Compare record counts and the Household finances figures with the old address.
4. **Other devices:** repeat step 3 on each device, then re-install the Home Screen shortcut from the new address.
5. **Only after every device is verified:** clear Ledger's data from the old origin's browsers and consider rotating the GitHub token (create a new one for the new origin, delete the old one on GitHub).

Throughout, the old origin keeps its data, which is the rollback.

## 4. Recommendation (planning default)

The brief's default is to isolate Ledger while keeping the existing repository where practical. That points to **A**: the repository, its history and its deployment stay exactly as they are; only a domain is attached. If the owner prefers not to pay for a domain, **B** is the free equivalent and keeps the history (a transfer), at the cost of changing the repository's address and a second account to look after. **C** needs no migration of Ledger's data and is the least disruptive for Ledger, but it moves the cost onto the other two apps and leaves the origin one careless future publish away from the same problem; it is best as a complement to A or B, not the only measure.

Until one of these is done, the practical advice is unchanged: do not publish anything else under `marshmond.github.io`, and keep the token a Contents-only token for the one private repository.

## 5. How isolation would be verified (owner-run, with invented data first)

1. In Ledger at its new address, add one invented test record and note `location.origin` (it must differ from `https://marshmond.github.io`).
2. Open one of the other apps (for example `https://marshmond.github.io/Foodventory/`), open the browser's developer console, and run `indexedDB.databases()` and `localStorage.getItem('ledger-sync-config')`. Expected: no database named `ledger` or `ledger-sync-meta`, and `null`.
3. Do the same from the old Ledger address if it still serves anything: it must show no data after clearing.
4. Confirm sync and a backup restore still work from the new address.
5. Record the result in the next phase report.

## 6. What needs the owner

- Choose A, B or C (or a combination) and, for A, a domain.
- Explicitly authorize each hosting action in writing before anyone performs it. Claude must not change GitHub settings, accounts, DNS or remotes on its own, and no GitHub token should be shared in chat.
- Decide the timing: this is independent of the ST-S1 code fixes and of ST-S2 to ST-S5, but it should be settled before Family Management stores more sensitive information.
