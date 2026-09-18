# Proposal: decision-focused UI and initial-import history

**Status:** Draft for owner review. Documentation and isolated mocks only; not approved for product implementation.

**2026-09-18 follow-up:** The owner reviewed the visual direction and merged
the mockups in PR #313. [The design handoff](library-design-handoff.md) records
the reviewed styling, remaining decisions and proposed next steps.
Production implementation remains explicitly on hold; initial-history product
decisions below remain open.

**Date:** 2026-09-17.

**Isolation:** Prepared on `docs/ui-initial-import-proposal` in a separate Git
worktree, based on `d40e367`. This proposal and its standalone mock files are in scope. No changes to
application code, migrations, authoritative specifications, backlog, generated
status, or another instance's checkout are authorized by this document.

**Evidence:** The owner's supplied screenshot and assessment against `3820528`.
Subsequent changes through `d40e367` are distinguished below. No live-browser
interaction or accessibility audit was performed for this assessment.

**Mock study added 2026-09-18:** [Open the standalone library mock](mocks/library-study.html)
or read its [walkthrough and limitations](mocks/README.md). This uses local sample data
only. Its presentation palette is not a change to the approved product theme,
and its illustrative interactions do not resolve the product decisions below.

**Additional mock directions, 2026-09-18:** [Cover browser and Comparison desk](mocks/layout-alternatives.html)
explore artwork-led recognition versus column-based comparison. They share
sample data and state for a direct comparison; the first mock remains unchanged.
These are alternatives for review, not a decision to add more production layouts.

## 1. Purpose and authority

The owner requested a deep UI assessment, then identified a gap in importing
watchlists accumulated over several years into a new application. This document
preserves both discussions without adding tasks to another instance's work.

The original job is: **choose something to watch from one trusted combined list,
instead of opening several streaming apps.** The BRD targets a decision in a
couple of minutes and rediscovery of forgotten saves, not merely accurate list
administration.

The two proposed workstreams are independent:

1. Improve information hierarchy and usable browsing density.
2. Distinguish the initial collection's history from its arrival in nextup.

Documenting these recommendations does not approve their implementation or
settle the open product choices. Existing acceptance criteria remain authoritative.
Do not interpret illustrative layouts, copy, targets or conceptual fields below
as assigned requirements.

## 2. Concurrent-work reconciliation

The screenshot is a historical observation, not a claim about the latest deployed UI.

| Area | Subsequent evidence at the worktree baseline | Proposal boundary |
| --- | --- | --- |
| Service presentation | #293, #294 and #295 introduced/refined service marks; current UI section 2.2a retains canonical accessible names. | Reassess proximity and recognizability with the current marks. Do not restore the screenshot's old badge treatment unilaterally. |
| Sort controls | #294 joined the sort control visually. | Recheck visible direction and one-click reversal before classifying the screenshot's detached-arrow issue as outstanding. |
| Filter panels | #296 and #299 addressed width and phone checkbox interaction. | Preserve these fixes; do not duplicate their work under a visual redesign. |
| Upload and review | #292 added progressive upload steps; #301 and #302 improved review position and close counts. | Upload/review redesign is not part of this proposal. Preserve explicit service/mode choices and review safety. |
| Scope documentation | #297 reconciled release boundaries and owner decisions. | Consult `docs/current-release.md` and `docs/requirement-index.md`; older scope headlines are not new work. |
| Historical dates | Date editing and mixed-changeset undo remain deferred in the current release document. | This proposal does not promote either capability or authorize backdating. |

Before implementing any part, compare against the then-current main branch and
coordinate ownership of shared files. The other active instance may have
uncommitted or unmerged changes that this baseline cannot describe.

## 3. UI assessment

### 3.1 Main finding

The dark indigo palette, artwork and readable names are a good foundation.
The principal issue is hierarchy: controls and row editing compete with the
information needed to choose a title.

Desired reading order:

1. What is it?
2. On which services is it recorded in my list?
3. Does it fit tonight: type, runtime, genre and rating?
4. Am I watching it, or have I prioritised it?
5. When did nextup first see it, and what maintenance actions are available?

Service badges describe recorded membership, not guaranteed live availability.
The current owner decision provides no service-launch links; this proposal does
not change that.

### 3.2 Findings from the supplied screenshot

Measurements are approximate pixels in the supplied 1,194-pixel-high image,
not CSS pixels or measurements at a verified browser zoom.

| Priority | Observation | Impact | Proposed direction |
| --- | --- | --- | --- |
| High | First title starts about 470 pixels down, roughly 39% of the image height. | Too much screen precedes browsing. | Compress desktop controls into one or two purposeful rows. |
| High | Compact shows three complete titles and part of a fourth; full rows are about 190 image pixels tall. | Too few choices can be compared at once. | Improve meaningful density without hiding required information. |
| High | Title, rating, service and priority occupy distant columns with substantial unused space. | The owner must assemble a decision across the row. | Group related facts and use a predictable, small action area. |
| High | Service badges appear below the rating, far from the title. | Cross-service membership feels incidental. | Place service identity near the name or identifying details; reassess with the new marks. |
| Medium | Priority is a prominent bordered control in every row. | Maintenance competes with browsing. | Make Normal/Someday quieter while retaining visible state and editing; distinguish Up next/Watching. |
| Medium | Search spans nearly the whole width while narrowing options are concealed. | Known-title lookup dominates deciding what to watch. | Bound desktop search width; consider easy access to existing runtime/intent filters. |
| Medium | Reverse order is a standalone chevron. | Direction and next action are not self-explanatory visually. | Reassess the joined control; preserve one-click reversal and explicit direction. |
| Medium | Information chips, controls and structural panels share similar outlines. | Interactivity and hierarchy are harder to distinguish. | Differentiate facts, editable state and actions. |

