# UI design studies

**Handoff:** [Reviewed design, open decisions and proposed next steps](../library-design-handoff.md).
The library mockups were merged in PR #313 and the guided-flow handoff in #316.
The owner subsequently authorized library-first implementation (`TASK-221`);
the HTML files remain offline design studies, not the running application.

**New workstream:** [Guided capture/review proposal](../capture-review-design.md).
Study 04 extends the visual direction to screenshot upload and batch review.
It is a new, mock-only proposal, not part of the earlier library merge.

All studies are standalone HTML files. Open them directly in a browser; no
server or build is needed. The first study is retained unchanged so the
alternatives can be compared against it.

| Study | Open | Emphasis | Tradeoff |
| --- | --- | --- | --- |
| **01: Compact library** | [Original interactive mock](library-study.html) | A refinement of the existing row layout, including the initial-collection confirmation flow. | Balanced density and artwork; controls still occupy several lines on a phone. |
| **02: Cover browser** | [Additional layouts](layout-alternatives.html?layout=browse) | Larger portrait covers for recognition, with service badges and practical facts beneath them. | More visual browsing, less desktop density. On phones covers move beside the metadata. |
| **03: Comparison desk** | [Additional layouts](layout-alternatives.html?layout=compare) | Aligned service/runtime/rating/priority columns and a persistent wide-screen filter rail. | Easier factual comparison, but more administrative in appearance. On phones columns become labelled fields. |
| **04: Guided capture and review** | [Connected workflow](capture-review-study.html) | Service → mode → screenshots → grouped review → exact change summary, in the refined indigo theme. | Proposes a final summary for both modes; that interaction and production parity still need approval. |

## Capture/review previews

| Stage | Desktop | Phone |
| --- | --- | --- |
| Upload | [Preview](capture-upload-desktop.png) | [Preview](capture-upload-phone.png) |
| Review | [Preview](capture-review-desktop.png) | [Preview](capture-review-phone.png) |
| Final summary | [Preview](capture-confirm-desktop.png) | [Preview](capture-confirm-phone.png) |

For study 04, choose a service and mode, use **sample screenshots**, then preview
the extraction. **Prototype tools** can jump to either review mode and demonstrate
offline, incomplete-extraction and failed-apply states. All review data and
evidence are synthetic; actual local attachments are not analyzed or uploaded.
Upload previews show the answered setup and sample queue; the HTML starts
unanswered. Full-page overviews place the action bar at the document end to avoid
obscuring rows; it remains sticky in the interactive file.
See the [capture/review note](../capture-review-design.md) for preserved safeguards,
intentional interaction changes, limitations and proposed next steps.

## Library alternatives

Studies 02 and 03 share one sample dataset and in-memory state. Switch between
them using the buttons above the app: search, filters, order and sample
preferences stay intact. The view choice does not reorder titles or create
separate copies of the collection.

## Additional-layout previews

| | Desktop | Phone |
| --- | --- | --- |
| Cover browser | [Preview](cover-browser-desktop.png) | [Preview](cover-browser-phone.png) |
| Comparison desk | [Preview](comparison-desk-desktop.png) | [Preview](comparison-desk-phone.png) |

Try narrowing to Netflix and movies in the Comparison desk, then switch to
Cover browser. The same matches should appear in the same order. Try the
initial-collection quick view in both; its honest import-date meaning stays
unchanged. Study 01 remains the place to try changing collection labels.

**These are alternatives, not a recommendation to ship three production
layouts.** In particular, the Comparison desk's phone layout deliberately
prioritizes explicitly labelled fields over density; the first study's more
compact rows remain available for comparison.

In studies 02/03, filters apply immediately in both the sidebar and the small-screen
dialog; Done/Escape close the dialog without undoing the chosen filters.
Sample priority edits still require explicit Save. The service dimension is
multi-select; the other illustrated facets remain simplified single selects.
The four demonstrated sort keys do not replace the full production set.

Illustrative metadata, lack of storage/networking, and separation from
production implementation apply to every study.

**Palette update, 2026-09-18:** at the owner's request, studies 02/03 now use
nextup's purple/indigo theme. Dark background, surface, text, secondary text,
interactive border, accent and danger values match `apps/web/src/index.css`;
supporting tints extend those colors without changing layout or behavior.
Accent-filled controls retain the approved dark foreground, not white text.
The light lavender/indigo preview is a mock-only companion, not a new approved
production theme. The refined hover/focus states and 120-180ms motion remain.
Study 01 and the archived before-refinement screenshot retain their original
charcoal/rose palette for comparison.

The subsequent visual-richness pass keeps that layout and primary palette,
but gives supporting colors distinct roles:

