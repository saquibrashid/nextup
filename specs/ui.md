---
createdAt: 2026-08-10T20:12:02-04:00
createdBy: spec-writer
phase: 8
status: complete
sourceOfTruth: docs/PRD.md §9, docs/architecture.md
---

# specs/ui.md — nextup screens

## Modal context contract (owner correction, 2026-09-21)

Remove from list, Not interested, Add title, Fix match, Stop ignoring, restore
duplicate/suppression conflicts, and extraction discard/replace confirmations
use the shared `Dialog` viewport overlay, never an inline page-bottom form.
Every variant portals outside page layout, locks page scroll, makes the
background inert, traps focus and has an accessible heading. Long content
scrolls inside a viewport-bounded surface. Cancel is the initial focus for
destructive confirmations; Escape/backdrop mean cancel, never confirm.
Pending writes/undo cannot be dismissed. Failures remain visible.

Opening and cancelling preserve list scroll; closing returns focus without
scrolling to the invoking control. A menu-to-dialog handoff returns through
the stable row action trigger. If the action removed that row, focus moves to
a surviving neighbour or the page heading instead of the document body.
Portals must not accidentally remove inherited offline/pending restrictions.

Filters/Sort stay in their existing responsive sheet/panel. Watch preferences,
final Apply, unfinished-capture discard, draft discard, leave-capture and
read-again confirmations retain their overlays and existing consent rules.
Upload, extraction status, review, capture history, and undo-refusal repair
remain full pages. Review candidate choices/search, manual candidate entry,
progress, errors and result/Undo notices remain inline: they need surrounding
evidence or describe an outcome, not a second interruption.

**Expanded service contract (US-061 / REQ-127, 2026-09-17).** Upload, manual add,
filtering, badges, review, batch/removal history, waiting availability and factual
service-update labels derive from the same eight-service `SERVICES` /
`SERVICE_LABELS` registry. Upload and manual add require one explicit service.
Opening `/upload?service=<supported-token>` preselects that service only, never
the capture mode; selecting choices alone never creates a batch. Unsupported
query values leave the service unselected. Both upload modes and all three
ingest affordances remain complete paths. Service-update links cover all eight
services with factual dates, not nags. At 320px, eight badges wrap within the
existing Grid/Compact layouts, and the searchable service picker stays bounded
and scrollable rather than expanding into an eight-button toolbar.

> ⚠ **REVISION 7 — 2026-08-11 (`A44`) — THE COMBINED LIST WAS MISSING A SORT
> CONTROL; US-020 AC-6 HAD NO UI AFFORDANCE.**
> Owner answer, verbatim: *"Newest-first — conventional, recent saves on
> top."* This **confirms** `ASM-035` (the default was already descending —
> unchanged) but exposed a real defect: §2.1 enumerated the combined-list
> screen's components and never included a sort control, so an implementer
> building strictly from this file would never build the one required by
> `US-020 AC-6` / `T-LIST-026` / `api.md` §6.2's `dir` parameter. **Fixed in
> place in §2.1 item 2**: `components/SortControl.tsx`, co-located in the
> filter bar row, with its 320 px consequence made explicit. New copy
> constants `SORT_NEWEST_LABEL` / `SORT_OLDEST_LABEL` in §9; new
> accessibility row and `T-UI-024` in §10.2. The owner's choice is accepted
> **knowing** it works against SUC-003 (old, forgotten saves resurfacing) —
> the "Oldest first" toggle is the accepted mitigation, so its absence from
> the UI spec was not cosmetic.

> ⚠ **REVISION 6 — 2026-08-11 (`A45`) — PASTE IS THE PRIMARY WAY SCREENSHOTS
> GET IN; FILE UPLOAD IS UNCHANGED AND STILL FULLY SUPPORTED.**
> Owner correction, verbatim: *"for screenshots, I'm generally expecting that
> I will take a screen grab and paste it into the app directly rather than
> saving it to my device first and then uploading it to the app."*
> **§3.2 said ingestion was drag-drop + file input + camera roll. That was
> upload-only and is now WRONG; it is corrected IN PLACE** (the `F-001`
> lesson), with the superseded sentence struck through beneath.
>
> **⚠ ADD, NOT SWAP.** The file input keeps every capability, including
> HEIC (A42). It is the only path that delivers raw HEIC from iOS Photos and
> the only path once the screenshot preview's *"Copy"* has gone.
> `T-PASTE-010` exists specifically to fail if paste quietly displaces it.
>
> New: **§3.2b Paste** (a `document` `paste` listener **and** a visible
> "Paste screenshot" button calling `navigator.clipboard.read()` — both, per
> `Context/evidence/clipboard-paste-support.md`), **§3.2c Drag and drop**,
> and **nine copy constants** in §9. New tests `T-PASTE-001`…`T-PASTE-010`,
> `T-UI-014`.
>
> ⚠ **HTTPS is mandatory for the button.** `navigator.clipboard` is absent on
> `http://`, so the button must be **feature-detected and not rendered** when
> unavailable. This bites when testing from the phone against a LAN-IP dev
> server (`api.md` §5.3.3).

> ⚠ **REVISION 5 — 2026-08-11 (`A43`).** Compute stays 0.25 vCPU / 0.5 GiB
> and the 1.0 GiB up-size is a pre-authorised **reactive** remedy, so the
> memory/decode failure is now a **user-visible, self-explaining** surface,
> not an internal error. **New §3.2a** specifies how a rejected image whose
> cause is memory is displayed — server `message` **verbatim**, the remedy
> path, and the "nothing else was affected" reassurance — and **§9** gains
> three copy constants plus the standing rule that the message text itself
> is **server-built**, never duplicated client-side, because it interpolates
> the live container size and guard value. `T-UI-013`.

**Serves:** US-001, US-002, US-003, US-004, US-011, US-012…US-024, US-027…US-036.
**Requirements:** REQ-024, REQ-026, REQ-031…REQ-034, REQ-036, REQ-038, REQ-039,
REQ-061…REQ-064, REQ-070, REQ-072, NFR-006, NFR-007, NFR-013.

Stack: React 18 + Vite + Tailwind + TanStack Query + Zod (ADR-0004). Files
under `apps/web/src/`. Routing: `react-router-dom`, `createBrowserRouter`
with `RouterProvider` (TASK-227), retaining real paths and the existing
container-owned data calls. The data-router host supplies supported navigation
blocking; it introduces no loaders, actions or automatic mutation replay.

---

## 1. Screen index

| Route | Component file | Purpose | Optimises for |
|---|---|---|---|
| `/` | `pages/ListPage.tsx` | The combined list — **the value loop** | Seeing everything you can watch, fast |
| `/titles/:titleId` | `pages/TitleDetailsPage.tsx` | Synopsis, cast and directors/creators, saved services and existing actions | Recognising a work without losing library browsing choices; `title-details.md` |
| `/upload` | `pages/UploadPage.tsx` | Create a batch and attach screenshots | Getting the mode choice right before any work is done |
| `/batches/:batchId` | `pages/BatchStatusPage.tsx` | Extraction progress and failure | Knowing whether it worked, and what to do if not |
| `/batches/:batchId/review` | `pages/ReviewPage.tsx` | The review pass — **the safety gate** | Not losing anything you didn't mean to lose |
| `/removed` | `pages/RemovedPage.tsx` | The removal history log | Finding and rescuing one specific thing |
| `/not-interested` | `pages/SuppressedPage.tsx` | Works you dismissed | Undoing a mistaken dismiss |
| `/batches` | `pages/BatchHistoryPage.tsx` | Batch history, provenance, undo | Understanding and reversing one import |
| `/about` | `pages/AboutPage.tsx` | Attribution and retention statements | Compliance and honesty |
| `/rating` | `pages/RatingLookupPage.tsx` | Look up any title's IMDb rating (REQ-092, US-045) | Answering "is it any good?" **without adding anything** |
| `*` | `pages/NotFoundPage.tsx` | Unknown route | Getting back to `/` |

⚠ **THERE ARE TEN SCREENS, NOT NINE.** `/rating` was added by Epic M
(ADR-0011). Four suites — `T-ATTR-002`, `T-ATTR-003`, `T-A11Y-001`,
`T-A11Y-012` — assert something across *the whole route set*, and every one of
them enumerates `ROUTES` rather than a literal list precisely so that adding a
screen extends their coverage instead of silently leaving it uncovered. Those
passages now read "every route" rather than a number, so they cannot go stale
again.
~~Superseded: the table above listed nine screens and omitted `/rating`; the
phrase "all nine routes" survived at §8 and §10 until it was retyped.~~

Every screen sits inside `components/AppShell.tsx`, which renders the header,
the nav, and the **global footer carrying TMDB attribution** (§8).

**Capture continuity (TASK-231).** Outside capture screens, `CaptureResume`
shows owner-scoped unfinished work beside the navigation, with service, stage
and a state-specific resume link. It reads on navigation, never by a new poll;
failed/offline checks remain visibly unknown. It does not add a phone nav
destination or a second navigation landmark. Checkpoint, strip and history
share resume vocabulary; all resume links reread batch status before review.
Capture navigation focuses the main landmark. Missing/foreign detail or review
IDs focus **Capture unavailable**, with history and upload entry links.

---

## 2. `/` — Combined list (US-018, US-019, US-020, US-022)

**Purpose.** One list of everything the owner has saved across the eight supported streaming services (US-061).
**Entry points.** Sign-in landing; the logo; after closing a batch; after any
restore, suppress, un-suppress or fix-match.
**Primary action.** Read. Secondary: filter, sort, open a row's menu.
**Navigation out.** `/upload`, `/removed`, `/not-interested`, `/batches`.

### 2.1 Information hierarchy (top → bottom)

1. **Service updates disclosure** — one factual link per service from `GET /api/service-state`
   (`components/FreshnessStrip.tsx`): *"Netflix updated today"*,
   *"Max updated 47 days ago"*, *"Max has never been
   updated"*. Opening **Service updates** reveals all links; activating one navigates to `/upload`
   pre-selecting that service (REQ-039, US-022) — this is unconditional
   navigation, not a nudge. The strip is
   informational; it never blocks the list. If the dates are unavailable,
   the degradation notice remains visible **outside the closed disclosure**,
   and each service's labelled upload link remains available inside.
   This is a nonmodal `FilterDisclosure`: Escape/Done/outside dismissal,
   focus restoration and normal untrapped Tab behavior (`T-UX-143`).
   *(A46: the staleness marker, the
   stale chip and its conditional "Update now" link are dropped entirely — no
   staleness threshold, no nag, no derived "stale" state. REQ-040 and ASM-038
   are retired.)*