### 3.3 Toolbar proposal

On desktop, group search, Filters and the live count on the left; current order,
reverse order and Grid/Compact on the right. Use two compact rows if needed.
Make the view selector content-sized rather than a full-width bordered strip.

At the assessment baseline, full-span grid placement for search and the view
selector carried mobile-style stacking into the wide screen. Recheck the latest
stylesheet before changing it.

Do not force desktop composition onto phones. Preserve wrapping, visible counts,
readable labels, 44-pixel targets, keyboard access and focus restoration. Save
space through grouping, not shrinking text.

### 3.4 Compact-row proposal

Group title, service, runtime and rating into a cohesive visual unit. Keep a
uniform poster alongside it, the honest nextup date as secondary information,
and priority/menu controls in predictable positions.

The assessed desktop grid used `26rem`, `11rem` and a content-sized third track.
That provides alignment but can separate related facts excessively. Preserve
alignment while sizing the composition around information needs.

An illustrative outcome is roughly six complete ordinary rows visible at a
comparable desktop viewport and zoom. This is not a fixed-height requirement:
long names, up to eight service badges, expanded genres and missing-data states
must remain readable. Grid and Compact retain the same data, order and actions.

### 3.5 Optional improvements, not approved scope

- Shortcuts for All titles, Watching and Up next could select existing filters,
  without duplicating rows or automatically reordering the list.
- An easily reached runtime filter could support choosing within the time available.
- Oldest-first remains directly accessible, but its label must mean entry into
  nextup rather than original service save time.
- "Last updated by service" may explain the service-date disclosure more clearly.
  Unknown-date notices remain visible outside it; no nags or age threshold.

Preserve dark indigo/violet, system fonts, visible genres, IMDb attribution,
per-episode TV runtime, explicitly submitted search, persistent query state and
review/undo safeguards. Do not add a recommendation hero, autoplay, extra
carousels, invented availability claims or "sync" language.

### 3.6 Proposed evaluation

"Shorter than Grid" and aligned columns are useful checks, but do not establish
usable Compact density. Evaluate first-row position, complete visible choices
and actual tasks: finding a title within a time budget, finding Watching/Up next,
identifying services, reversing order and clearing filters.

Exercise narrow screens, zoom, keyboard navigation, long names, eight badges,
expanded genres, unknown values and loading/error states. Use local browser
checks and owner walkthroughs, not analytics.

Existing coverage includes `T-UX-140`, `T-UX-141`, `T-UX-143`, `T-UX-145`,
`T-UX-146`, `T-UX-147` and accessibility suites. These are references, not
evidence that this unimplemented proposal passes. Any new measurable acceptance
criteria need approval, allocated test IDs and genuinely collected tests.

## 4. Initial-import history

### 4.1 The gap is semantic, not a timestamp bug

**New to nextup is not the same as recently saved on a streaming service.**

| Fact | Example | Evidence available |
| --- | --- | --- |
| First observed by nextup | 17 September 2026 | Known from import. |
| Originally saved on a particular service | Sometime in 2022 | Unknown unless supplied by the owner or visible, confirmed source evidence. |

PRD US-021 AC-4 explicitly anticipates importing years of saves at once and
assigning the import date to all of them. Honest "added to nextup" labelling
avoids a false claim, but does not restore the useful historical distinction.

Current dates are write-once. Title date sorting uses the earliest active
listing date, with a deterministic title-ID tie-breaker for equal dates.
Neither that tie-breaker nor screenshot receipt order encodes historical saves.

The mismatch also persists after onboarding at a smaller scale: a monthly
capture identifies when nextup first saw a title, not necessarily when it was
saved during the preceding month. Later imports create useful cohorts, not
exact source history.

### 4.2 Recommendation: keep observation dates intact

Do not backdate or reinterpret `dateAdded`. It participates in reconciliation,
ordering, restoration and provenance. Do not fabricate timestamps to improve
the apparent chronological spread.

Release year, screenshot time, file timestamps, upload sequence and extraction
reading order are not substitutes for the original save date.

REQ-059 and REQ-069 remain deferred and coupled in the authoritative documents.
This proposal recommends separate historical information, not silently promoting
editing of the existing date. New metadata still requires its own undo analysis.

### 4.3 First option: an explicit initial-collection classification

Propose an optional owner-confirmed classification:

> Initial collection: saved before you started using nextup; original save date unknown.

This would sit alongside, not replace, the existing verbatim nextup date.
An optional filter would support deliberately browsing this collection.