| Role | Treatment |
| --- | --- |
| Actions and selection | Violet: primary controls, Up next, selected tabs, focus outlines. |
| Service metadata | Cool periwinkle labels and subtle tinted badge surfaces. The color identifies a metadata category, not individual streaming-service brands or live availability. |
| IMDb scores | Slightly larger, tabular soft-gold numbers. Missing ratings stay neutral; gold is not a recommendation or a score threshold. |
| Watching | A readable green label and a quiet, non-animated status dot. The existing text remains, so color is never the only indicator. |
| Historical metadata | Muted dates, with a restrained secondary-color Initial collection label; no warning or recapture prompt. |
| Semantic colors | Separate success, warning and danger tokens. Rating gold has its own token and is not a warning state. |
| Depth | Neutral layered shadows replace the broader violet glow. Raised headers, restrained surface gradients and inset highlights establish depth without changing element dimensions. |

This pass changes only CSS inside the interactive artifact. Markup, sample
data and JavaScript are unchanged. Default layout bounds were compared against
the preceding indigo draft at 280, 390, 900, 1280 and 1440px in both layouts.
The sub-200ms motion and reduced-motion behavior are retained.

### Refinement: consistent geometry and visual rhythm

The 2026-09-18 refinement addresses the owner's annotated screenshot: priority
buttons sized to their labels, a Watching label changing the button's shape,
and percentage-based columns leaving gaps while crowding the action area.

| Element | Deliberate treatment |
| --- | --- |
| Page width | A centered 1248px outer frame prevents the table stretching across a wide monitor. Without the filter rail, the comparison frame narrows to 1040px. Extra viewport space becomes an outer margin, not an expanding hole between facts. |
| Columns | Services, runtime, rating, priority and date have content-sized allocations of 176, 112, 80, 168 and 168px. The title takes the remainder. This protects the control and date columns instead of compressing them into percentages. |
| Priority controls | The same 128 x 44px box, padding and 16px SVG chevron for Normal, Up next and Someday. All controls shrink equally when narrow phone columns require it; the height stays 44px. |
| Watching | A separate text-and-dot status beside title metadata, not another line inside the priority button. Progress and priority no longer compete for the same visual treatment. |
| Alignment | Header labels align with their column values; numeric ratings align right. Priority buttons and runtime cells share a vertical center. A quiet rule separates comparison facts from personal controls. |
| Spacing | Table cells use 16px horizontal and 12px vertical padding. Service labels have a consistent 24px minimum height. Thumbnail proportions, text hierarchy and chevron offsets repeat across rows. |
| Toolbar | Search and its submit icon form one joined field, using the space beside fixed-width sorting controls. The filter heading aligns with the collection tabs. |
| Smaller screens | Two-column comparison cards on tablets, one column on phones. Prototype utilities become labelled icon buttons, leaving a single compact study-toolbar row. Long titles and multiple badges wrap rather than disappear. |

The same priority controls and service-label treatment carry into the Cover
browser. The original study 01 is unchanged.

Compare the [previous desktop draft](comparison-desk-before-refinement.png)
with the refined [dark desktop](comparison-desk-desktop.png),
[light desktop](comparison-desk-light.png) and
[phone](comparison-desk-phone.png) captures.

### Additional-layout review evidence

Local Chromium review exercised both layouts at widths from 280 to 1866 CSS
pixels, including long titles, eight service badges and missing metadata.
Search submission, OR-within-service/AND-across-facet filtering, layout-switch
state preservation, preference Save/Cancel, oldest-first reversal, unknown-last
runtime sorting, dialog dismissal and empty-state recovery were exercised.
Sampled light/dark and dialog accessibility checks found no violations;
the browser reported no script errors or external requests.
Geometry checks additionally compared priority-button dimensions and chevron
offsets across every visible item, verified vertical alignment with runtime
cells, and rejected overflowing control labels or content crossing table-cell
boundaries. Both sides of the table/card and sidebar breakpoints were exercised,
as was the phone's light/dark toggle.

| Viewport | Cover browser: complete cards | Comparison desk: complete rows |
| --- | --- | --- |
| 1440 x 1080 | 5 | 7 |
| 1280 x 900 | 0 | 5 |
| 390 x 844 | 1 | 1 |

**The artwork-led option has a real cost:** at 1280 x 900, the first row's
artwork and key metadata are visible, but the full cards extend below the
viewport. Neither alternative beats study 01's two complete rows at 390 x 844.
These measurements include the prototype-only study toolbar and describe
the default sample state, not filtered or long-title cases. Compare the HTML,
not just the large desktop screenshots, before choosing a direction.

This is bounded prototype evidence, not production acceptance coverage.

## Study 01 walkthrough