2. **List controls** — a compact browse-first toolbar (`.list-controls`).
   #326 (owner-approved 2026-09-21) puts filters/count/sort/reverse first,
   followed by Compact/Grid and a labelled on-demand **Search** disclosure.
   The default unsearched view has no full-width search input.
   Filter fields and sort orders remain behind their existing buttons.

   The **Filters button, the live result count, the Sort button and the reverse
   button share ONE line from 360 px upward** (owner refinement 2026-09-17,
   `T-UX-147b`); view and Search controls share a wrapping secondary row below,
   and the search form occupies a full line only when opened.
   ⚠ **Below 360 px the sort control takes its own line** — four
   controls plus a 44 px reverse target do not fit, and forcing them pushed the
   reverse button off the 280 px reflow floor (`T-UX-147d`, `T-A11Y-015a`). To
   make the single line possible the toolbar is a **grid** and `FilterBar`
   renders the trigger, the chips and the count as **three siblings** — a
   wrapping flex row breaks between whole boxes, so while the count lived
   inside the filter bar no layout could put it beside the sort control. The
   count is sized to its content and the order label takes the slack:
   *"Showing 20 of 20"* is the answer to *"why is my list short"* and is never
   the thing that gets truncated.

   ⚠ **The reverse button is NOT a convenience and must not be folded into the
   sort chooser.** REQ-038's oldest-first escape hatch is `must` (`A47`), and
   the §10.1 floor rule forbids an additional step to reverse the current
   order. The reverse button is what keeps reversal at **one tap with nothing
   open** now that the six order buttons no longer sit on the page. Deleting it
   re-breaks the requirement that the chooser was allowed to move.

   **Filters** (`components/FilterBar.tsx`) opens a labelled dialog — a
   right-side panel from 640 px, a bottom sheet below it — presenting the
   **Filter by** group with labelled dropdown fields for **Services, Type,
   Genre, Runtime, Watching, Priority** (REQ-035/126). Each field has an
   external category label, a current-value trigger and a decorative down/up
   chevron, opening a labelled checkbox disclosure; active removable chips;
   **Clear filters**; and a live result count *"Showing 42 of 187"*, or
   *"Showing 50 of at least 50"* when only a lower bound is known. The button
   carries the **number of active filters** so the count is legible with the
   dialog shut, and the live result count **also** renders beside the toolbar,
   outside the dialog — a count only visible inside the thing that changes it
   is not a count.

   **Sort** (`components/SortControl.tsx`, US-020 AC-6, REQ-038, REQ-037,
   `api.md` §6.2) opens a chooser of **six single-row order toggles** — one per
   key, each showing a category icon, the key's name, a direction arrow and the
   **direction in words**. Choosing an unselected row sorts by it in that key's
   default direction; choosing the selected row reverses it. Direction is never
   conveyed by arrow shape alone. The toolbar button shows the current order
   and its direction arrow.

   ~~*Superseded 2026-09-17, retained for rationale only:* "a submitted
   title-search form, the filter bar and six visible complete-order buttons in
   one visually unified group", with the filter fields and all six order
   buttons rendered inline and always expanded. At 320 px this consumed
   roughly half the viewport before a single title was visible, which is the
   defect this revision fixes. Nothing about state changed: filters remain
   URL-only and sort remains URL → session → default.~~

   Services is searchable over `SERVICES` / `SERVICE_LABELS`, currently
   **Netflix, Max, Prime Video, Disney+, Apple TV+, Paramount+, Starz and Peacock**, with no "All" checkbox or invented providers.
   Type labels are Movies / TV series; genre options come from real facets.
   Selections are **URL-only**, OR within each dimension, AND across them.
   Every selected filter has a visible native 44 px removal button, even
   when results are nonzero. Each chip removes only its dimension/value.
   **Clear filters removes service/type/genre/runtime/watching/priority and `q`**, preserving
   sort, local view and unrelated query parameters. Picker option search
   never searches title rows. `T-UI-016`, `T-UX-139`.

   Defaults read **All services / All types / All genres / Any runtime / All titles / All priorities**;
   one selected value shows its name and multiple distinct values show
   **N selected**, with individual selections still enumerated by the chips.
   The accessible trigger name includes category and value. Fields use two
   equal columns on phones, three from 640 px and six from 1024 px; panels stay within the
   viewport. Existing 44 px targets, nonmodal keyboard behavior and dismissal
   remain unchanged (`T-UX-144`). This owner-approved 2026-09-16 refinement
   replaces the action-button appearance, not multi-selection semantics.

   The labelled title-search form submits explicitly by Enter or its Search
   button to **URL `q`**; typing alone does not fetch. A search chip removes
   only `q`. The server performs owner-scoped title matching before filters,
   ordering, paging and runtime-hidden counts (`api.md` §6.2c), never just
   against titles already loaded in the browser. Query changes reset paging
   while preserving sort, filters and view. `T-UX-140`, `T-API-030`.

   Opening Search focuses its input. Escape, Close search and the disclosure
   return focus without clearing the submitted query. A collapsed active
   search shows **Search active** and the removable query chip; it never
   silently hides a constraint. URL/history searches reveal the form without
   stealing focus. Clear search keeps the form open and focuses the cleared
   input. Unsubmitted drafts are discarded on close (`T-LIB-002`).

   **The runtime filter is BUCKETED, not a slider.** Buckets are *Under 30m*,
   *30m–1h*, *1h–1h 30m*, *1h 30m–2h*, *Over 2h*, and they map to `runtime=` in the query
   string. A range slider is rejected outright: it is the control this
   repository's accessibility floor (§9) is worst at — two draggable thumbs,
   no 44×44 px target at either end, and a value only reachable by pointer
   precision — and it also invites a meaningless *exact* range over data whose
   TV values are per-episode.
   ⚠ **Bucket boundaries are inclusive of the lower bound and exclusive of the
   upper** (`[30, 60)`), so a 60-minute film appears in exactly one bucket. An
   overlapping definition makes the result count disagree with the list.
   The two middle ranges are `[60, 90)` and `[90, 120)`; exactly 120 minutes
   remains in the existing 2h+ bucket. The old *1h–2h* option is removed.
   Saved `runtime=60-120` links select both replacements; removing either
   derived chip rewrites runtime parameters canonically, retaining only the
   other half and preserving unrelated query parameters.

   ⚠ **`runtimeMinutes: null` is the load-bearing case.** While a runtime
   filter is active, a title with no runtime **cannot** satisfy any bucket, so
   it disappears — and product invariant 2's rule applies here too: nothing
   vanishes silently. The bar therefore renders a disclosure beside the result
   count, *"3 titles have no runtime and are hidden"*, **only while a runtime
   filter is active**, and the count is a live value, never a fixed string.
   Without it the owner reads a shortened list as their library, which is the
   same class of defect as a failed extraction reading as a removal.

   **Six native buttons each select a complete KEY/DIRECTION order.**
   Inactive chooses its field's default; active reverses in one action.
   Name and Watch priority default to `asc`; dateAdded, releaseYear, runtime and rating default
   to `desc`. Exactly one is `aria-pressed`; its accessible name states the
   current order and next reverse action. **No separate direction segment or
   collapsed selector.** `T-UX-138` plus existing `T-UX-128`–`131`.

   | Key | `desc` label | `asc` label |
   |---|---|---|
   | `dateAdded` (default) | Recently added | Oldest additions |
   | `name` | Name Z-A | Name A-Z |
   | `releaseYear` | Newest releases | Oldest releases |
   | `runtime` | Longest runtime | Shortest runtime |
   | `rating` | Highest rated | Lowest rated |
   | `watchPriority` | Lower priority first | Watch priority |

   The twelve order strings come from **`SORT_ORDER_LABELS`** in
   `apps/web/src/copy.ts`, shared by the control and its assertions.

   Oldest additions is one press from the default view (REQ-038, invariant 6).
   Nullable keys remain last in both directions; the rating pre-sort refresh
   contract is unchanged (`api.md` §6.2a).

   The date labels name *nextup*'s own date-added,
   never the streaming service's save date — per REQ-061 it must not read
   "date saved" or imply the Netflix/Max date, only when the title entered
   *nextup*. Selecting a key or direction updates the query string
   (`?service=netflix&type=movie&genre=Drama&runtime=30-60&sort=runtime&dir=asc`),
   so it
   is deep-linkable, survives back/forward, and — per US-020 AC-6 —
   **persists across browser restarts for library return navigation** (#328,
   owner-approved 2026-09-21; `docs/proposals/library-browsing.md`). A validated
   browser-local destination remembers filters, search and complete sort order.
   Fresh bare-root visits and application returns restore it before list reads;
   explicit query links and Back/Forward remain authoritative. Clearing choices
   updates that destination. Unsupported saved choices and blocked storage are
   disclosed without disabling the page (`T-LIB-001`).
   Explicit entry/history URLs without direction use the per-field default;
   the former direction-only session fallback is superseded because it
   changed old history entries using newer choices.
   Explicit inactive-field selection uses that field's default, not the
   previous field's direction. Filter controls still render from the URL; the
   navigation bookmark is not a second live filter model.
   **At 320 px controls wrap without horizontal page scrolling.** Sort stays
   directly visible; filter panels are bounded to the viewport, nonmodal and
   keyboard-operable, with generated IDs, Escape/Done/outside dismissal and
   focus restoration. No fullscreen filter sheet is required.

   **Pending reads do not replace these controls.** Keep `ListSearch`,
   `FilterBar`, `SortControl` and `ListViewControl` mounted across initial
   loading and query refreshes so an open picker retains its search, focus
   and selection. Preserve selected genre options while facets are pending,
   even if the incoming facet array is temporarily empty. Pass
   **`countPending={loading}`** to suppress both the result count and
   runtime-hidden count until the response supplies the facts; never display
   guessed zeros or counts from the previous query (`T-UX-141h`, `T-UX-141i`).
   A failed online read still hides the filter/control group and shows the
   real error/retry state, rather than inventing numbers. Existing offline
   handling, including the no-cached-data state, is unchanged.
3. **The list** (`components/TitleList.tsx`) — the dominant element. Nothing is
   added above it beyond the compact service updates and list controls.
   **Grid / Compact** selects local presentation state: the same ordered rows,
   metadata, badges and actions in both views. **Owner-approved 2026-09-18:
   Cover browser maps to Grid; Comparison desk maps to Compact.** Grid stays
   the default and uses portrait-led cards in two columns from 640px and three
   from 1024px, then five from 1440px (TASK-239). On phones it uses one horizontal card per row, with a 96px-wide
   poster and more generous spacing than Compact's 72px poster.
   Compact stays single-column: wrapping facts below 1200px, then a flexible
   title/metadata column with fixed-width service, rating, priority and date
   columns. Each fact column aligns across titles (`T-UX-147a`); content-sized
   tracks must not reintroduce ragged offsets. At 390px rating and priority
   share a line (`T-UX-147c`). The frame is bounded to 96rem, including the
   desktop sidebar. Grid artwork fills each card at 2:3.
   Both layouts retain the same DOM, query/state ownership, all metadata and
   actions. Watching is a separate textual status beside title information,
   not part of the priority button's visible label. Priority buttons use the
   same 8rem width and 44px minimum target; at tested viewports they remain
   44px high for all three priorities. Accessible names still include Watching
   and priority. Semantic colors distinguish services, rating and Watching
   without replacing text. `T-UX-155a`/`b`/`c` cover these refinements.
   The heading reserves the 44px row-menu target; status text and metadata
   cannot overlap it. Unidentified and pending rows place their wider action
   group on its own line instead of squeezing it into the menu slot.
   ~~Superseded 2026-09-18: two-column phone poster Grid; wide horizontal Grid
   cards; Compact's three fixed-width text stacks.~~
   Loading, retry, pending and offline semantics remain real. `T-UX-141`.
4. **Load-more sentinel** — cursor pagination (`specs/api.md` §3), an
   IntersectionObserver auto-loading the next page, plus an explicit
   **"Load more"** button as the keyboard/no-JS-observer path.

**Loading presentation (`T-UX-010`).** Only the list rows are skeletonized:
exactly **six `aria-hidden` row skeletons** in the selected view, under one
`role="status"` wrapper named by `LIST_LOADING_BODY`, plus the existing
slow-request/retry notice. The real service-updates and list controls remain
mounted; do not add duplicate freshness-strip or filter-bar skeletons.
Loading is never the never-uploaded or zero-match state.

### 2.1a Watching and watch priority (US-060, REQ-126)

`WatchPreferencesDialog` edits a local draft: an independent **Currently
watching** checkbox and **Up next / Normal / Someday** radio choices. It opens as a bounded, viewport-centered
overlay with a dimmed backdrop, never a panel appended beneath the list.
Opening and dismissing it preserve the list's scroll position. The dialog is
portaled outside the list, locks background scrolling, scrolls internally on
short screens, and returns focus to the exact invoking control. This overlay
presentation is opt-in for watch preferences; other dialog flows are unchanged.
`T-WATCH-003k` asserts geometry and scroll preservation in Grid/Compact on
phone and desktop in Chromium/WebKit, not merely `aria-modal` semantics.

New works default to not watching and Normal. No data changes until **Save
preferences** succeeds. Cancel/Escape dismiss the draft and restore focus.
Pending saves disable all inputs, Save and Cancel, ignore dismissal and cannot
double-submit. Failures show the server message verbatim (generic visible
fallback for non-API errors), preserve the draft, and require explicit retry.
Offline disables Save if the dialog is already open.

Success closes the editor and refetches page one from the server; do not
optimistically reorder, filter or reset list rows. Preserve the URL and local
Grid/Compact choice. A refetch failure uses the existing list error/retry
state. The Watching filter is a single All titles / Watching / Not watching
radio choice. Priority is a multiselect; active chips and Clear filters cover
both dimensions.

The sixth sort button, **Watch priority**, is opt-in: Watching first,
then nonwatching Up next, Normal, Someday. Pressing it again selects
**Lower priority first**. Watching does not overwrite the selected priority.
Default Recently added and one-press Oldest additions remain unchanged.
Preferences survive removal/readdition and screenshot imports; no episode
tracking, reminders, inferred priorities or automatic assignments are added.
See `api.md` §6.2d and `T-WATCH-003`.

### 2.2 The row (`components/TitleRow.tsx`)

**Owner decision, 2026-09-17 (REQ-044):** rows and service badges provide
**no service-level or direct-title launch links**. The owner opens the
streaming app independently. Do not invent a service URL field or navigation
handler. Internal nextup links, including service-preselected `/upload`, and
required TMDB/JustWatch attribution remain unchanged. `T-UI-010` and
`T-UI-012` cover the row facts and absence of streaming-service URLs.