Keep classification independent of Add only / Full update and their safety rules.
Do not automatically group, reorder, hide or mark titles based on the first batch.
The initial collection can span several services, batches and days, and a first
batch may mix long-held and recent saves.

For completed imports, a future review flow could select the relevant genuine
additions from batch provenance for owner confirmation. Do not classify every
title mentioned in a batch: later full updates also include existing titles.
No deletion or re-import should be necessary.

**Limit:** this separates the existing collection from later additions; it does
not reconstruct chronology within the collection.

### 4.4 Optional extension: separately sourced historical dates or periods

Only if chronology within the initial collection matters, consider optional
historical information with explicit precision and provenance.

| Concept, not approved schema | Intended meaning |
| --- | --- |
| Original saved date or period | When the work was saved on a particular service, if known. |
| Precision | Exact date, month, year or unknown. A coarse estimate must not display as an exact day. |
| Provenance | Owner-entered, owner-estimated, or explicitly visible source evidence confirmed by the owner. |

Do not require reconstruction of hundreds of dates to finish onboarding.
Unknown is valid. Rough years or periods may be sufficient for rediscovery.
Association with the relevant service membership avoids copying one service's
history onto another.

A separate historical sort would need explicit semantics before implementation:
unknown values remain visible; overlapping approximate periods are not an exact
chronology; an earliest known date is not necessarily the actual earliest date
when another service's history is unknown. Do not silently replace default sorting.

### 4.5 Conditional alternative: preserve relative source order

A screenshot can potentially preserve relative order if the owner establishes
that the source view really is ordered by save time. It cannot supply missing dates.

Recommendation order, manual reordering, overlapping or missing screenshots and
file selection order invalidate an automatic assumption. A future feature would
need a confirmed source order and reviewed sequence. Existing extraction ordinals
are not a historical-order contract.

Even reliable order within one service cannot establish chronology across services.
This alternative is conditional, not an instruction to infer dates from screenshots.

### 4.6 Immediate workaround

Use current Watching and Up next choices to surface a manageable subset, and
service/genre/runtime/rating controls to browse the remaining backlog. Keep the
true nextup import dates. This improves decisions now but does not recover
information absent from the source and the owner's knowledge.

## 5. Decisions before implementation

| Decision | Proposed starting position | Still unresolved |
| --- | --- | --- |
| Initial-history scope | Start with optional initial-collection classification. | Is that sufficient, or is actual within-collection chronology needed? |
| Classification ownership | Owner-confirmed; no inference from first batch/date alone. | Work-level versus service-listing-level storage and mixed-membership display. |
| Existing imports | Review genuine additions from selected batches. | Exact selection UX, provenance availability and correction/undo semantics. |
| Historical entry | Optional exact or approximate facts with explicit provenance. | Whether to build this extension, allowed precision and efficient bulk entry. |
| Historical ordering | Separate from existing date-added sorting. | Unknown placement, overlapping periods, ties and cross-service aggregation. |
| Restore/reappearance | Preserve current lifecycle rules. | Whether new historical metadata survives restore or is offered for explicit reuse after reappearance. No automatic carry-forward is approved. |
| UI composition | Retain the approved visual identity and capabilities. | Final responsive layout and measurable density targets after reviewing current work. |

These decisions are intentionally not encoded as migrations, API fields or new
requirements. Documentation approval is not implementation approval.

## 6. Implementation handoff boundaries

After owner decisions, reconcile with current main and coordinate file ownership.
UI refinement and history support should be independently reviewable.

Historical metadata would require coordinated data-model, API, review, recovery,
sorting and undo work. Define how later owner edits survive subsequent captures
and how undo respects those edits. Do not assume a separate field makes undo safe.
Do not introduce background list mutations.

Authoritative specifications, acceptance mappings and real tests should change
together through the normal backlog process when implementation is authorized.
Do not add invented IDs or broaden coverage baselines to make a proposal appear
implemented. This branch is limited to proposal documentation and standalone
mock artifacts, not application changes.

## 7. Sources

- `docs/BRD.md`, section 4: decision speed, trust and rediscovery objectives.
- `docs/PRD.md`, US-020/US-021 and section 11: date semantics, initial imports,
  deferred date editing and undo coupling.
- `docs/current-release.md`: current scope and subsequent owner decisions.
- `docs/requirement-index.md`: reconciled requirement identifiers.
- `specs/ui.md` and `specs/ui-refresh.md`: approved library presentation and interaction contracts.
- `specs/data-model.md`: first-observed dates, sort derivation and image sequence.
- `specs/testing.md`: existing named acceptance checks.
- Historical source snapshot:
  [list composition](https://github.com/saquibrashid/nextup/blob/3820528/apps/web/src/pages/ListPage.tsx),
  [row composition](https://github.com/saquibrashid/nextup/blob/3820528/apps/web/src/components/TitleRow.tsx),
  [layout rules](https://github.com/saquibrashid/nextup/blob/3820528/apps/web/src/index.css).

The original screenshot remains in the owner's conversation; it is not packaged
as a repository asset here. Its measured observations are recorded in section 3.2.
