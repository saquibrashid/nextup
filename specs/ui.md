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
| `*` | `pages/NotFoundPage.tsx` | Unknown route | Getting back to `/` |

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
Safari file input can deliver (camera photos default to HEIC, screenshots are
PNG, "Most Compatible" photos are JPEG). **The client must not reject HEIC/HEIF
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
(Playwright: the disclaimer text is visible on all nine routes without
interaction), `T-ATTR-003` (the logo image renders with a non-zero bounding box
on all nine routes).

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
| **320 px (floor)** | Single column. Filter bar collapses into a **"Filters (2)"** button opening a full-screen sheet. Title rows stack: poster left, text right, badges wrapping beneath. **No horizontal scrolling anywhere**, on any screen, in any state. `T-A11Y-001` (Playwright at 320×640: `document.documentElement.scrollWidth <= clientWidth` on all nine routes, and on the review page with a 200-candidate fixture). |
| 640 px | Two-line rows; filter bar inline. |
| **1024 px+** | Filter bar as a persistent left rail; list in a max-width column (`max-w-4xl`) so lines stay readable. **No function is available only at ≥1024 px** — `T-A11Y-002` runs the full e2e journey at 320 px. |

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
| Automated scan | `axe-core` via `@axe-core/playwright` on all nine routes, in every state fixture — **zero `serious` or `critical` violations blocks the merge** | `T-A11Y-012` |

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
  **`components/ColdStartNotice.tsx` is KEPT anyway, and its name is
  the only thing that is now slightly wrong.** It fires on any request
  outstanding for **> 1200 ms** and renders *"Waking things up…"* instead
  of an indefinite spinner (`specs/ux-states.md` §2.1). A phone on a weak
  mobile connection will still cross 1200 ms, and the honest-slowness
  affordance is worth more than the deleted code. **Consider renaming it
  `SlowResponseNotice` and softening the copy to "Still working…"** —
  "Waking things up" is now a lie about the cause. Tracked in `TASK-143`.
  The 1200 ms figure remains an interface-affordance threshold, **not** a
  performance target, and does not pre-empt OQ-014.

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
