# Guided capture and review design

**Status:** Owner-reviewed design direction; interactive proposal only. No
production implementation, API change, backlog change or deployment is
authorized by this document.

**Owner review, 2026-09-18:** The owner responded, "Yes! so much better!" to the
connected upload/review study, then requested documenting, committing and
pushing it. This records endorsement of the visual and guided-flow direction,
not blanket approval of every implementation decision. The final-summary
interaction and remaining production-parity questions below must be resolved
before building.

This work extends the [library design handoff](library-design-handoff.md) in the
isolated proposal worktree. Application contracts were inspected at the same
`4e6bbae` baseline as that handoff; refresh them against current main before
planning implementation.

## 1. Open the connected study

[Study 04: screenshot capture and batch review](mocks/capture-review-study.html).
Open the HTML directly in a browser. It needs no server or build.

| Stage | Desktop | Phone |
| --- | --- | --- |
| Screenshots after service/mode selection | [Preview](mocks/capture-upload-desktop.png) | [Preview](mocks/capture-upload-phone.png) |
| Review the extraction | [Preview](mocks/capture-review-desktop.png) | [Preview](mocks/capture-review-phone.png) |
| Confirm the exact changes | [Preview](mocks/capture-confirm-desktop.png) | [Preview](mocks/capture-confirm-phone.png) |

Choose a service and mode, select **Use sample screenshots**, then **Preview
extracted titles**. Alternatively, **Prototype tools** opens either review mode
directly and exposes light/dark, offline, incomplete-extraction and failed-apply
examples. Loading an example replaces the current sample batch.

All titles, crops and memberships are synthetic. Actual file selection,
keyboard paste and drag/drop append local filenames to the same queue. The
clipboard button attempts the browser clipboard API directly in its click
handler; unsupported access and permission failures are explained visibly.
**Attached files are not analyzed.** Every review uses the fixed fixture.

## 2. The interaction model

One quiet progress rail presents five decisions, not five separate forms:

1. **Service:** eight equal-size choices; nothing preselected.
2. **Mode:** two consequence-led choices; nothing preselected. Answered steps
   become concise summaries with Change/Done controls.
3. **Screenshots:** paste, file selection and drop feed one queue. The side
   summary makes readiness explicit and names what is missing.
4. **Review:** decide new and unidentified items first; inspect existing matches
   and secondary evidence without interleaving them with those decisions.
5. **Confirm:** read exact additions and selected removals, then apply once.

The sequence guides attention but **does not lock early attachments**. A paste
before answering service/mode is held, not rejected. Changing the actual service
clears mode consent but retains screenshots. Merely opening Change, closing it,
or retaining the same service does not clear consent.

After entering review, service/mode are immutable. Discarding the batch is the
explicit route back to those choices. Cancel/Escape never discards or applies.

### Deliberate proposal: the final summary

The current `ReviewPage` applies directly when there are no removal proposals.
With proposals, it opens `RemovalConfirmDialog`, including when every proposal
is unchecked.

The study proposes **one final summary page for both modes**. In full update,
this page replaces the removal dialog; it must not be implemented as a summary
followed by a second removal confirmation. It names every selected removal and
only those removals, preserves the zero-selected case and requires the final
Apply action. Add-only gains a reviewable preflight step, not removal controls.

This is an intentional interaction change, **not a claim of pixel-for-pixel
parity with the current app**. It needs owner approval before implementation.
The close transaction, pending gate, one-service scope and explicit consent
must remain unchanged. Back/Escape preserves decisions; retry requires another
explicit Apply on the visible summary.

## 3. Review grouping

