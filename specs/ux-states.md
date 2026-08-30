---
createdAt: 2026-08-10T20:12:02-04:00
createdBy: spec-writer
phase: 8
status: complete
sourceOfTruth: docs/PRD.md §9, specs/ui.md, specs/api.md
---

# specs/ux-states.md — nextup

> ⚠ **REVISION (2026-08-11, `A45`) — the clipboard-paste states.**
> Paste is now the owner's **primary** way to get a screenshot in; **file
> upload remains fully supported** (ADD, not SWAP). New states **4.0a**,
> **4.12**–**4.18** cover paste success, the three clipboard failure
> classes, the **silently-abandoned promise** (which must re-offer, never
> hang), the **no-clipboard-API / non-HTTPS** case (button not rendered at
> all), drag-over, and ceiling/guard rejections of pasted images.
> **§4.3's dropzone copy is corrected IN PLACE** — it had named the formats
> correctly but implied upload was the only way in. §4.6a/§4.6b (A43) are
> untouched. Platform facts:
> `Context/evidence/clipboard-paste-support.md`.

Every surface, every state. **A state that is not listed here is a defect.**
PRD §9.2 requires each surface to define: initial/loading, empty, partial,
populated, error (per class), offline, submitting, success.

Each state below names: **what the owner sees**, **what they can do**, and the
**test id**.

---

## 1. Global rules

| Rule | Detail |
|---|---|
| **Never an indefinite spinner** | Any pending request that passes 1200 ms swaps the spinner for `SlowResponseNotice` — *"Still working…"* (renamed from `ColdStartNotice` / *"Waking things up…"* by `TASK-143`: `minReplicas = 1` means there is no cold start, so the old copy named a cause that cannot occur). Past 15 s it becomes the `slow` error state with a **Retry**. `T-UX-001`. |
| **Never a silent failure** | Every non-2xx response renders a visible message derived from `error.message`, plus the remedy from `error.details` when present. `T-UX-002` asserts no fetch rejection path ends without a rendered message. |
| **Never a blank page** | A 200 of the wrong SHAPE throws during render, and React unmounts the whole tree — the owner is left on a white page with no message, no nav and nothing to retry. An `ErrorBoundary` around the routed screen (NOT around the shell, so every other route stays one tap away) renders `BOUNDARY_TITLE` + `BOUNDARY_BODY` in a `role="alert"`, with **Try again**. It resets on navigation. `T-BOUND-001`. ⚠ This rule is separate from "never a silent failure" because that one is written about RESPONSE STATUS, and this failure arrives as a 200. It shipped three times — `/batches/:id`, the review route, and again during the all-routes a11y sweep — with `T-A11Y-001c` and `expectStyledAndRendered` green throughout, because `role="main"` exists for the instant before the throw propagates. |
| **Errors say what was NOT changed** | Every 4xx/5xx surface states, explicitly, that nothing was written when nothing was written. This is the ASM-029 defence: the owner must never have to guess whether a failed action half-applied. |
| **Offline** | `navigator.onLine === false` renders a persistent banner: *"You're offline. nextup needs a connection."* Mutating controls are disabled with that reason as visible text. Cached list data stays on screen, marked *"Showing what was loaded earlier."* `T-UX-003`. |
| **Success is confirmed in words, with counts** | Never a bare toast: *"Added 9, removed 3."* |
| **Focus after a state change** | On success, focus moves to the success region (`role="status"`). On error, to the error region (`role="alert"`). `T-A11Y-006`. |

---

## 2. `/` — Combined list