| Element | Source | Rule |
|---|---|---|
| Poster | `posterPath` → `src` = `https://image.tmdb.org/t/p/w342{path}`, plus `srcset` offering `w342` as `1x` and `https://image.tmdb.org/t/p/w500{path}` as `2x` | `alt=""` (decorative; the name is adjacent text). A missing poster renders the same 2:3 neutral tile, never a broken image. Current Grid posters are 96 CSS px wide on phones and 160 CSS px from 640px; Compact retains REQ-111's 72 x 108 floor. The existing w342/w500 renditions are retained: the previous w154 image was visibly soft when enlarged, and artwork is how a title is recognised (REQ-111). Density descriptors select by display density, not by card width. `T-UX-153a` pins the literal source widths; `T-UX-153b` asserts every rendition exceeds the 72 px floor. `T-UX-155c` measures the rendered aspect ratio and floor, including missing artwork. ~~Superseded: horizontal desktop Grid with approximately 200px-or-larger artwork; a single w154 rendition.~~ |
| Name | `name` | The only element with heading weight in the row |
| Watch preferences (REQ-126) | `watching`, `priority` | A separate native button below the title reads `Priority: Normal` by default, or `Watching · Up next` etc. Its accessible name includes the title, Watching state and priority. Opens the explicit-save editor (§2.1a); offline shows the same facts without an edit affordance. |
| Year · type · runtime · genres | `releaseYear`, `mediaType`, `runtimeMinutes`, `genres` | Runtime precedes genres in the approved 2026-09-16 layout. Film renders `1h 55m`, TV `45m/ep` (**one episode**, never a whole-series claim); missing runtime says **"Runtime unknown"**. Genres use three chips plus `+n` expansion, with active-filter genres always visible even above that limit. **Names wrap, never truncate**; `genres: []` renders nothing, never "Unknown" or `+0` (US-019 AC-6). All facts, including IMDb rating or its absent state, remain in Grid and Compact. |
| **Service badges** | `badges[]` | One badge per **active** listing (REQ-026), up to eight. Each badge renders through `components/ServiceMark.tsx` (§2.2a): locally bundled authentic artwork with restrained brand colour (ADR-0014 Revision 3), with canonical `SERVICE_LABELS` text **always present** and visually hidden; a visible word mark where no asset exists. Never colour-only; no per-service control theming. |
| Date-added label | `dateAddedLabel` | Rendered **verbatim from the API** (`specs/api.md` §6.2). REQ-061: it always contains "to nextup". The component **must not** construct this string. |
| Row menu | — | `⋮` button → **Not interested** (US-027), **Fix match** (US-030), **Remove from list** (US-048). 44×44 px hit area. ⚠ **Three items, and Remove was ADDED beside "Not interested", not in place of it.** They read alike — the row disappears either way — and mean opposite things: suppression is a permanent, work-identity decision that survives every future upload (REQ-071), while removal asserts nothing about the work and lets a later capture legitimately bring it back as a new row (product invariant 7). Collapsing them into one item is the defect this row exists to prevent; `T-MANUAL-016` fails if either disappears. |

A row for an **unmatched** title (`matchState === 'unmatched'`) shows the raw
extracted text as its name, an **"Unidentified"** chip, and a **"Find a
match"** action opening the fix-match dialog (US-008 AC-5).

### 2.2a Service marks (`components/ServiceMark.tsx`, ADR-0014)

Both surfaces that name a service — the row badge and the `/upload` service
step (§3.0) — resolve it through one component, so they can never disagree
about what a service looks like.

| | Row badge | `/upload` service chooser |
|---|---|---|
| Mark | Yes — all eight | Yes — all eight |
| Name | **In the DOM, visually hidden** (`nameHidden`) | **Visible**, beside the mark |
| Why | Badges repeat up to eight times per row; the mark is what is recognised | Attributing a batch to the wrong service is a destructive mistake in full-update mode — the word stays |

Rules, all of them load-bearing:

1. **The accessible name is the same in both branches and for all eight
   services.** It is `SERVICE_LABELS[service]`, never derived from the mark.
   `nameHidden` controls *visibility*, never *presence* — a logo-only badge is
   invisible to a screen reader and to the browser's own find-in-page.
   `T-BRAND-002a/b`.
2. **All eight use authentic vendored geometry** (owner-directed ADR-0014
   Revision 3): four retained CC0 marks and four verified Commons public-domain
   assets. `ATTRIBUTION.md` pins sources, revisions, hashes and presentation
   changes; `T-BRAND-001g` detects unreviewed replacements.
   ~~Revision 2 used five CC0 marks and three drawn approximations.~~
3. ⚠ **The word-mark fallback in `ServiceMark` is still live code**, even
   though no service reaches it. It is the removal path if a brand objects;
   `T-BRAND-002c` asserts it with the register mocked empty.
4. **Brand colours are confined to pinned artwork.** Labels, selection and focus
   keep the application's accessible tokens. Natural proportions are retained
   in bounded frames; logos never stretch. ~~Revision 2 required monochrome.~~
5. **Marks live in `components/brands/`, not the ADR-0013 icon register.**
   They are filled brand glyphs, not 1.5-weight line art, and they depict
   third-party trademarks. `T-BRAND-001` applies the icon register's
   closed-set, provenance, safe-SVG, no-package and no-network contract separately.
6. **Nothing is ever fetched, and no artwork is obtained from a brand.** The
   marks are compiled in. A request to a streaming service's CDN would be an
   automated request to a streaming service, which the product forbids outright
   — `T-SEC-001` fails on one of those hosts appearing anywhere in the tree.

### 2.3 Row menu dialogs

- **Not interested** (`components/SuppressDialog.tsx`) — states plainly:
  *"'Dune' will be hidden from your list and won't come back on future
  uploads, even if it's still saved on your streaming services. You can undo this from
  'Not interested'."* (US-027 AC-2/AC-3/AC-5). Confirm → `POST .../suppress`.
- **Fix match** (`components/FixMatchDialog.tsx`) — a TMDB search box
  (`GET /api/tmdb/search`, debounced 300 ms), results as poster + name + year +
  type. Selecting one shows a confirmation naming what is preserved:
  *"Your Netflix badge and the date you added it (2 Apr 2026) stay the same."*
  (US-030 AC-2/AC-3). Handles the three 409s from `specs/api.md` §6.5 inline
  (`specs/ux-states.md` §3.5).
- **Remove from list** (`components/RemoveTitleDialog.tsx`, US-048) — confirm →
  `DELETE /api/titles/:titleId` (`specs/api.md` §6.32), then the outcome with
  **Undo**. ⚠ The undo calls the **existing** `POST /api/listings/:id/restore`
  once per removed listing — every id in `removedListingIds`, because a
  two-badge row removes two and a partial restore is indistinguishable from a
  success. No second restore path is added: `T-REAP-014` pins
  `restoreServiceListing` to exactly two call sites. Failure states are
  `specs/ux-states.md` §3.11/§3.12.

The **add** affordance is not a row menu item — it belongs to no row. It is an
**"Add title"** button above the list (`components/AddTitleDialog.tsx`,
US-047), outside every loading and failure branch, opening a debounced TMDB
search and a service picker with **no default**
(`specs/ux-states.md` §2.15/§3.13). It exists because a title extraction missed
is otherwise only fixable by re-capturing an entire service.

---

## 3. `/upload` — Create a batch (US-003, US-004)

**Primary action.** First resolve any unfinished upload; otherwise choose service
and mode, attach screenshots, and submit. Read `GET /api/batches?open=true` before
exposing preparation. The checkpoint has service/mode/date, state-specific
resume, and confirmed discard only in legal states. Failed/offline checks block
creation with an explicit recovery action. Early desktop paste stays local.
Re-read status on resume/discard; preserve the queue through create-time races.
See `docs/proposals/capture-lifecycle.md` and `ux-states.md` §4.

### 3.0 Progressive reveal *(added in place, issue #287)*

Step 1's service options render their marks through `ServiceMark` with the name
**visible** — see §2.2a.

The three steps render as numbered panels, beside a 276px capture summary from
900px and with that summary below the form on phones (`TASK-222`). Each is in exactly one
state, and the state changes **only** in response to the owner answering:

| State | Rendered as | Interactive? |
|---|---|---|
| `locked` | Dimmed, with a hint saying what to answer first | **No** — `disabled`, and `aria-describedby` points at the hint |
| `active` | Full panel, controls live | Yes |
| `done` | Collapsed to the **answer** plus a `Change` button | The body is `hidden`; `Change` reopens it; Done closes an unchanged choice without clearing consent |

Rules, each of which a named test pins:

1. **Revealing a step never answers it.** US-003 AC-1/AC-2 and
   REQ-002/REQ-003 forbid a default that can be accepted by inaction, and the
   step that matters proposes removals. Unlocking step 2 leaves both radios
   unchecked (`T-UX-148c`).
2. **A locked step is dimmed and disabled, never removed.** `hidden`,
   `display: none` or an unmounted branch takes the question out of the
   accessibility tree, so a screen-reader owner never learns the step exists or
   why it cannot be answered (`T-UX-148a`).
3. **`hidden` is used in exactly one place: the body of an ANSWERED step**,
   whose answer and a labelled `Change` control are both on screen
   (`T-UX-148b`).
4. **Changing the service clears the mode** (`T-UX-148d`). The full-update
   consequence *names* the service; carrying the agreement to another service
   silently re-points a destructive choice while the collapsed summary still
   reads "Full update". Re-choosing the service already chosen keeps the mode,
   so backing out of a `Change` costs nothing (`T-UX-148e`).
5. **Step 3 is always `active`, never locked** (`T-UX-148f`) — a deliberate
   deviation from the reveal. `ImageDropzone`/`PasteButton` *hold* images that
   arrive before the questions are answered (`ux-states.md` §4.3) and the
   owner's primary path is pasting immediately, so a dimmed step would
   advertise the opposite of what it does and lose exactly that paste. It
   carries a waiting hint instead of a lock.

Each step's heading is the question, so the underlying `fieldset` legend is
rendered **visually hidden rather than dropped** — the radio group keeps its
accessible name and the sighted reader sees the question once.

**Upload timing (TASK-222):** `/upload` keeps all selected screenshots local
until the explicit Extract titles action. Changing service re-asks mode consent
without losing the queue; removing a local file guarantees it is not uploaded.
The page states that leaving/reloading clears the unsubmitted selection.
The action freezes setup, creates one batch, uploads images serially with their
individual ingest source, then submits only if every upload succeeded.

An upload or submit failure never automatically replays a request whose response
may have been lost. It preserves per-file diagnostics and opens a recovery path
to the server-re-read draft. That view lists actual saved files, deletes actual
server image IDs, allows explicit attachment of missing files, and enables
Extract only for a nonempty saved batch with no unsent local selection. A failed
image does not remove successful ones. Saved drafts keep service/mode fixed;
discard-and-start-over is explicit and confirmed. Offline disables mutations.
The capture summary and disabled-action reasons distinguish local preparation
from saved recovery rather than claiming an attachment already reached Azure.

**Input continuity (TASK-227):** distinguish Selected on this device, Uploading,
Saved, Rejected and Outcome unknown. In-page saved-draft recovery retains
failed/uncertain local files; successful files leave the local selection and
appear only in the authoritative saved list. Unknown outcomes cannot be
re-uploaded as a group: check saved previews first, then explicitly remove a
local copy or reselect it for retry. Never infer identity from matching filenames.
Read the latest draft before every mutation. Failed saved-state reads pause
writes until an explicit successful check. Saved and selected counts/UPLOAD
bytes share the batch ceilings; stored/transcoded bytes are not upload bytes.
Expired saved images need replacement before extraction.

Protect in-app links and browser Back with a focused leave confirmation when
local input or unverified work remains. Reload, closing the tab and sign-out
use the native `beforeunload` warning where supported; mobile browsers can
ignore it, so never promise reload persistence. Completed/saved-only work
does not trigger a blanket warning. PNG/JPEG previews use revocable local
object URLs; HEIC/HEIF has an explicit placeholder until the server returns
its transcoded image. No screenshot data is written to web storage.

### 3.1 Step 1 — service and mode

Two required choices, **no default for either** (US-003 AC-5). The mode control
is two large radio cards, each carrying `modeExplanation` from the API
verbatim:

| Card | Body copy (from `POST /api/batches` response) |
|---|---|
| **Add only** | *"Only adds what's in these screenshots. Nothing will be removed."* |
| **Full update** | *"Full update: anything on Netflix that isn't in these screenshots will be offered for removal."* |

The consequence sentence is **always visible**, never behind a tooltip or an
info icon (US-003 AC-2/AC-3, NFR-013). `T-UI-003` asserts both strings are in
the DOM without interaction.

### 3.2 Step 2 — get screenshots into the batch: THREE affordances *(corrected in place, A45)*

> ⚠ **(A45) Ingestion is NOT file-upload-only. That statement, wherever it
> appeared, is WRONG and is corrected here rather than annotated.** The
> owner's primary path is **paste a screen grab straight into the app**.
> ~~*Pre-A45 text: "`components/ImageDropzone.tsx`: drag-and-drop plus a file
> input plus a mobile camera-roll picker."*~~ — **superseded: that enumerated
> only the upload affordances and made paste look unsupported.**
>
> ⚠ **ADD, NOT SWAP. The file input STAYS**, at full capability: it is the
> only path that delivers raw HEIC from iOS Photos, and the only path once
> the screenshot preview's *"Copy"* has disappeared. The laptop
> web-screenshot path and the iOS Photos path both still need it.

`components/ImageDropzone.tsx` renders **three affordances, all visible at
once, all appending to the same open batch** (`api.md` §5.3.1):

| # | Affordance | Component | Platform where it is primary |
|---|---|---|---|
| **1** | **Paste** — a `document`-level `paste` listener (Ctrl/Cmd+V) **and** a visible **"Paste screenshot"** button calling `navigator.clipboard.read()` | `components/PasteCapture.tsx` (new) | Listener → desktop; button → **iOS Safari**. §3.2b |
| **2** | **Choose files** — `<input type="file" multiple>` | `components/ImageDropzone.tsx` | iOS Photos picker; laptop file picker. **Fully supported, not a fallback.** |
| **3** | **Drag and drop** — a `drop` target covering the attach area | `components/ImageDropzone.tsx` | Laptop: drag a screenshot from the desktop/Finder straight in. §3.2c |

All three end in the same call: append the `File`s to a `FormData` and
`POST /api/batches/:batchId/images` with `ingestSource` set to `paste`,
`upload` or `drop`. **The client does not branch on ingest source for
validation, preview, ceilings or error handling** — one path, three entry
points. `T-PASTE-010` asserts the file input still works end-to-end after
paste ships, because "add" turning into "swap" is the failure this note
exists to prevent.

