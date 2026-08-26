---
createdAt: 2026-08-10T20:12:02-04:00
createdBy: spec-writer
phase: 8
status: complete
sourceOfTruth: artifacts/PRD.md §9, artifacts/architecture.md
---

# specs/ui.md — nextup screens

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
under `apps/web/src/`. Routing: `react-router-dom`, `BrowserRouter`.

---

## 1. Screen index

| Route | Component file | Purpose | Optimises for |
|---|---|---|---|
| `/` | `pages/ListPage.tsx` | The combined list — **the value loop** | Seeing everything you can watch, fast |
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

---

## 2. `/` — Combined list (US-018, US-019, US-020, US-022)

**Purpose.** One list of everything the owner has saved across Netflix and Max.
**Entry points.** Sign-in landing; the logo; after closing a batch; after any
restore, suppress, un-suppress or fix-match.
**Primary action.** Read. Secondary: filter, sort, open a row's menu.
**Navigation out.** `/upload`, `/removed`, `/not-interested`, `/batches`.

### 2.1 Information hierarchy (top → bottom)

1. **Freshness strip** — one chip per service from `GET /api/service-state`
   (`components/FreshnessStrip.tsx`): *"Netflix updated today"*,
   *"Max updated 47 days ago"*, *"Max has never been
   updated"*. Clicking/tapping the strip navigates to `/upload`
   pre-selecting that service (REQ-039, US-022) — this is unconditional
   navigation, not a nudge. The strip is
   informational; it never blocks the list. *(A46: the staleness marker, the
   stale chip and its conditional "Update now" link are dropped entirely — no
   staleness threshold, no nag, no derived "stale" state. REQ-040 and ASM-038
   are retired.)*
2. **Filter bar** (`components/FilterBar.tsx`) — service, type, genre; a
   **"Clear filters"** control; a live result count *"Showing 42 of 187"*
   (US-019 AC-5); and, co-located in the **same row**, the **sort/direction
   control** (`components/SortControl.tsx` — US-020 AC-6, REQ-038, `api.md`
   §6.2). A two-state toggle: **"Newest first"** (default, `dir=desc`) and
   **"Oldest first"** (`dir=asc`). The label names *nextup*'s own date-added,
   never the streaming service's save date — per REQ-061 it must not read
   "date saved" or imply the Netflix/Max date, only when the title entered
   *nextup*. Selecting a direction updates `dir` in the query string
   (`?service=netflix&type=movie&genre=Drama&sort=dateAdded&dir=asc`), so it
   is deep-linkable, survives back/forward, and — per US-020 AC-6 —
   **persists for the session** even if the owner navigates away and back
   without a page reload (held in the same client-side view state as the
   filters, not re-derived from the URL alone). **320 px consequence:** the
   sort control does **not** add a second line at the floor width — it
   collapses into the same **"Filters (2)"** button/sheet as the rest of the
   filter bar (§10.1), appearing inside that sheet as its own labelled
   two-option row, so item 3's hard constraint below still holds exactly as
   stated.
3. **The list** (`components/TitleList.tsx`) — the dominant element. Nothing is
   allowed above it that pushes the first row below the fold at 320 px except
   the freshness strip and the filter bar (sort control included, per item 2
   above), both single-line at that width.
4. **Load-more sentinel** — cursor pagination (`specs/api.md` §3), an
   IntersectionObserver auto-loading the next page, plus an explicit
   **"Load more"** button as the keyboard/no-JS-observer path.

### 2.2 The row (`components/TitleRow.tsx`)

| Element | Source | Rule |
|---|---|---|
| Poster | `posterPath` → `https://image.tmdb.org/t/p/w154{path}` | `alt=""` (decorative; the name is adjacent text). A missing poster renders a neutral placeholder tile, never a broken image. |
| Name | `name` | The only element with heading weight in the row |
| Year · type · genres | `releaseYear`, `mediaType`, `genres` | Genres render as plain text; `genres: []` renders **nothing at all**, never "Unknown" (US-019 AC-6) |
| **Service badges** | `badges[]` | One badge per **active** listing (REQ-026). Badges are text-labelled (`Netflix`, `Max`), not colour-only — colour is never the sole carrier of meaning |
| Date-added label | `dateAddedLabel` | Rendered **verbatim from the API** (`specs/api.md` §6.2). REQ-061: it always contains "to nextup". The component **must not** construct this string. |
| Row menu | — | `⋮` button → **Not interested** (US-027), **Fix match** (US-030). 44×44 px hit area. |