| State | Owner sees | Can do | Test |
|---|---|---|---|
| **2.1 Loading (initial)** | Freshness strip and filter bar as skeletons; 6 row skeletons. Past 1200 ms, the cold-start notice. | Nothing yet; nav is live | `T-UX-010` |
| **2.2 Loading (next page)** | Existing rows stay; a spinner row at the sentinel | Keep scrolling and reading | `T-UX-011` |
| **2.3 Empty — never uploaded** | *"Nothing here yet."* + *"Upload screenshots of your saved lists on Netflix or Max and nextup will build one combined list."* Primary button **"Upload screenshots"**. Freshness strip shows both services *never updated*. | Go to `/upload` | `T-UX-012` |
| **2.4 Empty — filters exclude everything** | *"No titles match these filters."* + the active filter chips + **"Clear filters"**. **Distinct from 2.3** — it must never read as data loss (US-019 AC-5). | Clear or change filters | `T-UX-013` |
| **2.5 Empty — everything removed or suppressed** | *"Nothing on your list right now."* + two links: *"Removal history (12)"* and *"Not interested (3)"* | Go and restore or un-suppress | `T-UX-014` |
| **2.6 Partial** | Page 1 rendered; the sentinel below. Counts read *"Showing 50 of at least 50"* — **no total is fabricated** (there is no count query, NFR-018) | Load more | `T-UX-015` |
| **2.7 Populated** | Rows per `specs/ui.md` §2.2, default order | Filter, sort, open a row menu | `T-UX-016` |
| **2.8 Partial data — TMDB stale** | Rows render from stored metadata; a subtle chip *"Details may be out of date"* on affected rows | Everything, normally | `T-UX-017` |
| **2.9 Error — list fetch failed (5xx)** | *"Couldn't load your list. Nothing has changed."* + **Retry** | Retry, or navigate away | `T-UX-018` |
| **2.10 Error — 401** | Full-page *"Your session ended."* + **Sign in again** → `/.auth/login/aad` | Sign in | `T-UX-019` |
| **2.11 Error — 403 (not allow-listed)** | Full-page *"This nextup instance isn't set up for this account."* + the signed-in email + **Sign out**. **No list data, no nav, no partial UI.** | Sign out | `T-UX-020` / `T-SEC-010` |
| **2.12 Offline** | Global offline banner; last-loaded rows retained and marked | Read only | `T-UX-003` |
| **2.13 Submitting (row action)** | The affected row dims with an inline spinner; the rest of the list stays interactive | Wait, or act on other rows | `T-UX-021` |
| **2.14 Success (row action)** | The row animates out (suppress) or updates (fix match); a `role="status"` message names what happened and offers **Undo** where one exists | Undo, continue | `T-UX-022` |

---

## 3. Row-action dialogs

| State | Owner sees | Can do | Test |
|---|---|---|---|
| **3.1 Suppress — confirm** | `SUPPRESS_CONFIRM_BODY` with the title name | Confirm / Cancel | `T-UX-030` |
| **3.2 Suppress — already suppressed (idempotent 200)** | *"'{name}' was already on your Not interested list."* | Close | `T-UX-031` |
| **3.3 Fix match — searching** | Debounced results with poster/name/year/type; *"Searching…"* then *"No results for '{q}'"* | Refine, cancel | `T-UX-032` |
| **3.4 Fix match — TMDB unavailable (502)** | *"Couldn't reach TMDB. Try again in a moment. Nothing has changed."* + **Retry** | Retry, cancel | `T-UX-033` |
| **3.5 Fix match — 409 `DUPLICATE_WORK_IDENTITY`** | *"You already have '{name}' on your list. Do you want two rows for it?"* + **"Yes, keep both"** (re-sends `confirmDuplicate: true`) / **"Open the existing one"** / **Cancel** | All three | `T-UX-034` |
| **3.6 Fix match / restore — 409 `TARGET_WORK_SUPPRESSED` or `WORK_SUPPRESSED`** | *"You marked '{name}' as not interested. Stop ignoring it first?"* + **"Stop ignoring and continue"** (calls unsuppress then retries) / **Cancel** | Both | `T-UX-035` |
| **3.7 Fix match — success with suppression migration** | Success message plus `FIXMATCH_SUPPRESSION_MIGRATED` — **the migration is always stated, never silent** (data-model SD-06) | Close | `T-UX-036` / `T-FIX-005` |

---

## 4. `/upload` — Create a batch