The file input's `accept` attribute and the client-side
validation both admit **PNG, JPEG and HEIC/HEIF** — the three formats an iOS
Safari file input can deliver. ⚠ **Which one arrives is NOT predictable from
the capture path:** the owner's own iOS *screenshot* measured at TASK-151 is
**JPEG**, falsifying the "screenshots are PNG, camera photos are HEIC" map this
paragraph used to assert. That makes lenient client validation more important,
not less. **The client must not reject HEIC/HEIF
that the server accepts** — a client that rejects what §5.1 transcodes
reintroduces the very defect A42 fixes. Because iOS often reports HEIC with an
empty or `application/octet-stream` MIME type, the client validates
**leniently** (accept unknown/empty types and let the server's magic-byte check
in `api.md` §5 be authoritative) rather than hard-filtering on `File.type`.
**The same leniency applies to a pasted `Blob`'s `type`** — it is a hint, and
the server's sniff is authoritative (`api.md` §5, `T-PASTE-006`).

The client-side rejection message **names every accepted format** so a user
whose file was refused knows what is allowed, e.g. *"That file isn't a
screenshot nextup can read — attach a PNG, JPEG or HEIC image."* `T-UI-004`
asserts the message enumerates PNG, JPEG **and** HEIC.

**No client-side preview or crop of a HEIC/HEIF file.** Only Safari can render
HEIC in `<img>`/`<canvas>`; Chrome, Firefox and Edge cannot. So a selected
HEIC/HEIF tile shows a **format-and-filename placeholder** (a document icon,
the file name, size, and a small *"HEIC — preview after upload"* label) rather
than a broken image, until the server has transcoded it. PNG/JPEG selections
render a normal client thumbnail. Selected images render as a thumbnail/
placeholder grid with file name, size, and a **remove** control per image,
available until submit (US-004 AC-4). Running totals *"7 screenshots · 5.7 MB
of 60 MB"*. Rejections are listed **per file, by name, with the reason**
(US-004 AC-3/AC-6) and never replace the accepted list. Once uploaded, the
`/batches/:batchId` thumbnail strip (§4) is fed by `GET /api/images/:id`, which
serves the **transcoded PNG** — so those thumbnails render in every browser.
**A pasted image is always PNG, so it always renders a normal client
thumbnail** — the HEIC placeholder case cannot arise on that path (A45).

#### 3.2b Paste — the primary path *(new, A45)*

**Two primitives, both shipped.** They are the right primitive on opposite
platforms and are cheap together (`api.md` §5.3.2,
`Context/evidence/clipboard-paste-support.md` Q4).

**Primitive 1 — the `paste` listener (desktop).**
`components/PasteCapture.tsx` attaches `document.addEventListener('paste', …)`
**on mount of `/upload` and the open-draft attach area, and removes it on
unmount.** On event:

1. If `event.target` is inside an `<input>` or `<textarea>`, **return
   immediately without `preventDefault()`** — text pasting into the TMDB
   search must keep working. `T-PASTE-001`.
2. Read `event.clipboardData.files`, plus `items` filtered to
   `kind === 'file'` and a `type` beginning `image/`.
3. If **zero** images were found, return without `preventDefault()` — a
   text-only paste is left entirely alone.
4. Otherwise `preventDefault()`, and append **every** image found to the open
   batch (a multi-image clipboard is possible and is not truncated to one).

**No focus management is required** and the owner never has to click into a
box first: per the Clipboard API spec the `paste` event fires regardless of
editable context, bubbles, and is composed (evidence Q1c). **Do not add a
hidden `contenteditable` div** — that 2015-era workaround is obsolete
(WebKit bug 75891 is RESOLVED) and it breaks the focus order §10.2 requires.

**Primitive 2 — the "Paste screenshot" BUTTON (iOS Safari, and everywhere).**

| | |
|---|---|
| **Why a button and not a gesture** | On iOS, long-pressing non-editable content is **not** a supported way to reach a Paste option. The **verified** path is: the owner taps *our* button → our click handler calls `navigator.clipboard.read()` → **WebKit** shows a native callout bar with a single "Paste" option → the owner taps it → the promise resolves (evidence Q1d, `verified`). |
| **Label** | `PASTE_BUTTON_LABEL` — *"Paste screenshot"* (§9). |
| **Hint, always visible beneath it on a touch viewport** | `PASTE_IOS_HINT` — *"Take a screenshot, tap Copy on the preview, then tap here."* iOS screenshots go to **Photos**, not the clipboard; the paste path only exists if the owner acts on the transient thumbnail. Saying so is what makes the button usable. |
| **Placement** | Directly **above** the "Choose files" control on viewports ≤ 640 px, because it is the primary path there. It is **never** the only control shown — "Choose files" is always visible beside it. |
| **Gesture requirement** | `navigator.clipboard.read()` is called **synchronously inside the click handler**. Called outside a user gesture the promise **rejects immediately** (evidence Q4). No `setTimeout`, no `await` before the `read()` call. |
| **Reading the item** | Take the first `ClipboardItem` whose `.types` includes `image/png`; `await item.getType('image/png')`; wrap in a `File` named per the server rule (the client may send `image.png` — the server ignores it and synthesises, `api.md` §6.12). |
| **Every paste costs one tap on a system callout, forever** | iOS never remembers the choice (evidence Q1e caveat 1). **Do not build a "don't ask again" control** — there is nothing to remember. Do not apologise for it in copy either; state the flow once in `PASTE_IOS_HINT`. |
| **Feature detection** | If `navigator.clipboard?.read` is not a function — **including on any `http://` origin, where `navigator.clipboard` is simply absent** — the button is **not rendered at all**. A button that cannot work is worse than no button. `ux-states.md` §4.16, `T-PASTE-009`. |
| **Rejection handling — MANDATORY** | *"Tapping or clicking anywhere in the page … or performing any other actions, such as switching tabs or hiding Safari, will cause the promise to be rejected"* (evidence Q1d, `verified`). **The UI MUST detect the rejection and re-offer the button. It MUST NEVER appear to hang.** No spinner outlives the promise. `ux-states.md` §4.15, `T-PASTE-008`. |

**Successive pastes append to the open batch.** The second paste is one more
`POST .../images` against the **same** `batchId`; the thumbnail grid grows;
running totals update; the 40-image / 60 MiB ceilings are the only stop and
they are **shared across all three affordances** (`api.md` §5). **No new batch
is created by a paste, ever** — the existing multi-image batch model is reused
exactly as-is. `T-PASTE-003`.

**Privacy win, worth stating.** A pasted screenshot typically carries **no
EXIF** — WebKit strips it on clipboard read (evidence Q1d fact 5). That is a
genuine benefit of the owner's preferred path. ⚠ **It is NOT a global
control**: the file-upload path delivers EXIF/GPS intact and REQ-078's
explicit strip stays there. `api.md` §5.1a, `security.md` §4.2.

#### 3.2c Drag and drop *(new, A45)*

The attach area is a `drop` target (`onDragOver` → `preventDefault()`,
`onDrop` → read `event.dataTransfer.files`). It is the third affordance and
behaves **identically** to a file-input selection except that
`ingestSource: 'drop'` is sent.

- **Visible drop state.** While a drag is over the target, the area shows
  `DROPZONE_ACTIVE_LABEL` — *"Drop screenshots here"* — with a visible
  border change. Colour is never the sole carrier (§10.2). `ux-states.md`
  §4.17.
- **The whole `/upload` attach area is the target**, not a small inner box.
- **Not a mobile path**, and not pretended to be — it is silently inert on
  touch, which is correct behaviour, not a gap.
- **Non-image drags** (a text selection, a URL) are refused with the same
  per-file message as any other rejection; a dragged **folder** is refused
  by name. `T-PASTE-004`.

#### 3.2a Memory/decode rejections — the diagnostic path *(new, R5; `A43-M3`)*

**No client-side reinterpretation.** For a `rejected[]` entry whose `code` is
`IMAGE_TOO_LARGE_TO_DECODE`, `IMAGE_DECODE_OOM` or `IMAGE_DECODE_FAILED`
(`api.md` §5.0/§5.2), `components/ImageDropzone.tsx` renders the server's
`message` **verbatim** — it is the exact text specified in ADR-0008 R2.3 and
`api.md` §5.2.4, it already names the cause and the remedy, and the client
**must not** shorten it, re-word it, or replace it with a generic *"Upload
failed"*. That substitution is precisely the `RSK-016` failure mode the owner
paid for this containment to avoid. `T-UI-013`.

The rejection card for these three codes shows, in this order:

1. The **file name** (the batch may hold 40 images; naming the file is the
   point).
2. The server `message`, verbatim, as body text — **not** truncated, **not**
   behind a "details" disclosure, **not** in a toast that auto-dismisses.
3. For `IMAGE_TOO_LARGE_TO_DECODE` only: the dimension facts from
   `details` — *"8064 × 5952 · 48.0 MP · limit 25.0 MP"* — as secondary text.
4. For the two **memory** codes only (`IMAGE_TOO_LARGE_TO_DECODE`,
   `IMAGE_DECODE_OOM`): a **"How to fix this"** link to the copy constant
   `MEMORY_REMEDY_PATH` (`runbooks/scale-up-memory.md`), rendered as literal
   text as well as a link, so it survives being read in a screenshot or a
   copied error report. **`IMAGE_DECODE_FAILED` must NOT show this link** —
   more memory will never fix a corrupt file and offering the remedy would
   send the owner to spend money they do not need to spend (`api.md` §5.2.3).
5. A **reassurance line**, always: *"Nothing else in this batch was
   affected."* This is true by construction (`api.md` §5.2.1) and is the
   second half of what makes the failure non-frightening.

**The batch remains usable.** These rejections never clear the accepted list,
never close the batch, and never disable the **"Extract titles"** button while
`accepted.length > 0`. The owner may submit the images that worked and
re-attach the failed file later (`api.md` §5.2.5 — a re-attach, **not**
re-extract, because nothing was stored). `T-UI-013`.

### 3.3 Step 3 — submit

A single primary **"Extract titles"** button, disabled at zero images with the
reason shown as text (never a silent disabled button). Submitting navigates to
`/batches/:batchId`.

**Batch immutability** (US-003 AC-6): after submit, service and mode render as
read-only text with the note *"Locked for this batch. Discard and start again
to change them."*

---

## 4. `/batches/:batchId` — Extraction status (US-006)

### Saved-draft input recovery (TASK-230)

The draft groups persisted input issues separately from saved screenshots and
the local queue. It names failures, preserves memory-specific remedy links,
and explains that unresolved full-update input withholds removals while
additions remain available. Legacy/derived uncertainty asks for a fresh capture
before removal eligibility, never silently treating the capture as append-only.

For each failed/interrupted input, show available saved previews and initially
unchecked choices. The owner explicitly confirms that the selected existing
or newly uploaded screenshots cover the entire failed input. New uploads,
filename matches and local queue removal never auto-resolve it. Removed,
expired and unfinished-deletion images cannot remain selected for submission.
An unfinished image removal offers retry removal, not a coverage bypass.
Resolved input receives a status confirmation; this is not a guarantee the
owner captured every title on the service.

Local refusal reports are sticky through draft reloads and carry stable tokens.
Rejected-only selections offer **Save input issues**. Report failures retain
intent for explicit retry; reconnect never writes. Unreadable local evidence
blocks extraction and directs explicit discard rather than assuming success.
An unknown mutation followed by an unreadable saved status locks writes until
**Check saved screenshots** succeeds. Missing intake from an older response
blocks full-update extraction.

### Extraction progress

Polls `GET /api/batches/:batchId` every 2 s while `submitted`/`extracting`.
Only one status read may be pending; ticks share it instead of invalidating a
slow response. **Check saved status** explicitly supersedes a stalled read.
Initial loading does not invent queued counts. Failed reads retain clearly
labelled last-known evidence, stop polling and disable writes until read-only
recovery. A status-read failure must never use extraction-failure copy.
Shows `progress.imagesDone / imagesTotal`, a per-image thumbnail strip fed by
`GET /api/images/:imageId`, and — the moment extraction ends — the count of
images that yielded **no text**, named individually (US-006 AC-3).

On `in-review` it auto-navigates to the review page. On `extraction-failed` it
shows the failure states in `specs/ux-states.md` §5.

---

## 5. `/batches/:batchId/review` — The review pass (US-012…US-016, US-021)

> **This is the screen the product lives or dies on** (OQ-011). It is also the
> screen where the mode contract (`specs/ai.md` §6.3) becomes visible.

**Primary action.** Confirm what should happen, then close the batch.

### 5.1 Layout

```
┌ Sticky header ────────────────────────────────────────────┐
│ Netflix · Full update · 7 screenshots                     │
│ [Discard batch]                                           │
└───────────────────────────────────────────────────────────┘

  (banner, when present — low yield, TMDB unreachable, …)

  5 tiles found · 2 already saved · 3 to review
  [Original tile 1]  [Match and next step: already saved]
  [Original tile 2]  [Match and next step: confirm/change/discard]
      … every original tile in screenshot order …
      … conflicting readings stay beneath their source tile …

  ▸ No longer on Netflix (3)                   ← FULL UPDATE ONLY
      … removal cards, ALL TICKED …

┌ Sticky action bar ────────────────────────────────────────┐
│ 9 to add · 3 to remove · 2 still to review                 │
│                        [Review changes]                   │
└───────────────────────────────────────────────────────────┘
```

