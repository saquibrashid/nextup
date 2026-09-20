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