| State | Owner sees | Can do | Test |
|---|---|---|---|
| **4.0a Paste with no open batch** *(new — A45)* | A paste (or a "Paste screenshot" tap) arriving before service and mode are chosen. The image is **held client-side, not discarded**, and the service/mode step is highlighted: *"Got your screenshot — choose a service and a mode and it'll be attached."* Nothing is sent to the server (a batch must exist first — `api.md` §5.3.1) | Choose service and mode; the held image attaches automatically | `T-PASTE-002` |
| **4.1 Initial** | Service and mode unselected; the attach area disabled with visible reason *"Choose a service and a mode first."* | Choose | `T-UX-040` |
| **4.2 Mode chosen** | Both consequence sentences visible (US-003 AC-2/AC-3); attach area enabled | Attach files | `T-UI-003` |
| **4.3 Empty (no images)** | Dropzone showing **all three affordances** (A45): the **"Paste screenshot"** button (when supported — §4.16), **"Choose files"**, and `DROPZONE_IDLE_LABEL` — *"Paste a screenshot, choose files, or drag them here — PNG, JPEG or HEIC, up to 10 MB each, 40 per batch."* On a touch viewport, `PASTE_IOS_HINT` sits under the button. Submit disabled, reason visible. ~~*Pre-A45 copy: "PNG, JPEG or HEIC, up to 10 MB each, 40 per batch." as the whole dropzone message*~~ — **superseded in place: it named the formats but implied file upload was the only way in.** The formats and ceilings are unchanged | Paste, choose, or drag | `T-UX-041`, `T-UI-014` |
| **4.4 Partial acceptance** | Accepted thumbnails **and** a rejected list naming each file and its reason (US-004 AC-3/AC-6). Both visible at once | Remove, add more, submit | `T-UX-042` |
| **4.5 All rejected** | No thumbnails; the rejection list; submit stays disabled | Try other files | `T-UX-043` |
| **4.6 Ceiling breached** | *"That would be 41 screenshots. The limit is 40 per batch."* / *"That file is 14 MB. The limit is 10 MB."* — the specific number is always named | Remove some | `T-UX-044` |
| **4.6a Too large to decode** *(new — A43 / `A43-M3`)* | The **pixel** guard refused the file (`IMAGE_TOO_LARGE_TO_DECODE`). The message is rendered **verbatim from the server**, names the file and its megapixels, names the limit, says the cause is **container memory and not a bad file**, and offers the remedy link. ⚠ The message is **server-built**, never client-composed — it interpolates the live container size and guard value, so a client copy would state the wrong limit immediately after an up-size. Other files in the batch are **unaffected** and stay attached | Remove that file, submit the rest, or apply the remedy | `T-UI-013`, `T-IMG-020` |
| **4.6b Decode failed (corrupt file)** *(new — A43)* | `IMAGE_DECODE_FAILED` — a genuinely corrupt or truncated image. ⚠ This message **MUST NOT** mention memory or offer the up-size remedy: conflating a capacity failure with a file failure sends the owner to buy memory they do not need | Try a different file | `T-IMG-015`, `T-IMG-020` |
| **4.7 Populated** | Thumbnail grid + running totals; submit enabled | Submit | `T-UX-045` |
| **4.8 Submitting** | Per-file progress bars; the whole form disabled; **"Don't close this tab"** | Wait | `T-UX-046` |
| **4.9 Success** | Navigates to `/batches/:batchId` | — | `T-UX-047` |
| **4.10 Error — 409 `OPEN_BATCH_EXISTS`** | *"You already have an upload in progress."* + **"Go to it"** / **"Discard it and start again"** | Both | `T-UX-048` |
| **4.11 Offline** | Banner; submit disabled with the reason. **The "Paste screenshot" button is also disabled with the same visible reason** (A45) — a paste needs a `POST` | Wait | `T-UX-003` |
| **4.12 Paste accepted** *(new — A45)* | The pasted image appears in the same thumbnail grid as any attached file, named with the **server-synthesised** name (`pasted-20260811-154233-03.png`, `data-model.md` §3.8.1); running totals update; `role="status"`: *"Added 1 screenshot — 3 in this batch."* **A second paste APPENDS to the same batch** — no new batch, no replacement | Paste again, choose files, drag more, submit | `T-PASTE-003` |
| **4.13 Paste error — permission denied** *(new — A45)* | `PASTE_DENIED_BODY` — *"nextup couldn't read your clipboard. Tap 'Paste screenshot' again and choose Paste, or choose a file instead."* The button stays enabled and is **re-offered**. **The upload path is named in the copy**, because it always works | Retry the paste, or choose a file | `T-PASTE-008` |
| **4.14 Paste error — clipboard empty / not an image** *(new — A45)* | `PASTE_EMPTY_BODY` (*"There's nothing on your clipboard to paste."*) or `PASTE_NOT_IMAGE_BODY` (*"What's on your clipboard isn't an image. Copy a screenshot, or choose a file instead."*). **Two distinct messages — an empty clipboard and a clipboard holding text are different problems with different fixes.** Nothing was sent; nothing changed | Copy a screenshot and retry, or choose a file | `T-PASTE-008` |
| **4.15 Paste error — silently abandoned** *(new — A45, the brittle one)* | The `clipboard.read()` promise rejected **without the owner doing anything they would recognise as a refusal** — a stray tap on the page, a tab switch, or backgrounding Safari all cancel it (evidence Q1e caveat 2, `verified`). `PASTE_ABANDONED_BODY`: *"That paste didn't come through — tapping elsewhere, switching tabs or leaving Safari cancels it. Try again."* ⚠ **The UI MUST detect the rejection and re-offer. It MUST NEVER sit on a spinner.** No pending indicator may outlive the promise; there is no timeout state because the promise always settles | Tap the button again | `T-PASTE-008` |
| **4.16 Paste unavailable — no clipboard API** *(new — A45)* | `navigator.clipboard.read` is absent: an **`http://` origin** (the LAN-IP dev-server case — `api.md` §5.3.3) or a browser older than Safari 13.4 / Chrome 76 / Firefox 127. **The "Paste screenshot" button is NOT RENDERED AT ALL** — never rendered-and-broken, never rendered-and-disabled-without-reason. **"Choose files" and drag-and-drop are fully present and the owner loses no capability.** The desktop Ctrl/Cmd+V `paste` listener is unaffected by this check (it needs no permission and no secure context) | Choose files, drag, or Ctrl/Cmd+V | `T-PASTE-009` |
| **4.17 Drag over the dropzone** *(new — A45)* | `DROPZONE_ACTIVE_LABEL` — *"Drop screenshots here"* — with a visible border change (never colour alone, `ui.md` §10.2). On drop, behaves exactly as a file-input selection with `ingestSource: 'drop'` | Drop, or drag away | `T-PASTE-004` |
| **4.18 Pasted image rejected by a ceiling or the guard** *(new — A45)* | **Identical to §4.6 / §4.6a / §4.6b.** A pasted image is subject to the same 10 MB / 40-per-batch / 60 MB ceilings, the same magic-byte sniff and the same pre-decode pixel guard (REQ-079). The rejection card names the **synthesised** filename, so *"pasted-20260811-154233-03.png is 48.0 MP"* is what the owner reads. **No separate copy, no separate code path, no exemption** | Remove it, submit the rest | `T-PASTE-007` |