| Group | Presentation | Decision |
| --- | --- | --- |
| New titles | Expanded, consistent evidence/text/action rows. Original text remains adjacent to the proposed identity. | Confirm, change match or discard from this batch. Bulk confirmation touches pending rows only. |
| Unidentified items | Expanded, with extracted text as the useful headline instead of an empty title. | Keep unidentified, find a match or discard. Bulk Keep applies only to pending unidentified items. |
| Existing matches | Full-update-only disclosure, with count and a non-color "Stay on list" label. Every fixture match remains in the document. | Inspect the known matches and their evidence; do not silently treat failed reads as removals. |
| Proposed removals | Full-update-only, last, with a restrained danger rule and explicit per-row consequence. | Proposals start checked. Uncheck to keep; there is no per-row destructive action. |

**Other extracted items** is a secondary, counted disclosure, not deleted
information. It preserves both "probably not a title" rescue and unreadable-tile
search. Artwork-inferred reads retain their warning and a 104px-square sample
crop; OCR-only reads retain their separate warning. A mismatch offers inline
alternatives before opening the sample search dialog.

Corrections display the selected identity, not the extraction's original guess.
Correcting onto a fixture title already on the selected service does not count
as a new addition. Pending/discarded rows do not inflate action counts.
Manually added titles are explicitly owner-selected and have **no invented
screenshot provenance**.

Full update keeps existing matches in the DOM even when collapsed. Add-only
omits both the existing and removal sections from the DOM. Withheld removals are
an explicit incomplete-extraction state, not a reassuring empty result.

## 4. Visual system

The approved purple/indigo library direction carries into this flow without
making every surface or badge bright:

| Role | Treatment |
| --- | --- |
| Frame | Bounded 1152px outer frame; desktop content uses the available width beside a fixed 276px summary. Below 900px, the upload summary follows the form and the redundant review rail disappears. |
| Rhythm | 4px-based spacing, mostly 24px panel padding, 16px card radii and 10px controls. Phone padding reduces deliberately, not separately per card. |
| Hierarchy | A single page title, numbered local questions and repeated section headings. Explanations sit beside the decision they affect. |
| Evidence | Fixed 104px crop wells align across candidates. At very narrow widths they stack above the identity rather than squeezing the title. |
| Actions | Repeated three-column decision controls, all 44px tall. Primary violet means an owner action; periwinkle identifies service/evidence metadata. |
| Meaning | Green labels describe completed decisions; amber names uncertainty; restrained rose names removal consequences. Text carries every distinction independently of color. |
| Depth | Layered ink surfaces, quiet gradients and neutral shadows. No web fonts, remote artwork or broad colored glow. |
| Motion | 120-160ms interaction transitions and dialog appearance. Motion uses transform/opacity or paint properties; reduced motion disables transitions, animations and scaling. |
| Phone attention | Shorter introductory copy and compact section-header actions bring the first title's full decision row above the persistent footer at the 390 x 844 fixture viewport. |

The light theme remains a mock companion, not approval for a production theme
switch. Letter marks and text-based crops are illustrative, not final service
assets or genuine screenshots. In full-page overview captures only, the action
bar is placed at its natural document end so it does not cover title/removal
rows. It remains sticky in the interactive prototype. Upload previews show
answered setup steps and the sample queue; opening the HTML starts unanswered.

## 5. Safety and recovery examples

- Attempting to continue with pending decisions gives an error and focuses the
  first unresolved candidate. Nothing is silently accepted or discarded.
- Correcting Dune to the 1984 version changes the displayed identity and final
  summary. Matching an unidentified item to Dark illustrates an existing-title
  correction with no duplicate addition.
- Unchecking one removal removes only that title from the final removal list.
  Unchecking both still produces an explicit "Nothing will be removed" summary.
- Incomplete extraction withholds removals while leaving additions available.
  The affected sample is named and its synthetic evidence remains reachable.
- Offline keeps local review intact but disables Apply and Discard.
- Failed Apply keeps decisions and the exact summary intact; retry is explicit.
  A successful in-memory apply is guarded against repeated submission.

These are **prototype scenarios**, not production acceptance tests or a complete
failure-state implementation.

## 6. What the mock deliberately does not prove