A row for an **unmatched** title (`matchState === 'unmatched'`) shows the raw
extracted text as its name, an **"Unidentified"** chip, and a **"Find a
match"** action opening the fix-match dialog (US-008 AC-5).

### 2.3 Row menu dialogs

- **Not interested** (`components/SuppressDialog.tsx`) — states plainly:
  *"'Dune' will be hidden from your list and won't come back on future
  uploads, even if it's still saved on Netflix or Max. You can undo this from
  'Not interested'."* (US-027 AC-2/AC-3/AC-5). Confirm → `POST .../suppress`.
- **Fix match** (`components/FixMatchDialog.tsx`) — a TMDB search box
  (`GET /api/tmdb/search`, debounced 300 ms), results as poster + name + year +
  type. Selecting one shows a confirmation naming what is preserved:
  *"Your Netflix badge and the date you added it (2 Apr 2026) stay the same."*
  (US-030 AC-2/AC-3). Handles the three 409s from `specs/api.md` §6.5 inline
  (`specs/ux-states.md` §3.5).

---

## 3. `/upload` — Create a batch (US-003, US-004)

**Primary action.** Choose service and mode, attach screenshots, submit.

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

Polls `GET /api/batches/:batchId` every 2 s while `submitted`/`extracting`.
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

  ▸ New to your list (9)                       [Confirm all 9]
      … candidate cards, expanded by default …

  ▸ Couldn't identify these (2)
      … unmatched cards with a "Find a match" search …

  ▾ Already on your list (54)          ← FULL UPDATE ONLY, collapsed, NEVER omitted
      … read-only cards …

  ▾ Probably not titles (25)                   collapsed
      … cards with a "This is a title" rescue …

  ▸ No longer on Netflix (3)                   ← FULL UPDATE ONLY
      … removal cards, ALL TICKED …