---

## 5. `/batches/:batchId` — Extraction status

| State | Owner sees | Can do | Test |
|---|---|---|---|
| **5.1 Queued (`submitted`)** | *"Queued — 0 of 7 screenshots read."* | Discard | `T-UX-050` |
| **5.2 Running (`extracting`)** | *"Reading 4 of 7…"* + thumbnails ticking green | Discard | `T-UX-051` |
| **5.3 Partial — some images yielded nothing** | *"No text was found in 1 of 7 screenshots"*, the image **named and thumbnailed** (US-006 AC-3) | Continue to review | `T-AI-020` |
| **5.4 Success** | Auto-navigates to the review page | — | `T-UX-052` |
| **5.5 Error — `EXTRACTOR_ERROR`** | *"Couldn't read your screenshots. Nothing has changed and your screenshots are safe."* + **Try again** / **Discard batch** (US-006 AC-4/AC-6) | Both | `T-UX-053` |
| **5.6 Error — `EXTRACTOR_UNAVAILABLE`** | *"The text-reading service is busy. Nothing has changed. Try again in a few minutes."* + **Try again** (US-006 AC-5) | Retry | `T-UX-054` |
| — *(R2 note)* | `EXTRACTOR_ERROR` / `EXTRACTOR_UNAVAILABLE` now mean **both** readers failed. A single-reader failure is **not** an error state — it is 5.9 or 5.10 below, and the batch completes. An implementation that fails the batch when only one reader is down has made the product worse, not safer. | — | `T-AI-036` |
| **5.7 Error — `IMAGES_PURGED`** | *"These screenshots were deleted 30 days after upload, so they can't be read again."* + **"Upload new screenshots"** (US-034 AC-5) | Go to `/upload` | `T-UX-055` |
| **5.8 Offline while polling** | Banner; polling pauses and resumes on reconnect; no error is invented | Wait | `T-UX-056` |
| **5.9 Degraded — the tile reader was unavailable** *(new, ADR-0001 R2)* | A **persistent, non-dismissible banner on both this page and the review page**: *"One of the two readers was unavailable, so these results may be less complete than usual. Nothing has been removed from your list — you can still add titles, and you can re-read these screenshots later."* The batch **completes**, OCR-only. In **full-update** mode, **removals are withheld entirely** — no removal section is rendered, because an incomplete read would propose removing titles that are still on the list. | Continue to review; re-extract later (REQ-074) | **`T-AI-036`**, `T-UX-057` |
| **5.10 Degraded — the cross-check reader was unavailable** *(new, ADR-0001 R2)* | Same banner wording, milder consequence: extraction proceeds on the model alone, every candidate carries `ocrSupport: 'not-checked'`, and **removals are still permitted** (completeness is unaffected — only corroboration is). | Continue to review | `T-UX-058` |