### 5.2 The rules this screen must not break

| Rule | Implementation |
|---|---|
| Both modes show **all** extracted titles (REQ-057; owner-approved tile-first revision) | Every verified input tile remains visible, including already-known matches and unidentified tiles. Older batches retain the section layout with known titles expanded. `T-REV-006`, `T-UI-005`, `T-AI-067`. |
| Append-only never proposes removals (REQ-022) | Only the removals section is absent. Already-known matches remain visible and require no action. `T-UI-006`. |
| Known matches are not additions | No confirm, discard or bulk-add controls in the known section. **Find the right title** corrects mistaken identity through the existing candidate API; the server determines the new section. `T-REV-016`, `T-UX-162g`. |
| Removals ticked by default (REQ-055) | Every removal checkbox is `checked` on first render. `T-UI-007`. |
| Removals individually rescuable (REQ-021) | Each labelled checkbox calls `PATCH /api/batches/:id/removals` and rereads the review. A failed write is visible; no optimistic removal consent. |
| One final summary in both modes (owner-approved, 2026-09-18) | **"Review changes"** refreshes authoritative decisions and opens the single final summary in `components/RemovalConfirmDialog.tsx`. It lists effective additions and only selected removals. **"Apply changes"** closes once; **"Back to review"** or Escape preserves decisions. The summary replaces the removal-only dialog, never precedes a second dialog. `T-UX-159`, `T-UI-008`. |
| Removals confirmed as one group (REQ-020) | The final summary names every selected removal and explicitly states when nothing will be removed. The consent flag is true only after this confirmation when proposals exist, including zero selected. No per-row destructive action. `T-REV-007`. |
| No accept-by-inaction (REQ-014) | **"Review changes"** reports pending decisions and focuses the first pending card instead of presenting an incomplete summary. The server's `PENDING_ADDITIONS` gate remains authoritative at close. |

### 5.3 Candidate card (`components/CandidateCard.tsx`)

**TASK-229 outcome recovery:** a failed Apply response does not prove failure.
Check saved batch status before enabling another write. Applied, undone,
discarded and other non-review states open their saved batch page; `in-review`
requires a refreshed summary and explicit Apply retry. Unreadable status keeps
Apply/decision mutations disabled and offers **Check saved status** inside the
retained confirmation or on the review after Back. Reconnect never replays
Apply. Leaving the route stops subsequent reads/navigation, not an accepted
server transaction. Old terminal review links resolve to saved status.

The saved applied page exposes the persisted receipt, appropriate undo and
provenance, with routes to the list, history and another capture. Zero-member
removal groups never offer removal undo. Already-undone groups are identified
and not offered again; no-change batches explicitly say nothing changed.

Poster, matched name + year + type, **the raw extracted text always visible in
small type** (so the owner can see what was read), the source-screenshot
thumbnail, and three controls: **Confirm** / **Change match** / **Discard**.
"Change match" expands the top-5 alternatives inline — they are never hidden
behind a search (US-007 AC-4) — with a search box beneath for anything else.

Flags rendered as chips: **"Low confidence"** (`verdict === 'low-confidence'`),
**"Uncertain match"** (`match.uncertain`), **"Could be more than one work"**
(`match.ambiguous`).

#### 5.3a Revision-2 verdicts (ADR-0001 Revision 2)

**Tile-first review (`T-AI-065`–`T-AI-067`).** Render every controlled
`inputTileBox` beside its proposed catalogue match and explicit next step.
Already saved on this service: nothing to add, with Change match recovery.
Known on another service: confirm adding this service. New: confirm, change
or discard. Unidentified: search, keep unidentified or discard; a textless
unreadable tile offers search/discard, never an empty-title Keep.
Related or weak readings require individual decisions and are excluded from
bulk confirmation consistently in the client, API and offline replay.
Show conflicting readings inside the same physical tile, not as additional
tiles. Shared identities retain every source tile but share one saved decision.
Window tile groups above the existing 100-item threshold. Apply changes still
has its separate authoritative summary and never adds an undecided reading.
Unreadable tiles are not additions; leaving one unidentified does not add it.

**Legacy image-derived evidence (`T-AI-062`–`T-AI-064`).** Without controlled
input provenance, crop to a measured tile only with
an OCR-backed title location. Unique exact OCR text, including a tile's joined
OCR lines, may locate an otherwise unverified artwork candidate without
upgrading its confidence or removing its warning. Never snap an unverified
model box to its nearest tile. Rejected layouts retain the existing crop rule
and labelled whole-screenshot fallback.

Show per-image coverage above collapsed review groups, with a link to the
source: **"3 title candidates; readings located in 3 of 5 detected tiles."**
If coverage is incomplete, ask the owner to compare the screenshot and add
missing titles, explicitly distinguishing *unlocated* from *unread*. The
"Couldn't read these" bucket still counts explicit unreadable candidates,
not silently omitted tiles. Readings may be duplicates or misreads, not
verified identities. Absent measurement makes no completeness claim.
Any unlocated detected tile withholds full-update removals through `lowYield`.

In **Probably not titles**, headline the raw transcription (e.g. **My List**),
not a speculative TMDB result (e.g. **My Wish List**). Do not promote that
match's poster/year; keep correction controls and alternatives available.

Two verdicts are new and each has a **mandatory** presentation. These are not
cosmetic — they are the review-side half of the mitigation for `RSK-028`
(fabrication), and an implementation that renders them as ordinary cards
silently removes the safeguard.

| Verdict | Chip | Mandatory presentation |
|---|---|---|
| `inferred-unverified` | **"Read from the artwork — check this"** | The **cropped tile thumbnail must be rendered immediately beside the proposed title**, at a size where the artwork is legible (≥ 96 px on the short edge). The title came from the model with **no** corroborating OCR text, so verification must be a glance, not an act of faith. `T-AI-041`. |
| `unreadable-tile` | **"Couldn't read this one"** | Rendered as a **thumbnail with no proposed title** and a **"Search for this"** action that opens manual entry (US-009) pre-scoped to the batch. Never silently dropped. |
| any `provider === 'ocr-only'` item | **"The text reader saw this, the tile reader did not"** | An additional chip on an otherwise normal card. This is the omission-recovery path — it exists so the model cannot silently drop a title. |

**`rawText` may be empty for `unreadable-tile`.** The "raw extracted text always
visible" rule above must degrade to showing the thumbnail rather than rendering
an empty line.

### 5.4 OQ-011 ergonomics decisions (SD-11)

Recorded as decisions because the review pass at ~200 candidates is the
likeliest cause of abandonment, and no numeric interaction budget is stated
anywhere in the record.

| ID | Decision |
|---|---|
| SD-11a | **A "Confirm all N" control per section.** One tap disposes of the common case. Without it a 200-title first import is ~200 taps. |
| SD-11b | **"Already on your list" is collapsed by default with its count visible.** Expanded, it would bury the additions; omitted, it would break REQ-057. |
| SD-11c | **The list is virtualised** (`@tanstack/react-virtual`) above 100 items in a section, so a 500-candidate batch stays responsive on a phone. |
| SD-11d | **A sticky action bar** carries the running counts and the single primary action, so the owner is never scrolling to find out where they are. |
| SD-11e | **Saved decisions remain authoritative; unsaved intent is separate.** Session storage under `nextup.review.intents.<batchId>` retains candidate/removal intent. Offline decisions are labelled **Not saved** and block Apply. **Check and save choices** rereads first; satisfied writes are not replayed, conflicts require an explicit choice, and changed identities cannot be overwritten. Reconnect never saves automatically. Unavailable storage is reported rather than promising persistence. `T-UX-162c`–`f`, `T-UX-162l`, `T-UX-162o`. |

**TASK-228:** confirmed, corrected and discarded additions/unidentified cards
retain **Change decision** until Apply. Bulk confirmation remains one atomic
request; its results can be reversed individually, not through a new bulk-undo
operation. A correction's chosen identity survives later decision changes.
Secondary evidence supports deliberate rescue/correction. Distinct messages
describe no candidates, known-only, unidentified, secondary-only and deliberately
discarded additions; an empty additions section alone never proves "already known".

**Read screenshots again** checks saved status and screenshot availability,
then separately confirms **Discard this review** and **Read saved screenshots**.
There is no automatic discard/read chain. An uncertain result requires a
read-only status check; a derived open batch can be resumed rather than
duplicated. Expired images require new input. The derived batch keeps the
original expiry and locked service/mode.

**Still open in OQ-011:** whether the resulting effort is *acceptable to the
owner*. That is the M5 kill criterion and can only be answered by the owner
using it. Not decidable here; deliberately not invented.

---

## 6. `/removed` — Removal history (US-023, US-024)

**Purpose.** A **historical log, not a recycle bin** — the framing has to be in
the interface, or repeated rows read as a bug (L1/A33).

- Page title: **"Removal history"**. Subtitle, always visible:
  *"Everything that's ever left your list is kept here forever. The same title
  can appear more than once — each row is one removal."* (US-024 AC-6.)
- Controls: **title search** and **service filter** only (data-model §11).
- Each row: poster, name, **service badge of the removed listing**, *"Removed
  14 Jul 2026"*, *"Added 4 Jan 2026"*, an ordinal chip **"Removal 2 of 3"**,
  and a **Restore** button.
- **The view is never de-duplicated** (US-024 AC-6, PRD R-4). `T-UI-009`
  asserts three rows render for a work removed three times.
- A row whose work is actively suppressed shows a **"Not interested"** chip and
  its Restore button opens the un-suppress-first flow (`specs/ux-states.md`
  §3.6) rather than failing.

---

## 7. `/not-interested` — Suppressed works (US-029)

- Page title **"Not interested"**; subtitle *"These won't be added back by
  future uploads."*
- Each row: poster + name + year from `displaySnapshot`, a **"Stop ignoring"**
  button.
- Un-suppressing shows a confirmation that says the honest thing:
  *"'Dune' can be added again by a future upload. This doesn't bring back
  anything that was removed — check Removal history for that."* (US-029 AC-4.)
- A row with `identityStability: "text-derived"` carries a caveat line:
  *"We couldn't identify this title, so we're matching it on the text we read.
  If a future screenshot reads slightly differently, it may come back."*
  (data-model §2.3.1, §2.3.3.)

---

## 7a. `/rating` — Check a rating (US-045, Epic M)

`pages/RatingLookupPage.tsx`. The tenth screen (§1). A **read-only** surface:
the owner types a name, nextup resolves it through TMDB to an `imdb_id` and
asks OMDb for the rating.

⚠ **It writes nothing.** No title is created, no listing is touched, nothing
joins the list. `T-IMDB-006h` asserts that against the route's source. The
copy says so explicitly (`IMDB_LOOKUP_BODY`), because a search box inside a
list-building product otherwise reads as "add to list" and the owner would
reasonably expect the film to appear on `/`.

**Five states**, a closed union in the page:

| State | Renders |
|---|---|
| `idle` | The labelled input and `IMDB_LOOKUP_SUBMIT_LABEL` |
| `loading` | The pending affordance; the input stays visible and readable |
| `found` | Title, year, and the rating — or `IMDB_RATING_ABSENT` when the work exists but carries no rating. Plus `IMDB_LOOKUP_IN_LIST` when the work is already on the list |
| `not-found` | `IMDB_LOOKUP_NOT_FOUND` |
| `failed` | `IMDB_LOOKUP_FAILED` and a retry |

⚠ **`not-found` and "found but unrated" are DIFFERENT states and must not be
merged** (US-045 AC-3). A 404 from `GET /api/imdb/lookup` is a *result*, not a
failure; every other non-ok response is `failed`. Collapsing the two tells the
owner a film does not exist when it does, or that one exists when it does not.

⚠ **`inList` is matched on canonical `workIdentity`**, never on the typed
string — the same identity rule the whole product uses (REQ-071), so a lookup
for *"the matrix"* recognises a listed *"The Matrix"*.

The rating renders through the same rule as the list row: one decimal place
always, so `8` shows as **8.0**. A bare "8" beside an "8.7" elsewhere on the
page reads as a coarser scale.

---

## 8. TMDB attribution (US-011, NFR-016) — compliance, and invisible when broken

`components/TmdbAttribution.tsx` renders, in the **global footer of
`AppShell`** so it is present on **every** screen:

- The TMDB logo (`/assets/tmdb-logo.svg`, `alt="TMDB"`), and
- the disclaimer **verbatim**, as visible text (not a `title`, not `aria-label`,
  not an image):
  **"This product uses the TMDB API but is not endorsed or certified by TMDB."**

Both strings come from `GET /api/me`'s `attribution` object, backed by
`TMDB_DISCLAIMER` in `packages/domain/src/attribution.ts`. No component
contains the sentence as a literal. It is **never** behind an expander, a
tooltip, a modal or an "about" link (US-011 AC-3).

`/about` additionally states, in plain language: what TMDB is used for, the
30-day screenshot retention (US-035 AC-6), that removed titles are kept
forever (US-023 AC-2), and that no analytics are collected (NFR-005).

