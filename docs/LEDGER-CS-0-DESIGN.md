# Ledger CS-0: Family Command Station and Calendar Communications (design)

**Status (2026-11-16, revised in place by CS-0.1 the same day; see the CS-0.1 section below): DESIGN ONLY. Design review by ChatGPT: product direction and architecture ACCEPTED IN PRINCIPLE, no further design phase required. The owner has NOT formally approved the L-series recommendations, and owner acceptance gate G1 is OUTSTANDING. No production code, test, database schema, dependency, deployment setting, repository, hosted resource, credential or email integration was created or changed. Nothing is committed, staged, pushed or deployed.** CS-1, CAL-N0 and every later phase are NOT started and need explicit approval.

**Privacy:** the repository is public. Every name, address and number below is invented (Sam, Robin, Jordan; example times). No real household data appears here.

**Labels used:** **[Fact]** verified in this repository during CS-0 (file named). **[Decision]** a recommendation that becomes binding only when the owner approves it. **UNVERIFIED** an outside fact (a product's limit, price, or behavior) that I could not confirm from an official source in this session and that must be checked before it is relied on. Estimates are relative (Small / Medium / Large), not calendar time.

## CS-0.1: Targeted refinement (what changed)

ChatGPT reviewed CS-0 and approved the product direction and architecture in principle. CS-0.1 changes only the items below; the rest of the document stands. No architecture was re-evaluated.

| # | Requested | What changed | Where |
|---|---|---|---|
| 1 | The ten-minute sync rule cannot stop a stale device republishing a revoked item | Replaced by a **publication protocol**: a full sync round *immediately* before publishing, a **causal check against the display file** (the file lists every privacy decision its last publisher had seen; a publisher missing any of them refuses), a re-check, then compare-and-swap. Fails closed. Honest limits stated | H.5a (new), H.5, F.3, F.6 (`grantsSeen`), CS-1 and CS-2 scopes, L-8 |
| 2 | Filters must not silently clear | Who and Show choices **persist** until changed or Reset; an always-visible "Showing Sam · Events" chip with Reset; idle return to a screen is an **optional setting, off by default**, and never touches filters; Calendar remains the start screen | D.2, D.6, D.7, L-7 |
| 3 | Calendar-level sharing must be understandable | Plain-language switch dialog, **mandatory preview**, visible badges and a one-tap "Keep this one private" on every event, a "recently became eligible or changed" list, and a clear split between what is structurally excluded and what an owner can type into a title | F.3b (new) |
| 4 | Shorter offline default; honest about erasure | Default **3 days** (choices 24 hours, 3 days, 7 days); expiry is checked at app start and while running; explicit statement that it cannot erase an offline, unopened stolen tablet, that a clock can be set back, and that **non-extractable keys do not protect against someone holding the device** | F.8, H.2, I.3, I.5, L-7 |
| 5 | Email must not interrupt the tablet path | CS-1 → CS-2 → CS-3 is the primary path. CAL-N0 stays a design phase that runs alongside. **Real delivery is CAL-N1**, independent. `mailto:` assisted send is an **optional interim convenience (CAL-N1-lite)**, built only if you ask, never on the tablet path | A, J.10, J.11, K, L-9 |
| 6 | Scope unchanged | MVP and exclusions unchanged (section C). No grocery lists, voice, meal planning, tablet write-back or external calendar integration in the first release | C |

**Closeout clarifications (CS-0.1 final).**
1. **Privacy decisions advance the published history even when the visible schedule is unchanged.** A new, changed or revoked decision must change `grantsSeen`, and publication is skipped **only if both the display-content digest and the `grantsSeen` set are unchanged** (H.5, H.5a, F.6, CS-1/CS-2, H.6). Example: revoking an event outside the published date window changes no visible entry, but the published causal history still advances, so a stale device cannot use the unchanged visible schedule to bypass the decision.
2. **A parent-calendar grant never makes a Finance-type event display-safe.** The future display-source adapter rejects known financial event types and retired or handed-off financial records even under a calendar-level grant (F.4a). Owner-written titles remain the owner's judgment.

**CS-1 readiness.** The design is ready for CS-1 *authorization*, which still needs your approval of the decisions CS-1 depends on (L-2, L-3, L-4, L-6, L-11) and gate G1 (section M). CS-1 builds no publishing, so the protocol in H.5a is implemented in CS-2; CS-1 must still produce and test the `grantsSeen` list it relies on. L-5, L-7, L-8 are needed before CS-2; L-9 and L-10 before CAL-N0; L-12 before CS-3.

---

## 0. Baseline verified before writing

| Check | Result |
|---|---|
| Branch / HEAD | `main`, `3ad8f09` (`feat(family): add family lenses and weekly schedule`, R4.2) |
| `origin/main` | `3ad8f09`: identical to HEAD after `git fetch` |
| Deployment | GitHub Pages run **#126**, `completed` / `success`, for `3ad8f09` (public Actions API; `gh` is not installed) |
| Working tree | clean except the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`), untouched |
| Documentation drift found | `docs/LEDGER-R4.2-REPORT.md`, `docs/BACKLOG.md` and `docs/CHATGPT-HANDOFF.md` still describe R4.2 as "uncommitted, not deployed" (written before the commit). Corrected in this batch (section P). |
| Real-device acceptance | **None recorded** for any phase since stabilization (handoff section 9; R0 finding). I did not find the owner's filled-in results table for `docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md`. Treated as NOT DONE. |

Read for this design: `CHATGPT-HANDOFF.md`, `BACKLOG.md`, `LEDGER-R0-STRATEGIC-ROADMAP.md`, `LEDGER-R0-PRODUCT-ASSESSMENT.md` (4C), `FAMILY-MANAGEMENT-F0-PLAN` (section 10), `LEDGER-R4.1-REPORT.md`, `LEDGER-R4.2-REPORT.md`, `LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md`, `LEDGER-HOSTING-ISOLATION-PLAN-2026-11-08.md`, `sync.md`. Code inspected: Calendar (`model.ts`, `occurrences.ts`, `ics.ts`, `data.ts`, `EventEditor.tsx`), Family (`familyView.ts`, `householdPeople.ts`), Tasks (`model.ts`), the due-provider contract, Bills' append-only fact model, the sync engine (`github.ts`, `codec.ts`, `merge.ts`), the Content-Security-Policy (`shell/csp.ts`), the service worker, and the deploy workflow.

---

## A. Executive recommendation

**What to build.** A separate, small tablet application, the *Family Command Station*, that shows the household's schedule on a shared iPad or Android tablet. It is a different program on a different web address, not Ledger with the money screens hidden. It never holds Ledger's database, sync file, sync token or sync passphrase.

**How it gets its information.** Ledger (on your own devices) builds a small, encrypted "display file" containing **only items you have explicitly approved for the tablet**, written field by field from a short allow-list, and puts it in a **separate private GitHub repository** that holds nothing else. The tablet fetches that file every few minutes with its own **read-only** key and shows it. The tablet works out "today", "next" and "tomorrow" itself, so it keeps working through midnight and short outages.

**Why this and not a server.** It reuses what you already operate (a GitHub account, a private repository, fine-grained keys, the passphrase encryption Ledger already uses for sync and backups), costs nothing to run, and adds no company, bill or server for you to maintain. The honest trade-off: updates take a few minutes, and **publishing only happens while Ledger is open on one of your devices** (section I explains why; a closed Ledger cannot publish).

**Privacy in one sentence.** An item is private until you approve it; approving is a recorded decision that cannot be undone by an old, out-of-date device; and the display file is built so that notes, places, contacts, money and everything unapproved are never even read into it.

**The tablet experience.** Three screens: a large color-coded family **Calendar** (week, day, month), a glanceable **Today** briefing (what is on, what is next, what needs attention, a peek at tomorrow), and a read-only **Tasks** list. Two independent controls narrow the view: **who** (Everyone, or one or more people) and **what** (events, birthdays and dates, tasks, household visits, maintenance reminders). Settings are limited to appearance, display, layers and connection status.

**Email.** Separately, Ledger Calendar will offer to email people **after you save an event**, only to the people you choose, with a preview, and only after you confirm. Declining changes nothing. The first version needs no server at all (Ledger opens a prepared message in your own mail app); a later version can send automatically and report whether the mail service accepted it, using the same private-repository pattern plus a send-only email key kept in GitHub, never in the browser.

**Order of work.** CS-1 (eligibility and the safe builder, all local) → CS-2 (publish and fetch) → CS-3 (the tablet app). CAL-N0 (email design, design only) runs alongside; real outbound email is CAL-N1, a separate, independently reviewed phase. A `mailto` assisted send is an optional interim convenience, built only on request, never on the tablet path. Optional static mock-ups before CS-3. The real-device checks you owe (section M) gate CS-2 in particular, because CS-2 is the first time Ledger touches a hosted repository and a new credential.

**Decisions I need from you:** twelve, each with a recommended default, in section L. The three that shape everything: the architecture (L-1), which Household Services and maintenance items may appear on the tablet (L-2), and where the tablet app is hosted (L-5).

**What cannot be promised.** A stolen tablet that stays offline and is never opened keeps its saved data in browser storage indefinitely; no remote erase is possible, and the 3-day expiry only acts when the app runs. A closed Ledger publishes nothing. A privacy decision that exists only on a device that has not synced or published cannot stop another device from publishing (H.5a states exactly what is and is not guaranteed). "Delivered" for email can only ever mean "the mail service accepted it".

---

## B. Existing capabilities (what Ledger already provides, and what must be built)

| Need | Already in the code [Fact] | Must be built |
|---|---|---|
| Events with several people | Event `contactIds` (`calendar/model.ts`); "People" box in the editor (`EventEditor.tsx` line 343) | Nothing for the model |
| Repeats, skipped dates, one-date changes | `occurrencesOf` expands any range on local dates (`calendar/occurrences.ts`); the tablet must **not** reimplement it | A publish step that expands a window and sends **occurrences**, so the tablet needs no recurrence engine (F0 decision 5) |
| Family identities and colors | Members point at Contacts; eight stored colors with semantic ids (`family/memberIdentity.ts`, `core/householdPeople.ts`); color is never the only cue | A projection person record (id, name, color id, coarse group) |
| Person filter | `core/peopleLens.ts`; Everyone / one or more; an item naming two selected people appears once (R4.2) | A tablet-side copy of the same *rule* over projection ids; a separate independent source filter |
| Family week reader | `buildFamilyView`, owner audience only; **`display` and every other audience throw `UnsupportedAudienceError` before anything is read** (`family/familyView.ts`; pinned by tests) | **Leave unchanged.** A new, separate allow-list builder (section F) |
| Tasks with people | `contactIds`; Task status `todo/doing/waiting/done`; due date and time; repeat creates a successor with `recurFrom` (`tasks/model.ts`, `tasks/data.ts`) | Eligibility carried to the successor (F.4) |
| Dated items from other modules | Read-only due providers (Services visits and deadlines, Bills, Assets warranties, Projects, Family dates) with titles such as "Warranty ends: <asset>" or "Due: <bill>" | **Not usable as display text** (they name providers, assets and bills). Schedule-only readers plus an owner-written label (F.5) |
| Calendar file export | `calendar/ics.ts` (all-day plain dates, floating repeats, `RRULE`, `EXDATE`, `RECURRENCE-ID`, stable `cal-<id>@ledger.local` ids); `family/familyIcs.ts` (Family-only) | Kept for fallback and for future invitations; **R4.3 deferred** |
| Contact email | `Contact.email` (optional, validated on entry: `core/contacts.ts`) | Recipient selection and consent rules (J) |
| Append-only records that sync safely | Bills' billing "fact" records: added, never merged, a superseded fact stays as history (`bills/cycleModel.ts`); kinds live in `moduleRecords`, which needs **no new table** | The same pattern for display grants and for notices |
| Encryption | PBKDF2 (310,000 iterations, SHA-256) + AES-GCM (`lib/backup.ts` `deriveKey`; `lib/sync/codec.ts`) | A different passphrase and file format for the display file (reuse the primitives, not the sync file) |
| GitHub as a private store | `lib/sync/github.ts`: Contents API with a fine-grained token, compare-and-swap by file `sha`, `409/422` becomes a conflict | A second repository, a write key and a separate read key |
| Hosted-script protection | Production CSP lists the only outside hosts (`shell/csp.ts`): `api.github.com` and one price API | The tablet app gets its own, narrower CSP |
| Offline app shell | Per-build service-worker cache (`public/sw.js`, `swBuild.ts`) | Reused as a pattern for the tablet app |
| Soft delete and sync | Whole-record last-writer-wins by `updatedAt`; deletes are soft; conflicts are kept (`docs/sync.md`) | Eligibility must not live in a mutable flag (F.3) |

**Not present at all [Fact]:** any shared-display eligibility, display projection, tablet app, publishing, email sending, invitation or RSVP code; the F0 idea of a `display` flag on members and dates was **not built** (R4.2 report section E).

---

## C. Product scope

| Tier | Included |
|---|---|
| **MVP (CS-3)** | Landscape-first Calendar with week (primary), day and month; Today and next-event indicators; family-member colors; independent person and source filters; event detail on tap; a toggleable Today briefing; read-only Tasks; approved household visits and maintenance reminders as owner-labeled schedule entries; automatic refresh; last-updated and stale warnings; offline display of the last file; minimal device settings; portrait fallback |
| **Near-term (after the MVP has been lived with)** | Saved views the tablet remembers; an optional "show the place" per event; per-person default rules ("show everything for Sam", owner choice, never a default); a day-by-person columns view (only if shared events can still appear once); clock/dim schedule polish; a settings PIN; night mode schedule |
| **Later and optional (CS-4)** | Marking a Task done from the tablet (needs a write-back path and its own security design); other tightly scoped actions |
| **Explicitly excluded** | Meal planning; grocery or other lists (not a priority); voice commands; weather (optional later, would need its own decision about an outside service); requiring Google Calendar; any money, account, balance, bill, tax or investment information; Contacts' phone, email or notes; birth years and ages; free-text notes; Ledger sign-in on the tablet; any write to Ledger from the tablet in the MVP |

Nothing excluded is re-introduced anywhere below.

---

## D. Tablet UX design

### D.1 Design principles and visual direction

1. **Glanceable first, touch second.** Everything must be understood from about 2 to 3 metres; touch is for nearby use. Proposed (to be tested on the real tablet, not measured here): body text at least 20 px, event titles at least 18 px bold on the grid, headings 28 to 48 px, the Today "next up" title about 48 px, touch targets at least 56 px, contrast at least 4.5:1 for text and 3:1 for color marks.
2. **A related identity, not a copy.** Reuse Ledger Signature's tokens (type scale, surfaces, the eight `--mc-*` member colors in light and dark) so the two feel related. Do not reuse Ledger's shell: no module bar, no sync chip, no Quick Add, no Search, no menus that suggest more exists.
3. **Color is never the only cue.** Every colored mark is accompanied by a name or initial (the D9 invariant). Shared events show **stripes of each person's color plus their initials**.
4. **Calm.** Neutral surfaces, member colors as accents, no badges, charts or counters beyond what is listed. Reduced motion respected. A night theme dims automatically.
5. **Landscape-first (about 1180 to 1366 css px wide), portrait supported.** Layouts below are drawn for 1280 x 800.
6. **No hidden gestures.** Swipe changes the week, but visible Previous / Next buttons always exist. Pinch-zoom is disabled on the display page (this is a fixed display; a note in settings offers larger text instead).

### D.2 Navigation and information architecture

Three destinations in a narrow left rail (about 96 px) with a clock and date at the top and a status dot at the bottom:

```
 +------+
 | 2:14 |   <- clock
 | Mon  |
 | Nov16|
 |      |
 | [#]  |   Calendar   (default)
 | Cal  |
 |      |
 | [*]  |   Today      (briefing)
 | Today|
 |      |
 | [v]  |   Tasks      (read-only)
 | Tasks|
 |      |
 | (o)  |   status dot (green / amber / red) + "Updated 2:14 PM"
 | [gear]   Settings (small, bottom)
 +------+
```

**Today Briefing: recommendation.** Make it **one sidebar destination, plus one button on the Calendar's top bar that flips Calendar and Today** (same screen, two doors). Not a Calendar "mode": a mode hides what the person is looking at behind a toggle and is harder to find from across a room. The Calendar stays the start screen and the first item in the rail. An **optional** device setting, "When nobody has touched it for N minutes, go to: Today briefing or Calendar (this week)", is **off by default**; when on it only changes the screen and **never changes the Who or Show choices**.

Settings are reached from a small gear at the bottom of the rail, with an optional four-digit lock so children cannot reset the display.

### D.3 Calendar (the centerpiece)

**Top bar:** `‹ Today ›` navigation; the range title ("Nov 16 – 22, 2026"); a **Day | Week | Month** switch; a Briefing button; then the two filters.

```
+------+-------------------------------------------------------------------------------+
| rail |  ‹  Today  ›   Nov 16 – 22, 2026          [Day|WEEK|Month]        [Briefing]  |
|      |  Who:  (Everyone) (● Sam) (● Robin) (● Jordan)        Show: [Events ▾ 4 of 5] |
|      +-------------------------------------------------------------------------------+
|      |        Mon 16   Tue 17   Wed 18   Thu 19   Fri 20   Sat 21   Sun 22           |
|      |  all   [Robin's birthday ........]                                             |
|      |  day   [Cleaner visit]                                                         |
|      |  8 am  |         |         |         |         |         |         |          |
|      |  9     |  Drop-off ▌S       ...                                              |
|      | 10     |                                                                      |
|      | ...    |                      ┃▌S▐R  Dentist  (shared: Sam + Robin stripes)     |
|      |  4 pm  ┃ Soccer ▌S  ← NOW line across today's column                           |
|      |  5     |                                                                      |
|      | ...                                                                           |
|      |  Updated 2:14 PM                                           (green dot)        |
+------+-------------------------------------------------------------------------------+
```

- **Week grid (primary).** Seven day columns; today's column tinted with a bold date; an **all-day lane** across the top (birthdays, multi-day items, all-day visits); a timed grid from 6 AM to 10 PM that scrolls, **opening scrolled so the current time is about one hour below the top**; a **current-time line** across today's column that moves each minute. Overlaps share the column in lanes.
- **Event blocks.** Fill is a light tint of the person's color; the left edge carries the color stripe (a shared event: equal-width stripes of each named person, up to three, then "+N"), text is dark on tint (contrast checked), and initials follow the time. Cancelled occurrences are not published, so they never appear. A repeating series shows a small repeat mark.
- **Day view.** One wide column (time grid + all-day lane + a "later today" side list); used by tapping a day header or from Month.
- **Month view.** Large day cells with up to three entries as small dot-and-title pills and "+N more"; tapping a day opens **Day view** (not a pop-over). Today ringed.
- **Event detail (tap).** A right-hand sheet in landscape (about 420 px) or a bottom sheet in portrait: title; when ("Today, 4:30 – 5:30 PM" or "All day, Nov 17 – 19"); the people as named chips; the source label ("Family calendar", "Household visit"); "Repeats" if part of a series. **No place, notes, creator, or links.** A footer line says "Shown from Ledger, updated 2:14 PM".
- **Today / now.** The Today button jumps to today and re-centers the time grid. The current-time line and "now" highlighting are computed on the tablet.
- **Refresh and status.** Data refreshes in the background with no flicker (new data swaps in on the next frame; the scroll position and open sheet are kept). The rail's dot and the footer show connection and freshness (section I).
- **Beyond the loaded window.** Navigating past the end of the published window shows "Schedule loaded through Mar 16" rather than an empty grid that looks like free time.

### D.4 Today Briefing

Answers four questions in this order: *What is on today? What is next? What needs attention? What is tomorrow?*

```
+------+--------------------------------------------------------------+---------------------+
| rail |  Monday, November 16                          2:14 PM         |  Tasks today        |
|      |                                                                |  ▌R  Return library |
|      |  NEXT UP ---------------------------------------------------  |  ▌S  Pack gym bag   |
|      |  |  Soccer practice            ▌Sam                         |  |  ▌   Water plants   |
|      |  |  4:30 – 5:30 PM             in 2 h 16 min                |  |  + 2 more           |
|      |  ------------------------------------------------------------ |  Overdue: 1  (red)  |
|      |                                                                |                     |
|      |  TODAY                                                         |  Coming up          |
|      |   ✓ 9:00  Drop-off ▌Sam  (earlier, dimmed)                     |  Tue  Dentist ▌S▐R  |
|      |   ● 4:30  Soccer practice ▌Sam                                 |  Tue  Cleaner visit |
|      |   ● 6:00  Piano ▌Robin                                         |  Wed  Robin's bday  |
|      |   + 1 more                                                     |                     |
|      |  TOMORROW   9:30 Dentist · 1:00 Cleaner visit · (3 items)      |  [ Open calendar ]  |
|      |  Updated 2:14 PM                                               |                     |
+------+--------------------------------------------------------------+---------------------+
```

- **Next-event highlight:** the first entry not yet over, large, with a plain countdown ("in 2 h 16 min" / "now" / "ends 5:30 PM"). If a timed entry is in progress it is "NOW".
- **Today list:** at most eight rows; earlier ones collapse to one dimmed line ("3 earlier"); "+N more" opens Day view. All-day items first.
- **Needs attention:** open overdue Tasks (count in a restrained red chip), Tasks due today, and approved maintenance reminders due within seven days. No money, ever.
- **Tomorrow preview:** one line (up to three items by time, then "+N").
- **Coming up:** the next few days' notable items and birthdays within seven days (names only).
- **Optional:** a clock (always shown in the rail). Weather: not in the MVP; leaving it out removes an outside-service dependency.
- **Filters:** the briefing honors the same Who and Show controls (a compact chip row under the date). It uses only the same published, approved entries: it has no data source of its own.
- **Return:** "Open calendar" and the rail's Calendar item. A large "Calendar" button sits on the briefing; the optional idle return (D.2) can also bring the screen back here without touching filters.
- **Avoid:** charts, long scrolling lists, Task descriptions, notes, badges, anything not in the published file.

**Portrait:** a single column in the same order (Next up, Today, Needs attention, Tomorrow, Coming up).

### D.5 Tasks (read-only)

```
+------+---------------------------------------------------------------------------+
| rail |  Tasks            Who: (Everyone)(● Sam)(● Robin)      [Today|Upcoming|Overdue|By person|Household]
|      |  OVERDUE  1                                                                |
|      |   ◐  Return library books            due Fri Nov 13 · 3 days overdue  ▌R  |
|      |  TODAY  3                                                                  |
|      |   ○  Pack gym bag                    today 3:00 PM                   ▌S  |
|      |   ◐  Water plants                    today                                |
|      |  UPCOMING                                                                  |
|      |   ○  Book dentist follow-up          Wed Nov 18                     ▌S▐R |
|      |   ○  Renew pool pass                 Mon Nov 23                           |
|      |  Done in Ledger. This display cannot change tasks.        Updated 2:14 PM  |
+------+---------------------------------------------------------------------------+
```

- **Groups:** **Today**, **Upcoming**, **Overdue**, **By person**, **Household-wide** (approved Tasks naming nobody). "Overdue" and "Today" are computed on the tablet from the due date and its own clock.
- **Rows:** a status mark (not a checkbox: **To do** open circle, **In progress** half, **Waiting** pause), the title, a plain-language due label ("today 3:00 PM", "Wed Nov 18", "3 days overdue"), and the people as colored named chips.
- **Person association, not assignment.** The Task names people; Ledger does not record who must do it (R4.2 decision). The tablet says "for Sam", never "assigned to". A Task is **never** attributed from words in its title.
- **Read only.** No checkbox, no edit, no reorder. A one-line note says where to complete it. Tapping a row opens a small sheet with the same fields (title, due, status, people); no notes, checklist, project, tags or origin.
- **Not shown:** completed Tasks; Tasks not approved; anything unreadable.

### D.6 Filtering: two independent systems

**Who (people).** Chips: **Everyone** (default) plus one chip per household member, in the member's color with the name in text. Several can be on at once. An event naming two selected people appears **once**, striped in both colors; there is no "primary" person. **Rule** (the same as R4.2's `lensMatches`): with nobody selected, everything shows; with people selected, an entry shows if it names at least one of them. Entries that name nobody (a household-wide visit) show under Everyone only.

**What (sources).** A "Show" control opens a panel of switches, each with a count: **Events** (family and personal calendars), **Birthdays and dates**, **Tasks**, **Household visits**, **Maintenance reminders**. Only sources that exist in the file are listed.

**Combining.** The two are independent and combined with AND: `shown = whoMatches(entry) AND sourceOn(entry.source)`. Example: Who = Sam and Jordan, Show = Events + Birthdays only, so maintenance reminders and Tasks vanish while the children's activities remain. A status line under the bar states the combination in words ("Showing Sam and Jordan · Events, Birthdays") and offers **Reset**.

**Presets (fixed, not user-built, in the MVP).** A "Views" menu: **Everyone** (all people, all sources), **Kids' schedules** (children in the file's coarse group, Events + Birthdays + Tasks), **Household appointments** (Everyone, Household visits + Maintenance reminders), **Everything approved** (all people, all sources). "Kids" needs a coarse `group` on each person (`adult | child | other`, derived from the Family role at publish; the role words themselves are not published): see L-3. User-saved views are deferred (near-term) because a wall display with many saved views becomes configuration clutter.

**Choices persist.** The Who and Show selections stay exactly as set, across screens, idle time and restarts, until someone changes them or presses **Reset** (back to Everyone and all sources). Because a persisted filter can be forgotten, whenever anything other than the default is active every screen shows a prominent chip ("Showing Sam and Jordan · Events, Birthdays") with a **Reset** button, so the display never looks complete when it is not. A filtered-to-nothing view says "Nothing matches this filter" with Reset, never an empty grid that looks like free time.

**Where the choice lives.** In the tablet's own browser storage only (not in the file, not in Ledger).

**Important distinction.** Turning a layer on or off here is a **presentation preference**. It can only hide entries that are already in the file; it can never reveal anything. Eligibility (section F) is decided in Ledger before a byte is written to the file.

### D.7 Settings (minimal, device-focused)

| Group | Contents |
|---|---|
| Appearance | Light / dark / automatic by time; text size (Standard, Large, Extra large); 12 or 24 hour clock; week starts on (taken from Ledger's setting in the file, overridable) |
| Display | Start screen (default Calendar); optional idle return (Off by default, or Today briefing, or Calendar this week; 5, 10, 30 minutes; screen only, never filters); night dimming schedule; offline keep time (24 hours, **3 days**, 7 days); "keep screen on" (best effort; see I.5) |
| Layers | The Show switches (same as the panel in D.6), and the preset list |
| Connection | Last checked, last published, revision number, projection version, next check, **Check now**, plain-language status |
| Device setup | Device name; pairing status (Paired / Not paired); app version; **Pair this display** (enter or scan the pairing code); **Forget this display** (wipes the saved file and keys); settings lock |
| **Not present** | Finance, accounts, anything about Ledger's data, administrative settings, sync, backup, the file's passphrase |

### D.8 Portrait fallback

- The rail becomes a bottom bar (Calendar, Today, Tasks, Settings); the clock moves to the top-left.
- **Week** in portrait is a **stacked seven-day agenda** (a day header with its entries listed), not seven cramped columns. The grid week appears only when the width is at least about 1000 css px.
- Day and Month work as in landscape; the event sheet is a bottom sheet; filter chips scroll horizontally in one row.

### D.9 Static prototype review (proposed as its own step, CS-0.5)

Before CS-3, produce **four static, invented-data mock-ups** (week, Today, Tasks, portrait week) for you to approve on the real tablet's screen (or its size in a browser). No production code. Recommended because look and distance legibility are the hardest things to judge from words. See K and L-12.

---

## E. Source of truth

**Rule.** Ledger is the only source of truth for Ledger-managed events, Tasks, Family information and household schedules. The Command Station displays a **projection**: a read-only, replaceable, expiring copy. It never edits, merges or becomes authoritative; if the file and Ledger disagree, Ledger is right, and the next publish fixes the tablet.

**Ownership classes** (so duplicates and unintended edits cannot arise later):

| Class | Owner | Tablet shows | Edited where | Future external calendars |
|---|---|---|---|---|
| **Ledger-owned events** | Ledger Calendar (`cal-<id>@ledger.local`) | Yes, when approved | Ledger only | May be **published out** one-way to Google/Apple under the same stable ids so an update replaces rather than duplicates |
| **Externally owned events** (a subscribed Google/Apple/school feed) | The external calendar | Only as a read-only overlay, with a visible "from <name>" label, never re-published, never edited in Ledger | The external calendar | Overlay only; Ledger does not take ownership, copy it into Ledger events, or send it back |
| **Derived household events** (visits, maintenance due dates) | Their module (Services, Assets); Ledger Calendar shows them as read-only layers | Only as sanitized, owner-labeled, schedule-only entries (F.5) | The owning module | Not exported by default (they name providers and assets) |
| **Family dates** (birthdays, important dates) | Family module; derived on demand, never stored in Calendar | Name and date only, no age or year | Family | Not exported to external calendars unless the owner opts in |
| **Task-derived dates** | Tasks; shown as Tasks (not as events) | As Tasks, with a due label | Tasks | Tasks are not calendar events and are not exported as such |

**Why the classes prevent trouble.** Each entry carries a `source` and an opaque stable id. An overlay is never converted into a Ledger-owned event, so there is nothing to double up when it also appears from the source calendar; Ledger-owned events keep one id forever, so a future one-way publish updates in place; derived items cannot be edited on the tablet or in a calendar app because they are not events at all.

**External calendars (future, separate decision; not built and not required).**

- *Publish selected Ledger events to Google Calendar, viewable in Apple Calendar.* One-way, event-by-event, opt-in, using the existing UID convention and a stable per-event external id so changes update, not duplicate. Requires Google sign-in (OAuth), a token stored somewhere that is not the browser alone, and handling deletions and the "following" series split (Ledger creates a **new event id** when a series is split: `saveEdit` with scope `following`). It is a real integration (Medium to Large) and is **not** a prerequisite for anything here.
- *Show selected external subscriptions as read-only overlays.* Needs an outside fetch (an `.ics` URL is usually secret-URL protected) and the same projection pipeline with a distinct `source`. The "subscribed" calendar type is already reserved in `calendar/model.ts`.
- *Never:* two-way sync, importing external events as Ledger-owned, or making the tablet depend on either.

---

## F. Privacy architecture

### F.1 What is being protected

| Asset | Adversary or accident | Required outcome |
|---|---|---|
| Money, accounts, taxes, investments, Contacts' private details, notes, birth years | A thief with the tablet; whoever sees the tablet; a bug in the display builder; a leaked read key | **Never present** on the tablet or in the file |
| Items you did not approve | A bug, a stale device, a mis-set filter, an event moved into an approved calendar by mistake | **Not in the file** |
| Revoked items | An out-of-date device re-publishing old approvals; a restored old backup | **Stay hidden** |
| The tablet's credentials | Loss, theft, a script on the same web address | Read-only, single-purpose, separately revocable; useless for Ledger |
| Ledger's own storage | Other apps on the same web address (existing accepted risk SE-01) | The tablet app is on a **different origin** and Ledger is never opened on the tablet |

### F.2 Non-negotiable rules

1. **Private by default.** Association with a Family member, a Contact, a project or a calendar does not make anything eligible.
2. **Allow-list construction, never filtering.** The display file is built **field by field** from an explicit list. It is never "serialize the record, then delete the sensitive fields". The builder's *input type* has no field for notes, location, contact details, amounts or links, so it cannot leak what it cannot hold.
3. **Fail closed.** Unreadable, unknown-kind, unknown-version, conflicting or newly added anything is **excluded**.
4. **No second schedule engine, no second source.** The builder calls the Calendar's own `occurrencesOf`; the tablet only filters and arranges published entries.
5. **`buildFamilyView('display', …)` keeps throwing.** The R4.2 reader and its tests do not change. The display builder is a separate function with a different signature that cannot be called without an eligibility set (F.3).
6. **No Ledger credentials on the tablet, ever.**

### F.3 Eligibility: options compared and the recommendation

| Option | How it works | Verdict |
|---|---|---|
| **1. A flag on the event or Task record** (`display: true`) | A field in the record | **Rejected.** Records sync by whole-record last-writer-wins. A stale device that still holds `display: true` and edits the title a minute later overwrites the owner's "make private" edit and republishes it. F0 section 10.2 already ruled this out. |
| **2. A separate allow-list document, held outside Ledger** (in the display repository) | Ledger reads it back to decide | **Rejected.** A second source of truth outside Ledger's sync, merge, backup and restore semantics; changes would not travel with restores; an outside write could widen eligibility. |
| **3. Append-only decision records inside Ledger** (new `moduleRecords` kind; no new table) | One immutable record per decision; a later record *supersedes* earlier ones; the effective state is computed | **Recommended.** Follows Bills' fact-record precedent; syncs and backs up with everything else; a stale device cannot rewrite history because it can only **add** records. |
| **4. Rule-based eligibility only** ("everything for Sam") | A predicate | **Rejected as the foundation** (private by default; association is not consent). Allowed later only as an explicit, owner-set convenience that an item can always override. |

**Recommended design (Option 3), summarized as rules.**

*Storage.* `moduleRecords` rows with `module: 'display'`, `kind: 'grant'`. **UNVERIFIED in the code until CS-1 starts with a check:** that no feature that enumerates `moduleRecords` by module name (backup summaries, deletion cleanup, Search, the sync conflict labeler) mishandles a module name it does not know. No database table or migration is needed (this respects the standing "no new table" rule from ST-S5.1).

*A decision record (all fields).* `subject` (what it is about: `event:<id>`, `task:<rootId>`, `calendar:<layerId>`, `visit:<arrangementId>`, `reminder:<planId>`, `dates:<memberId|all>`, or the kill switch `all`); `decision` (`show` or `hide`); `level` (`details` or `busy`, for events only); `label` (owner-typed display text, required for visits and reminders, optional for `busy`); `supersedes` (the ids of the decision records for this subject that this device had seen); a random `deviceId`. Records are **never edited or deleted** by any screen.

*Computing the effective state of a subject.*
1. Gather the subject's decisions. The **heads** are those no other decision supersedes.
2. No decisions: **hidden**.
3. Any head that is unreadable, has an unknown `decision`, or an unknown record version: **hidden**.
4. Any head says `hide`: **hidden** ("concurrent choices: the safest wins").
5. All heads say `show`: **shown**, at the **narrowest** level among them (`busy` beats `details`).
6. **Timestamps are never used to order decisions.** Only the `supersedes` links do. A device with a wrong clock therefore cannot make an old approval look newer than a revocation. (`updatedAt` remains for display and for the sync engine.)

*Precedence for one event.* (1) the event's own decision, if any: it wins either way; (2) otherwise a **calendar-level** grant (`calendar:<layerId>`) that is shown; (3) otherwise hidden. A calendar-level grant is the convenience for a dedicated "Family" calendar (one switch, not one tap per event); an event-level `hide` always overrides it.

*Revocation and stale devices.* Revoking adds a `hide` record that supersedes the `show` heads the revoking device sees. A stale device that never saw the revocation can only add records. If it adds `show` while the revocation exists elsewhere, after sync the subject has two heads, one `hide`, so it is **hidden** and Ledger shows "Conflicting choices: please choose again" (the owner's new decision supersedes both). The one thing an old device could do that matters is **publish** from stale data. A "synced within ten minutes" rule does **not** stop that (Device A revokes at 2:00, Device B synced at 1:55 and publishes at 2:03 from a state that still says `show`), so CS-0.1 replaced it with the protocol in **H.5a**: a full sync round immediately before publishing plus a causal check against the display file. That protocol also enforces the restore rule below.

*Restore is dangerous, so it pauses publishing.* A restored older backup brings back older grant records. After any restore, replace-from-sync, or "use the synced copy", **publishing pauses** and the owner reviews the full "what the tablet will show" list before it resumes (CS-2).

*Lineage.* Two Ledger actions create a new record from an existing one, and a grant on the old record would not follow:
- Calendar scope **"this and following"** splits a series and creates a **new event id** (`calendar/data.ts` `saveEdit`, `scope === 'following'`, which already copies links with `copyLinks`).
- Completing a repeating Task creates a **successor Task** with `recurFrom` (`tasks/data.ts`).
CS-1 must copy event-level grants on a split and key a Task's grant to the **root of its `recurFrom` chain**. A device on an older build that splits without copying produces a **hidden** new event (fail closed), never an exposed one.

*The kill switch.* A decision on subject `all` with `hide` pauses every publish and causes the next publish (or a "Hide everything now" button) to write an **empty** file, immediately. The owner can resume deliberately.

*Where the owner sees and changes it.* A small "On the family tablet" control in the event and Task editors (Not shown / Shown / Shown as "Busy"); a "Show this calendar on the tablet" switch in calendar settings; "Family tablet" sections for Household Services arrangements and Home & Assets maintenance plans (each asks for the display label); and **Settings → Family display**, a single page listing everything currently shown, with Revoke buttons, the preview, the publish log, and the kill switch.

### F.3b Calendar-level sharing, explained (CS-0.1)

Private by default stays absolute: no calendar is shared until the owner switches it on. A dedicated "Family" calendar can be approved as a whole, because approving every school and practice event one by one would not be used. What the owner must understand, and how the design says it:

1. **The switch dialog says it plainly:** "Every event on this calendar, including events you add or move here later, can appear on the family tablet with its title, date, time and the people named. Notes, places and anything outside Calendar never appear. Use a calendar that holds only family events." Derived calendars (Finance, Bills, Tasks, Projects, Home & Assets, Services, Family) cannot be switched on at all; only calendars that store events can.
2. **A preview is required.** Before the switch takes effect Ledger lists every event on that calendar that would become eligible (count and titles for the publish window) and the owner confirms. The Personal calendar carries an extra warning that it often holds private items.
3. **Visible, per-event overrides.** Each event on a shared calendar shows an "On family tablet" badge in the Calendar, agenda and editor, and the editor has **Keep this one private** (an event-level `hide`, which always wins) and **Show as Busy**. A private event shows a lock mark so overrides are not invisible.
4. **New and moved events.** An event created on, or moved into, a shared calendar is eligible on the next publish. The editor says so at the moment of saving ("This calendar is shown on the family tablet"), and Settings → Family display lists, for 14 days, events that **became eligible or whose title changed** since the owner last reviewed, each with Keep private.
5. **Edited titles.** An approved item's new title is published automatically (an approval is to show *the item*, L-11). The editor states this before saving, and the "recently changed" list is the review point. A setting that would hold edited titles until reviewed is **not** proposed for the first release (it adds a step to every edit); it can be added if real use shows the list is not enough.
6. **Turning the calendar off** hides everything shown only because of the calendar (count shown first); events with their own explicit `show` stay.

**Structural exclusion versus text the owner types.** Finance, Bills, Services records, contacts' details, notes and places are **structurally** impossible to publish: the builder's input type has no field for them, and tests prove it. A **title is free text**, and Ledger cannot know that "Pay Dr. Lee $1,200" in a title is private. So the design promises only this: an event's title is published exactly as typed once the event is eligible; the owner sees the real text in the preview, in the list and in the editor banner; and Busy and Keep private exist. An optional "this title contains an amount" hint may be added in CS-1, but it is a convenience, not a safeguard, and the document does not rely on it.

*Content drift after approval.* An approval follows the item as it is edited (it is approval to show *this item*, not this exact text). The preview page and a "title changed since you approved it" marker (items whose title differs from the first-approved title) are the control; pinning approval to content would force a re-approval for every edit and train the owner to click through. This is a judgment call (O.2).

### F.4a Financial-type events are rejected even under a calendar grant (CS-0.1 final)

An event in an approved personal or family calendar is **not automatically display-safe**. Events carry an explicit `type` label (for example `bill` or `finance`) and may be `retired` (taken over by another module, with a note of where it went) [Fact: `calendar/model.ts`]. The future display-source adapter must **not rely on the parent calendar**; it rejects, before reading any other field:
- any event whose `type` is a known Finance-related value (the list lives in the adapter, is **closed by default**: an unrecognized non-empty `type` is rejected until the owner-approved list says otherwise), and
- any `retired` or handed-off event (authoritative ownership has moved to Finance, Bills, Services or another module), and
- any event that links to a Finance, Bills, Services or Projects record (checked through the shared links).
This applies even if the event has its own item-level `show`; a calendar-level or item-level grant can never override it. Rejected items are listed in the preview as "Not eligible: belongs to Finance" so the owner is not left wondering. **Limits:** this is structural, based on stored type, ownership and links. It cannot recognize that an ordinary-looking, untyped event was entered with a title like "Pay Dr. Lee $1,200"; arbitrary owner-written titles remain the owner's judgment, as in F.3b.

### F.4 Which sources may reach the tablet: approvals needed

| Source | Tablet use | Default | Needs owner approval before display support is built? |
|---|---|---|---|
| Calendar events (family/personal calendars) | Yes, as events | Hidden until granted (item or calendar) | **No further approval**: the brief approves it; the owner grants per item/calendar |
| Family birthdays and important dates | Yes: name and date only, **no age, no birth year** | Hidden until granted (per member, per date, or `dates:all`) | **Yes (L-2):** confirm names-only |
| Tasks (open only) | Yes, read-only | Hidden until granted | No further approval (brief) |
| Household Services visits (the cleaner, a repair visit) | Yes, as a **schedule-only, owner-labeled** entry | Hidden | **Yes (L-2).** This relaxes nothing in the existing boundary: no Services *record* is exposed (F.5) |
| Home & Assets maintenance reminders | Same mechanism | Hidden | **Yes (L-2)** |
| Services renewal / notice / contract dates | **No** | n/a | Excluded: contract and money-adjacent |
| Bills & Subscriptions | **No** | n/a | Excluded: payee names reveal what the household pays |
| Projects | **No** (a Task or event linked to a project can be approved on its own; the project name is never published) | n/a | Excluded |
| Home & Assets warranties, lifecycle, asset names | **No** | n/a | Excluded |
| Finance (anything) | **No, even if somehow granted** | n/a | Hard exclusion in the builder's type |
| Contacts | Member **names** only; never phone, email, notes, address, non-member Contacts | n/a | Already the F0/R4.2 rule |

### F.5 How Services and maintenance appointments can appear without exposing their records

The brief asks whether sanitized display events can be derived from other modules **without exposing their records**, and whether the existing boundary is being relaxed. **Answer: yes, with no relaxation,** because the display entry is a *new* object, not a view of the source record:

1. The module provides a **schedule-only reader** for display: it returns only `{ key, date, time?, durationMinutes? }` for the arrangement's upcoming visits, using the module's own scheduling rules. (Services' due provider already computes these dates; the new reader returns the dates and nothing else: no provider, price, contract, note, or link.)
2. The **title** is the owner-written `label` stored in the grant ("Cleaner", "Furnace service"). The tablet never receives the arrangement title, provider name or any text the module wrote.
3. The grant is **per arrangement or plan**, not per visit, so a recurring cleaner appears without a decision per visit; revoking it removes every future visit.
4. The entry carries `source: 'visits'` or `'reminders'` and the people the owner chose on the grant (default none).

Why not reuse the due-provider items: their titles are built from record text ("Warranty ends: <asset>", "Due: <bill>", renewal and notice wording). Filtering after the fact would be exactly the "serialize then delete" pattern ruled out.

### F.6 The display projection contract (version 1)

A narrow, versioned, plain schema. **No arbitrary metadata, no free-form object, no unknown keys.** Every field is listed.

```
DisplayProjection (decrypted contents)
  format         "ledger-display"
  version        1                 schema version
  minReader      1                 oldest tablet app version that may read it
  revision       integer           +1 per publish; the tablet never accepts a lower one
  publishedAt    ISO-8601 UTC
  generatedFor   { tz: IANA zone name, today: "YYYY-MM-DD" }   zone of the publishing device
  window         { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
  household      { label: string<=40 }        owner-chosen, default "Family"
  prefs          { weekStart: 0 | 1 | 6 }
  people[]       { id, name<=40, color: one of 8 semantic ids | null, group: "adult" | "child" | "other" }
  sources[]      { id: "events"|"dates"|"tasks"|"visits"|"reminders", label }
  entries[]      (calendar-style)
                 { id, source: "events"|"dates"|"visits"|"reminders",
                   title<=80, allDay,
                   start { date, time|null }, end { date, time|null },   local wall clock; for all-day, end.date is the LAST day inclusive
                   people[] (ids, sorted), repeat: boolean, status: "scheduled" | "done" }
  tasks[]        { id, title<=80, due { date, time|null } | null,
                   status: "todo" | "doing" | "waiting", people[] (ids, sorted), repeat: boolean }
  grantsSeen[]   opaque ids (HMAC, like entry ids) of EVERY display-grant record the publisher had when it built this file; used only by publishers (H.5a); no content
  counts         { entries, tasks }
  digest         SHA-256 over a canonical form of people, entries and tasks (the DISPLAY-CONTENT digest; it does not cover `grantsSeen`)
```

- **Stable IDs.** Opaque, derived as the first 12 bytes of HMAC-SHA-256 over `"<kind>:<ledgerRecordKey>:<occurrenceKey>"` with a key derived from the display passphrase (HKDF). The tablet never learns Ledger's numeric record ids (which are time-based) and ids agree across every publishing device that knows the passphrase.
- **Dates and times.** Local wall-clock strings (`YYYY-MM-DD`, `HH:MM`) in the **publishing device's zone**, recorded in `generatedFor.tz`. Timed events are stored in Ledger as absolute milliseconds; the builder converts them with the Calendar's own local-time functions. The tablet interprets them in its own zone and shows a notice if its zone differs from `generatedFor.tz`. A tablet whose clock disagrees with the server's `Date` response header by more than five minutes shows "This display's clock may be wrong" (**UNVERIFIED** that the header is usable from the browser fetch; the CS-2 acceptance checks it).
- **Window.** From 14 days before today through 120 days ahead, already expanded. Hard caps (2,000 entries, 300 Tasks, 500 KB uncompressed): over the cap the publish **fails with a message**, it never truncates silently.
- **What is never in it:** notes, location, reminders, priority, tags, project, calendar layer name, Contact ids, phone, email, birth year or age, ages, amounts, account or tax fields, links, any Ledger record id, `retired` information, override text for a single occurrence (a one-date change publishes **only** its title, time and date, taken through the same allow-list).
- **Display-safe status.** Events: `scheduled` or `done` (only for "keep until done" items). Tasks: `todo`, `doing`, `waiting`. "Overdue" is computed on the tablet. Completed, cancelled, skipped and retired items are simply **absent**.
- **Revision and timestamp.** `revision` (monotonic) and `publishedAt` let the tablet reject rollback and tell the owner when it last changed.
- **Errors and unsupported versions.** The tablet validates the whole file before using any of it: wrong `format`, an unknown key, a bad `digest` or `counts`, a lower `revision`, or a malformed value means **the file is rejected and the last good file stays on screen with an error status**. `version` greater than the tablet understands or `minReader` greater than the app's version means "This display needs updating": last good data stays, the app updates itself through its service worker. A file that fails to decrypt means "paired code or passphrase no longer matches" and offers re-pairing. Partial rendering never happens.
- **Container.** `LDP1` magic, 16-byte salt, 12-byte IV, AES-GCM ciphertext of the gzip-compressed JSON, with the magic, version and `revision` bound as additional authenticated data. No plaintext header at all.
- **Test pinning.** A compile-time check and a runtime key allow-list (as R4.2 did for `FamilyEntry`) fail if a field is added; a privacy test seeds records with deliberately sensitive text in every excluded field and proves none of it appears in the serialized file.

### F.7 Application isolation

- **A separate application.** Its own entry point, build and deployment, in the same source repository under `display-app/` (CS-3 confirms the folder), with its own Vite configuration and `index.html`. A **shared contract folder** (`display-contract/`: the schema types, the validator, the codec) is the only code both sides import, and imports nothing from Ledger.
- **No Ledger data code.** A test, in the style of the existing `lazyBoundary.test.ts`, walks the tablet app's import graph and **fails if it reaches** `src/db`, `src/core/store`, `src/modules/*`, Dexie, or any Finance file. The shared contract is also checked to import nothing outside itself.
- **Separate origin.** See H.7. The tablet app must **not** be served under the same web address as Ledger (a service worker at `/ledger/` would also cover `/ledger/display/`, and the browser would put both in one storage origin).
- **Separate storage names**, a distinct service-worker scope and cache prefix (not `ledger-`).
- **Tablet CSP:** `default-src 'self'; connect-src 'self' https://api.github.com; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'`, a test pinned to the list of allowed hosts as `shell/csp.ts` is.
- **Never open Ledger in the tablet's browser, and never open the tablet app on a device that holds Ledger.** (A script in the tablet app could otherwise reach Ledger's storage if they shared an origin.)

### F.8 Revocation and lost or stolen tablets

| Event | What you do | What it achieves | What it does not |
|---|---|---|---|
| Tablet lost or stolen | In GitHub, delete the tablet's **read key** (one click); then in Ledger, **change the display passphrase** (re-pair the new tablet) | The old tablet can no longer fetch anything; the next files cannot be decrypted by it | Does not erase what the tablet already holds |
| What the thief can see | Whatever the cached file contains (approved schedule, a window of about 4 months) | n/a | A cached file is readable by anyone who can use the unlocked tablet, until it reconnects and learns of the revocation, or its **self-expiry** (default **3 days** without a successful refresh; choices 24 hours, 3 days, 7 days) runs. The expiry is checked when the app starts (before anything is drawn) and every minute while it runs; **it cannot act on a tablet that stays off or offline and is never opened**, and it relies on the device clock, which can be set back |
| Remote erase | Not possible if the tablet is offline | Self-expiry and re-pairing are the mitigations | Honest limit: cached data on an offline device cannot be remotely erased |
| Read key leaks (not the tablet) | Delete the read key | Only ciphertext could ever be fetched with it, and only until deletion; the passphrase never traveled with it | Old ciphertext someone already copied stays decryptable with the **old** passphrase (hence the passphrase change) |
| Item shown by mistake | Revoke the decision in Settings → Family display (or the kill switch) | Next publish removes it | The tablet's cache keeps it until the next successful fetch |
| Write key leaks | Delete the write key in GitHub | Stops further publishing | An attacker with the write key could replace the file with a garbage or old file: the tablet rejects it (it cannot decrypt without the passphrase, and refuses a lower `revision`) |

---

## G. Hosting alternatives

The requirement: Ledger, which runs in browsers, must put a **display-safe** file somewhere a tablet can fetch it, with separate credentials and revocation. Do not assume a closed Ledger can publish (see I.2).

### G.1 Option A: private GitHub repository holding only the encrypted projection (recommended)

- **What:** one private repository containing one binary file (`display.bin`); a **write** key (fine-grained token, Contents: read and write, that one repository) in each Ledger device that publishes; a **read** key (fine-grained token, Contents: read-only, that one repository) on the tablet; the file encrypted with a display passphrase that exists only on Ledger devices that publish and on the tablet.
- **Credentials and scope:** two fine-grained tokens, separate from the sync token; neither can touch the sync repository. Fine-grained tokens are scoped per repository, **not per file**, so the repository must hold only the display file (which is why the email outbox in J.7 is a *separate* repository). Both have an expiry (the owner chooses; Ledger shows a reminder before it). **UNVERIFIED:** current maximum expiry and whether an organization policy forces one.
- **Encryption:** AES-GCM with a key from the display passphrase (PBKDF2, 310,000 iterations); the host sees only noise. Two independent layers protect the content: the read key (to fetch) and the passphrase (to read).
- **Repository history:** every publish is a commit with an encrypted blob (about 10 to 30 KB). At about 15 publishes a day that is about 100 MB a year at the high end (my estimate; the existing sync file has the same growth character, tracked as SY-02). Mitigations: skip unchanged output, a minimum interval, and an annual owner-guided **history reset** (recreate the repository). Old blobs stay decryptable by a holder of the **old** passphrase, which is why a lost tablet means a passphrase change.
- **Revocation:** delete the token (immediate) and change the passphrase; deleting the repository is the nuclear option.
- **Operational experience for the owner:** a one-time setup (create the repository, two tokens, enter them where Ledger asks, enter a pairing code on the tablet); afterwards nothing, except a yearly token renewal.
- **Cost:** none. **Maintenance:** token renewals, an occasional history reset. **Availability:** GitHub's; a brief outage only delays updates (the tablet shows its last file). **Latency:** debounce (about 10 seconds) + the tablet's poll (every 3 minutes) = typically 1 to 4 minutes after a save.
- **Rate limits:** about 20 requests an hour per tablet, against an authenticated limit of 5,000 an hour (**UNVERIFIED** current figure); conditional requests (`If-None-Match`) answered "not modified" are expected not to count (**UNVERIFIED**).

### G.2 Option B: a small authenticated publishing service

- **What:** a hosted function plus a tiny store (for example a serverless function with a key-value or object store), with a write endpoint for Ledger and a read endpoint for the tablet; per-device tokens issued by the service.
- **Benefits:** per-device credentials that are trivial to revoke individually; near-instant updates (server-sent events or a short poll); a natural home for email sending and, later, RSVP inbound handling; HTTP caching and rate limiting under your control.
- **Costs:** a new vendor account (and likely a payment card on file), a deployment toolchain you do not currently have, secrets management, code to maintain and monitor, an extra place a data incident could occur. Free tiers at household volume are typical (**UNVERIFIED**; check the vendor's current terms).
- **Security:** can be strong, but the strength depends on code and configuration the project does not have today. Its encryption is the same as A unless the service is trusted with plaintext (it should not be).
- **Verdict:** a legitimate later choice **if** the household ever needs push-fast updates, per-device revocation, inbound email or RSVP. Not the smallest robust architecture for the stated need.

### G.3 Option C: anything materially better?

| Candidate | Why not |
|---|---|
| Public GitHub Pages file holding the same ciphertext | Needs no read key, but the ciphertext (and all its history) becomes public and permanently crawlable; the only protection left is the passphrase against offline guessing. Rejected as the default, and the brief rules out public feeds as the default model |
| A secret-URL `.ics` feed (Google/Apple "subscribe") | Public to anyone holding the link; plaintext of children's schedules; no per-device revocation; no Ledger-side eligibility control. Rejected (also in F0) |
| A shared Google Calendar the tablet reads | Makes Google a prerequisite and moves the source of truth out of Ledger |
| The sync repository with a second token | Tokens are per repository, so the tablet would be able to read the whole encrypted database. Rejected |
| Tablet joins Ledger sync | Gives the tablet everything. Rejected |
| Manual export and import | Safe but defeats the goal |

**No Option C offers a material improvement.**

### G.4 Recommendation

**Option A.** It is the smallest robust architecture for one household: no new vendor, no server, no recurring cost, the same credential practice you already follow for sync, two independent protections on the data, and clean revocation. Option B remains the escape hatch if the limits below prove unacceptable in daily use.

**Limits you are accepting:** minutes of delay; publishing only while Ledger is open on a device that has been set up to publish; a read key that expires and must be renewed; history growth needing an occasional reset; no push; no remote erase of an offline tablet.

---

## H. Recommended technical design

### H.1 Architecture

```
  YOUR DEVICES (Ledger, local-first)                      PRIVATE GITHUB REPO "display"            THE TABLET (separate app, separate origin)
 +---------------------------------------+               +------------------------------+          +-----------------------------------+
 | Ledger database (everything)          |               |  display.bin                 |          | Command Station app               |
 |   |                                   |               |  (one encrypted file,        |          |  - no Ledger code, no database    |
 |   v                                   |               |   nothing else in the repo)  |          |  - read key + display passphrase  |
 | Eligibility resolver (append-only     |               +--------------+---------------+          |  - fetch every 3 min (If-None-Match)|
 |   grants; heads; hide wins)           |  PUT, CAS by sha             ^   GET (read-only key)      |  - validate, then show; keep last  |
 |   |                                   |  (write key)                 |                           |    good file in its own storage    |
 |   v                                   +----------------------------> +<--------------------------+  - today/next/tomorrow computed    |
 | Display builder (allow-list, field by |                                                          |    locally from its own clock      |
 |   field; occurrencesOf; no notes,     |                                                          |  - two filters + 3 screens         |
 |   places, contacts, money)            |   Publish protocol (H.5a): sync round, causal check,       +-----------------------------------+
 |   |                                   |   not paused (restore/kill switch), under size caps
 |   v                                   |
 | Encode + encrypt (passphrase K)       |        Ledger never contains the tablet's read key;
 +---------------------------------------+        the tablet never contains Ledger's data, sync file, token or passphrase.
```

### H.2 Concrete decisions

| Topic | Decision |
|---|---|
| Eligibility store | `moduleRecords`, module `display`, kind `grant`, append-only; no new table, no migration; included in backup and sync automatically |
| Builder | New `src/display/` (Ledger side): `resolveEligibility()` → `DisplaySource[]` (already stripped) → `expand()` (uses `occurrencesOf`) → `buildProjection()`; exports no function that accepts a raw record |
| Contract | `display-contract/` (schema, validator, codec), imported by both sides; imports nothing |
| File | `display.bin` as in F.6; one file; no per-device files |
| Passphrase and key | A **display passphrase** different from the sync and backup passphrases; PBKDF2 310,000 → AES-GCM key; per-publish random IV; the tablet stores a **non-extractable** CryptoKey (derived once at pairing) so a *script* cannot copy the key's bytes. **This is not protection against someone holding the tablet:** the app, which that person can open, can still use the key to decrypt and show the schedule, and the key sits in the same browser storage as the ciphertext. Real protections for a lost device are the device passcode and operating-system encryption, the short offline expiry, key revocation and the small amount of data in the file |
| Pairing | Ledger shows a one-time **pairing code** (repository name, read key, passphrase, key salt) as text and a QR; the owner enters or scans it on the tablet. Never typed into chat; never sent through any service |
| Publisher credentials | Write key stored per device in device storage, like the sync token (not synced, not backed up); the display passphrase too |
| Tablet credentials | Read key in the tablet's own storage; passphrase-derived key non-extractable |
| Publication | See H.5 |
| Retrieval | `GET` the file's listing/`sha` with a conditional request; download the blob only when `sha` changed; validate; swap atomically; keep the previous good file |
| App updates | Per-build service worker (same pattern as Ledger, different cache prefix); the app checks for an update at night while idle |
| Status UI in Ledger | Settings → Family display: paired/not, last published, revision, "N changes waiting to publish", key expiry dates, publish log (times and outcomes only, never content), preview, kill switch |

### H.3 Passphrase and key handling

- Three distinct secrets, none shared: **sync passphrase** (unchanged), **backup passphrase** (unchanged), **display passphrase** (new). The read key and write key are separate GitHub tokens.
- Add all five to the password-manager checklist (acceptance step 16).
- A leaked display passphrase is contained by changing it: new salt, new file, re-pair the tablet; old ciphertext in repository history remains readable by whoever holds the **old** passphrase and old read key, which is why revocation does both.

### H.4 Builder pipeline (why a leak is structurally unlikely)

1. `resolveEligibility()` reads grant records and returns the *set of subjects currently shown* plus each subject's level and label. It reads no event, Task or Contact.
2. For each shown subject the pipeline reads the minimum from its owner: for an event `{ title, allDay, start/end, recurrence, skipped, overrides (title and time fields only), contactIds }`; for a Task `{ title, status, due, contactIds }`; for visits/reminders a schedule-only reader (F.5). Each reader returns **its own narrow type**, assembled field by field.
3. Event expansion calls the existing `occurrencesOf`, so repeats, skipped dates and one-date changes are the Calendar's, not a copy. Overrides are applied through the allow-list: an override's notes or location are never carried.
4. People ids come from the existing neutral reader `core/householdPeople.ts`, so a Contact who is not a household member never appears (R4.2's rule).
5. The projection builder accepts only those narrow types. There is no overload, no `any`, no spread of a record.

### H.5 Publish triggers and rules (section I explains the limits)

| Trigger | Rule |
|---|---|
| After a relevant change (an event, Task, grant, member, or relevant setting changed) | Debounce about 10 seconds, then build; **skip only if BOTH the display-content digest AND the `grantsSeen` set equal the last published**. A new, changed or revoked privacy decision always counts as a change, even when no visible entry differs (for example a revocation for an event outside the published window) |
| App opened, tab shown again, device came online | Build and compare **both** the content digest and `grantsSeen` with the published file; publish if either differs |
| Owner presses **Publish now** | Immediate |
| Periodic while open | Every 10 minutes: re-evaluate (so "today" rolls the window forward) |
| **Gate 1: authoritative-state check (replaces the CS-0 "synced within 10 minutes" rule, which was not sufficient).** Every publish runs the protocol in **H.5a** (a sync round *now*, a causal check against the display file, a re-check). Otherwise: "Can't confirm this device is up to date; nothing was published" | The real protection against a stale device republishing revoked items, within the limits H.5a states |
| **Gate 2: not paused.** Paused after a restore / replace / "use the synced copy" / kill switch until the owner reviews the preview | |
| **Gate 3: compare-and-swap.** `PUT` with the previous `sha`; on conflict (`409/422`), re-read, rebuild and retry up to three times, then show a plain error; never force | Two devices publishing at once cannot silently overwrite each other with different states |
| **Gate 4: first publish** requires the owner to review the full list and confirm | |
| **Gate 5: single publisher without sync.** If sync is not configured, only one device may be the publisher (it claims a `publisherId`; a second device is refused with a message) | Prevents two unsynchronized devices from diverging |
| Size or schema failure | Publish refused; the previous file stays; the owner is told |

### H.5a Publication and revocation protocol (CS-0.1)

**Why the ten-minute rule failed.** Device A revokes event E at 2:00 and syncs at 2:00:20. Device B last synced at 1:55 and its debounce fires at 2:03. B is "within ten minutes" but still holds E as `show`, builds from that, and publishes E: the revoked event returns to the tablet. The age of *B's own* last sync says nothing about what *other* devices have written since.

**Principle.** A device publishes only after establishing, at publish time, two facts, and otherwise publishes nothing:
- **(a) Fresh against the sync repository:** it has just completed a full sync round (using the existing `SyncEngine`: read the remote file, merge, write back), and the remote file is unchanged since.
- **(b) Not behind the display file:** the display file carries `grantsSeen`, the ids of every privacy decision its last publisher held. The new publisher's merged local decisions must include **all** of them. The display file is the rendezvous point every publisher must pass through, so this check works even when sync is slow, misconfigured or was never set up.

**Steps** (all must succeed, in order; any failure stops with a plain message and leaves the previous file in place):
1. If sync is configured on this device, run a **full sync round now** and note the remote file's `sha` (S). If sync cannot complete (offline, error, wrong passphrase, newer format, an unresolved conflict involving a privacy decision), **stop**. If sync is not configured, skip this step; the single-publisher rule below applies.
2. Read the grants and build the projection from one consistent local read; compute `grantsSeen` (the complete set of privacy-decision ids, independent of what is currently visible or inside the window) and the content digest. If both equal the published file's, nothing is written; if either differs, continue.
3. Read the current display file (note its `sha` H). If it exists but cannot be decrypted or validated, **stop**: never overwrite an unknown file; only the owner's explicit "start a new display file" proceeds.
4. **Causal check:** every id in H's `grantsSeen` must be in this device's `grantsSeen`. If not, run one more sync round and rebuild; if still not, **stop** with "Another device has newer privacy choices that this device has not received."
5. **Re-check:** ask the sync repository for its file `sha` again; if it is not S, or this device's grants changed since step 2, go back to step 1 (at most three times, then stop).
6. **Compare-and-swap:** `PUT` with H. On conflict (`409/422`) go back to step 3.
7. Record the outcome in the publish log (time and result only).

**Revocation from the revoking device.** Revoking (or the kill switch) tries immediately: the sync round and publish run at once, without the debounce. The status reads **"Removed from the tablet"** only after a publish succeeded; otherwise **"Hidden in Ledger; the tablet has not been updated yet"** with the reason, so a pending revocation is never mistaken for a completed one.

**Concurrent publishing.** Two devices publishing together are ordered by the compare-and-swap. The loser re-reads the file; if the winner knew decisions the loser lacks, step 4 makes the loser sync first. Neither silently overwrites the other.

**Offline changes.** A device that is offline cannot publish at all (publishing is a network write). If Device A revokes while offline, Device B (which lacks the revocation) can still publish E, and nothing can prevent that: B has no way to learn of a record that has not left A. The exposure ends when A next reaches GitHub: A's step 1 pulls whatever B added, A's publish passes the causal check, and the corrected file replaces B's. If A never reconnects the exposure does not end. Ledger on A shows the pending state (above). The owner can also revoke from any other device, which is subject to the same rules.

**Restore and replace.** Restoring an older backup, or a replace-from-sync, can **remove** later decision records (restore deletes records the backup lacks). The restored device then lacks ids the display file lists, so step 4 refuses to publish. The owner must review the list and choose "Accept this device's state and start fresh", which is logged. This enforces the "pause after restore" rule by a check instead of by remembering that a restore happened.

**Without sync.** With sync off there is no second device to disagree with; the one publisher's local state is authoritative. A second device is refused unless the owner transfers the publisher role (the file records a `publisherId`).

**What this guarantees, and what it does not.**

| Guaranteed (by design and tests) | Not guaranteed |
|---|---|
| A device does not publish unless, just before the write, it had completed a sync round and held every privacy decision the last publisher had seen | A decision that exists only on a device that has neither synced nor published, including an offline revoke |
| A device that lost decision records (restore, replace) cannot publish until the owner acknowledges | A race window of seconds between the step-5 re-check and the write |
| An undecryptable or unknown display file is never overwritten | Edits and deletions (a changed title, a deleted event) are covered by step 1 only: a stale device can briefly re-show an old title or deleted event; this self-corrects at the next up-to-date publish. These are freshness, not revocation guarantees |
| Two publishers cannot silently overwrite each other | A malicious or compromised device holding the write key |
| Failures stop publication and say why | Anything the tablet has already cached |

**Proportionality.** No server, locks or vector clocks: one extra sync round (a few API calls) only when the content digest or `grantsSeen` changed, one extra read of a small file, and a list of ids in the file. A household with a handful of grants carries a list of a few dozen ids; above 5,000 the publish fails with a message rather than truncate.

### H.6 What to test (this becomes CS-1/CS-2 acceptance)

**Required test, outside-the-window revocation.** Approve an event dated outside the published window (for example 200 days ahead) and publish. Revoke it. Assert: the visible entries and the content digest are unchanged, but `grantsSeen` gains the revocation, so a publish occurs and the file's causal history advances. Then simulate a stale Device B that lacks the revocation and holds the same unchanged visible schedule: assert its publish is refused by the causal check, and that it cannot skip or bypass the check by comparing only content digests. Also assert that an approval, a superseding approval and a revocation each advance `grantsSeen` with no visible change.

**Required test, Finance-type events.** Under a calendar-level grant, an event whose `type` marks it Finance-related, and a retired or handed-off event, are absent from the built projection and from the preview (F.4a).

Field allow-list (compile-time and runtime); sensitive-text tests for every excluded field; every excluded module's tables throw if read; a database spy proves nothing is read for an ineligible or hidden subject; grant resolution (heads, concurrent `hide`/`show`, unknown versions, clock skew with the real `SyncEngine` two-device simulation); revocation survives a stale device; restore pauses publishing; a "following" split and a Task successor carry or hide grants; the tablet rejects lower `revision`, bad `digest`, wrong key, unknown keys, higher `version`; the tablet import graph reaches nothing in Ledger; `buildFamilyView('display')` still throws; nothing is written by reading.

### H.7 Where the tablet app is hosted

Hosting the page from the same web address as Ledger (`https://marshmond.github.io`) would put two apps with different trust levels in one browser storage origin, and a second repository under the same account is the same origin too (this is the SE-01 situation already accepted for Ledger, FBB and Foodventory).

| Option | Origin | Cost | Comment |
|---|---|---|---|
| **T1 (recommended): a new free GitHub organization** holding a small public repository that builds only `display-app/` | its own `<org>.github.io` origin | none | Gives the tablet app its own origin; the code is public but contains no data; the data repository stays private and under your account |
| T2: another repository in the same account | the same origin as Ledger | none | Weakest: extends the accepted SE-01 exposure; acceptable only if the tablet's browser never visits another app on that origin and Ledger is never opened there |
| T3: a custom domain | its own origin | about a domain fee yearly (UNVERIFIED) | The hosting plan's option A; could also serve Ledger itself and the email sender domain (J.7), so the decision is shared |

Building in the organization's repository: a workflow checks out the public Ledger repository at a pinned tag and builds only the tablet app, so no cross-repository deploy key is needed. **UNVERIFIED:** I have not tested this arrangement; CS-3 includes a short feasibility check before relying on it.

---

## I. Updates and offline behavior

### I.1 What the owner experiences

You save an event in Ledger. Within about ten seconds Ledger builds and, if all gates pass, publishes. Within the next three minutes the tablet notices and refreshes, with no flicker. Typical: one to four minutes. The Ledger editor shows "Will appear on the tablet shortly" or "Not published yet: open Ledger on a synced device" so a change is never silently pending.

### I.2 Four different things, kept apart

| Mechanism | What it is | In this design |
|---|---|---|
| **Publishing while Ledger is open** | The running Ledger tab builds and uploads | **Yes.** The only path that creates new content |
| **Publishing when a device reconnects or reopens** | On launch, focus, or "online", Ledger notices unpublished changes and publishes | **Yes.** Covers a phone closed right after saving; but a phone that is never opened again publishes nothing |
| **Tablet polling** | The tablet asks "has the file changed?" every few minutes | **Yes.** Read-only; never creates content |
| **Genuinely always-on server-side processing** | A server reads Ledger's data and publishes while every device is closed | **No.** It would require Ledger's data on a server, which contradicts local-first and the privacy model. Nothing here pretends otherwise |

**Consequence you must accept:** if you save an event on your phone and close it instantly, or if a change is made on a device that is not set up to publish, **the tablet will not know until a publishing device is next opened.** Mitigations: a short debounce, a flush attempt when the page is hidden (**UNVERIFIED** on iOS: background time is not guaranteed), set-up of the publisher on every device you schedule from, and the visible "not yet published" status.

### I.3 Cadence, freshness and warnings (proposed defaults)

| Situation | Tablet shows |
|---|---|
| Checked within 15 minutes | "Updated 2:14 PM", green dot |
| Last good check 15 minutes to 2 hours ago | Amber dot, "Last checked 1:05 PM" |
| More than 2 hours without a successful check | A banner: "Not updated since 1:05 PM. Showing the saved schedule." |
| More than 24 hours | Stronger banner: "The schedule may be out of date." |
| Beyond the offline keep time (default **3 days** since the last successful refresh; choices 24 hours, 3 days, 7 days; "never" is not offered) | The saved file is **deleted** (checked at app start and every minute while running); "Reconnect this display" |

Why 3 days: long enough for a weekend away, a router fault or a power cut over a long weekend, short enough that a tablet lost or left behind holds at most a few days' schedule that you would not already have seen. A household that travels longer can choose 7 days; 24 hours suits a tablet in a shared or visited space.

The tablet can prove it is connected and holds the latest *published* file. It **cannot** know whether a change is waiting on a Ledger device that has not published yet; only Ledger shows that. "Last published" is shown for information and is not treated as a warning (a quiet household legitimately publishes rarely).

### I.4 Offline behavior and recovery

- **Offline:** the tablet keeps showing the last good file and recomputes today, now, next and tomorrow from its own clock, so it keeps working through midnight. The app itself is cached by its service worker. Entries beyond the window show "Schedule loaded through <date>".
- **Reconnect:** polls immediately on the "online" event, then back to the normal cadence; swaps in the new file without a visible reload.
- **Errors:** network, 5xx, rate limit and "unauthorized" are told apart. Network and 5xx: keep the cache, back off (3, 6, 12, 30 minutes). Rate limit: wait until the reset time. **Authorization failure (401/403/404) repeated over at least 10 minutes** is treated as revoked or expired: the saved file is deleted and the screen says "This display was disconnected. Reconnect it from Ledger." (**UNVERIFIED** exact GitHub responses; CS-2's own acceptance revokes a real key on a real tablet.)
- **Decryption failure** (passphrase changed): "The display code no longer matches. Re-pair it" (cache kept until the owner decides, then deleted on re-pair).
- **Rollback:** a file with a lower `revision` than already accepted is ignored.

### I.5 Cache and what cannot be undone

The tablet's cache contains only the approved projection (a few tens of kilobytes). Deleting the cache is possible when the tablet is online or by the owner at the device. **If the tablet is offline, nothing can erase it remotely**; the keep-time expiry is the mitigation, and it **only acts when the app starts or is running**. A stolen tablet that stays powered off or offline keeps its stored data until someone opens the app (which then deletes it first) or reads the browser storage some other way; the device's clock can also be set back. Browser encryption keys that cannot be exported do not change this (see H.2): they stop a script copying the key, not a person using the tablet. Set a device passcode. Keep-awake (the Screen Wake Lock feature) is best effort and **UNVERIFIED on iPad home-screen apps**; the recommended supporting settings are the operating system's (Auto-Lock off while charging on iPad; screen pinning or a kiosk app on Android). Long-term display (burn-in) is addressed by the night dimming schedule.

---

## J. Calendar communications

### J.1 Three different groups

| Concept | Meaning | Stored today? |
|---|---|---|
| **People involved** | Contacts the event is *about* (`contactIds`) | Yes |
| **Notification recipients** | People you choose to **email about** the event | No (chosen per notification) |
| **Calendar invitees** | People who would receive a standards-compatible invitation (`METHOD:REQUEST`, `ATTENDEE`, `RSVP`) and whose replies are tracked | No |

They overlap but are not the same: a child's event *involves* the child; the parents may be the **recipients**; an RSVP-tracked invitation to a coach is a *later* invitee case. Ledger must never infer one from another.

### J.2 What exists, and what does not [Fact]

Exists: `contactIds` on events; a People picker; Contacts with optional validated `email`; Family member identities; repeat rules with three edit scopes (**this one**, **this and following**, **all**: `Scope = 'one' | 'following' | 'all'`); soft delete with Undo; a single-event `.ics` builder. **Does not exist:** any email sending, invitation, RSVP, delivery record, send queue, or sender identity.

### J.3 The approved interaction (CAL-N1 target)

1. Create or edit an event; press Save.
2. **The event is saved first.** Saving never depends on anything in this flow.
3. If the change is **meaningful** (J.4) and at least one eligible recipient exists, a non-blocking panel appears: "Event saved. Email someone about it?" with **Not now** and **Choose people**. Declining records the decision and nothing else.
4. The owner **selects recipients** (no one is pre-ticked; a one-tap "All involved with an email" helps; additional Contacts can be added; a recipient with no valid email is listed as unavailable with the reason).
5. A **preview** shows exactly the message each recipient will get.
6. **Send** (the only action that sends). Closing the dialog sends nothing.
7. The panel then shows per-recipient status (J.8).

### J.4 What counts as a meaningful change

| Change | Prompt? |
|---|---|
| New event | Yes |
| Title, date, time, all-day, duration, place, the repeat rule, people involved added/removed | Yes ("Updated") |
| Cancel an occurrence, this-and-following, or the series | Yes ("Cancelled"), asked in the delete confirmation itself (J.6) |
| Notes, priority, reminders, tags, project, calendar layer, "keep until done" | No (not meaningful to others) |
| A change that only affects people who were never notified and have no email | No |

### J.5 Recurring events: the message must say which scope changed

| Action | Wording in the message (examples) |
|---|---|
| One occurrence changed | "Changed for **Wed Nov 18 only**: now 5:00 PM" |
| This and following | "Changed from **Nov 18 onward**: now 5:00 PM (earlier dates unchanged)" (Ledger creates a new event id for the later part; notices refer to the event the owner edited and name the date range) |
| Whole series | "Changed for **every Wednesday**: now 5:00 PM" |
| One occurrence cancelled | "**Cancelled: Wed Nov 18 only.** Other dates are unchanged." |
| This and following cancelled | "**Cancelled from Nov 18 onward.**" |
| Series cancelled | "**Cancelled: the whole series.**" |
| Created | "New: Soccer practice, Wed 4:30 – 5:30 PM, repeats weekly" |

### J.6 Message content and privacy

- **Included by default:** title, date and time with the zone, duration, whether it repeats and the scope sentence, the names of the people the event involves (editable), the owner's name as sender, an optional one-line personal message typed by the owner.
- **Place:** included only if the owner ticks it for this message (and a place exists).
- **Never automatically:** notes, reminders, priority, tags, projects, amounts, other events, other recipients' email addresses.
- **Other recipients' addresses:** each recipient gets **their own message** ("To: only them") by default. A single shared message is an explicit, labeled choice that warns "everyone will see everyone's address".
- **Owner approval:** the owner sees and approves the actual recipients and the actual text. No hidden template content.
- **Cancel via delete:** the delete confirmation offers "Also email people that it is cancelled". If the owner later presses Undo, Ledger proposes a correction ("It is back on") to anyone already told; it never sends it automatically.

### J.7 Delivery architecture: options

A browser cannot hold an email key, so any automatic delivery needs something server-side. Options:

| | Option | How | Pros | Cons |
|---|---|---|---|---|
| **E1** | **Assisted send** (`mailto:`) | Ledger composes subject and body and opens the owner's mail app; the owner presses Send there | **No server, no key, no cost, best privacy** (nothing leaves the device except what the owner sends); works on phone and computer; sender is the owner's real address | **Cannot know whether it was sent**; body length limit; no HTML or attachments; a shared message exposes addresses unless Bcc is used; one message at a time on some phones |
| **E2** | Gmail API from the browser (OAuth) | Ledger asks for Gmail send permission | Sends as the owner | An OAuth app and consent screen to maintain; an access token in the browser; permission scope that can send as the owner; refresh behavior for an unreviewed app **UNVERIFIED**; a heavy setup. Not recommended |
| **E3** | Relay function + email provider API | A hosted function holds the provider key; Ledger calls it with a revocable per-device token | Immediate success or failure; easy idempotency store; can also receive inbound mail for RSVP later | New vendor and server (Option B), a sender domain's DNS records (SPF/DKIM) for good deliverability; ongoing maintenance |
| **E4** | **GitHub "outbox" repository + a workflow that sends** | Ledger writes one small encrypted *request* file per notification to a **separate private repository**; a GitHub Actions workflow in that repository decrypts it, sends via a **send-only** email provider key stored as a repository **secret** (never in the browser), then writes a result file Ledger reads back | **No server to run; secrets stay in GitHub; reuses the CS-2 pattern and the owner's account; free at household volume (UNVERIFIED limits); no new CSP host** | Asynchronous (seconds to minutes; status arrives by polling); the email provider is still needed; the workflow definition is a trust point (a token that could edit workflow files could read the secret: the fine-grained permission for that is separate from Contents (**UNVERIFIED**); keep the outbox token Contents-only) |
| **E5** | A browser-embedded email service key | A public key in the page | Easy | Anyone with the page can send mail as the household. **Rejected** |

**Recommendation.** **CAL-N1: E4** for real, tracked, automatic sending, once CS-2 has proved the repository-and-token pattern on real devices (CAL-N0 confirms the transport). **E1** (assisted send) is only an **optional interim convenience (CAL-N1-lite)**: it meets "choose recipients, review, confirm, decline harmlessly" with no infrastructure, but it cannot know whether anything was sent, so it is not the completed notification experience and is built only if the owner asks. **E3** only if the household later needs immediate feedback or RSVP replies (CAL-N2), because inbound mail needs a stateful server. **The outbox must be its own repository**, never the display repository (the tablet's read key can read everything in the display repository, and an outbox holds recipients and message text) and not the sync repository.

**Sender identity (CAL-N0 decision).** "From" a dedicated send-only sender (for example a household notices address verified with the provider) with **Reply-To** the owner's real address and the owner's name in the display name; a one-line footer: who sent it and "reply to this message to reach <owner>". Using the owner's personal mailbox through an application password is **not** recommended (an application password can also read the mailbox). A custom domain improves deliverability and could be shared with the hosting decision (H.7, T3); not required for E1.

### J.8 Delivery correctness: intent, status, duplicates, retry

**Principle:** *the event is saved first; the message is a separate, explicit act.* An email problem can never fail, block or roll back a save.

**Records.** A new append-only record kind in the shared `moduleRecords` (module `calendar`, kind `notice`), like Bills' billing facts: one record per attempt; never edited, never deleted by normal use; unknown states read as "needs review", never as sent.

| Field | Meaning |
|---|---|
| `noticeId` | Deterministic id: SHA-256 of `eventKey | scope | occurrence/range | kind (created/updated/cancelled…) | digest of the meaningful fields | sorted recipient Contact ids` |
| `attempt` | 1, 2, … (manual retries only) |
| `state` | `declined` · `drafted` · `confirmed` · `queued` · `sent` · `failed` · `unconfirmed` · `needs-review` |
| `recipients[]` | `{ contactId, address used, status }` (the address actually used is kept so history stays accurate if the Contact changes) |
| `previewDigest` | digest of the exact text the owner approved |
| timestamps, `deviceId` | for display only |

**Rules.**

1. **Declining is recorded and final.** A `declined` record means *no email now*, and **nothing ever sends later from it**. There is no background sender in Ledger: sending happens only as the immediate result of the owner's Confirm.
2. **Confirm while offline** keeps the notice `queued`, visibly ("Waiting for a connection. Cancel?"). At send time Ledger recomputes the digest; if the event changed since the owner approved the text, the notice becomes `needs-review` and **sends nothing**.
3. **Duplicate suppression across devices.** The deterministic `noticeId` is also the file name in the outbox (E4) or the key for the "already sent" check (E1/E3): a second device that tries to send the same message for the same recipients finds it already exists: "Already sent from another device at 3:02 PM". Different recipients or changed content produce a different id on purpose.
4. **No indefinite retries.** A failure shows a plain reason class (address rejected, mail service refused, quota, unknown) and offers **Try again** (one manual action, a new `attempt`). There is no automatic retry loop.
5. **Unknown outcomes.** If Ledger cannot tell whether the first attempt reached the mail service (a lost response), the state is `unconfirmed` and the retry button warns "This may send a second copy". With E4 the result file normally resolves it, which is a reason E4 beats E3 for correctness.
6. **Honest vocabulary.** The strongest status is **"Accepted by the mail service"**. Ledger cannot know the message reached an inbox, was read, or later bounced (a bounce returns to the sender mailbox, not to Ledger).
7. **Rate limiting.** At most 10 recipients per notice and 30 messages a day, enforced where the sending happens (the workflow or relay), and by Ledger before it asks.
8. **Observability.** A "Messages" list on the event and in Settings: time, kind, recipients' names and status; message text is kept only as the digest and the preview the owner saw.

### J.9 Recipient consent and privacy

- Ledger emails only people the owner selects, one notification at a time; there are no recurring digests or automatic reminders in CAL-N1.
- A Contact with no email is never prompted. An email address is used only for this purpose and is not copied to the display repository, Search, or logs.
- **Contact-level consent flag** (e.g. "OK to email event notices") is **recommended for CAL-N0 to decide**, so the owner is not asked about the same person every time, while still approving each message's recipients.
- Whether any notice-related legal obligations apply is not something I can assess; these are personal household messages and the footer tells recipients how to ask to stop. **UNVERIFIED / not legal advice.**
- No credential for any email provider ever appears in the browser, the repository, a test, the docs or chat.

### J.10 CAL-N0, CAL-N1, CAL-N2

| Phase | Purpose | Kind |
|---|---|---|
| **CAL-N0** | Calendar Communications Design: pick sender identity and transport, confirm the notice record, message templates, recipient rules, consent flag, the first-send dry-run plan, error wording | Design only |
| **CAL-N1-lite** (optional interim, built only on request, separate review) | Opt-in notifications with **assisted send** (E1): prompt after save, recipient picker, preview, `mailto` hand-off, owner-attested "I sent it" status, `declined` record, duplicate guard, scope-accurate wording | Optional convenience; not on the Command Station path |
| **CAL-N1** | Automatic sending with tracked status (E4, or E3 if CAL-N0 chooses it): outbox repository, send-only email key as a repository secret, status read-back, rate limits | Build, first sender infrastructure |
| **CAL-N2** | Standards-compatible invitations: `METHOD:REQUEST`/`CANCEL`, stable `UID` and `SEQUENCE`, `ATTENDEE`, optional RSVP **with inbound reply handling** | Optional later; needs a stateful receive path, so likely Option B |

**A simple notification is not an invitation.** A notification is informational text (optionally with a plain `.ics` attachment later). An invitation carries `ATTENDEE`/`ORGANIZER`/`RSVP=TRUE` and expects replies; replies need an inbox Ledger can read. Calling the first "RSVP-ready" would mislead people. N1 will not claim to track responses.

### J.11 When CAL-N0 and CAL-N1 should happen relative to CS-1 to CS-3

**Recommendation (CS-0.1):** the primary path is **CS-1 → CS-2 → CS-3** and it is not interrupted by email work. **CAL-N0** is design only and can run alongside any of them. **CAL-N1** (real delivery) is a separate, independently reviewed phase that follows CAL-N0 and, if the repository-and-Actions transport is chosen, CS-2's proven credential practice (gate G3); it can be scheduled before or after CS-3 at the owner's choice. **CAL-N1-lite** (the mail-app hand-off) is optional, only on request, and if built should follow CS-1 because both change the event editor. The Command Station and email are independent products; they touch only through the event editor and CS-2's credential practice.

---

## K. Implementation roadmap

```
  CS-0 design (this document)  ->  owner + ChatGPT approval + decisions L-1..L-12
        |
        +-- CS-0.5 (optional) static mock-ups, owner approval       (parallel; before CS-3)
        +-- CAL-N0 email design (design only)                       (parallel with CS-1)
        |
  CS-1 Secure Display Projection (local only)  --gate G1-->
        |
  CS-2 Secure Publishing and Retrieval  --gate G2-->
        |
  CS-3 Family Command Station MVP
        |
  Separate, independently reviewed:  CAL-N1 real delivery + tracked status (after CAL-N0; gate G3)
  Optional, only on request:         CAL-N1-lite mail-app hand-off (after CS-1; not on the path)
  Later, separate decisions:         CS-4, CAL-N2, External calendars, R4.3
```

Phases are independently deliverable and reviewable. Effort is relative.

### CS-0.5: Static prototypes (optional, Small)
- **Objective:** the owner approves how it looks and reads from across a room.
- **Scope:** four static HTML mock-ups (landscape week, Today briefing, Tasks, portrait week) with invented data; sized to the real tablet; no scripts that fetch anything; kept out of the production source tree.
- **Dependencies:** the tablet model (L-12).
- **Owner decisions:** approve or revise the look; confirm text size and the color set at distance.
- **Security implications:** none (no data).
- **Acceptance:** owner sign-off on the four screens.
- **Verification:** viewed on the actual tablet or an equivalent viewport; contrast measured.
- **Out of scope:** any production component, build step or data.

### CS-1: Secure Display Projection (Medium to Large)
- **Objective:** the eligibility mechanism and the allow-listed display builder, with no publishing.
- **Scope:** `display/grant` record kind and resolver (F.3); editor controls ("On the family tablet") in the event and Task editors and calendar settings; the Settings → Family display page (list, preview, revoke, kill switch) with **no publishing**; lineage copying on series split and Task successor; schedule-only readers for Services visits and maintenance plans with the grant label (only if L-2 approved); `display-contract/` schema, validator and codec; the builder that produces the projection **in memory and for the preview only**; the `grantsSeen` list (H.5a) computed over ALL decisions (not only visible items) and unit-tested, with publication skipped only when both it and the content digest are unchanged; the Finance-type, retired and linked-record rejection in the display-source adapter (F.4a); including after a simulated restore that removes grant records; the calendar-level explanation dialog, mandatory preview, visible badges, "Keep this one private" and the recently-changed list (F.3b); the guard tests.
- **Dependencies:** this design approved; **gate G1** (section M); the check that unknown `moduleRecords` module names are harmless.
- **Owner decisions:** L-1 to L-4, L-6, L-11 (sources, granularity, place, group labels).
- **Security implications:** the central phase. New record kind rides sync and backup; the `display` audience in `familyView.ts` is **not** changed; excluded fields cannot be represented.
- **Acceptance:** the two required tests in H.6 (outside-the-window revocation advances `grantsSeen` and defeats a stale device; Finance-type, retired and linked events rejected under a calendar grant); every test in H.6 that does not need a network; a household with sensitive text in every excluded field produces a projection containing none of it; revocation survives a simulated stale device; preview equals what a later publish would contain.
- **Verification:** unit and integration tests, the existing two-device `SyncEngine` simulation, the full suite, `tsc`, build; browser check at 375 px and desktop; **not** real-device accepted.
- **Out of scope:** any repository, token, passphrase entry, network call, tablet app, email.

### CS-2: Secure Publishing and Retrieval (Medium)
- **Objective:** the approved destination, credentials, publishing and retrieval, with basic freshness behavior.
- **Scope:** Settings → Family display set-up (repository, write key, display passphrase, pairing code and QR); publisher with the H.5 gates (debounce, skip only when both the content digest and `grantsSeen` are unchanged, and the H.5a protocol: a full sync round, the causal check against the display file, a re-check and compare-and-swap, all failing closed; restore handling enforced by that check; first-publish review; single-publisher rule when sync is off); encrypted file writer; a **minimal retrieval client and a diagnostic page** in the tablet app skeleton (status only, no calendar UI) so freshness and revocation can be tried on the real tablet before the interface is built; key-expiry reminders; publish log.
- **Dependencies:** CS-1 released; **gate G2**; the L-5 decision (hosting origin); the owner creates the private repository and both tokens directly in GitHub (no token ever appears in chat).
- **Owner decisions:** L-5, L-7, L-8.
- **Security implications:** first hosted repository and new credentials; the CSP does not change for Ledger (`api.github.com` is already allowed); tablet CSP is new and tested.
- **Acceptance:** a publish from Ledger is fetched, decrypted and displayed by the diagnostic page on a real tablet; wrong key, rollback, bad digest and higher `version` are rejected; revoking the read key makes the tablet delete its file after the confirmation window; in the real two-device simulation, Device B (synced minutes earlier) cannot republish an item Device A revoked, and an offline revoke is shown as pending rather than done; a restore that removes grant records blocks publishing until acknowledged; two simultaneous publishers do not overwrite each other; a lost-tablet drill is completed by the owner.
- **Verification:** automated tests with a fake store for every rule above, plus the owner's **real-tablet checks** (24-hour connected run, airplane mode, revoke, wrong-clock notice) recorded as such.
- **Out of scope:** the calendar UI, saved views, email, any write from the tablet.

### CS-3: Family Command Station MVP (Large)
- **Objective:** the tablet application.
- **Scope:** Calendar (week, day, month, current-time line, shared-person stripes, event sheet); Today briefing; read-only Tasks; two filters and the four presets; settings (D.7); offline cache, staleness states; portrait layout; per-build service worker; the tablet CSP; import-graph guard; its deployment to the chosen origin.
- **Dependencies:** CS-2 released and accepted on a real tablet; CS-0.5 approved if done; **gate G2 satisfied**.
- **Owner decisions:** the look (via CS-0.5); the optional idle-return setting (off by default).
- **Security implications:** the app holds a read key and a non-extractable decryption key; no Ledger code; no write path.
- **Acceptance:** all MVP items in section C; keyboard and screen-reader pass for every control; contrast and 56 px targets measured; no Finance string or code reachable (tests); freshness states and revocation behave as in section I on the real tablet.
- **Verification:** component and logic tests; browser checks at 1280 x 800, 1180 x 820, 1366 x 1024 and portrait; real-tablet acceptance recorded separately; the full suite for Ledger is unchanged.
- **Out of scope:** Task completion, lists, voice, meal planning, weather, any external calendar.

### CS-4: Future interactions (optional)
- **Objective:** decide, after real use, whether a tightly scoped write-back is worth its risk.
- **Scope:** design first: a separate append-only "inbox" file the tablet may add to ("Task X done"), ingested by Ledger only when the owner opens it and approves; never a direct write to Ledger data.
- **Dependencies:** CS-3 lived with; its own design phase and owner approval.
- **Owner decisions:** whether it is wanted at all.
- **Security implications:** the first time the tablet writes anything; needs a write credential on the tablet and an ingestion review step.
- **Acceptance / verification:** defined in its own design phase.
- **Out of scope:** lists, voice, meal planning, anything that changes events.

### CAL-N0: Calendar Communications Design (Small, design only)
- **Objective:** settle the email decisions before code.
- **Scope:** sender identity and domain; transport (E1, E3, E4) and whether to ever build the optional CAL-N1-lite; the `notice` record and state machine; message templates for every scope; recipient picker rules and consent flag; first-send dry-run plan (to the owner's own addresses); error wording; what happens on Undo of a deletion.
- **Dependencies:** this design approved.
- **Owner decisions:** L-9, L-10 (and the deferred sender choice).
- **Security implications:** defines credential handling for the first sender.
- **Acceptance:** a written design the owner and ChatGPT approve.
- **Verification:** none (document).
- **Out of scope:** any code or account.

### CAL-N1: Event notifications, real delivery (Medium; independent of CS-1 to CS-3)
- **Objective:** opt-in emails after meaningful event changes, sent by the system with tracked status.
- **Scope:** the after-save and delete-confirmation prompts; recipient selection; preview; the `notice` records and state machine (J.8); declined, duplicate and scope handling; the Messages list; the outbox repository and sending workflow (or the transport CAL-N0 chose); a send-only email key stored as a repository secret by the owner in GitHub; status read-back; per-day limits; manual retry rules.
- **Dependencies:** CAL-N0 approved; if the repository-and-Actions transport is chosen, CS-2's credential practice proven on a real device; **gate G3**.
- **Owner decisions:** as settled in CAL-N0; the mail provider account (the owner creates it and the key, never in chat).
- **Security implications:** the first outbound-message surface: abuse limits and the two-repository separation matter; no secret in the browser.
- **Acceptance:** save never depends on email; a declined notice never sends later; no duplicate from two devices; scope wording correct for all seven cases; no private notes included; a failed send shows a reason and a manual retry; first sends only to the owner's own addresses.
- **Verification:** tests with a fake mail transport and fake store; browser checks; a dry run with real test addresses recorded as an owner check; **delivery to an inbox is not provable by tests**.
- **Out of scope:** invitations, RSVP, attachments, digests, automatic reminders, inbound mail.

### CAL-N1-lite: assisted send (optional interim convenience; only if the owner asks)
After CS-1, a smaller change: the same prompt, recipient choice and preview, then the owner's mail app opens with the message prepared and the owner presses Send there. Status can only read "I sent it" (owner-attested), never "delivered". Own review; **not** part of CAL-N1 and not a step on the Command Station path. A phone check that the mail app opens with the prepared message (iPhone and Android) is its own acceptance.

### CAL-N2: Invitations and RSVP (optional, Large)
Evaluate after N1 has been used: `METHOD:REQUEST/CANCEL`, `UID` and `SEQUENCE`, attendee state, inbound reply handling (a stateful receive path, likely Option B). Separate design, separate approval, separate security review.

### External calendar integration (future decision)
One-way Ledger to Google publishing with stable ids; read-only subscriptions as overlays. Separate design, OAuth and secret-storage review. Not a prerequisite for anything.

### R4.3 (deferred)
The richer manual calendar export stays deferred pending this design. If CAL-N2 or the external integration proceeds it will reuse `calendar/ics.ts` and `family/familyIcs.ts` rather than start over.

---

## L. Owner decisions (only those that need you)

Each has a recommended default. If you simply approve this document, the defaults apply and nothing is built until you also say go.

| # | Decision | Recommended default |
|---|---|---|
| **L-1** | Approve the architecture: a separate tablet app fed by an encrypted, display-safe file in a separate private GitHub repository (Option A), with Ledger staying owner-only | **Approve.** Keep Option B as a later escape hatch |
| **L-2** | Which non-Calendar items may appear: Household Services visits and Home & Assets maintenance reminders as **schedule-only entries with a label you type**; birthdays and important dates as names and dates only (no ages) | **Approve all three.** Bills, Projects, warranties, contract dates and Finance stay excluded |
| **L-3** | Show a coarse "adult / child / other" group (from the Family role) so a "Kids' schedules" preset can exist; role words are not published | **Approve** |
| **L-4** | Eligibility granularity: per event and per Task, **plus** a per-calendar switch for a dedicated Family calendar (default off), and a "Shown as Busy" level | **Approve both**; no per-person rules in the MVP |
| **L-5** | Where the tablet app is hosted: T1 a new free GitHub organization (own address), T2 same account (shares Ledger's address), T3 a custom domain | **T1** (T2 only if you accept extending the SE-01 risk) |
| **L-6** | Event place on the tablet | **Not shown** (revisit as a per-event option after real use) |
| **L-7** | Freshness defaults: tablet checks every 3 minutes; amber after 15 minutes, a banner after 2 hours; the saved file deletes itself after **3 days** without a successful refresh (choices 24 hours, 3 days, 7 days); Who and Show choices **persist** until changed or Reset; idle return to a screen is **off** by default; optional settings lock | **Approve** (all adjustable) |
| **L-8** | Publishing rules: a device publishes only after a full sync round and a check that it holds every privacy decision the last publisher saw (H.5a), and stops with a message if it cannot confirm that; a device that lost records in a restore cannot publish until you review the list; set up publishing on each device you schedule from | **Approve** |
| **L-9** | Email sequencing: CAL-N0 is a design phase that runs alongside the tablet work; real delivery (CAL-N1) is separate. The mail-app **assisted send** (status "I sent it", never "delivered") is an optional interim you may request; it is not on the tablet path | **Approve**; do not build the assisted send unless you ask |
| **L-10** | Email defaults: nobody pre-ticked; one message per person (addresses not exposed); place only if ticked; notes never; sender is a dedicated send-only address with Reply-To you | **Approve** (sender and domain finalized in CAL-N0) |
| **L-11** | Approval follows an item as it is edited (with a preview and a "title changed" marker), rather than being pinned to the exact text | **Approve** |
| **L-12** | Static mock-ups before CS-3, and which tablet (brand, size) you will use | **Yes**, and tell me the model |

**Things that are NOT decisions but need your hands later (never in chat):** creating the repository and the two read/write keys; the email provider account and its send-only key; choosing and saving the display passphrase in your password manager.

---

## M. Acceptance gates

The R0 roadmap and the handoff keep one gate: **no new hosted surface, credential, repository or backend before the owner's real-use pass.** Automated tests, simulations and the in-app browser are **not** real-device acceptance, and nothing here counts them as such.

Mapping to `LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md` (step numbers are that document's):

| Gate | Needed before | Minimum checks (that document's steps) | Why |
|---|---|---|---|
| **G1** | CS-1 (local code, a new record kind in an existing table, no credentials) | **12** plain and encrypted backup; **13** encrypted restore into a test window; **16** secrets in a password manager; **confirm every device runs a build at or after ST-S5.1 (`ba4da59`)** (the older-build compatibility point; step 18 shows how each device updates) | Grant records must survive backup/restore; an out-of-date build must not erase newer rows; no hosted surface yet, so the phone and sync checks are not required for CS-1 |
| **G2** | CS-2 (first hosted repository, tokens, publishing) and therefore CS-3 | The "full GO" set: **1** phone opens every part; **2** Search and Quick Add; **3–6** budget, scheduled, Calendar, confirmations; **7** home-screen install; **8** airplane mode and offline entry; **12**, **13**, **16**; and, if you use sync, **9** two-device sync, **10** conflict handling, **11** numbers agree, **18** first update. Hosting decision for the tablet app (L-5) | CS-2 depends on sync being trustworthy (the stale-device gate), on phones behaving, on backup/restore, and on credential handling; this is the first time a real credential and a hosted store are involved |
| **G3** | CAL-N1 (outbound email infrastructure) | **16** (now including the display and email secrets); **G2** met; **CS-2's credential drill passed on a real tablet** (create, rotate, revoke a key); a sender identity and a provider account the owner created; a dry run **only to the owner's own addresses** before any other recipient | An automatic sender can reach other people; abuse and mistakes are harder to undo than a schedule on a wall |
| *(none beyond CS-1's)* | CAL-N1-lite (optional assisted send) | A phone check that the mail app opens with the prepared message on **iPhone and Android** (a phase-own check) | No server, no key, nothing leaves the device except what the owner sends |

**Phase-own real-device checks** (these are the deliverable's acceptance, not an expansion of the stabilization checklist): CS-2: 24 hours connected, airplane mode then reconnect, revoke a read key and watch the tablet disconnect, re-pair, wrong-clock notice. CS-3: read from across the room, touch targets with a real hand, portrait, night dimming, a power cycle. CAL-N1: an actual send and receive on a phone.

**Not provable by automation, and never claimed:** a real phone or tablet, a screen reader, a printer, Safari and Firefox behavior, iPad home-screen storage and wake-lock behavior, real GitHub revocation responses, an email reaching an inbox.

---

## N. Deferred initiatives (status preserved)

| Initiative | Status |
|---|---|
| **R4.3 richer manual Calendar export** | **Deferred** pending this design. `.ics` infrastructure retained for fallback and future invitations |
| **Google Calendar integration** (one-way publish, read-only overlays) | **Future, separate decision**; not a prerequisite for anything here |
| **Google Drive document integration** | **Future, separate phase**; unchanged |
| **Year-end tax-document organization** | **Future, separate phase**; unchanged |
| **AI-D0 "Ask Ledger" assessment** | **Future, design-only, not approved**; unchanged; this design adds no model or outside call |
| **Optional R3.3 budget-target suggestions** | **Optional**, needs a separate owner decision and approval to touch the Budget page; unchanged |

---

## O. Uncertainties and meaningful risks

**O.1 Real-device evidence is zero for every phase since stabilization** (no filled-in owner results table found). Several choices (iPad home-screen storage, wake lock, mail-app hand-off, GitHub revocation behavior) rest on documentation I have not confirmed. Gate G2 exists for this reason.

**O.2 Approvals follow edited content.** An approved item whose title is later changed to something sensitive stays on the tablet. The preview, the "title changed" marker and revocation are the controls; pinning approval to text was rejected as impractical (L-11).

**O.3 Publishing is not always-on.** A closed Ledger publishes nothing. The status text in Ledger and the multi-device set-up reduce surprise; they do not remove it.

**O.4 UNVERIFIED outside facts** (check before relying on them): fine-grained token maximum expiry and whether repository-wide scoping cannot be narrowed to a file; current API rate limits; whether "not modified" responses count against limits; the separate "workflows" permission that keeps a Contents-only token from editing workflow files; GitHub Actions minutes at the free tier; repository size guidance; email provider free tiers and sender verification rules; iPad home-screen storage retention and wake-lock support; Android install and kiosk behavior; whether the HTTP `Date` header is readable for the clock check; background time to flush a publish on iOS; the exact responses for a revoked or expired token.

**O.5 Code facts to confirm at the start of CS-1** (I did not test them): that unknown `moduleRecords` module names do not trip any enumerating feature; that the Task `recurFrom` chain stays intact enough to find a root after deletions; that copying a grant on series split is atomic with the split.

**O.6 Clock and zone.** Decisions here avoid clock ordering for eligibility, but the tablet's own clock drives "now" and "today"; a wrong tablet clock or a different zone than the publisher shows wrong times. The notices in F.6 and I.4 are detection, not prevention.

**O.7 Owner workload.** Keys expire, the repository needs an occasional reset, two passphrases exist beyond the existing ones, and a lost tablet needs the owner to act promptly. The design keeps these to a short list; they are real recurring tasks.

**O.8 Origin choice.** T1 and T3 add an account or a domain. T2 is easiest and weakest. No option removes SE-01 for Ledger itself, which stays an owner-accepted risk.

**O.9 Visual readability at distance** can only be judged on the actual tablet (hence CS-0.5).

**O.10 Email correctness** can be made safe (no duplicates, no surprise sends) but not complete: "accepted by the mail service" is the honest ceiling.

---

## P. Documentation changes made in this batch

- Created: this document.
- Updated: `docs/CHATGPT-HANDOFF.md` (top notice, snapshot, roadmap, risks, change log; R4.2 status corrected to committed and deployed), `docs/BACKLOG.md` (a new top status; R4.2 and R4.3 statuses corrected), and the one-line status of `docs/LEDGER-R4.2-REPORT.md`.
- Not touched: production code, tests, schemas, dependencies, workflows, the three protected untracked files, any prior phase history beyond the status corrections above.
- Nothing committed, staged, pushed or deployed.

---

## Appendix A: Example display file contents (invented, decrypted form)

```json
{
  "format": "ledger-display", "version": 1, "minReader": 1, "revision": 128,
  "publishedAt": "2026-11-16T19:03:12Z",
  "generatedFor": { "tz": "America/New_York", "today": "2026-11-16" },
  "window": { "from": "2026-11-02", "to": "2027-03-16" },
  "household": { "label": "Family" },
  "prefs": { "weekStart": 1 },
  "people": [
    { "id": "p_a1", "name": "Sam",   "color": "blue",  "group": "child" },
    { "id": "p_b2", "name": "Robin", "color": "green", "group": "adult" }
  ],
  "sources": [ { "id": "events", "label": "Events" }, { "id": "visits", "label": "Household visits" } ],
  "entries": [
    { "id": "e_9f3c1a07b2d4", "source": "events", "title": "Soccer practice", "allDay": false,
      "start": { "date": "2026-11-18", "time": "16:30" }, "end": { "date": "2026-11-18", "time": "17:30" },
      "people": ["p_a1"], "repeat": true, "status": "scheduled" },
    { "id": "e_41c07dd2aa19", "source": "visits", "title": "Cleaner", "allDay": false,
      "start": { "date": "2026-11-19", "time": "13:00" }, "end": { "date": "2026-11-19", "time": "15:00" },
      "people": [], "repeat": true, "status": "scheduled" }
  ],
  "tasks": [
    { "id": "t_77aa0b19c3e2", "title": "Return library books", "due": { "date": "2026-11-13", "time": null },
      "status": "todo", "people": ["p_b2"], "repeat": false }
  ],
  "counts": { "entries": 2, "tasks": 1 },
  "digest": "sha256-…"
}
```

## Appendix B: Example grant records (invented)

```
{ subject: "calendar:9000000000000101", decision: "hide" }                      (default state: no record = hidden)
{ subject: "event:421", decision: "show", level: "details", supersedes: [] }
{ subject: "event:421", decision: "hide", supersedes: ["grant-17"] }             (revocation: a new record, the old one stays)
{ subject: "visit:88", decision: "show", label: "Cleaner", supersedes: [] }      (label is what the tablet sees)
{ subject: "all", decision: "hide" }                                             (kill switch: next publish is an empty file)
```
Effective state of `event:421` after the second record: one head, `hide`: hidden. If an out-of-date device later adds `{ show, supersedes: ["grant-17"] }`, there are two heads and one is `hide`: **hidden**, flagged "choose again".

## Appendix C: The R4.2 guard that stays

`readFamilyView('display', …)` and `buildFamilyView('display', …)` continue to throw `UnsupportedAudienceError` before any record is read. The display builder is a different function in a different folder with a different input type; it is not an extension of that audience parameter, so the existing tests (`family-r42-view.test.ts`) remain valid and unchanged.