---

## 6. `/batches/:batchId/review` — The review pass

| State | Owner sees | Can do | Test |
|---|---|---|---|
| **6.1 Loading** | Section skeletons with their counts already shown from `GET /api/batches/:batchId` | Wait | `T-UX-060` |
| **6.2 Empty — nothing extracted, `append-only`** | *"No titles were read from these screenshots."* + **Re-extract** / **Discard** / **Add a title manually** | All three | `T-UX-061` |
| **6.3 Empty — nothing extracted, `full-update`** | `LOW_YIELD_FULL_UPDATE`. **The removals section is not rendered at all** and `removals.withheld === true`. | Re-extract / Discard / Add manually | `T-AI-021` |
| **6.4 Low yield, `full-update`, some titles read** | Additions and "Already on your list" render; the removals section is replaced by the withheld notice; the action bar reads *"Nothing will be removed by this batch."* | Confirm additions only, re-extract, discard | `T-AI-021` |
| **6.5 Populated — `append-only`** | Additions, Unmatched, Probably-not-titles. **No "Already on your list" section. No removals section.** | Confirm, correct, discard, apply | `T-UI-006` |
| **6.6 Populated — `full-update`** | All five sections; **"Already on your list (N)"** present and collapsed with its count visible; removals all ticked | Everything | `T-REV-006` |
| **6.7 Partial review** | Action bar: *"9 to add · 3 to remove · 2 still to review"* | Keep going | `T-UX-062` |
| **6.8 Unmatched item** | Raw extracted text, an **"Unidentified"** chip, an inline TMDB search, and **"Keep as unidentified"** — which is a real, supported outcome, not a failure (US-008 AC-4) | Match, keep, discard | `T-UX-063` |
| **6.9 TMDB unreachable during extraction** | Banner: *"Couldn't reach TMDB — nothing was matched. You can still confirm these as unidentified titles, or discard the batch and try again later."* (US-007 AC-6) | Confirm as unidentified, discard | `T-AI-017` |
| **6.10 Removal confirmation dialog** | *"Remove 3 titles from Netflix?"* + every ticked title named + *"They'll be kept in Removal history and you can restore them any time."* | Confirm / Cancel | `T-UI-008` |
| **6.11 Zero removals ticked** | The dialog reads *"No removals selected. Nothing will be removed."* and the close proceeds (US-015 AC-5) | Confirm | `T-REV-007` |
| **6.12 Submitting (close)** | Sticky bar shows *"Applying…"*; all controls disabled | Wait | `T-UX-064` |
| **6.13 Success** | Navigates to `/` with `role="status"`: *"Added 9 titles, removed 3 from Netflix."* + **Undo this batch** when `undoable === true`, or **"View what changed"** when not | Undo, view, continue | `T-UX-065` |
| **6.14 Error — 409 `PENDING_ADDITIONS`** | Inline: *"2 titles still need a decision."* Focus and scroll to the first pending card. **Nothing was applied.** | Decide, retry | `T-UX-066` |
| **6.15 Error — 409 `REMOVALS_NOT_CONFIRMED`** | The confirmation dialog opens. Nothing was applied. | Confirm / cancel | `T-REV-005` |
| **6.16 Error — 5xx on close** | *"Couldn't apply these changes. Nothing was changed — your review is still here."* + **Try again**. Local dispositions are preserved (SD-11e) | Retry | `T-UX-067` |
| **6.17 Offline mid-review** | Banner; dispositions keep working locally; **Apply changes** disabled with the reason | Keep reviewing | `T-UX-068` |
| **6.18 Session expired mid-review (401)** | *"Your session ended. Sign in again — your review is still here."* + **Sign in**, returning to this URL. Local dispositions preserved | Sign in | `T-UX-069` |