It does not run OCR/vision, contact TMDB, upload images, validate magic bytes,
strip EXIF/XMP, guard decode pixels, transcode HEIC, persist decisions, or call
batch-close APIs. It cannot prove restart recovery, memory safety, rollback,
concurrency, authentication, undo, server classification or service isolation.

The production extraction lifecycle remains required: per-image progress,
no-text evidence, catchable memory failure, restart/OOM recovery and explicit
retry paths. This study jumps to a fixture review and does **not** replace that
lifecycle with instant extraction. Its incomplete-extraction toggle is not a
real image retry implementation.

The sample catalog is intentionally small. Review failure/reload recovery,
large-batch virtualization, full matching/search errors, disposition-write
failure and real provider marks need separate state designs. The study's
in-memory section arrays and count helpers are fixture plumbing, **not logic to
copy into the production client**. Production classification and effect counts
must agree with server-authoritative review and close behavior.

This study neither adopts nor implements Initial collection or historical
service-save dates. Those decisions remain separate.

## 7. Logical next steps, without building

1. Review the connected desktop/phone flow with realistic owner tasks: early
   paste, ambiguous match, unidentified keep, rescue, complete update and
   zero-removal confirmation. Approve or revise the final-summary interaction.
2. Resolve the phone grouping and density tradeoff with real long titles,
   screenshots and a large batch. Decide whether a compact phone section
   navigator is needed; do not assume a small fixture proves 200-item usability.
3. Extend the mock/state map for extraction progress and the remaining recovery
   cases. Keep memory versus corrupt-file copy distinct and preserve per-image
   retry semantics.
4. Refresh contracts against current main, then map the approved design to
   existing components and named tests. Coordinate any shared-file changes with
   the active implementation lanes; do not start a parallel copy.
5. Only after explicit build approval, turn the agreed work into sequenced
   backlog tasks and acceptance criteria. Preserve the required collected test
   locations and existing UI/API/invariant coverage.

Relevant current implementation surfaces are `UploadStep`, `UploadPage`,
`UploadRoute`, `ReviewPage`, `CandidateCard`, `UnmatchedActions`,
`RemovalConfirmDialog`, shared copy and domain review classification.

Contract anchors include `specs/ui.md` sections 3-5 and the mapping in
`specs/testing.md`: upload progression (`T-UI-003`, `T-UX-148a` through
`T-UX-148f`), full-update visibility and append omissions (`T-REV-006`,
`T-UI-005`, `T-UI-006`, `T-REM-011`), removal confirmation (`T-UI-007`,
`T-UI-008`, `T-REV-007`), evidence (`T-REV-013`, `T-AI-041`), unidentified
decisions (`T-UNM-010`, `T-UNM-012`, `T-UX-063`), sticky actions and recovery
(`T-UX-011`, `T-UX-064`, `T-UX-066`, `T-REV-005`). These are future
implementation obligations, not tests passed by this artifact.

## 8. Prototype review evidence

Session-only Playwright checks exercise both modes, early attachments,
service-change consent reset, pending focus, bulk-confirm safety, match
corrections, unidentified outcomes, secondary-read rescue, exact removal names,
zero-selected confirmation, cancellation, offline behavior and failed-apply
retry. File/drop/paste checks assert that editable-field paste is not hijacked.

Responsive/accessibility inspection covers 280, 320, 390, 900 and 1440px widths
in both themes: empty upload, ready upload, review, expanded disclosures, match
dialog and final confirmation. It checks page overflow, control heights and
automated WCAG A/AA findings, plus reduced motion and absence of external
requests/browser script errors. Generated previews were visually inspected.

This evidence supports discussion of the prototype. It is not full
assistive-technology testing, production test coverage, proof of every contrast
state, or approval to ship.

At publication, the repository's documentation-path suite passed all five
tests. `npm run check:test-locations` was also attempted, but could not collect
tests because this isolated worktree has no installed Vitest package. That gate
is not claimed as passing; the standalone HTML needs no installed dependencies.