Open [library-study.html](library-study.html) directly in a browser. It is a
self-contained, offline prototype: no build, server, account or dependencies.

This mock accompanies [the proposal](../ui-and-initial-import-history.md).
It does not change application code, active specifications or the backlog.
Sample edits exist only in the open page; reload to discard them.

### Views to review

| View | What to look for |
| --- | --- |
| Compact library | Smaller control footprint, service identity beside the title, runtime and rating together, quieter priority editing and an honest secondary import date. |
| Grid library | The same titles, facts, order and actions, with a more spacious composition. This is a layout comparison, not a second data source. |
| Initial collection | Select the quick view to see how an existing collection can be distinguished without inventing historical dates. |
| Collection review | Use **Review initial collection**, change a selection, review the exact changes, then confirm. Nothing changes before confirmation. |
| Date explanation | Open a row's **Details** button to distinguish its known nextup observation date from an unknown original save date. |
| Edge cases | Under **About this mock**, include the long title with eight services and the title with missing metadata. |

### Suggested walkthrough

1. Compare Compact and Grid on a laptop and a phone-sized window.
2. Choose **Up next**, then **Under 2 hours**. On a phone, quick views are in
   the collection dropdown and runtime is under **Filters**. Submit a search;
   typing alone does not filter. Clear constraints and reverse the date order.
3. Open **Filters**, select a service and choose **Show titles**.
4. Open a row's priority control, change Watching or priority and explicitly save.
5. Choose **Initial collection**. Notice that the import dates remain visible,
   and that the explanatory text does not claim a historical ordering.
6. Open **Review initial collection**, mark an unclassified sample such as
   Andor, then choose **Review changes**. Cancel or go back before confirming
   to check that no label or date changes prematurely.
7. Confirm the label in the mock. The initial-collection count updates; import
   dates, services and default ordering do not change.

### Deliberate prototype boundaries

- All memberships, ratings and dates are illustrative, not verified facts or
  live availability. Artwork is original abstract placeholder design.
- The HTML artifact uses the Clawpilot charcoal/rose presentation palette and
  supports light/dark previews. **This is not a proposal to replace nextup's
  approved indigo/violet product theme.** Review layout and hierarchy separately
  from the artifact palette.
- Text service labels make proximity easy to judge. Production service marks,
  app navigation and their existing contracts are not being replaced.
- The mock defaults to Compact to foreground the assessment. It does not change
  the product's approved default presentation.
- The service filter is multi-select, while type/genre use single selects here.
  Filters apply on confirmation; this is a simplified prototype interaction,
  not a change to production URL-driven multi-select behavior.
- Four illustrative sort keys and a one-action reverse control are exercised.
  The other production sort keys are not proposed for removal.
- The initial-collection selector uses title-level choices for visual review.
  Work-level versus service-listing-level storage, undo and reappearance
  semantics remain open decisions in the proposal. Prechecked sample titles
  represent previously owner-confirmed labels, not inferred history.
- Runtime shortcuts use strictly-less-than bounds. Unknown runtime is excluded
  by a time limit and remains visible without one; TV runtime is per episode.
- State is local to this page, not persisted in a database, URL or local storage.
  Reset is available in **About this mock**.
- Upload, destructive row actions, paging, network failures and optional
  historical-date entry are outside this bounded study. A mock cannot establish
  that production integration or accessibility criteria pass.

### Files

- `library-study.html`: the interactive mock; this is the primary deliverable.
- [Desktop Compact](desktop-compact.png) and [desktop Grid](desktop-grid.png).
- [Phone Compact](phone-compact.png).
- [Initial-collection view](initial-collection.png).
- [Desktop confirmation](collection-review.png) and [phone confirmation](phone-collection-review.png).

Screenshots are sample captures of this HTML, not the live app. Open the HTML
to judge keyboard behavior, responsive reflow and the changes between states.

### Prototype review evidence

Browser review on 2026-09-18 used local Chromium, without a server or external
requests. Compact/Grid, filters, submitted search, explicit preference saving,
empty-state recovery, sort reversal, and collection-selection cancel/confirm
paths were exercised. Collection confirmation preserved sample dates and order.

At 1440 x 1080, the compact view displayed six complete sample rows with the
first starting around 328 CSS pixels from the viewport top, including the
prototype-only toolbar. At 390 x 844, two complete rows fit. These are mock
measurements, not directly comparable with image pixels at an unknown browser
zoom in the original screenshot.

Automated accessibility checks covered sampled dark/light and dialog states,
along with narrow-screen overflow and control sizes. This is prototype evidence,
not a production accessibility certification or a replacement for the
repository's named acceptance tests.

No production implementation is authorized by these mock files.