---

## 7. `/removed` — Removal history

| State | Owner sees | Can do | Test |
|---|---|---|---|
| **7.1 Loading** | Row skeletons | — | `T-UX-070` |
| **7.2 Empty — nothing ever removed** | *"Nothing has been removed yet."* + *"When a title leaves your list, it's kept here forever."* | Back to `/` | `T-UX-071` |
| **7.3 Empty — search/filter matched nothing** | *"No removals match '{q}'."* + **Clear search**. **Distinct from 7.2** | Clear | `T-UX-072` |
| **7.4 Partial** | Page 1 + load-more sentinel | Load more | `T-UX-073` |
| **7.5 Populated** | One row per removed listing, with ordinal chips. **Never de-duplicated** | Search, filter, restore | `T-UI-009` |
| **7.6 Submitting (restore)** | The row dims with a spinner | Wait | `T-UX-074` |
| **7.7 Success (restore)** | Row moves out; `role="status"`: *"'{name}' is back on your Netflix list, with its original date (4 Jan 2026)."* — **naming the original date** makes US-025 AC-2 visible | Continue | `T-UX-075` |
| **7.8 Error — 409 `DUPLICATE_WORK_IDENTITY`** | §3.5's dialog | Keep both / cancel | `T-UX-034` |
| **7.9 Error — 409 `WORK_SUPPRESSED`** | §3.6's dialog | Stop ignoring and continue | `T-UX-035` |
| **7.10 Error — 409 `LISTING_NOT_REMOVED`** | *"'{name}' is already back on your list."* + refresh | Refresh | `T-UX-076` |
| **7.11 Offline** | Banner; restore disabled with reason | Browse | `T-UX-003` |

---

## 8. `/not-interested` — Suppressed works

| State | Owner sees | Can do | Test |
|---|---|---|---|
| **8.1 Loading** | Skeletons | — | `T-UX-080` |
| **8.2 Empty** | *"You haven't marked anything as not interested."* + *"Use the ⋮ menu on any title."* | Back | `T-UX-081` |
| **8.3 Populated** | Rows from `displaySnapshot` | Stop ignoring | `T-UX-082` |
| **8.4 Populated — text-derived identity** | The row carries `UNMATCHED_SUPPRESSION_CAVEAT` | Stop ignoring | `T-SUP-006` |
| **8.5 Submitting** | Row dims | Wait | `T-UX-083` |
| **8.6 Success** | `UNSUPPRESS_CONFIRM_BODY` restated as confirmation: *"…This doesn't bring back anything that was removed."* (US-029 AC-4) | Continue | `T-UX-084` |
| **8.7 Error** | *"Couldn't update this. Nothing has changed."* + Retry | Retry | `T-UX-085` |

---

## 9. `/batches` — Batch history and undo

