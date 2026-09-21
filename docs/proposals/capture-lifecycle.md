# Capture lifecycle: entry, resumption and recovery

**Approved direction:** owner request, 2026-09-19: document, design and begin
building the lifecycle improvements identified in the end-to-end assessment.
This extends [the capture/review design](capture-review-design.md), rather than
replacing its visual system or its list-safety contracts.

**Scope:** the capture journey, not a library redesign. The requested library
follow-ups were recorded first: search prominence (#326), retained filters and
sort (#328), title details (#327), and watched history/personal ratings (#325).
They are not included in these implementation slices.

## 1. The experience

Enter Upload -> resolve unfinished work -> prepare screenshots -> save and
extract -> review decisions -> confirm changes -> inspect the actual outcome.

Every stage must answer four questions:

- Where am I?
- What is saved, and what exists only on this device?
- What needs attention?
- What is the useful next action?

One owner's open batch blocks another batch, even for a different service.
The server remains authoritative. Entry checks improve the experience; they
do not replace the create/transition guards or authorize automatic writes.

## 2. Entry checkpoint

Before exposing the new-upload form, read `GET /api/batches?open=true`. This
owner-scoped lookup shares create-time conflict detection and bypasses the
50-record history cap. Do not create a batch on mount. A failed/unknown status
is not permission to begin.

| State | Presentation and primary action | Secondary action |
| --- | --- | --- |
| Checking | Checking for unfinished uploads; slow/stalled feedback and explicit Retry | Navigation stays available |
| No open batch | Reveal the existing guided form; preserve a service deep link | Normal navigation |
| Draft | Unfinished upload, service, mode and created date; Continue adding screenshots | Confirmed discard |
| Submitted/extracting | Reading screenshots; View progress | Leave and return; no discard |
| In review | Ready to review; Continue review | Confirmed discard |
| Extraction failed | Needs attention; Resolve extraction issue | Confirmed discard |
| Applied/undone/discarded | Does not block a new capture | History remains available |
| Check failed/offline | Explain inability to check; no enabled new-upload submission | Retry when online |

The checkpoint replaces the apparent new-upload workflow, not the application
shell. Use a bounded elevated panel, a state eyebrow, a descriptive heading,
aligned service/mode/date metadata, one primary action and quieter secondary
actions. Retain the application's existing indigo tokens, minimum touch sizes,
responsive wrapping, visible focus and reduced-motion rules.

An early desktop paste is held locally while checking. The form stays mounted
but hidden, keeping the existing queue and its provenance rather than creating
a second intake implementation. State how many screenshots are held and that
none has been attached to the existing batch. Before navigating to resume an
older batch with local files present, explicitly confirm leaving those files.
Do not claim they can survive a browser reload.

Resume rereads the selected batch and routes by its current state. An already
completed/discarded batch triggers a fresh entry check instead of a dead review
link. Discard requires a focused confirmation, rereads eligibility before the
write, then rereads server state. Uncertain responses must not automatically
repeat a discard or start another batch. Keep the current local queue after
discard; starting its upload still requires Extract titles.

Keep the server's create-time conflict handling for another-tab races. Move
back to the same checkpoint, retain the local selection, and disable Extract
until the conflict is resolved. Never offer discard while extraction is running.

## 3. Preparation and saved drafts

Retain all three input paths and PNG/JPEG/HEIC support. Changing service renews
mode consent without dropping files. Saved drafts have fixed service/mode
because there is no current draft-edit API.

TASK-227 distinguishes Selected on this device, Uploading, Saved,
Rejected and Outcome unknown. Navigation protection is specific to unsaved
files or unverified writes, not a blanket warning on every navigation.
Recognizable previews must not depend on unsupported HEIC rendering.

Successful files survive individual failures. Retrying means reconciling saved
contents first, not replaying all requests. Saved and newly selected counts
must be clear, including the total batch limits.

The implementation keeps recovery on the capture page until local input is
resolved. Saved-only drafts can be left without a warning. In-app Back and
links use React Router's supported blocker; reload/sign-out use the native
unload warning where the browser supports it. No promise of mobile reload
persistence or screenshot web-storage cache is made. Unknown requests require
checking saved previews, then explicit removal/reselection rather than a replay.
Counts and uploaded-byte totals come from saved batch detail; storage bytes
remain a separate measure. Server validation remains authoritative.

## 4. Reading and reviewing

Progress represents actual reported results. A failed status read must not say
the extraction failed. Long-running work and interrupted work need distinct,
server-supported recovery; elapsed time alone never authorizes cancellation.

Review decisions remain editable until successful Apply, including after bulk
confirmation and returning from the final summary. Existing-match mismatches
and secondary evidence need a deliberate correction/rescue route without
silently repartitioning or dropping candidates.

Distinguish no extracted titles, all titles already known, unidentified titles,
and all additions deliberately discarded. Do not tell the owner everything
was already known merely because the additions section is empty.

Offline decisions must either be retained as visibly unsaved decisions under
the existing specification or explicitly redesigned with owner approval. Never
silently replay mutations on reconnect. Saved server decisions win during
reconciliation; conflicting unsaved intent must remain visible.

Retry extraction reuses the failed batch. Re-extraction creates a derived
batch and currently refuses any open batch, including its source. Therefore a
review-time recovery must explain and confirm how the current review is
resolved first; merely wiring a Re-extract button would create a dead end.
Expired screenshots require new input, not a retry that cannot succeed.

TASK-228 implements this as authoritative saved cards plus a separate,
session-persisted unsaved-intent panel. Atomic bulk confirmation remains;
reversal is per card, not a new bulk-undo operation. Known-match corrections
and secondary rescue use existing endpoints and server sectioning. Re-extraction
requires two separate confirmations: discard review, then create the derived
read. Lost responses require read-only checks; original image expiry is kept.

## 5. Confirmation and outcomes

One refreshed summary remains mandatory for both modes. Names and counts must
describe current corrected identities and selected removals. Back/Escape
preserves decisions; editing them requires a new summary.

A network failure after Apply is not proof that nothing changed. Read batch
status/provenance before offering another write: applied becomes a success
receipt; still in review permits an explicit retry; unreadable status remains
unknown with a read-only Check status action. Handle another tab applying or
discarding the batch the same way. Never repeat Apply automatically.

Success has actual counts, appropriate undo, durable history and a route to
start another upload. Terminal review links resolve to outcomes rather than
an endless generic Retry page.

TASK-229 resolves close uncertainty by reading saved status and refreshing an
in-review summary before allowing explicit retry. Saved batch detail now
projects a durable application receipt from existing change/group records;
there is no new migration or guessed client count. Terminal review links open
that detail, and unavailable reads never claim nothing changed.

## 6. Completeness is a separate safety decision

Rejected ingest input is not the same as an extraction failure for a saved
image. Current extraction withholding sees the latter; successful saved
images alone do not prove the original full-update capture was complete.

The completeness slice must retain unresolved ingest evidence across reloads,
define how replacement resolves it, and prove that omitting a failed image
cannot enable removals. This requires a reviewed server persistence contract,
not a client-only flag or a new meaning silently assigned to an old flag.
Add-only work may remain available; it must not silently change mode.

### 6.1 TASK-230 persistence contract

Implementation status: the additive ledger, pre-parser admission, atomic image
finalization, explicit replacement UI and shared review/tick/close gate are
implemented. `T-UX-164a`–`ab` cover domain policy, API behavior, real SQL/Blob
failures and responsive browser recovery. Release remains CI-gated.

The image route now records a receiving attempt before multipart parsing.
Previously, a parser rejection, interrupted request, process death or rejected
file left no durable negative evidence. Extraction statistics cannot reconstruct
those missing inputs.

Use an additive `capture_ingest_attempt` ledger and an explicit capture-origin
field on `UploadBatch`; do not overload `lowYield`, `degradedExtraction` or
`extractionStats`.

| Record | Contract |
| --- | --- |
| Batch capture origin | New tracked captures explicitly opt into tracking. Existing/older-writer batches default to unverified. Derived captures inherit an incomplete origin when the source cannot prove complete intake. |
| Attempt | Owner/batch-scoped ID and idempotency token, kind (upload, local selection refusal, image removal), started/completed/resolved times, state, display-only failure evidence, accepted image IDs and explicit replacement image IDs. No screenshot bytes, EXIF or streaming credentials. |
| States | Receiving, complete, incomplete, resolved. An interrupted receiving attempt remains unresolved without inventing its cause. No timeout or background worker silently clears it. |
| Replacement | An explicit owner operation in draft selects available, successfully saved images from the same batch, either already present or newly uploaded. This includes an accepted image from a partially failed request when the owner identifies it as covering the failed input. Merely removing a local file, retrying, matching a filename or uploading an unrelated image never resolves an issue. |
| Deleting a replacement | Removing its saved image in draft invalidates the resolution and withholds removals again. Resolution is not a permanent ignore flag. |
| Re-extraction | Incomplete/unknown source intake stays incomplete in the derived batch. Re-reading accepted screenshots cannot recover rejected inputs. A fresh capture is required to regain removal eligibility. |

Persist the upload attempt **before multipart buffering/decode**, after owner
and draft validation. Legacy callers of the existing image endpoint are tracked
too; tracking is not conditional on a client flag. Final image-row persistence
and the attempt result share a transaction. Draft admission, resolution and
image commit serialize on the batch row, so submit/discard and a late upload
cannot cross. Resolving an interrupted attempt makes a later original commit
fail rather than introducing extra images after replacement.

Image removal records its own receiving attempt **before deleting the blob**.
Blob deletion cannot roll back with SQL. If the row transaction fails or the
process stops between those steps, the marker keeps intake incomplete even
when the surviving row still names a selected replacement. That image cannot
be selected again while its removal is unfinished. Explicitly retrying removal
finishes all interrupted removal markers for that image atomically with row
deletion; it does not repair other unresolved input.

Submit seals the batch in the same transaction that reads its images.
Validation failure rolls back the seal. The existing `extraction-failed`
submit retry remains supported, while late draft upload commits are refused.

Client-side format/size/count refusals also matter. Before a batch exists,
retain them with the protected local capture and include them atomically in
creation. Within a saved draft, persist them through an owner-initiated report;
unverified reports block progression until saved status can be checked. A
stable report token prevents lost responses from creating duplicate issues.
This is user-initiated work, not reconnect replay or a new background process.

Batch detail exposes unresolved evidence and available replacement choices.
The draft explains which input is missing, keeps successfully saved images,
and offers explicit replacement association. Review, removal decisions and
close all use the same server completeness predicate. Full-update remains
full-update, but unresolved or unverified intake withholds **all removals**;
additions remain usable. Append-only never acquires a removal path.

Retain metadata evidence; only screenshot blobs have the existing 30-day purge.
Replacement selection refuses expired input, but later blob expiry does not
invent a new list-staleness rule or reverse a completed intake decision.
No new scheduler, list TTL, automatic mutation replay or filename-based
identity inference is permitted.

Migration `0013_capture_completeness` is additive. Old rows and requests
without `captureProtocol: 1` remain unverified; they may add titles but cannot
remove them through the new API. Deploy the migration before the new image and
route code. Keep traffic on a single application revision: an older binary
does not enforce this new removal gate, so rollback to that binary is not a
safety-preserving recovery for captures using the ledger. Prefer a forward
fix; do not reopen full-update writes on an old revision as if the gate existed.
Tracking proves only **recorded intake**, not that the owner photographed
every item on a streaming service.

The owner chose **explicit existing-or-new replacement**: a failed duplicate
must not force another upload when a saved screenshot already covers it.
Association records the owner's decision, not a claim that the server compared
the images. Show the saved previews and the scope of the failed input before
confirmation; never preselect a replacement. Preserve the original failure
evidence after resolution, and invalidate the resolution if a selected image
is removed.

Before shipping, named `T-UX-164` tests must prove parser and per-file rejection,
interruption, partial success, failed/successful explicit replacement, removed
replacement, reload, legacy/derived capture, expired replacement refusal,
cross-owner/cross-batch refusal, submit/late-commit races, and review/transactional
close withholding despite otherwise sufficient successful extraction.

## 7. Scenario matrix and delivery order

Each slice must add collected named tests before claiming completion. Pending
slices below are design/work orders, not claims of implemented behavior.

| Slice | Required scenarios | Named coverage |
| --- | --- | --- |
| TASK-226: entry/resume | All five open states; terminal-only history; service shortcut; failed/slow/offline check; early paste; resume with local files; confirmed/cancelled discard; status races; uncertain discard; create-time conflict; phone/keyboard | T-UX-160 |
| TASK-227: local/saved input | All input sources; format/size/pixel refusals; partial success; lost upload response; wrong service/mode; refresh/Back/leave; sign-in interruption; saved/new limits | T-UX-161 |
| TASK-228: reversible review | Edit confirmed/corrected/discarded choices; bulk reversal; known mismatch; secondary rescue; empty-state distinctions; offline unsaved decisions; re-extraction recovery | T-UX-162 |
| TASK-229: authoritative outcomes | Lost Apply response; duplicate press; unavailable status; another-tab close/discard; changed proposals; zero removals; no-change completion; appropriate undo | T-UX-163 |
| TASK-230: complete capture | Ingest rejection followed by sufficient successful extraction; failed replacement; reload; partial decode failure; zero yield; expired evidence; one-service transactional removal | T-UX-164 |
| TASK-231: journey continuity | Navigation indicator; resume from every entry point; terminal/deleted links; slow reads versus running extraction; mobile/screen-reader focus; large-list position | T-UX-165 |

Preserve existing ownership, suppression, soft-delete, append/full-update,
one-service close, no-automatic-replay and no-background-list-mutation guards
through every slice. Each completed slice gets its own PR and CI-gated release.