┌ Sticky action bar ────────────────────────────────────────┐
│ 9 to add · 3 to remove · 2 still to review                 │
│                        [Apply changes]                    │
└───────────────────────────────────────────────────────────┘
```

### 5.2 The rules this screen must not break

| Rule | Implementation |
|---|---|
| Full update shows **all** extracted titles (REQ-057) | The **"Already on your list (N)"** section is rendered whenever `mode === 'full-update'`. It is **collapsible but never omitted**, and its **count is visible while collapsed** so the owner can sanity-check it against what they expect. `T-REV-006`, `T-UI-005`. |
| Append-only shows only new (REQ-022) | The section, and the entire removals section, are **absent from the DOM**. `T-UI-006`. |
| Removals ticked by default (REQ-055) | Every removal checkbox is `checked` on first render. `T-UI-007`. |
| Removals individually rescuable (REQ-021) | Each removal card has its own checkbox with a label naming the title. |
| Removals confirmed as one group (REQ-020) | **"Apply changes"** opens `components/RemovalConfirmDialog.tsx` naming the count and listing every ticked title, with one confirm. There is no per-row "remove" button anywhere. `T-UI-008`. |
| No accept-by-inaction (REQ-014) | **"Apply changes"** is enabled but produces the `PENDING_ADDITIONS` inline error when anything is still pending, scrolling to and focusing the first pending card. Never a silent skip. |

### 5.3 Candidate card (`components/CandidateCard.tsx`)

Poster, matched name + year + type, **the raw extracted text always visible in
small type** (so the owner can see what was read), the source-screenshot
thumbnail, and three controls: **Confirm** / **Change match** / **Discard**.
"Change match" expands the top-5 alternatives inline — they are never hidden
behind a search (US-007 AC-4) — with a search box beneath for anything else.

Flags rendered as chips: **"Low confidence"** (`verdict === 'low-confidence'`),
**"Uncertain match"** (`match.uncertain`), **"Could be more than one work"**
(`match.ambiguous`).

#### 5.3a Revision-2 verdicts (ADR-0001 Revision 2)

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
| SD-11e | **Dispositions are optimistic and locally persisted** (TanStack Query cache + `sessionStorage` under `nextup.review.<batchId>`), so an accidental refresh mid-review does not lose an hour of work. The server is the source of truth on reload. |

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
| `SUPPRESS_CONFIRM_BODY` | *"{name}" will be hidden from your list and won't come back on future uploads, even if it's still saved on Netflix or Max. You can undo this from "Not interested".* | US-027 AC-2/AC-3 |
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
| **`SORT_NEWEST_LABEL`** *(new, `A44`)* | *Newest first* | §2.1 item 2 — the default (`dir=desc`); REQ-061 honest wording, never "date saved" |
| **`SORT_OLDEST_LABEL`** *(new, `A44`)* | *Oldest first* | §2.1 item 2 — `dir=asc`, the accepted mitigation for SUC-003 (old saves surfacing) |
| **`IMDB_RATING_SOURCE`** *(new, Epic M)* | *IMDb* | §7a — labels the number on the row. The rating is **display-only** (REQ-095): it never sorts or filters |
| **`IMDB_RATING_ABSENT`** *(new, Epic M)* | *No IMDb rating* | REQ-091 — ⚠ **a rendered state, not an omission.** May be reworded; may **not** become blank, `0`, `0.0` or an empty star row. Without it, "this work has no rating" and "nextup failed to fetch one" look identical |
| **`IMDB_LOOKUP_TITLE`** *(new, Epic M)* | *Check a rating* | §7a — the `/rating` screen (US-045) |
| **`IMDB_LOOKUP_BODY`** *(new, Epic M)* | *Look up any film or series to see its IMDb rating. Nothing is added to your list.* | US-045 — **the second sentence is load-bearing.** A search box inside a list-building product otherwise reads as "add to list", and the route writes nothing (`T-IMDB-006h`) |
| **`IMDB_LOOKUP_INPUT_LABEL`** *(new, Epic M)* | *Film or series name* | §10 — a real label, not placeholder text |
| **`IMDB_LOOKUP_SUBMIT_LABEL`** *(new, Epic M)* | *Look it up* | §7a |
| **`IMDB_LOOKUP_NOT_FOUND`** *(new, Epic M)* | *Couldn't find that title.* | US-045 AC-3 — ⚠ **distinct from `IMDB_RATING_ABSENT`.** "No such title" and "found, but unrated" are different answers; conflating them tells the owner a film exists when it does not |
| **`IMDB_LOOKUP_FAILED`** *(new, Epic M)* | *Couldn't run that lookup. Nothing has changed.* | Mirrors `LIST_LOAD_FAILED_BODY` — same reassurance, same reason |
| **`IMDB_LOOKUP_IN_LIST`** *(new, Epic M)* | *Already on your list.* | US-045 AC-4 — matched on canonical `workIdentity`, never on the typed string |
| **`LIST_LOADING_BODY`** *(new, Epic N)* | *Loading your list…* | §12.2 — ⚠ **an empty list and a not-yet-loaded list are indistinguishable from the rows alone.** Without a distinct loading state, `listEmptyKind()` sees zero rows and no filters on every page load and renders *"Nothing here yet"* to an owner whose list is full — a data-loss misreading US-019 AC-5 exists to prevent. `T-DATA-002c` |

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
| **320 px (floor)** | Single column. Filter bar collapses into a **"Filters (2)"** button opening a full-screen sheet. Title rows stack: poster left, text right, badges wrapping beneath. **No horizontal scrolling anywhere**, on any screen, in any state. `T-A11Y-001` (Playwright at 320×640: `document.documentElement.scrollWidth <= clientWidth` on **every** route, and on the review page with a 200-candidate fixture). |
| 640 px | Two-line rows; filter bar inline. |
| **1024 px+** | Filter bar as a persistent left rail; list in a max-width column (`--layout-max-width`, §13) so lines stay readable. **No function is available only at ≥1024 px** — `T-A11Y-002` runs the full e2e journey at 320 px. ~~`max-w-4xl`~~ *(R2: a Tailwind utility name, and Tailwind is not used — ADR-0004 Rev 2. The token replaces it.)* |

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
| **Sort control** *(new, `A44`)* | `SortControl.tsx` is a real, labelled, keyboard-operable control (same treatment as every other control in this table — reachable via the standard keyboard path, focus ring, 44×44 px target) that renders on the combined list and toggles `dir` | **`T-UI-024`** |
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
| Runtime filter and sort | v1.1 (REQ-035, REQ-037). `runtimeMinutes` is displayed but not filterable. |
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

Filters, sort and pagination are read from `useSearchParams` and nothing
mirrors them into component state (REQ-101, `T-DATA-007`). A mirrored copy
desynchronises on the back button, a shared link and reload — silently, showing
a list that contradicts its own visible controls.

### 12.6 Mutations only from event handlers

Never from a render effect (REQ-102, `T-DATA-008`).

⚠ **React 19 StrictMode double-invokes effects in development** and `main.tsx`
mounts inside `<StrictMode>`. A `POST` in a mount effect fires **twice** —
two batches, two extraction runs — and is invisible in production builds, so it
surfaces first in the owner's real data.

### 12.7 Polling — narrow, and not a background process

`/batches/:batchId` may poll while a batch is running (REQ-103). It stops on a
terminal state, on unmount, and while `document.hidden` (`T-DATA-009`).

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

### 13.1 The vocabulary is already fixed — do not invent a second one

Components ship these names. The stylesheet defines them; it does not rename
them (`T-CSS-001`).

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
| `--bp-lg` | `1024px` | §10.1 |
| `--layout-max-width` | `56rem` | §10.1's readable column. Replaces the stray `max-w-4xl` |
| `--tap-target-min` | `44px` | NFR-006. **The one definition**; `.tap-target` is its only consumer |
| `--color-text` | `#111827` | 17.7:1 on `--color-surface`, 17.0:1 on `--color-bg` |
| `--color-text-muted` | `#4b5563` | 7.6:1 / 7.2:1. Comfortably over the 4.5:1 floor even on the tinted background |
| `--color-bg` | `#f9fafb` | |
| `--color-surface` | `#ffffff` | |
| `--color-border` | `#878d99` | ⚠ **3.3:1 / 3.2:1 — chosen by calculation, not by eye.** §10.2 requires ≥ 3:1 for UI boundaries, and the conventional light-grey border (`#d1d5db`) is **1.47:1** — it fails by a factor of two while looking entirely normal |
| `--color-accent` | `#1d4ed8` | Links and primary actions; 6.7:1 on white |
| `--color-danger` | `#b91c1c` | 6.5:1 on white. Destructive confirmation only |
| `--space-1` … `--space-6` | `4px` `8px` `12px` `16px` `24px` `32px` | A closed scale |
| `--radius` | `6px` | |
| `--font-stack` | system UI stack | No web font: no third-party request (NFR-005), no layout shift |

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

### 13.3 Mobile-first, and no dark mode in v1

Base rules are the 320 px layout; `min-width` media queries add the wider ones.
Writing it desktop-first means the **floor** — the width NFR-006 actually
mandates and `T-A11Y-001` actually tests — is the case reached by subtraction.

No dark mode: it doubles every contrast obligation in §13.2 for a
single-owner app that never asked for it. `prefers-reduced-motion: reduce`
**is** honoured (`T-CSS-005`) because it is one rule and an accessibility
obligation, not a preference.

### 13.4 What the stylesheet may not do

| Not allowed | Why |
|---|---|
| A web font, an icon font, or any external `@import` | A third-party request per page load. NFR-005 and `T-CI-007`'s egress rule |
| `!important` outside a `prefers-reduced-motion` reset | It is how a token gets bypassed rather than changed |
| Styling on a `data-testid` | Couples the test contract to presentation, so a visual tidy-up silently breaks tests |
| A hard-coded colour or breakpoint outside `:root` | Defeats §13.2. `T-CSS-003` greps for hex literals and `px` breakpoints in rule bodies |
| Hiding content with `display: none` where §10.2 needs it announced | Removes it from the accessibility tree; use a visually-hidden pattern |