| State | Owner sees | Can do | Test |
|---|---|---|---|
| **9.1 Loading** | Skeletons | — | `T-UX-090` |
| **9.2 Empty** | *"You haven't uploaded anything yet."* | Go to `/upload` | `T-UX-091` |
| **9.3 Populated** | One card per batch: date, service, mode, status, and counts *"Created 6 · Modified 0 · Removed 3"*. `undoable` batches show **Undo this batch** | Open, undo | `T-UX-092` |
| **9.4 Detail — provenance** | Full created/modified/removed lists (US-031 AC-2/AC-3), each entry linking to the title | Navigate | `T-UX-093` |
| **9.5 Detail — a batch that changed nothing** | *"This upload didn't change anything."* — explicitly, not an empty panel (US-031 AC-4) | — | `T-UX-094` |
| **9.6 Submitting (undo)** | Card shows *"Undoing…"* | Wait | `T-UX-095` |
| **9.7 Success (undo)** | *"Undone. 6 titles and 9 service entries were removed."* + a link to `/` | Continue | `T-UX-096` |
| **9.8 Refusal — 409 `BATCH_NOT_CREATES_ONLY` — THE BIG ONE** | **A full-screen panel, not a toast**: *"This upload can't be undone in one step, because it changed things as well as adding them. Here's everything it touched, and how to fix each one."* Then three labelled groups — **Added (N)**, **Changed (N)**, **Removed (N)** — each listing **every** title with poster, name, year, current state, and a **working action button** (*Not interested* / *Fix match* / *Restore*). Client-side paginated at 50 per group with a **"Show all"**; **nothing is summarised away, ever** (US-033 AC-5). Titles since removed or suppressed are shown with a state chip (US-033 AC-6). | Act on any listed title, in place | `T-UNDO-006`, `T-UX-097` |
| **9.9 Refusal — `reason: 'provenance-unavailable'`** | *"We can't tell what this upload changed, so it can't be undone safely. Nothing has been changed."* + links to per-title remedies (US-033 AC-7) | Navigate | `T-UNDO-007` |
| **9.10 Error — 409 `BATCH_ALREADY_UNDONE`** | *"This upload was already undone."* + refresh | Refresh | `T-UX-098` |
| **9.11 Offline** | Banner; undo disabled with reason | Browse | `T-UX-003` |

---

## 10. Authentication states (US-001, US-002)

| State | Owner sees | Test |
|---|---|---|
| **10.1 Unauthenticated, any route** | Container Apps Easy Auth redirects to the Entra sign-in page before the SPA loads. `/api/*` returns 401 JSON, never HTML | `T-AUTH-001`, `T-SEC-008` |
| **10.2 Authenticated, allow-listed** | The requested route, with the deep link preserved through the redirect (US-001 AC-2) | `T-AUTH-002` |
| **10.3 Authenticated, NOT allow-listed** | Full-page refusal (§2.11). **No list data of any kind is fetched or rendered.** The highest-value test in the product | `T-SEC-010` |
| **10.4 Session expired** | 401 → the sign-in-again state, returning to the current URL. In-progress review state is preserved (§6.18) | `T-AUTH-003` |
| **10.5 Signed out** | Sign-out link is always present in the header; after sign-out the owner lands on the Entra signed-out page | `T-AUTH-004` |

---

## 11. Coverage checklist

| Surface | initial | empty | partial | populated | error | offline | submitting | success |
|---|---|---|---|---|---|---|---|---|
| Combined list | 2.1/2.2 | 2.3/2.4/2.5 | 2.6/2.8 | 2.7 | 2.9–2.11 | 2.12 | 2.13 | 2.14 |
| Upload | 4.1/4.2 | 4.3 | 4.4 | 4.7 | 4.5/4.6/4.6a/4.6b/4.10/**4.13–4.16**/**4.18** | 4.11 | 4.8 | 4.9/**4.12** |
| Batch status | 5.1 | — | 5.2/5.3 | 5.3 | 5.5–5.7 | 5.8 | 5.1/5.2 | 5.4 |
| Review | 6.1 | 6.2/6.3 | 6.4/6.7 | 6.5/6.6 | 6.9/6.14–6.16/6.18 | 6.17 | 6.12 | 6.13 |
| Removed | 7.1 | 7.2/7.3 | 7.4 | 7.5 | 7.8–7.10 | 7.11 | 7.6 | 7.7 |
| Not interested | 8.1 | 8.2 | — | 8.3/8.4 | 8.7 | 8.7 | 8.5 | 8.6 |
| Batches | 9.1 | 9.2 | 9.4 | 9.3 | 9.8–9.10 | 9.11 | 9.6 | 9.7 |
| Auth | 10.1 | — | — | 10.2 | 10.3/10.4 | — | — | 10.5 |