**Its failure is invisible from inside the product**, so it is tested three
ways: `T-ATTR-001` (string equality across constant/API/DOM), `T-ATTR-002`
(Playwright: the disclaimer text is visible on **every** route without
interaction), `T-ATTR-003` (the logo image renders with a non-zero bounding box
on **every** route).

⚠ Phrased as "every route", not a number. All four of these suites enumerate
`ROUTES` from `apps/web/src/routes.tsx`, so their coverage grows with the route
table on its own — a written count is a redundant restatement that goes stale
the moment a screen is added, as "nine" did when `/rating` arrived.
~~Superseded: "on all nine routes".~~

### 8a. OMDb provenance (Epic M, ADR-0011 D-1a)

The same footer carries a second line, `OMDB_DISCLAIMER`, backed by
`packages/domain/src/attribution.ts` and delivered on the same `attribution`
object.

⚠ **This is NOT a licensing obligation, and the difference matters.** TMDB's
disclaimer is contractual and therefore asserted **verbatim**. OMDb's is not:
it is there because OMDb is an unendorsed third-party republisher of IMDb data
which can lag behind the source, and a number labelled simply "IMDb" hides
that. So the wording **may be improved**, but the two facts — that the data
comes from OMDb, and that IMDb does not endorse it — may not be dropped.
`T-ATTR-006` therefore asserts the **facts**, deliberately not byte-equality:
a byte guard here would falsely imply a contract that does not exist.

---

## 9. Copy that must be exact

Held in `apps/web/src/copy.ts` as named exports, imported everywhere, so a
change is one diff and a test can assert it.

| Constant | Text | Why |
|---|---|---|
| `TMDB_DISCLAIMER` | *This product uses the TMDB API but is not endorsed or certified by TMDB.* | US-011 AC-2 — verbatim, compliance |
| `REMOVED_VIEW_SUBTITLE` | *Everything that's ever left your list is kept here forever. The same title can appear more than once — each row is one removal.* | US-023 AC-2, US-024 AC-6 |
| `SUPPRESS_CONFIRM_BODY` | *"{name}" will be hidden from your list and won't come back on future uploads, even if it's still saved on your streaming services. You can undo this from "Not interested".* | US-027 AC-2/AC-3 |
| `UNSUPPRESS_CONFIRM_BODY` | *"{name}" can be added again by a future upload. This doesn't bring back anything that was removed — check Removal history for that.* | US-029 AC-4 |
| `UNMATCHED_SUPPRESSION_CAVEAT` | *We couldn't identify this title, so we're matching it on the text we read. If a future screenshot reads slightly differently, it may come back.* | data-model §2.3.3 |
| `FIXMATCH_SUPPRESSION_MIGRATED` | *We also moved your "not interested" setting across to the corrected title, so it still won't come back.* | data-model SD-06 |
| `LOW_YIELD_FULL_UPDATE` | *We couldn't read enough titles from these screenshots to safely work out what's been removed, so nothing will be removed by this batch. You can re-extract, add more screenshots, or discard it.* | US-014 AC-6, `specs/ai.md` §8.2 |
| `MODE_FULL_UPDATE_CONSEQUENCE` | *Full update: anything on {Service} that isn't in these screenshots will be offered for removal.* | US-003 AC-2 |
| `MODE_APPEND_ONLY_CONSEQUENCE` | *Only adds what's in these screenshots. Nothing will be removed.* | US-003 AC-3 |
| `IMAGE_RETENTION_STATEMENT` | *Screenshots are kept for 30 days so you can re-extract them, then deleted automatically.* | US-035 AC-6 |
| **`MEMORY_REMEDY_PATH`** *(new, R5)* | `runbooks/scale-up-memory.md` | `A43-M3` — the one place the remedy path is written, so a moved runbook is one diff |
| **`DECODE_BATCH_UNAFFECTED`** *(new, R5)* | *Nothing else in this batch was affected.* | `A43-M2` — true by construction (`api.md` §5.2.1) |
| **`DECODE_REMEDY_LINK_LABEL`** *(new, R5)* | *How to fix this* | §3.2a item 4 — shown for the two **memory** codes only, never for `IMAGE_DECODE_FAILED` |
| **`PASTE_BUTTON_LABEL`** *(new, A45)* | *Paste screenshot* | §3.2b — the iOS-critical affordance. The label says *screenshot*, not *image*, because that is what the owner is pasting |
| **`PASTE_IOS_HINT`** *(new, A45)* | *Take a screenshot, tap Copy on the preview, then tap here.* | §3.2b — iOS screenshots go to Photos, **not** the clipboard, unless the owner acts on the transient preview. Without this line the button looks broken |
| **`PASTE_ABANDONED_BODY`** *(new, A45)* | *That paste didn't come through — tapping elsewhere, switching tabs or leaving Safari cancels it. Try again.* | §3.2b / `ux-states.md` §4.15 — the mandatory re-offer for the silently-rejected promise (evidence Q1e caveat 2) |
| **`PASTE_EMPTY_BODY`** *(new, A45)* | *There's nothing on your clipboard to paste.* | `ux-states.md` §4.14 |
| **`PASTE_NOT_IMAGE_BODY`** *(new, A45)* | *What's on your clipboard isn't an image. Copy a screenshot, or choose a file instead.* | `ux-states.md` §4.14 — **always names the still-available upload path** |
| **`PASTE_DENIED_BODY`** *(new, A45)* | *nextup couldn't read your clipboard. Tap "Paste screenshot" again and choose Paste, or choose a file instead.* | `ux-states.md` §4.13 |
| **`DROPZONE_IDLE_LABEL`** *(new, A45)* | *Paste a screenshot, choose files, or drag them here — PNG, JPEG or HEIC, up to 10 MB each, 40 per batch.* | `ux-states.md` §4.3 — **all three affordances named in one line.** Supersedes the upload-only phrasing in place |
| **`DROPZONE_ACTIVE_LABEL`** *(new, A45)* | *Drop screenshots here* | §3.2c |
| Date-added complete orders *(approved 2026-09-16)* | *Recently added* / *Oldest additions* | §2.1; `desc` / `asc`, nextup's own earliest active-listing date. ~~Legacy `SORT_NEWEST_LABEL` / `SORT_OLDEST_LABEL`: Newest first / Oldest first~~ |
| Name complete orders *(approved 2026-09-16)* | *Name A-Z* / *Name Z-A* | §2.1; `asc` default / `desc` |
| Release-year complete orders *(approved 2026-09-16)* | *Newest releases* / *Oldest releases* | §2.1; `desc` default / `asc` |
| Runtime complete orders *(approved 2026-09-16)* | *Longest runtime* / *Shortest runtime* | §2.1; `desc` default / `asc`. ~~Legacy SORT_LONGEST_LABEL / SORT_SHORTEST_LABEL: Longest first / Shortest first~~ |
| Rating complete orders *(approved 2026-09-16)* | *Highest rated* / *Lowest rated* | §2.1; `desc` default / `asc`; pre-sort rating refresh remains mandatory |
| Selected sort accessible name *(approved 2026-09-16)* | *{current order}. Selected. Change to {reverse order}.* | Marks state and next action without ambiguity (`T-UX-138`) |
| **`RUNTIME_UNKNOWN_LABEL`** *(new, `A48`)* | *Runtime unknown* | §2.2 — the NAMED absence (REQ-119). Never `0m`, never an empty slot: `0m` is a claim about the work, and an empty slot is indistinguishable from a rendering failure |
| **`RUNTIME_HIDDEN_DISCLOSURE`** *(new, `A48`; both forms approved by the owner 2026-09-16)* | *{n} titles have no runtime and are hidden.* — singular: *1 title has no runtime and is hidden.* | §2.1 item 2 — rendered **only** while a runtime filter is active, with a live `n`. The mitigation for the one way REQ-035 can silently shorten the list. ⚠ **A count-dependent string cannot be a bare constant**, so the export is the function `runtimeUnknownHiddenLabel(n)`; §9's "one diff" promise is satisfied by the function being the single place both forms are written. The singular and the full stop were drafted by the implementer and are approved here rather than left as a standing finding |
| **`IMDB_RATING_SOURCE`** *(new, Epic M)* | *IMDb* | §7a — labels the number on the row. ⚠ **REVISED at `A53`: the rating **is** a sort key (`sort=rating`, ADR-0011 Rev 1). It still never *filters*.** ~~"The rating is **display-only** (REQ-095): it never sorts or filters"~~ |
| **`IMDB_RATING_ABSENT`** *(new, Epic M)* | *No IMDb rating* | REQ-091 — ⚠ **a rendered state, not an omission.** May be reworded; may **not** become blank, `0`, `0.0` or an empty star row. Without it, "this work has no rating" and "nextup failed to fetch one" look identical |
| **`IMDB_LOOKUP_TITLE`** *(new, Epic M)* | *Check a rating* | §7a — the `/rating` screen (US-045) |
| **`IMDB_LOOKUP_BODY`** *(new, Epic M)* | *Look up any film or series to see its IMDb rating. Nothing is added to your list.* | US-045 — **the second sentence is load-bearing.** A search box inside a list-building product otherwise reads as "add to list", and the route writes nothing (`T-IMDB-006h`) |
| **`IMDB_LOOKUP_INPUT_LABEL`** *(new, Epic M)* | *Film or series name* | §10 — a real label, not placeholder text |
| **`IMDB_LOOKUP_SUBMIT_LABEL`** *(new, Epic M)* | *Look it up* | §7a |
| **`IMDB_LOOKUP_NOT_FOUND`** *(new, Epic M)* | *Couldn't find that title.* | US-045 AC-3 — ⚠ **distinct from `IMDB_RATING_ABSENT`.** "No such title" and "found, but unrated" are different answers; conflating them tells the owner a film exists when it does not |
| **`IMDB_LOOKUP_FAILED`** *(new, Epic M)* | *Couldn't run that lookup. Nothing has changed.* | Mirrors `LIST_LOAD_FAILED_BODY` — same reassurance, same reason |
| **`IMDB_LOOKUP_IN_LIST`** *(new, Epic M)* | *Already on your list.* | US-045 AC-4 — matched on canonical `workIdentity`, never on the typed string |
| **`LIST_LOADING_BODY`** *(new, Epic N)* | *Loading your list…* | §12.2 — ⚠ **an empty list and a not-yet-loaded list are indistinguishable from the rows alone.** Without a distinct loading state, `listEmptyKind()` sees zero rows and no filters on every page load and renders *"Nothing here yet"* to an owner whose list is full — a data-loss misreading US-019 AC-5 exists to prevent. `T-DATA-002c` |
| **`ROW_MENU_REMOVE_LABEL`** *(new, US-048)* | *Remove from list* | §2.2 — the **third** row-menu item, beside "Not interested" and never instead of it |
| **`REMOVE_TITLE_CONFIRM_BODY`** *(new, US-048)* | *"{name}" will be taken off your list and logged in Removal history, where you can put it back. It isn't marked "not interested", so a future upload can add it again.* | ⚠ **Every clause is load-bearing, and the contrast with `SUPPRESS_CONFIRM_BODY` is the point.** The two actions are adjacent menu items with visually identical outcomes and opposite meanings; an owner who reads this as the other one permanently suppresses a real work they never rejected. The reappearance is stated, not left to be inferred |
| **`REMOVE_TITLE_DONE`** *(new, US-048)* | *Removed. "{name}" is in Removal history.* | `ux-states.md` §3.9 — names where it went, so it does not read as deletion |
| **`REMOVE_TITLE_UNDO_LABEL`** *(new, US-048)* | *Undo* | §3.9 — restores every removed listing, one call each |
| **`REMOVE_TITLE_UNDONE`** *(new, US-048)* | *Back on your list.* | §3.10 |
| **`REMOVE_TITLE_FAILED`** *(new, US-048)* | *Couldn't remove that. Nothing has changed.* | §3.12 — ⚠ **it must say nothing changed.** A bare *"couldn't remove that"* leaves the owner unsure whether the title is half-removed, and the safe-feeling answer to that doubt is to press it again |
| **`REMOVE_TITLE_NOT_ACTIVE`** *(new, US-048)* | *That title is already off your list.* | §3.11 — 409 `TITLE_NOT_ACTIVE`, rendered as a **status, not an error**: the asked-for state already holds |
| **`REMOVED_BY_OWNER`** *(new, US-048)* | *Removed by you* | §7.5 — the provenance chip when `removedBy === 'owner'`. A manual removal has no upload to explain it |
| **`ADD_TITLE_LABEL`** *(new, US-047)* | *Add title* | §2.15 — the button above the list, **not** a row-menu item |
| **`ADD_TITLE_HEADING`** *(new, US-047)* | *Add a title* | §3.13 |
| **`ADD_TITLE_SEARCH_LABEL`** *(new, US-047)* | *Search TMDB* | §10 — a real label, not placeholder text |
| **`ADD_TITLE_SERVICE_LABEL`** *(new, US-047)* | *Which service is it saved on?* | §3.13 — asks a factual question, because the badge is a factual claim |
| **`ADD_TITLE_SERVICE_REQUIRED`** *(new, US-047)* | *Pick the service it’s saved on.* | ⚠ **The picker has NO default.** A default writes a badge the owner never chose, and the next full-update of that service then proposes the title for removal. Same reasoning as `POST /api/batches` having no default mode (US-003 AC-5) |
| **`ADD_TITLE_DONE`** *(new, US-047)* | *Added. "{name}" is on your list.* | §3.14 |
| **`ADD_TITLE_DONE_BADGE_ONLY`** *(new, US-047)* | *"{name}" was already on your list — it now has a {service} badge too.* | §3.14 — the `titleWasCreated: false` case. *"Added to your list"* would be wrong: the row was already there and only the badge is new (REQ-005) |
| **`ADD_TITLE_DUPLICATE`** *(new, US-047)* | *That title is already on your list for that service.* | §3.15 — 409 `DUPLICATE_WORK_IDENTITY` |
| **`FRESHNESS_UNAVAILABLE`** *(new, approved by the owner 2026-09-16)* | *Last updated dates are unavailable right now.* | §2.1 item 1 — `T-FRESH-014` requires the strip to **degrade visibly** rather than vanish, but specified no wording. ⚠ **It is an admission about nextup, never a statement about the owner's list.** *"Never updated"* here would be the US-022 AC-3 misreading `T-FRESH-012` exists to prevent, and any *"update now"* phrasing would reintroduce the nudge `A46` deleted. REQ-039 shows the fact; it never nags |
| **`ROW_PENDING_LABEL`** *(new, approved by the owner 2026-09-16)* | *Saving…* | `ux-states.md` §2.13 — the inline spinner on a row whose write is in flight (`T-UX-021`). §2.13 specified the behaviour and no words, and **an unlabelled spinner is silent to a screen reader**. ⚠ **It names the row's STATE, not the action.** The row does not know which §2.3 menu action is in flight, so *"Removing…"* during a *Fix match* would be a confident, specific, wrong description of a write the owner cannot see |

