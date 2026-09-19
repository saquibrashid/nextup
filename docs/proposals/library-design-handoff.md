# Library design handoff and proposed next steps

**Status:** Library-first implementation authorized 2026-09-18. `TASK-221` in
`docs/backlog.md` is the work order for the first composition slice; remaining
decisions below retain their explicit boundaries.

**Date:** 2026-09-18.

**Baseline:** Mockups merged in [PR #313](https://github.com/saquibrashid/nextup/pull/313),
commit `4e6bbae4778d0015008b0629b106e13c4e91f925`. Application references below
were inspected at that baseline. Refresh against current main before any future
implementation; other work may continue independently.

**Owner direction:** Retain the refined layout/hierarchy, use the purple/indigo
theme, add intentional metadata colors and subtle depth, and preserve restrained
motion. The owner chose **mockups only**, then requested merging and documenting
next steps while refraining from building. Visual approval does not approve new
data fields, navigation defaults, historical-date behavior or a deployment.

**Capture/review follow-up, 2026-09-18:** The owner also endorsed the connected
upload/review study and requested publishing its documentation, mock and
previews. The [capture/review design record](capture-review-design.md) preserves
that feedback, the proposed guided sequence, safeguards, open decisions and
the original non-building next steps. The owner subsequently authorized
**Library first: Comparison desk as Compact
and Cover browser as Grid**, and approved a single final-summary step for both
update modes. The latter is reserved for subsequent upload/review work.

## 1. What is available

| Reference | Purpose | Boundary |
| --- | --- | --- |
| [Assessment and initial-import proposal](ui-and-initial-import-history.md) | Original product intent, UI assessment and the distinction between import time and original service-save time. | Initial-history product decisions remain open. |
| [Mock gallery and design notes](mocks/README.md) | Canonical inventory, dimensions, color roles, previews, walkthrough and prototype evidence. | This handoff links to those details rather than maintaining a second geometry specification. |
| [Study 01](mocks/library-study.html) | Original Compact/Grid composition and the initial-collection selection/review/confirmation concept. | Retained comparison reference, including the earlier charcoal/rose palette. |
| [Studies 02/03](mocks/layout-alternatives.html) | Cover browser and Comparison desk, with the final indigo styling and shared sample-state interactions. | Primary visual direction; not wired into the real app. |
| [Capture/review proposal](capture-review-design.md) and [study 04](mocks/capture-review-study.html) | A connected service/mode/capture/review/confirmation exploration using the same visual direction. | Final-summary interaction approved; production work follows library. Remaining extraction/recovery designs still need review. |
| [Dark desk](mocks/comparison-desk-desktop.png), [light desk](mocks/comparison-desk-light.png), [phone](mocks/comparison-desk-phone.png) | Review snapshots of the refined composition. | Screenshots cannot demonstrate interaction, assistive-technology behavior or API parity. |
| [Cover browser](mocks/cover-browser-desktop.png) | Approved artwork-led direction for Grid. | Prototype density is not a production acceptance target; first-slice cards use bounded 160px artwork on desktop. |

The HTML files run locally without a server. Search, filtering, sorting and
preference edits use in-memory sample data; reload/reset discards them. Memberships,
ratings, dates and abstract cover art are illustrative. No real provider requests
or streaming credentials are involved.

## 2. Visual direction to carry forward

The objective remains **choosing what to watch from one trustworthy combined
list**, not adding decorative content or turning nextup into a streaming player.

| Principle | Reviewed treatment | Future implementation boundary |
| --- | --- | --- |
| Composition | Bounded page width, intentional column allocations, cohesive metadata groups and consistent priority-control geometry. | Preserve the balance, not necessarily every prototype pixel value. Use the product's spacing, breakpoint and touch-target mechanisms. |
| Hierarchy | Title first; service membership, runtime and rating easy to compare; import dates quieter but readable. Watching is separate from priority. | Do not remove metadata, genre expansion, status text or row actions to achieve density. |
| Primary color | Violet actions and selection on dark ink/indigo surfaces. | Retain the approved dark foreground on accent-filled controls; white text is not interchangeable. |
| Secondary and semantic color | Periwinkle service metadata, soft-gold IMDb scores, green Watching state and neutral historical dates. | Keep text labels. Periwinkle is not a provider brand; gold is neither a recommendation nor a score threshold. Warning/danger retain separate meanings. |
| Depth | Neutral layered shadows, restrained gradients, raised surfaces and quiet separators. | Depth must not hide focus outlines, change hit areas or make noninteractive badges look like launch buttons. |
| Typography | System fonts, repeated weights and spacing, tabular numerical values and a slightly stronger rating treatment. | Translate into the existing closed type scale; do not introduce a web font or copy isolated font-size literals into production. |
| Feedback | Hover, focus and pressed states; 120-180ms fades/scale effects using paint/compositing properties. | Reduced motion disables the effects. Preserve geometry and immediate keyboard-focus feedback. |

The light preview is a coordinated **mock companion**, not approval to ship a
production theme switch. The style tokens in standalone HTML are not a second
production design system: future application work should use or deliberately
extend the existing tokens in `apps/web/src/index.css`.

## 3. Decision record and remaining boundaries

| Decision | Proposed starting position | Required resolution |
| --- | --- | --- |
| Layout mapping | Comparison desk as Compact and Cover browser as Grid. | Approved 2026-09-18. No third production layout. |
| Default and persistence | Preserve the current Grid default and existing preference lifetime. | Any new default or persistence mechanism requires explicit approval. |
| Phone composition and density | Keep the complete, labelled information while reducing wasted space. | Agree on viewport/zoom, first-title position, complete visible choices and task-based success criteria. Do not infer a density waiver from positive feedback on styling. |
| Artwork-led desktop density | Retain recognition benefits without hiding practical choices below the fold. | Decide whether the current tradeoff is acceptable on shorter laptop screens, or needs another mock revision first. |
| Filter entry points | Consider a persistent desktop rail with the existing small-screen dialog. | Confirm where the rail appears and how its state, clear action, focus and dialog counterpart stay consistent. |
| Theme scope | Ship only the existing dark indigo product theme in an eventual first slice. | Confirm before treating the mock's light preview as product scope. |
| Initial collection | Keep it a separate optional, owner-reviewed history proposal. | Decide whether to build it at all, then resolve ownership, provenance, correction/undo and lifecycle rules independently. |

### Density evidence that must not be glossed over

At the recorded mock viewports, Comparison desk shows seven complete rows at
1440 x 1080 and five at 1280 x 900. Cover browser shows five complete cards at
1440 x 1080 but **zero complete cards at 1280 x 900**. Both alternatives show
one complete choice at 390 x 844, versus two in study 01.

These captures include the prototype-only toolbar and use sample metadata;
they are not production measurements. The earlier balanced-density guidance in
`specs/ui-refresh.md` section 2 mentions roughly six titles on a phone. That
guidance and these results need explicit reconciliation, not a silent change to
the acceptance bar. Prefer owner tasks such as finding a short title, comparing
two services, finding Watching/Up next and reaching oldest-first over an
unqualified screenshot-density claim.

## 4. Prototype-to-product parity checklist

**Do not paste the standalone HTML/JavaScript into the SPA.** Preserve the live
React component lifecycle, server-owned data and existing accessibility contracts.

| Area | Mock simplification or omission | Product behavior to preserve / references |
| --- | --- | --- |
| Search and paging | All sample titles are already in memory. | Explicit submitted search reaches the server before paging. Preserve cursors, load-more behavior, lower-bound counts and unrelated query state. `T-UX-140`, `T-API-030`; `ListPage.tsx`, `ListSearch.tsx`, `LoadMoreSentinel.tsx`. |
| Sorting | Four fields and a simple in-memory comparator; runtime starts shortest-first. | Keep all six API fields, their actual defaults, URL/back/forward/session precedence and a visible one-action reversal. The product's inactive runtime default is longest-first. `T-UX-138`, `T-UX-146`; `SortControl.tsx`. |
| Filter dimensions | Type/genre/runtime use simplified single selections. | Preserve URL-driven multi-select dimensions, OR within a dimension, AND across dimensions, chips, clear behavior and immediate dialog changes. `T-UX-139`, `T-UX-144`, `T-UX-145`; `FilterBar.tsx`, `FilterDisclosure.tsx`. |
| Runtime | Shortcuts illustrate upper limits; the desk says `Unknown`. | Preserve the actual half-open runtime buckets, `/ep` meaning, shared formatting rules, `Runtime unknown` copy and the **server's** hidden-unknown count. `T-UX-121` through `T-UX-124`. |
| Layout representation | The artifact renders separate hidden gallery/table trees. | The product has one ordered `TitleRow` tree. Keep identical metadata, actions and state across preferences; choose accessible semantics without duplicating independent lists or state. `T-UX-141`; `TitleList.tsx`, `TitleRow.tsx`, `ListViewControl.tsx`. |
| Genres and services | Sample genres are plain text; service marks are text badges. | Preserve canonical genre mapping, full-name expansion and active-genre visibility; preserve all eight services and current service marks. No streaming-service launch links. `T-UX-127`, `T-UX-141`; `GenreChips.tsx`, `ServiceMark.tsx`, PRD US-061 and current-release decisions. |
| Preferences and row actions | Sample preference Save/Cancel only. | Retain real API saves, per-title pending restrictions, error reporting, offline behavior, menus, add/remove, suppression and fix-match flows. Presentation must not bypass existing dialogs or confirmations. `ListPage.tsx`, `WatchPreferencesDialog.tsx`, `RowMenu.tsx`. |
| Shell and freshness | Prototype controls and a sample-only header replace the app shell. | Keep real navigation, Upload/More, phone safe-area clearance, attribution and factual service updates including unavailable-state disclosure. No staleness nag. `T-UX-137`, `T-UX-143`; `AppShell.tsx`, `FreshnessStrip.tsx`, `TmdbAttribution.tsx`. |
| Loading and failures | No real network lifecycle, recovery or pagination states. | Preserve loading, slow-response, retry, offline, no-match, never-imported and all-removed distinctions. Do not animate fake progress or show a success-shaped fallback. `T-UX-010`, `T-UX-141`; `ListEmptyState.tsx`, `SlowResponseNotice.tsx`. |
| Visual/accessibility behavior | Local Chromium samples and standalone CSS. | Meet real token contrast, 44px targets, native-control and focus contracts, zoom/wrapping, reduced motion and mobile-browser behavior. `T-UX-142`, `T-CSS-004`, `T-A11Y-001`, `T-A11Y-016`, `T-A11Y-017`. |

Component filenames in this table are under `apps/web/src/components`, except
`ListPage.tsx`, which is under `apps/web/src/pages`. Copy remains centralized in
`apps/web/src/copy.ts`; visual changes should reuse the existing `components/ui`
primitives and inline icon vocabulary.

### Existing summary drift to reconcile, not implement literally

- `specs/ui-refresh.md` section 2.1 still summarizes the service registry as
  Netflix/Max. [Current release](../current-release.md) and PRD US-061 establish
  **eight services**. Do not shrink the current product to the old summary.
- `specs/testing.md` US-057 AC-4 describes name ascending and all other defaults
  descending. Current `SortControl.tsx`, `apps/api/src/routes/titlesQuery.ts`
  and `apps/web/test/sortControl.spec.tsx` also make **watchPriority ascending**.
  Reconcile the summary with the current ordering contract; do not change the
  API or comparator as part of a visual refresh.

These are recorded findings, not edits to authoritative documents in this pass.

## 5. Keep initial-import history independent

The mock's **Initial collection** filter and labels are not existing production
fields to wire up. Their visual inclusion does not resolve the original
proposal's product decisions.

Continue to distinguish **first observed by nextup** from **originally saved
on a streaming service**. Keep `dateAdded` immutable, with title-level date
ordering derived from the earliest active listing. Never infer historical dates
from release year, upload time, screenshot order or the first batch.

Before any history implementation, resolve work-versus-listing ownership,
review of genuine additions from prior batches, correction/undo, multi-service
display, restore/reappearance and whether approximate historical dates are
needed at all. See the [original proposal, sections 4-5](ui-and-initial-import-history.md).
No schema, migration, API, background work or automatic classification is
authorized here. A visual-only implementation should omit unsupported history
controls rather than ship sample state or nonfunctional placeholders.

## 6. Implementation sequence and remaining stop points

The first library composition slice is now allocated as `TASK-221`. Remaining
work packages below are not blanket authorization for data, defaults or other
page changes.

| Phase | Activity / deliverable | Exit condition |
| --- | --- | --- |
| Documentation | Completed and merged in #316. Preserve artifacts, visual rationale, parity gaps and unresolved decisions. | Original documents-only boundary subsequently superseded for the approved library slice. |
| Owner decision review | Library-first and mode mapping approved; remaining section 3 choices stay bounded. | Further changes to data, defaults or filter navigation need their own decisions. |
| Current-main reconciliation | Inspect the then-current UI/state ownership, resolve the summary drift above and coordinate with other active work. | Agreed component/file ownership and a complete capability-parity checklist. No unrelated route or backend rewrites. |
| Approval and traceability | Library build authorized; `TASK-221` and `T-UX-155a`–`c` allocated. | Current geometry is promoted in `specs/ui.md` and acceptance in `specs/testing.md`; no weakened coverage thresholds. |
| Library visual foundation | Adapt semantic colors, elevation, type and interaction states using existing CSS tokens/primitives. | Existing contrast, class-vocabulary and accessibility contracts preserved; owner review before further composition changes. |
| Library composition and controls | Adapt the shared title presentation and approved mode mapping, retaining current filter/sort dialogs. | Same real content/actions/order in each layout; persistent filter rail and column headers remain outside this first slice. |
| Future release review | Review realistic long lists, device/zoom/accessibility cases and actual API lifecycle states; compare against the old production UI. | Named CI gates plus owner visual/interaction acceptance. Deployment remains a separately authorized action. |

If a new PRD story or UX state is needed, its mapping and genuinely collected
tests must arrive with its promotion, as specified by the existing repository
process. Do not add unimplemented stories now or relax coverage gates to create
a planning placeholder. `docs/backlog.md` remains the work order;
`specs/testing.md` remains the acceptance mapping.

History support, if approved, follows its own product/data/undo design sequence.
It is not a dependency of the presentational refresh unless the owner explicitly
chooses to couple them.

## 7. Evidence for implementation and release review

Reuse the named existing tests above for regression protection. `T-UX-155a`–`c`
now cover separate Watching/priority semantics, color contrast, five viewport
widths, equal controls, artwork bounds and row-action clearance. Further
composition changes need their own agreed measurements; these tests do not
prove that deferred features have been built.

The review matrix should cover both preferences, real poster aspect ratios and
failures, long titles, eight service marks, expanded/active genres, missing
runtime/rating, identical import dates, narrow screens, zoom, keyboard focus and
reduced motion. Include multiple pages of results, query history, runtime-hidden
counts, pending writes, failed saves, offline restrictions, empty-state recovery
and factual freshness degradation. Recheck text >= 4.5:1 and interactive
boundaries >= 3:1 on actual normal, selected, hover and focus surfaces.

Use `apps/web/test/` for collected web component tests and `tests/e2e/` for
Playwright, following `specs/testing.md` section 11. Real-browser layout and
focus evidence must supplement DOM/CSS-source assertions. Session-local mock
scripts and screenshots are useful design evidence, not a replacement for
production acceptance tests or real-device review.

**Current implementation boundary:** `TASK-221` adapts the shared title tree,
semantic colors, equal priority controls, bounded comparison columns and
portrait-led cards. It retains existing filters/sort dialogs and their real
URL/API ownership. Sidebar composition, historical-import features and
upload/review implementation are not included. No deployment is authorized.