**(R5) The three memory/decode messages themselves are deliberately NOT copy
constants.** `IMAGE_TOO_LARGE_TO_DECODE`, `IMAGE_DECODE_OOM` and
`IMAGE_DECODE_FAILED` messages are **built by the server** (`api.md` §5.2.4,
verbatim from ADR-0008 R2.3) because they interpolate the live values —
actual megapixels, actual dimensions, the **configured** container size and
the **configured** `NEXTUP_MAX_DECODE_PIXELS`. **A client-side copy of that
text would be a second source of truth that goes stale the moment the owner
up-sizes**, and would then state the wrong limit in the very error whose job
is to explain the limit. The client renders `error.message` verbatim
(§3.2a). `T-UI-013` asserts the rendered DOM contains the server string
unmodified, contains the word **"memory"** for the two memory codes, and
contains **neither** "memory" nor `MEMORY_REMEDY_PATH` for
`IMAGE_DECODE_FAILED`.

---

## 10. Responsive and accessible

### 10.1 Breakpoints (NFR-006, NFR-007)

| Width | Behaviour |
|---|---|
| **320 px (floor)** | Compact and Cover-browser Grid both use one card per row, with different artwork sizes and density (§2.1, owner-approved 2026-09-18). The list toolbar wraps within the viewport and the Filters and Sort dialogs render as bottom sheets that fit it. **No horizontal page scrolling**, no clipped genre names, and **no additional step to reverse the current order** — the dedicated reverse button keeps that at one tap with nothing open. `T-A11Y-001` covers every route and the 200-candidate review fixture. |
| | ~~*Superseded 2026-09-17:* "Single-column horizontal poster/details rows in both views. Filter disclosures and the six visible sort buttons wrap; panels fit the viewport." The no-horizontal-scrolling and no-additional-step-to-reverse rules were **not** superseded and are restated above.~~ |
| 640 px | Navigation returns to the header: **List, Upload, Batches, More**. Below this width the single bottom-fixed nav is **List, Upload, More**, with safe-area clearance. |
| **1024 px+** | Grid has three portrait-led card columns; Compact stays a single column and gains aligned comparison facts at 1200px. Controls remain above the list, not a left rail. Width is bounded by `--layout-max-width` (§13). **No function is available only on desktop** — `T-A11Y-002` runs the journey at 320 px. |

Touch targets: minimum **44×44 CSS px** for every interactive element
(`.tap-target` utility). `T-A11Y-003` asserts it across the review page.

### 10.2 Accessibility — SD-12 (provisional; OQ-014 remains open)

> **OQ-014 is open and does not state an accessibility target. Rather than
> invent a numeric one or ship nothing, this spec adopts WCAG 2.1 AA as a
> labelled provisional decision (SD-12).** If the owner sets a different bar,
> only this section changes.

| Requirement | Mechanism | Test |
|---|---|---|
| Landmarks | `<header>`, `<nav>`, `<main>`, `<footer>` once each per page | `T-A11Y-004` |
| Headings | One `<h1>` per page; no skipped levels | `T-A11Y-004` |
| Keyboard path | Every action reachable and operable by keyboard; a visible focus ring on every focusable element; a **"Skip to list"** link first in tab order | `T-A11Y-005` |
| Focus order | DOM order = visual order. Dialogs trap focus, restore it to the trigger on close, and close on `Escape` | `T-A11Y-006` |
| Contrast | ≥ 4.5:1 body text, ≥ 3:1 large text and UI boundaries | `T-A11Y-007` (`axe-core` `color-contrast`) |
| Non-colour meaning | Service badges, low-confidence and ticked-removal all carry text or an icon, never colour alone | `T-A11Y-008` |
| **Sort control** *(new, `A44`)* | `SortControl.tsx` is a real, labelled, keyboard-operable control (same treatment as every other control in this table — reachable via the standard keyboard path, focus ring, 44×44 px target) that renders on the combined list and toggles `dir` **and selects `sort` (`A48`)**. From 2026-09-17 the six orders live in a labelled chooser dialog opened from the toolbar, and **a dedicated reverse-order button on the toolbar keeps `dir` reversible in one tap with nothing open** (§2.1 item 2, §10.1) | **`T-UI-024`** |
| **Runtime filter** *(new, `A48`)* | The bucket control is a real labelled control on the same terms — standard keyboard path, focus ring, 44×44 px target — and **not a range slider**, which cannot meet any of the three. The hidden-unknowns disclosure is rendered in the same live region as the result count, so a screen-reader user is told the list shortened rather than discovering it by absence | **`T-UI-029`** |
| Live regions | Filter result count, review counters and toasts in `aria-live="polite"`; errors in `role="alert"` | `T-A11Y-009` |
| **Paste is never the only way in** *(A45)* | The **"Paste screenshot"** button is a real `<button>` in tab order with a 44×44 px target; the `paste` listener is a **shortcut, not a requirement**, and every image can also be attached with **"Choose files"** by keyboard alone. A clipboard result is announced in the `aria-live="polite"` region (*"Added 1 screenshot — 3 in this batch."*); a clipboard failure renders in `role="alert"`. Drag-and-drop is **never** the only route to any capability | `T-UI-014`, `T-A11Y-005` |
| Images | Posters `alt=""` (decorative); the TMDB logo `alt="TMDB"`; screenshot thumbnails `alt="Screenshot {n} of {total}"` | `T-A11Y-010` |
| Forms | Every input has a `<label>`; errors linked by `aria-describedby`; checkbox labels name the title | `T-A11Y-011` |
| Automated scan | `axe-core` via `@axe-core/playwright` on **every** route, in every state fixture — **zero `serious` or `critical` violations blocks the merge** | `T-A11Y-012` |

### 10.3 Performance posture (OQ-014 open — no invented targets)

No numeric latency target is stated anywhere in the record, so none is invented
here. What *is* specified is mechanism:

- The list route fetches one page (50 items) and renders progressively.
- Poster images are `loading="lazy"` with `width`/`height` set to avoid layout
  shift.
- **(REVISION 3; store R4)** The **cold start of 2–8 s** ~~(ADR-0003, `minReplicas=0`)~~
  **no longer occurs.** Constraint change A41/CC-002 relaxed `NFR-012`, and
  ADR-0003 Revision 2 set **`minReplicas = 1`**: the container is always
  warm. **R4: the store is Azure SQL Database Basic, which — like the
  PostgreSQL it replaced — does not auto-pause** (only the serverless
  *staging* database auto-pauses, and nobody judges staging's cold start).
  `RSK-023` is closed.
  **`components/SlowResponseNotice.tsx` is KEPT — only RENAMED.** It fires
  on any request outstanding for **> 1200 ms** and renders *"Still
  working…"* instead of an indefinite spinner (`specs/ux-states.md` §2.1).
  A phone on a weak mobile connection will still cross 1200 ms, and the
  honest-slowness affordance is worth more than the deleted code.
  **DECIDED (`TASK-143`, 2026-08-20): the rename and the copy change are
  both binding, not "consider".** With `minReplicas = 1` there is no cold
  start, so *"Waking things up…"* names a cause that cannot occur — it
  would send anyone debugging a genuinely slow request (weak mobile link,
  a slow TMDB call, a scan-based search) to look for a container that was
  never asleep. ⚠ **No code carried the old name at the time of the
  rename** — the component is unbuilt — so this is the spec's name for it
  and there is nothing to migrate. The 1200 ms figure remains an
  interface-affordance threshold, **not** a performance target, and does
  not pre-empt OQ-014.

  > ~~*Superseded 2026-08-20 (`TASK-143`): "**`components/ColdStartNotice.tsx`
  > is KEPT anyway, and its name is the only thing that is now slightly
  > wrong.** … renders *"Waking things up…"* … **Consider renaming it
  > `SlowResponseNotice` and softening the copy to "Still working…"** —
  > "Waking things up" is now a lie about the cause. Tracked in
  > `TASK-143`." `TASK-143` is the task that was tracking it, so leaving
  > it as "consider" would have closed the task without deciding the thing
  > it was opened to decide.*~~

---

## 11. What is deliberately NOT in the UI

| Absent | Why |
|---|---|
| Any per-row "delete" or "remove from service" button | Removal happens **only** through a confirmed full-update review group (REQ-020) or "not interested" (REQ-070). A direct delete would be a mutation outside REQ-041's closed enumeration. |
| Any settings screen with a retention or clean-up control | REQ-028 / data-model §9. There is nothing to configure and offering it would invite the defect. |
| A "sync now" or "refresh from service" button | There is no service integration and no scheduler (REQ-041, ASM-016). |
| ~~Runtime filter and sort~~ | ~~v1.1 (REQ-035, REQ-037). `runtimeMinutes` is displayed but not filterable.~~ **PROMOTED INTO SCOPE at `A48`** — runtime is now displayed (REQ-119), filterable (REQ-035) and sortable (REQ-037); see §2.1 item 2 and §2.2. ⚠ **The struck-through text was also factually wrong while it stood:** `runtimeMinutes` was fetched, stored, returned by `GET /api/titles` and declared on `TitleRow`'s props, but **never rendered** — the row's meta line was `Year · type · genres`. A spec that describes shipped behaviour incorrectly is worse than one that omits it, because it stops anyone from looking. |
| Date-added editing | v1.1 (REQ-059). The label is displayed, read-only. |
| Bulk restore in the removed view | Out of scope by the OQ-022 closure (data-model §11). |
| Analytics, cookie banners, consent dialogs | NFR-005 — nothing is collected. |

---

## 12. Data access (Epic N, ADR-0012)

⚠ **This section exists because the SPA had none.** Every screen was a stub
rendering hardcoded state — "Showing 0 of 0", "Nothing here yet" — against a
complete, working API. Every gate stayed green because every web test injects
props into a component and nothing asserted that anything ever fetched.

### 12.1 One client, one place

All API access goes through `apps/web/src/lib/apiClient.ts` (REQ-097). No
component calls `fetch` (`T-DATA-001`).

Every screen that displays owner data **issues a request** for it (REQ-096,
`T-DATA-002`). ⚠ **That assertion is the one that was missing**, and its
absence is why every gate was green on an app that fetched nothing: a test
that injects props proves a component renders what it is given, and says
nothing about whether anything ever gives it real data. `T-DATA-002` asserts
against a mocked client that mounting each data screen calls it.

Every request carries **`credentials: 'same-origin'`** — Easy Auth is
cookie-based and the SPA and API share one origin (ADR-0003 / ADR-0012 D-4) —
and `T-DATA-003` asserts it on every method the client exposes, not on one
sample call. Omitting it returns 401 on every call, which by §12.3 becomes a
redirect loop rather than a visible error.

### 12.2 Four states, and only four

```ts
type Resource<T> =
  | { kind: 'loading' }
  | { kind: 'ok'; value: T }
  | { kind: 'refused' }
  | { kind: 'failed' };
```

Every screen renders all four. `isLoading` + `error` + `data` admits states
that cannot be rendered sensibly and pushes the decision into each component,
differently each time.

⚠ **`refused` and `failed` are different facts** — *"nextup will not show you
this"* versus *"nextup could not reach the server"*. Merging them offers a
retry that can never succeed.

### 12.3 401 and 403 are not the same thing

| Status | Behaviour | Test |
|---|---|---|
| **401** | Redirect to `/.auth/login/aad?post_login_redirect_uri=<current path>` | `T-DATA-004` |
| **403** | Render the refusal screen | `T-DATA-005` |

⚠ **A 401 SHOWN AS AN ERROR IS THE FAILURE THIS ROW PREVENTS.** Easy Auth
sessions expire on a timer. Rendered as a generic failure, a correctly
signed-in owner is told their list could not be loaded and offered a retry that
fails identically forever, with nothing pointing at the actual remedy.

The redirect preserves the path, so a deep link survives expiry (US-001 AC-2).

### 12.4 Retry is always the owner's decision

No automatic retry, no backoff loop, anywhere (REQ-100, `T-DATA-006`).
Production is **one replica at 0.25 vCPU** — automatic retries turn a
struggling container into a harder-hit one. `LIST_LOAD_FAILED_BODY` carries the
honest half (*"Nothing has changed."*); `RETRY_LABEL` is the affordance.

### 12.5 The query string is the request

The request's filters, submitted title search (`q`) and sort come from
`useSearchParams`; route-owned keyset paging is reset when that base query
changes (REQ-101, `T-DATA-007`). No component-state mirror may override the
request. The search form may hold **unsubmitted input** and disclosures/local
Grid/Compact may hold presentation state; neither filters title data. URL
navigation refreshes the submitted query and displayed search value.

### 12.6 Mutations only from event handlers

Never from a render effect (REQ-102, `T-DATA-008`).

⚠ **React 19 StrictMode double-invokes effects in development** and `main.tsx`
mounts inside `<StrictMode>`. A `POST` in a mount effect fires **twice** —
two batches, two extraction runs — and is invisible in production builds, so it
surfaces first in the owner's real data.

### 12.7 Polling — narrow, and not a background process

`/batches/:batchId` may poll only while submitted/extracting (REQ-103). It
pauses offline or hidden, stops at every other status and on a failed read,
and aborts on unmount (`T-DATA-009`, `T-UX-165`). Changing batch ID starts a
fresh keyed lifetime; no old state or late response may redirect the new page.
Leaving during a write does not cancel that write, but its response must not
redirect the owner afterward.

⚠ **This does not engage REQ-041.** That invariant forbids a *non-owner*
process changing *user-visible list state*. This is the owner's own browser,
looking at the screen, issuing a **read** of a status endpoint. `T-MUT-001f`
counts **server-side** processes and is unaffected.

The `document.hidden` stop is not politeness: without it a forgotten tab polls
a single-replica container indefinitely, which is a background process by
behaviour whatever the intent.

### 12.8 Server error text is rendered verbatim

The envelope's `message` is the string shown (REQ-104, `T-DATA-010`). A
client-side table keyed on error code is a second source of truth that keeps
displaying yesterday's limit after the owner up-sizes memory — in the very
message whose job is to state the limit (§3.2a, `T-UI-013`).

---

## 13. Design tokens and the stylesheet (Epic O, ADR-0004 Rev 2)

⚠ **This section exists because the project had no CSS at all** — no
stylesheet, no import in `main.tsx`, and no Tailwind, while 43 `className`
attributes across the components already used a consistent semantic vocabulary.
ADR-0004 Revision 2 keeps that vocabulary and drops Tailwind.

### 13.1 ⚠ THE CORRESPONDENCE IS FIXED — THE VOCABULARY IS NOT

> ⚠ **THIS HEADING USED TO READ *"The vocabulary is already fixed — do not
> invent a second one"*, AND THAT SENTENCE IS WHY THE APPLICATION SHIPPED
> LOOKING UNSTYLED.** Read together with `T-CSS-001`'s both-directions rule —
> *every class used is defined, **and every rule defined is used*** — it was
> taken to mean that **no CSS rule may exist for a selector no component
> already carries**. So every unclassed element (`<nav>`, `<ul>`, `<li>`,
> `<fieldset>`, `<input type="checkbox">`) was left to render at browser
> defaults **permanently**, and `AppShell.tsx`'s primary navigation — which
> has no `className` at all — became a vertical stack of blue underlined
> links. The owner opened it and reported the app as broken. Nothing had
> failed.
>
> ⚠ **`T-CSS-001` WAS NEVER THE BLOCKER — THE PROSE WAS.** The test inspects
> **class names only**, so an element selector such as `nav ul { … }` would
> have passed at every point in this project's history. An agent that read the
> old heading and declined to add a class had understood the sentence
> correctly and shipped the defect anyway.

**The rule, stated correctly:** the class vocabulary **may grow**. What may not
drift is the **correspondence** — a class used by a component must be defined
in the stylesheet, and a rule in the stylesheet must be used by a component
(`T-CSS-001`, both directions). Adding a class **and** its rule in the same
change satisfies both. Renaming one side without the other still breaks the
build rather than the page, which is the property worth keeping.

⚠ **Do not invent a SECOND vocabulary** — a parallel naming scheme alongside
the one below is what the old heading was reaching for, and that prohibition
stands. Extending the existing scheme is not that.

~~Superseded, and corrected in place rather than banner-superseded because this
section is an instruction a builder executes (the F-001 rule): "**13.1 The
vocabulary is already fixed — do not invent a second one.** Components ship
these names. The stylesheet defines them; it does not rename them
(`T-CSS-001`)."~~

Components ship the names below, and **Epic P adds more** (`docs/backlog.md`
§5P, `specs/ui-refresh.md` §7b–§7d): navigation, the review sections, the sort
control, the icon set and the component primitives all need classes that do
not exist yet. **Add them with their rules.**

⚠ **`T-CSS-002` asserts `main.tsx` imports the stylesheet.** Without it every
other assertion in this section passes on a document that renders unstyled —
the same vacuous-green failure mode as §12.1's `T-DATA-002`, and the one that
put the owner in front of an unstyled page. A stylesheet that exists but is
never imported is indistinguishable from no stylesheet at build time, and Vite
will not warn.

`app-shell`, `app-shell__logo`, `dropzone`, `dropzone__target`,
`dropzone__choose`, `dropzone__paste`, `filter-bar`, `freshness-strip`,
`freshness-strip__chip`, `freshness-strip__notice`, `refusal`,
`refusal__account`, `tap-target`, `title-list`, `title-row`, `title-row__name`,
`title-row__poster`, `title-row__badges`, `title-row__body`, `title-row__chip`,
`title-row__date`, `title-row__meta`, `title-row__menu`, `title-row__action`,
`title-row__actions`, `title-row__rating`, `title-row__rating-source`,
`tmdb-attribution`, `tmdb-attribution__disclaimer`, `tmdb-attribution__logo`.

Modifiers use the `--` suffix already in use: `title-row__poster--empty`,
`title-row__rating--absent`.

### 13.2 Tokens — declared once, in `:root`

| Token | Value | Why it is a token |
|---|---|---|
| `--bp-sm` | `640px` | §10.1. Named so a breakpoint cannot be typed twice with different values |
| `--bp-md` | `768px` | Intermediate responsive token; the list grid activates at `--bp-lg` (`T-UX-110`, `T-UX-111`) |
| `--bp-lg` | `1024px` | §10.1 |
| `--layout-max-width` | `96rem` | Bounded catalog and desktop sidebar; responsive two/three/five-column Grid and aligned Compact facts |
| `--tap-target-min` | `44px` | NFR-006. **The one definition**; `.tap-target` is its only consumer |
| `--color-text` | `#f2efff` | **14.97:1** on `--color-surface` |
| `--color-text-muted` | `#bcb4d2` | **8.54:1** on `--color-surface` |
| `--color-bg` | `#121020` | Dark ink background |
| `--color-surface` | `#1e1932` | Dark indigo surface; also the foreground on primary accent-filled buttons |
| `--color-surface-raised` | `#262039` | Subtle card-gradient endpoint |
| `--color-catalog` | `#111526` | Owner mockup's navy content and section surfaces |
| `--color-catalog-raised` | `#1a2036` | Navy cards and capture/action summaries; contrast checked with semantic text and interactive borders |
| `--font-display` | `Georgia, Cambria, 'Times New Roman', serif` | Local serif page/step headings; body and controls keep the existing system sans-serif stack |
| `--color-secondary` | `#adc5f7` | Secondary metadata, never a provider brand |
| `--color-rating` | `#e8c88f` | IMDb scores, not recommendations |
| `--color-success` | `#7adcb0` | Watching text, independently of priority |
| `--color-border` | `#77678f` | **3.32:1** on surface; interactive boundaries, not a soft decorative divider |
| `--color-accent` | `#b3a0ff` | **7.57:1** on surface, also for **surface-coloured text on accent fill**. White/light foreground on the primary button is not the approved pair |
| `--color-danger` | `#ff9ba8` | **8.47:1** on surface. Destructive confirmation only |
| `--space-1` … `--space-6` | `4px` `8px` `12px` `16px` `24px` `32px` | A closed scale |
| `--radius` / `--radius-card` | `10px` / `16px` | Controls / cards |
| `--font-stack` | `'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif` | System stack only: no web font, dependency or third-party font request |
| `--text-xs` … `--text-2xl` *(Epic P)* | `0.75rem` `0.875rem` `1rem` `1.125rem` `1.5rem` `2rem` | REQ-123, matching `ui-refresh.md` §7b. `rem`, never `px`; primary content never below `--text-sm` (`T-CSS-007`) |
| `--leading-tight` / `--leading-normal` *(Epic P)* | `1.2` / `1.55` | Unitless, matching §7b's heading/body rhythm |
| `--weight-normal` / `--weight-medium` / `--weight-bold` *(Epic P)* | `400` / `600` / `700` | Closed set from `ui-refresh.md` §7b |

⚠ **EVERY RATIO ABOVE WAS COMPUTED, AND FOUR DRAFTED VALUES WERE WRONG.** The
first draft of this table asserted `#d1d5db` was "≥ 3:1" when it is **1.47:1**,
and claimed `#6b7280` **failed** at "4.28:1" when it actually **passes** at
4.83:1 — a wrong number in each direction, both plausible enough to survive
review. Non-text contrast is the trap: a border can look obviously visible and
still be less than half the required ratio.

⚠ **`T-CSS-004` computes the WCAG ratio for every token pair from the token
values themselves** and fails below 4.5:1 for text and 3:1 for boundaries. A
token file is exactly where a "slightly nicer" grey gets substituted, and
`axe-core` only catches it on a page that happens to render that pair — it
never checks a token that is momentarily unused.

### 13.3 Mobile-first, default dark indigo design

Base rules are the 320 px layout; `min-width` media queries add the wider ones.
Writing it desktop-first means the **floor** — the width NFR-006 actually
mandates and `T-A11Y-001` actually tests — is the case reached by subtraction.

The owner approved this default dark palette on **2026-09-16**
(ADR-0013 Revision 1); it replaces the earlier light-only instructions.
There is no theme toggle or second light palette. Validate each actual
foreground/background pair, including dark foreground on accent fill.
`prefers-reduced-motion: reduce` **is** honoured (`T-CSS-005`) because it is
one rule and an accessibility obligation, not a preference.

### 13.3a The visual direction is ADR-0013's, and it is the owner's

⚠ **Read `docs/adr/ADR-0013-ui-refresh.md` before writing any visual `must`.**
The tokens in §13.2 are the vocabulary; ADR-0013 is the *taste*, and it was
chosen by the owner: **dark indigo/violet**, portrait-led Grid and aligned
Compact cards (composition refined by the owner on 2026-09-18, §2.1),
explicit Grid/Compact preference, complete-order buttons, removable filters,
submitted search and compact navigation. The no-Tailwind and no-web-font
decisions remain unchanged.

Epic P (`docs/backlog.md` §5P, `specs/ui-refresh.md` §7b–§7d) adds three things
this section did not previously have, each with its own requirement:

| | Where | Requirement |
|---|---|---|
| **A typographic scale** | §13.2's `--text-*`, `--leading-*`, `--weight-*` | **REQ-123** — on the system stack, no web font (`A53`, OQ-8) |
| **An icon set** | `apps/web/src/components/icons/`, a **closed set of 16 inline SVGs**, including BrandIcon/GridIcon/CompactIcon | **REQ-124** — no library, no dependency. `stroke="currentColor"` and **no hard-coded colour**, so an icon inherits a token `T-CSS-004` has already proved |
| **Component primitives** | `apps/web/src/components/ui/` | **REQ-125** — every interactive control comes from a primitive; a surviving bare `<button>` or `<fieldset>` is the native-widget look the owner reported |

⚠ **`T-CSS-001c` FORBIDS A COMPUTED `className`, AND THAT SHAPES THE
PRIMITIVES.** A variant must resolve through a **static lookup from a literal
map** — `STYLES[variant]` — never a template literal. A class assembled at
runtime is invisible to `T-CSS-001`'s both-directions check, which is precisely
how an unstyled element gets past the gate that exists to catch it.
`specs/ui-refresh.md` §7d widens the rule to permit that one form and no other.

### 13.4 What the stylesheet may not do

| Not allowed | Why |
|---|---|
| A web font, an icon font, or any external `@import` | A third-party request per page load. NFR-005 and `T-CI-007`'s egress rule. ⚠ **Reaffirmed by the owner at `A53`** — Epic P's icons are **inline SVG components**, which is not an icon font and is explicitly allowed |
| `!important` outside a `prefers-reduced-motion` reset | It is how a token gets bypassed rather than changed |
| Styling on a `data-testid` | Couples the test contract to presentation, so a visual tidy-up silently breaks tests |
| A hard-coded colour or breakpoint outside `:root` | Defeats §13.2. `T-CSS-003` greps for hex literals and `px` breakpoints in rule bodies |
| Hiding content with `display: none` where §10.2 needs it announced | Removes it from the accessibility tree; use a visually-hidden pattern |
