# `specs/ui-refresh.md` — the UI refresh: requirements and design

> ## STATUS: EPIC P SHIPPED; REFINED INDIGO LIBRARY APPROVED 2026-09-16.
>
> Epic P shipped in #275. After reviewing the interactive indigo/violet
> mockup, the owner approved implementation on 2026-09-16. ADR-0013 Revision 1
> records that approval. The refined controls replace the original separate
> sort segments and add an explicit grid/compact preference.
>
> **Decisions and rationale live in `docs/adr/ADR-0013-ui-refresh.md`.** This
> file is the executable detail: what must be true, and what it looks like.

---

## 1. Why these requirements are HERE and not in `docs/PRD.md`

⚠ **THIS SECTION IS THE ONE THAT SAVES A BUILD, SO READ IT BEFORE MOVING A
SINGLE LINE OF THIS FILE ANYWHERE ELSE.**

The obvious thing to do with new requirements is to append them to
`docs/PRD.md` and add their states to `specs/ux-states.md`. **Doing that today
breaks CI**, and it does so for a reason that is correct and must not be
worked around:

| Gate | Rule |
|---|---|
| `T-META-001a` (`tests/meta/acCoverage.spec.ts`) | **Every** `US-nnn AC-n` in the PRD must have a row in `specs/testing.md` §9. |
| `T-META-001e` | Every test id cited in that mapping must exist **in `it()` title position** in a real file. |
| `T-META-007a` (`tests/meta/uxStateCoverage.spec.ts`) | Every state id in `specs/ux-states.md` must have a test. |

Their `KNOWN_UNMAPPED` baselines are **shrink-only**, and the file says in
terms: *"Do NOT add to this list to make a build pass."* So an unimplemented
story in the PRD has exactly two outcomes — a red build, or a widened baseline
that permanently weakens the gate that guarantees this product's requirements
are tested. **Neither is acceptable, and the second is worse because it looks
like success.**

**Therefore the sequencing is fixed:**

1. **Before approval** — new requirement text lives here as *proposed*, with
   ids reserved only after collision checks. Epic P's original stories have
   since been promoted; the 2026-09-16 refinement is approved, not proposed.
2. **On approval to build** — each new story moves into `docs/PRD.md`, its
   states into `specs/ux-states.md`, its `specs/testing.md` §9 rows and its
   **real tests** land **in the same change**. That is what keeps the gate green
   without ever relaxing it.
3. **The design sections** (§4 – §7) fold **in place** into `specs/ui.md` §2
   and §13, per the repository's supersede-in-place rule for executable
   instructions. `specs/ui.md` is not superseded by a banner pointing here.

`T-INFRA-014` (`tests/infra/specPaths.spec.ts`) is satisfied: it fails only
when a spec names a path under an existing directory that is absent **while a
file of that name exists elsewhere**. Every path named below either exists or
is explicitly labelled *proposed, does not exist yet*.

---

## 2. What the owner asked for

From `docs/adr/ADR-0013-ui-refresh.md` §2 — **the owner's own answers**, not an
inference from them:

| | |
|---|---|
| Row layout | **Grid / Compact** choice, identical content and actions; responsive grid remains the default (approved 2026-09-16) |
| Density | **Balanced** — ~6 titles visible on a phone, metadata trimmed |
| Accent | **Indigo/violet on dark ink surfaces** (approved 2026-09-16; replaces light-only) |
| Posters | **Larger and uniform** |
| Pain points | *"better navigation. improve the filter/ordering ux"* |
| Runtime *(added at `A48`)* | *"for the list view, I'd like to see run time as well and filter and sort by it"* — a direct request, and the recorded revisit trigger for the deferred REQ-035/REQ-037 pair. Answered in §5a |
| **Genres on the row** *(added 2026-09-14, OQ-7)* | *"keep generes on the row but find a way to minimize how much room it takes. use another ux to make it compact but still list the genres."* Answered in §4.3 |
| **Genre redundancy** *(added 2026-09-14, OQ-7)* | *"some of the genres are redundant, for example, there is action, action & adventure, and adventure. action & adventure seems extra. would it not be easier just to click action and adventure separately?"* ⚠ **A correctness bug, not a preference** — answered in §4.4 |
| **Sorting** *(revised 2026-09-16)* | Six visible complete-order buttons, including owner Watch priority. Selecting another field applies its default direction; activating the current field reverses it in one action. The rating refresh contract in §7a.1 is unchanged. |
| **Navigation** *(added 2026-09-14, OQ-2)* | Phone bar = **List, Upload, More** — two real destinations plus overflow. Answered in REQ-117 |
| **Review screen** *(added 2026-09-14, OQ-6)* | The confusion was **(d), the three sections looking alike** — not the list's length and not the Apply wording. Answered in §6a.1 |
| **Design system** *(revised 2026-09-16)* | A typographic scale, inline SVG icons, play/next brand, removable filter chips, grid/compact selector and reduced-motion-aware feedback. **No web font or new dependency.** |

### 2.1 Refined library acceptance contract — owner-approved 2026-09-16

| Surface | Required behaviour | Named test |
|---|---|---|
| Sort | Inactive field selects its complete default order; active field reverses. Oldest-first is one click, with state and next action named. URL/back/forward and session precedence stay intact. | `T-UX-138` |
| Filters | Searchable service disclosure, URL-driven checkbox dimensions, removable chips, clear-all preserving sort and view. Provider registry remains Netflix/Max. | `T-UX-139` |
| Search | Explicit search submission updates `q` in the URL; server applies it before paging and runtime-hidden counts. Never search only loaded rows. | `T-UX-140`, `T-API-030` |
| Layout | Grid/compact switch preserves server ordering, all metadata, service badges, pending/offline restrictions, row actions and view across filtering. Owner-approved 2026-09-18 composition maps Cover browser to Grid and Comparison desk to Compact; `specs/ui.md` §2.1 defines the current geometry and unified watch status. Real loading and retry paths remain. | `T-UX-141`, `T-UX-155` |
| Palette | Dark indigo/violet tokens, body/secondary text >= 4.5:1 and interactive boundaries >= 3:1, no network font or icon dependency. Reduced motion disables animation. | `T-UX-142` |
| Shell | Compact navigation and play/next identity, one nav landmark, all destinations reachable, factual service-update disclosure with a visible unavailable state. | `T-UX-143` |

The mockup's fabricated title data, loading/error demonstration switches and
marketing subtitle do not ship. Only the real API lifecycle drives states.

Plus five defects the owner hit while using the app, in §3.

**Traceability rule for anyone extending this document: every requirement below
cites either a row of this table or a defect in §3.** One that cites neither is
an agent's taste wearing a `must`, and it should be deleted.

⚠ **THIS RULE HAS ALREADY CAUGHT ONE VIOLATION, ON THE DAY IT WAS TESTED.** An
agent asked to fix the "awful" UI drafted a full **dark-theme** palette with an
**amber** accent, a **self-hosted variable web font**, and a rewrite of
`specs/ui.md` §13 — computing every contrast ratio correctly along the way. Not
one line of it cited a row of this table, and all of it contradicted the
owner's **then-recorded** choices: a light theme, a deeper indigo accent,
and no web font. That earlier, unapproved draft was reverted; it is historical
rationale, not a prohibition on the dark indigo design approved 2026-09-16.
**The failure mode
is real, it is fast, and it looks exactly like progress.** Read this table
before writing a `must`.

---

### 2.2 Premium presentation pass — TASK-236

The owner's visual-only refinement applies to upload, extraction, review and the
library. Retain the approved dark ink/indigo tokens and native font stack; no new
dependency, data model, network behavior, consent, default or action.

- **Orientation:** a shared, noninteractive ordered indicator reads Prepare,
  Read screenshots, Review. The current stage has `aria-current="step"` and a
  non-colour underline. It indicates location, not percentage or extraction
  quality. No stage skipping or automatic confirmation. Show it for new/local
  preparation, editable saved drafts, active/failed reading and review; omit it
  from terminal status records and unresolved capture checkpoints.
- **Upload:** active step numbers have restrained accent treatment; answered
  steps remain compact and editable. Group screenshot previews and the primary
  action with consistent borders and spacing. The desktop summary remains
  sticky; phone layout remains linear. All three input methods and explanatory
  disabled/error text remain visible and usable.
- **Review:** title, year/type, existing confidence warnings, consequence, then
  labelled original screenshot text form the metadata hierarchy. Raw evidence
  never truncates. At 1024px and above, evidence, identity and decisions occupy
  separate columns; on narrower screens actions remain below the identity.
  Keep every section, native disclosure, 104px evidence box and virtualized list.
  Apply stays sticky with mobile navigation clearance.
- **Library:** flat, quiet surfaces replace per-card gradients. Grid artwork
  fills each card at 2:3 (TASK-239); compact retains its 72px by
  108px posters and aligned comparison columns. Controls keep their compact
  phone geometry, low-prominence search and persisted choices.
- **Interaction:** restrained border/background transitions, visible keyboard
  focus, no scaling/lifting or hidden-on-hover actions. Existing reduced-motion
  override applies to every new transition. Target floors remain 44px and
  layouts must not overflow at 280px, 320px, phone, tablet or desktop widths.

`T-POL-001` covers stage semantics; `T-POL-002` covers review hierarchy and honest
evidence; `T-POL-003` measures responsive stage/card geometry, catalog proportions
and reduced motion in Chromium and WebKit. Existing functional and accessibility
tests remain mandatory; screenshots accompany browser coverage for visual review.

### 2.3 Catalog alignment follow-up — TASK-237

In Grid view, Watching occupies the top-left status badge instead of a separate
line beneath the title (owner revision 2026-09-23, TASK-245). At tablet
and desktop widths, adjacent cards share content-sized row tracks: artwork,
heading/status, metadata, rating, date, service footer, and recovery
actions. TASK-240 places priority on the artwork while retaining its full label
and target size. Service footers share their top edge and height, including when badges
wrap. Long titles, genres, missing posters, absent ratings and unmatched actions
must remain complete and usable; do not substitute fixed heights or truncation.
Compact layout, markup, semantics and persistence remain unchanged.

`T-POL-004` measures these alignments for short/long watched titles, unwatched
titles, different service logos and wrapped multi-service footers in both browser
engines. Existing library geometry and action tests remain mandatory.

### 2.3a Denser artwork cards and one status — TASK-245

Owner-approved 2026-09-23: reduce the information gradient's first dark stop to
75% opacity, still fading to solid at the footer. Top-left status and top-right
ellipsis surfaces use 85% opacity to retain contrast over bright posters without
reducing text/icon opacity or hit targets.
Card headings use 1.125rem. Remove the separate Watching track; retain
content-sized shared heading, facts, genre/rating and footer tracks.
Two genre chips plus overflow share the rating row where space permits, aligned
at the top; narrow/long content may wrap rather than truncate. Replace visible
IMDb text with the existing star icon; preserve source attribution in accessible
and hover text and retain the explicit absent-rating state. Shorten visible
catalog date prefixes to Added, retaining the full API label for accessibility,
hover and details. Existing artwork crops, edition labels and service badges remain.
One status editor/filter exposes Watching / Up next / Normal / Someday, as defined
in `ui.md` section 2.1a; no database migration or inferred preference changes.

### 2.4 Owner mockups: in-app design only — TASK-240

Adopt the three owner-supplied library/import/review mockups, excluding their
scenic promotional surround, slogans, avatars and unimplemented destinations.
Use only the existing routes, service registry and saved data.

- At 1024px and above, the existing primary navigation becomes a left sidebar
  beside a bordered navy content panel. Retain one header/nav/main/footer and
  the existing More destinations. Tablet keeps the top navigation; phone keeps
  List, Upload and More with safe-area clearance. Long sidebar content remains
  reachable at short viewport heights and zoom.
- Use local Georgia/Cambria serif page headings, the existing system sans-serif
  for content and controls, restrained violet accents and contrasting navy
  panels. No downloaded fonts, scenery or new dependencies.
- Library cards use full-width 2:3 artwork at tablet/desktop widths, equal
  content-sized metadata/footer tracks and complete title text. Compact keeps
  72x108 posters. The priority control remains labelled and always available.
  Service chips expose the existing multi-service filter: All clears only the
  service dimension. Share URL, cursor reset, history and remembered state with
  the existing list route/filter panel; no second filter store. Expanded filter
  groups stay in the drawer's flow rather than covering its close control.
  Do not collapse them between pointer-down focus and click: moving the outer
  Done button before release can swallow its click. Tab and programmatic focus
  leaving a group still close it; pointer clicks close it after activation.
- Upload retains progressive required choices, editable summaries and all three
  intake paths. Refine numbered orientation, logo tiles, mode cards, previews
  and the sticky summary; never default a service/mode or auto-submit.
  Use 24px step markers on phones and 36px from 640px upward; narrow-screen
  progress must remain within its 120px height budget with wrapped labels.
- Review uses distinct section headings, restrained state accents and framed
  evidence/identity/action groups. Keep original text, real warnings, all
  full-update candidates, virtualization, explicit confirmation and sticky
  apply controls. Do not invent confidence or completeness percentages.

`T-MOCK-001` checks shared service-filter semantics. `T-MOCK-002` measures sidebar,
content, artwork and chip geometry and keyboard access in both browser engines.
`T-MOCK-003` verifies the heading/step/section treatment on upload and review.
Existing accessibility, narrow reflow, reduced-motion and workflow tests remain
mandatory. The earlier fixed 192x288 grid-artwork size is superseded by full-width
2:3 artwork, not by cropping or fixed-height text.

### 2.5 Compact composition, library header and import — TASK-241

The owner chose compact composition **with full titles and content-sized growth**,
not uniform-height cards with truncated titles. This supersedes the stacked
poster/solid-panel arrangement of section 2.4, not its safety or content guarantees.

- From 640px, Grid is one artwork-led tile: retain the 2:3 image, put the title
  over a dark gradient, share a row between genres and the real IMDb rating,
  and group service badges with the short "Added" date (full API label remains accessible) in a compact
  footer. Preserve missing-data states, watched state, full titles, genre expansion,
  active genres, all badges and correction/recovery actions. Neighbouring cards
  retain aligned content tracks; long content may increase the row height.
- Priority has a small visual pill over the artwork but a target of at least
  44px. No hover-only actions. The gradient must maintain text contrast even
  over white artwork. Compact and narrow phone cards remain unchanged.
- At wide desktop sizes, group the heading/count, visible title search,
  filter trigger, view switch and sort as a compact header. Service chips and
  available filter controls follow without oversized separators or empty rows.
  Keep service updates and Add title accessible and separated from resume banners.
  Service updates must paint above the entire catalog, including artwork gradients,
  priority pills and menus. Contain card stacking within the list; every service
  link and Done must receive pointer input, not merely be present in the DOM.
  Align that panel with its left-side trigger on tablet and its right-side
  trigger on wide desktop; neither edge may leave the viewport.
  No actor search, rating/year filters or other unsupported mockup features.
  Phone controls retain accessible disclosure/reflow and remembered query/layout.
- Import uses full-width service tiles, grouped mode cards and a single
  screenshot-intake area with a quieter summary. Retain progressive required
  choices, change/undo paths, all eight services, early file/paste/drop intake,
  PNG/JPEG/HEIC/HEIF, truthful saved/local state, and explicit submission.
  Capture-stage vocabulary and safety are unchanged; no default selections.

`T-MOCK-004` measures card density, overlay geometry, complete text, shared rows,
footer alignment, growth and actions. `T-MOCK-005` covers responsive header
geometry, search/filter behavior and preserved browsing state. `T-MOCK-006`
covers import geometry, full service choices and all intake affordances.
Existing keyboard, reduced-motion, contrast and narrow-reflow checks still apply.

## 3. The five defects — these are BUGS, not design

⚠ **These are separated from the design sections on purpose.** Bundled into a
restyle they become unverifiable: after a large visual change nobody, including
the owner, can tell whether the menu was *fixed* or merely *moved*. Each gets a
`must` and a named test, and **each can ship independently of the refresh** —
if the owner wants the visual work deferred, §3 should still be built.

### REQ-105 (`must`) — the row menu opens anchored to the row it belongs to

> When the owner activates a row's `⋮` menu, the menu appears **visually
> adjacent to that row**, at every viewport width, whether the row is first,
> last, or in the middle of a long list.

**Observed:** the owner tapped `⋮` on a mid-list row and the menu rendered at
the bottom of the page.

**Root cause — and it is structural, not stylistic.**
`apps/web/src/pages/ListPage.tsx` (~line 445) mounts the menu as a **sibling of
`<TitleList>`**:

```tsx
<TitleList items={visible} … />
{onLoadMore !== undefined && <LoadMoreSentinel … />}
{menuFor !== null && <RowMenu item={menuFor} … />}   {/* ← after the whole list */}
```

⚠ **`apps/web/src/index.css:507` already declares `.title-row__menu { position:
relative }` — a containing block for a positioned descendant the menu never
is.** The stylesheet was written for the correct tree; the JSX was not. **No CSS
rule can fix this**, and the two plausible CSS-shaped "fixes" are both wrong:
`position: absolute` on `.row-menu` resolves against the nearest positioned
ancestor, which is the page, not the row; `position: fixed` merely relocates
the same detachment to the viewport and then breaks on scroll.

**The fix is to render the menu inside the open row's `.title-row__menu`.**
That is a change to `ListPage.tsx` and `TitleRow.tsx`, not to `index.css`.

⚠ **What must NOT be lost while moving it:** `RowMenu`'s existing focus
management, its Escape and click-outside dismissal, its `aria-expanded`
wiring, and `canRemove`'s **`false` default** (TASK-207 chose that default
deliberately: forgetting the prop must lose an affordance visibly, never add
an inert one invisibly). `T-A11Y-001e` asserts the menu has exactly four items.

| Test id | Asserts |
|---|---|
| `T-UX-100` | The menu element is a **DOM descendant of the row's `.title-row__menu`**, not merely near it. Asserting screen position would pass on a `fixed` overlay that happens to land nearby. |
| `T-UX-101` | Opening the menu on the **last** row of a paginated list still yields a descendant of that row (guards the sentinel-ordering regression). |
| `T-A11Y-001e` | *(existing, must keep passing)* four items, all ≥ 44 px. |

### REQ-106 (`must`) — independent facts in the row are visibly separated

> The metadata line renders as **`Year · type · runtime · genres`** with a visible
> separator between each fact.

**Observed, from the owner's screenshot:** `TV2004Animation, Sci-Fi & Fantasy,
Action & Adventure, Kids`.

**Root cause:** `components/TitleRow.tsx` lines 196–205 emit three bare
`<span>`s inside `.title-row__meta`, and `index.css:444–448` sets colour and
font-size only — no `display: flex`, no `gap`, no `::before`.

⚠ **The original defect was missing separation in "Year · type · genres".** This is not
a design decision; it is a specified line that was never implemented. It is a
`must` and not a style tweak because **`TV2004Animation` is a correctness
failure, not an aesthetic one** — the owner cannot distinguish a missing
separator from a missing field, and `Movie2026Action` reads as a title.

The separator must be a **CSS-generated `·`** (or a gap), not a literal `·`
concatenated into the text node: it is decoration, and a screen reader should
not announce "middot" between every fact.

| Test id | Asserts |
|---|---|
| `T-UX-102` | The wrapping metadata row has CSS-generated separators; decoration is not concatenated into accessible text. |
| `T-UX-103` | Metadata facts follow year → type → runtime → genres, including within the facts grouping wrapper; absent genres invent no placeholder. |

### REQ-107 (`must`) — the `⋮` control is a button, not a full-height column

> The row-menu trigger occupies a control-sized box, vertically aligned to the
> top of the row. It does not stretch to the row's height.

**Observed, in the owner's screenshot:** a tall bordered grey rectangle running
the full height of the row, which reads as a structural panel.

**Root cause — confirmed in CSS.** `.title-row` is `display: flex`
(`index.css:373`) with the default **`align-items: stretch`**, so
`.title-row__menu` — a flex child — is stretched to the row's height, and
`.tap-target`'s `min-height: 44px` (`index.css:163–170`) is a floor, not a
ceiling, so the button fills it.

The fix is `align-self: flex-start` on `.title-row__menu`. ⚠ **The 44 px floor
must stay** — `T-A11Y-001b` asserts it and NFR-006 requires it. This
requirement narrows the box, it does not shrink the target.

| Test id | Asserts |
|---|---|
| `T-UX-104` | The trigger's rendered height is within a control-sized bound and **less than the row's height** on a row with a poster. |

### REQ-108 (`must`) — the row's text has readable vertical rhythm

> Lines within a row are separated by at least `--space-2`, and the row's text
> block does not read as a single paragraph.

**Observed:** the owner's words were *"the text in the tiles is scrunched
together"*, and the screenshot shows four stacked lines with no visible
leading.

**Root cause:** `.title-row__body` uses `gap: var(--space-1)` —
**4 px** (`index.css:57`) — between the name, the metadata, the rating, the
added-date and the service badge. Five lines at 4 px is a block, not a list.

⚠ **Do not "fix" this by removing lines.** The density direction is *balanced —
metadata trimmed*, and §4.3 decides **which** facts are trimmed on the basis of
what the owner uses. Deleting a line to create whitespace and deleting it
because it is unused look identical in a diff and are completely different
decisions.

| Test id | Asserts |
|---|---|
| `T-UX-105` | The computed `row-gap` of `.title-row__body` is ≥ 8 px. |

### REQ-109 (`must`) — a corrected match is visibly reflected on the card that was corrected

> After the owner corrects a title's match, **the card for that candidate
> displays the corrected identity** — corrected name, corrected poster,
> corrected year — before they navigate away. The owner must never have to
> apply a batch to find out whether their correction took.

**Observed, in the owner's words:** *"I did a fix match and selected the right
show. After confirming, the image on the upload page stayed the same. I
couldn't tell if my change had been applied. I figured it had and went ahead
with clicking apply. Sure enough, the change I made did show up on list page."*

⚠ **THIS IS THE MOST SERIOUS ITEM IN §3, AND ITS SEVERITY IS NOT OBVIOUS FROM
THE SYMPTOM.** The review screen is the **owner's confirmation step** — the
entire safety model of this product is that nothing changes the list until the
owner has seen what was read and agreed to it. A review screen that does not
show the effect of the owner's own correction has broken that contract: it
asked for confirmation and then withheld the thing being confirmed. The owner
proceeded **on a guess**, and the guess happened to be right. Next time the
correction fails and the screen looks identical.

**Root cause — two faults, in `components/UnmatchedActions.tsx`.**

1. **The card's poster and heading are never re-rendered from the correction.**
   The card is built from the candidate's *extracted* identity; `onMatch`
   PATCHes `{ disposition: 'corrected', tmdbId, mediaType }` and the card's
   primary display continues to show the original wrong match. Only a small
   status paragraph changes.
2. **Even that paragraph forgets the name on any re-render** (line 137):

   ```ts
   if (disposition === 'corrected') return { kind: 'matched', name: null };
   ```

   Immediately after the click the component holds a local
   `{ kind: 'matched', name: result.name }` and says *"Matched to X."* On any
   re-render from server state that becomes `name: null`, and `outcomeText`
   (lines 144–146) falls back to `UNMATCHED_MATCHED_UNNAMED` — a **generic**
   message. **The correction is real and stored; the screen just stops naming
   it.** ⚠ The `name: null` is not a bug in itself — the server's disposition
   genuinely carries no name — so the fix is to **carry the corrected identity
   back**, not to patch the fallback string. Patching the string would make the
   screen assert a name it does not have.

**Where the name actually goes missing — a third fault, on the server, and it
is the one that decides the size of this fix.**

`ReviewRoute.tsx` **does** refetch after `patchCandidate`, so the naive theory
("the screen never reloads") is wrong. The refetched payload is what is
impoverished. `routes/batchReview.ts:222-240` builds each candidate's `match`
from `parseMatchCandidates(row.matchCandidates)` — the stored **match
candidates**, which are the *extraction's* guesses. `applyCorrection`
(`routes/batchCandidates.ts:153-168`) writes `resolvedWorkIdentity`,
`correctedToTmdbId` and the verdict — but **does not rewrite
`matchCandidates`**. So after a correction the row's `resolvedWorkIdentity`
starts with `tmdb:` and the guard at line 226 passes, which means `match` is
served from `alternatives[0]`: **the original wrong match**. The screen is not
merely unnamed, it is re-serving the identity the owner just rejected.

⚠ **The manual-add path (`addCandidate`, `batchCandidates.ts:429-441`) DOES
write a one-entry `matchCandidates` array from the chosen work — but do NOT
read that as evidence the correction path merely forgot to.** The non-rewrite
on correction is **deliberate and load-bearing**, and
`services/batchClose.ts:167-186` records why in a comment written after the bug
it caused: *"correcting a candidate deliberately does NOT rewrite
`matchCandidates` (the owner corrected the decision, not the extraction)"*.
`tmdbFieldsFor` was hardened to choose metadata **by identity, never by
position** precisely because an earlier version read `alternatives[0]` at close
and stored the film the owner had just rejected — the row said
`tmdb:movie:949` while its name, year and poster all still said `438631`. The
`title_match_coherent` constraint does not catch that: it checks null-ness, not
agreement.

**So `matchCandidates` must NOT be rewritten to carry the corrected name.**
That is the one fix shape that looks obvious and re-opens a bug this codebase
has already paid for. The extraction's guesses and the owner's decision are two
different facts, and the schema keeps them apart on purpose.

**Where the name legitimately comes from.** The same `batchClose` comment names
the existing mechanism: when the corrected target is not among the alternatives
*"there is no name to store and none is invented … `tmdbFetchedAt` stays null
so the lazy refresh (REQ-076, NFR-014) fills the display fields on first
access."* That is why the correction looks right on the **list** after apply.
It does nothing for the **review screen**, which runs *before* any `Title` row
exists — so at review time the server holds an identity and, by design, no
name. **That is the actual shape of REQ-109: not a lost name, but a name the
server has never had at that point in the flow.**

**The scope question — ✅ RESOLVED: the owner chose OPTION 1 below. Build
option 1; options 2 and 3 are recorded for rationale only.**
`applyCorrection` is additionally **network-free** on purpose: its header
states *"a TMDB outage must not stop the owner fixing a wrong match"*:

1. **Carry the display fields the client already holds** — `TmdbSearchResult`
   has `name`, `releaseYear` and `posterPath` at correction time — in a **new,
   separate candidate field**, never inside `matchCandidates`. Keeps the outage
   property and keeps decision and extraction apart, but it needs a column (so
   a migration) and widens the patch schema in `specs/api.md`.
2. **The server fetches TMDB detail during the correction.** Authoritative and
   needs no new column — but it **reverses the explicit outage decision**
   recorded in that function's header comment.
3. **The server resolves on the review read from the owner's `Title` rows.** No
   schema change and no outage coupling — but it is **only a partial fix**: a
   correction onto a work that is not already on the owner's list has no
   `Title` row yet, and that is the common case for the corrections this
   requirement is about.

**Option 1, as built.** `applyCorrection` stays **network-free**, and the
client carries the display
fields it already holds — `TmdbSearchResult`'s `name`, `releaseYear` and
`posterPath`, values **this server itself returned** from `/api/tmdb/search` —
in three new candidate columns (`0008_corrected_display`). The review read
projects them through `chosenReviewMatch` (`packages/domain/src/review.ts`).

⚠ **`matchCandidates` is NOT rewritten, and the new columns are not a
back-door rewrite of it.** They hold the owner's DECISION; `matchCandidates`
holds the EXTRACTION's guesses. Both facts stay in the row, apart, exactly as
`services/batchClose.ts` requires.

⚠ **This is the one endpoint that accepts caller-supplied display text, while
§6.20 manual entry REFUSES it — the asymmetry is deliberate and documented at
`parseCorrectedDisplay`.** Manual entry fetches from TMDB anyway, so refusing
costs nothing there; refusing here would cost the requirement. What makes it
safe is that identity is still derived from `tmdbId` + `mediaType` alone
(SD-05), and the lazy refresh (REQ-076, NFR-014) replaces these with TMDB's own
values on first access — they are a review-time placeholder, not a source of
truth.

⚠ **A fourth option — keeping the corrected name only in client state — was
rejected outright**, and the test suite is built to keep it rejected: it would
look correct in the click path and break on exactly the re-render this
requirement exists to fix, which is the present bug rebuilt. `T-UX-107`
therefore renders from **server state with no click at all**.

~~**The scope question, which is an owner/design call and NOT settled here.**
Do not pick one silently. Each gives something up: 1 a migration and a
published request contract, 2 a decision already written down, 3 correctness in
the common case.~~ — settled above.

**What good looks like:** the corrected poster replaces the wrong one, the
heading shows the corrected name and year, the card is chipped as corrected,
and a live-region message names what it was corrected to. This is the same
principle as the existing `BatchAppliedNotice` — the app already knows that a
mutation the owner cannot see is a mutation they will not trust.

| Test id | Asserts |
|---|---|
| `T-UX-106` | After `onMatch` resolves, the card renders the **corrected** name and poster URL, not the extracted one. |
| `T-UX-107` | After a **re-render from server state** (`disposition: 'corrected'`), the card still names the corrected title — the regression that `name: null` causes today. |
| `T-UX-108` | The correction is announced in a live region. |

---

## 4. Design — the list

### 4.1 Hybrid layout (REQ-110, `must`)

> **Grid** is the default local view preference; **Compact** is an explicit
> alternative. Both use one ordered row tree with identical data and actions.
> Owner-approved refinement, 2026-09-18: **Cover browser maps to Grid** and
> **Comparison desk maps to Compact**. Both are single-column on phones;
> Grid uses two portrait-led columns from 640px and three from 1024px.
> Compact remains one column, with aligned comparison facts from 1200px.
> Artwork never replaces metadata or actions. `specs/ui.md` §2.1 defines
> current sizes and the separate Watching status.

~~Superseded: horizontal poster-plus-details desktop Grid only; no vertically
stacked artwork tiles.~~

⚠ **The phone list is the base rule; the grid is a `min-width` addition.**
`specs/ui.md` §13.3 mandates mobile-first, and writing it the other way makes
the 320 px case — the one NFR-006 requires and `T-A11Y-001` tests — the case
reached by subtraction.

⚠ **The grid and compact view are ONE component at two densities.**
`ListViewControl` selects local presentation state, not a new API ordering;
CSS handles width changes without a JS viewport branch. Filtering, searching
and sorting preserve the selected view. No local re-sort or title filtering,
and no promise of cross-session persistence for this local preference.

Wide Compact uses five aligned tracks within the same row body/DOM: identity,
services, IMDb, priority and the verbatim date label, separated by 12px.
Narrow Compact wraps complete facts, with an 8px column gap and 4px line gap.
Neither view removes content to gain density.

**Every action available on a list row is available on a grid tile** — remove,
suppress, restore, `⋮`. A grid that drops actions has made desktop the weaker
client.

| Test id | Asserts |
|---|---|
| `T-UX-110` | At 320 px the list layout renders and there is no horizontal scroll *(extends `T-A11Y-001`)*. |
| `T-UX-111` | At 1280 px the default grid has three columns with bounded portrait artwork above complete details. |
| `T-UX-112` | The `⋮` menu offers the **same item set** in both layouts. |
| `T-UX-141` | Explicit Grid/Compact changes density only: content, server order, badges, row actions, pending/offline restrictions and preference across query changes remain intact. |

**Loading is not a control remount.** `ListSearch`, `FilterBar`, `SortControl`
and `ListViewControl` stay mounted while the query is pending, preserving
open-picker/search/focus/selection state. Selected genres remain available
even when a pending facet response temporarily supplies no options.
`FilterBar` receives `countPending={loading}` and hides **both** result and
runtime-hidden counts until the response arrives. Keep the real service
updates control too; **only six row skeletons** render, `aria-hidden` beneath
one loading status, with the existing slow-request/retry affordance.
Do not duplicate controls with freshness/filter-bar skeletons. Failed online
reads still hide the filter/control group and show error/retry; no fabricated
numbers or empty-library claims. Offline behavior remains unchanged.
`T-UX-141h` / `T-UX-141i` guard picker/selected-genre preservation and absent
pending counts; `T-UX-010` retains six-row/status/slow-request coverage.

### 4.2 Posters (REQ-111, `must`)

> Every poster occupies a box of **uniform aspect ratio 2:3**, and no poster is
> smaller than **72 × 108 px** in the list layout.

Today `.title-row__poster` is `3rem × 4.5rem` — **48 × 72 px**
(`index.css:414–420`). The owner asked for *larger and uniform*, and gave the
reason: artwork is how they recognise a title.

⚠ **`.title-row__poster--empty` MUST KEEP ITS BOX.** `index.css:422–429`
carries the existing note: *"A MISSING POSTER IS A RENDERED STATE, NOT AN
OMISSION."* Collapsing it makes rows jump. Enlarging posters makes that worse,
not better — the empty box grows with them.

### 4.3 Density and what gets trimmed (REQ-112, `should`)

> **Amended in place by the approved 2026-09-16 refinement.** Grid and Compact
> both show **poster, name, year, type, runtime, genres, service badges,
> added-date and IMDb rating (or its honest absent state)**. Density comes
> from layout, never removing a fact or action.
>
> ~~The compact list shows, per title: **poster, name, `Year · type`, service
> badge(s)**. The genre list and the IMDb rating move to the expanded/grid
> presentation.~~

**Both of this requirement's original trims were rejected by the owner**, and
the two warnings below are the reason each was put to them rather than built:

| Originally trimmed | Owner's answer | Consequence |
|---|---|---|
| **The added-date** | **Keep it** (OQ-1) | It is the default sort key; hiding it makes the order inexplicable |
| **The genres** | **Keep them, but compact** (OQ-7) — *"use another ux to make it compact but still list the genres"* | They are a filter dimension and are tied to US-019 AC-6 |

⚠ **"COMPACT" IS A PRESENTATION CHANGE, NOT A CONTENT CHANGE.** The genres are
**all** still present and still readable; what changes is the room they take.
The compact presentation shows **two genre chips plus `+n` expansion**;
this is a count limit, not a measured one-line limit. **Genre names wrap and
are never ellipsized or clipped.** Science Fiction may display as **Sci-Fi** with
the canonical full name in its abbreviation title. Expansion reveals the remainder in place.
⚠ **The `+n` affordance must not be the only way to reach a
genre that is currently filtered on** — if a genre is in the active filter, its
chip is always visible, otherwise the row stops explaining the very filter that
produced it. ⚠ **`genres: []` still renders NOTHING AT ALL, never "Unknown"
and never an empty `+0`** (US-019 AC-6 is unchanged and still tested).

> ### ⚠ THE ORIGINAL TRIMS CONTRADICTED TWO THINGS THAT ARE CURRENTLY
> ### SPECIFIED. BOTH WARNINGS STOOD, AND BOTH WERE UPHELD BY THE OWNER.
>
> 1. **`specs/ui.md` §2.2 line 154 puts genres ON the row**, and ties it to a
>    PRD acceptance criterion: *"`genres: []` renders **nothing at all**, never
>    'Unknown' (**US-019 AC-6**)."* Trimming genres would have been a **change
>    to a tested AC**, not a styling choice. **It is not being made.**
> 2. **REQ-106 retains visible separation between facts.** The approved
>    refinement puts runtime before genres; it does not remove either fact.
>
> ⚠ **And the reason genres looked safe to cut was wrong.** The tempting
> argument — *"nothing filters or sorts by genre"* — **is false**:
> `specs/ui.md` §2.1 item 2 lists **genre as one of the three filter
> dimensions**, with `?genre=Drama` in the query string. Cutting the row's
> genres removes the only on-screen explanation of why a genre filter returned
> what it returned. **Any trim proposal must be checked against the filter
> dimensions before it is written, not after.**

### 4.4 ⚠ THE GENRE VOCABULARY COLLIDES, AND THE FILTER SILENTLY UNDER-RETURNS

**Raised by the owner at OQ-7, and it is a correctness bug, not clutter:**

> *"some of the genres are redundant, for example, there is action, action &
> adventure, and adventure. action & adventure seems extra. would it not be
> easier just to click action and adventure separately?"*

**Verified in the code.** `apps/api/src/clients/tmdbClient.ts` stores TMDB's
genre **names verbatim** —

```ts
genres: Array.isArray(body.genres)
  ? body.genres.map((g) => (typeof g?.name === 'string' ? g.name : '')).filter(Boolean)
  : [],
```

— and there is **no normalisation anywhere in the tree** (a search for
`genreMap`, `normaliseGenre`, `normalizeGenre`, `10759` and the literal
`'Action & Adventure'` across `apps/**` and `packages/**` returns **zero
hits**).

**The cause is that TMDB maintains two different genre vocabularies**, and this
product puts film and TV rows in **one** genre filter dimension:

| Film genre list | TV genre list | Collides as |
|---|---|---|
| `Action` (28) + `Adventure` (12) | `Action & Adventure` (10759) | three chips for two concepts |
| `Science Fiction` (878) + `Fantasy` (14) | `Sci-Fi & Fantasy` (10765) | three chips for two concepts |
| `War` (10752) | `War & Politics` (10768) | two chips for one concept |

⚠ **THE VISIBLE REDUNDANCY IS THE SYMPTOM; THE BUG IS THAT `?genre=Action`
MISSES EVERY TV TITLE TAGGED `Action & Adventure`.** The facet under-returns
and **nothing on screen says so** — which is the same failure shape as every
other silent-omission defect this project guards against. The owner's instinct
("click action and adventure separately") is exactly right: **the film
vocabulary is the canonical one**, and the TV names are mapped onto it.

**REQ-120 (`must`) — the genre vocabulary is normalised to one list on read**

> A TV-only combined genre name is presented and filtered as its constituent
> film genres. Filtering on a constituent genre returns **both** the film
> titles tagged with it and the TV titles whose combined genre contains it.

**Normalised on READ, by the owner's answer to OQ-9.** The mapping is applied
at query and display time; **stored data is not rewritten and there is no
migration**, so the change is fully reversible and `T-MIG-001` is not engaged.

⚠ **THE MAPPING IS ONE-TO-MANY AND MUST BE APPLIED ON BOTH SIDES.** Expanding
only the *display* leaves the filter broken; expanding only the *filter* leaves
the row showing a chip the owner cannot click. Both, or neither.

⚠ **THE MAP IS A CLOSED LITERAL, NOT A STRING HEURISTIC.** Splitting on
`" & "` would also split a legitimate single genre and would silently invent
genres from any future TMDB name containing an ampersand. The three rows above
are the whole map.

| Test id | Asserts |
|---|---|
| `T-UX-125` | A TV title whose stored genres contain `Action & Adventure` renders the chips `Action` and `Adventure`, and does **not** render `Action & Adventure`. |
| `T-UX-126` | The genre filter list contains no combined TV name — `Action & Adventure`, `Sci-Fi & Fantasy` and `War & Politics` never appear as options. |
| `T-API-028` | `?genre=Action` returns **both** a film tagged `Action` and a TV title tagged `Action & Adventure`; `?genre=War` returns a title tagged `War & Politics`. |
| `T-UX-127` | Two genre chips plus `+n` expansion; Sci-Fi retains its full canonical name, names wrap without truncation and active-filter genres stay visible even above the count limit. |

⚠ **"Trimmed" means moved, not deleted, and one line may not move at all.** The
added-date is the field the **default sort orders by** (REQ-038, newest-first),
and its date is always supplied by the API. Catalog rows may shorten the known
prefix to **Added**, retaining the verbatim full label in accessible/hover text
and title details (REQ-061, owner revision 2026-09-23). Hiding the sort key makes the order inexplicable. See
§9, OQ-1.

---

## 5. Design — filter and sort (the owner's "improve the filter/ordering ux")

### REQ-113 (`must`) — filters and sort present as one control group

> The filter controls and the sort control render as a single visually unified
> bar above the list.

`specs/ui.md` §2.1 item 2 already co-locates them. `components/FilterBar.tsx`
says so in a comment and does not do it, because `SortControl` shipped later
(TASK-166).

> ### ⚠ MERGING THEM VISUALLY MUST NOT MERGE THEM MECHANICALLY.
>
> **This is the single most likely way to break working behaviour in this
> refresh**, because shared presentation must not introduce mirrored control
> state. #328 (owner-approved 2026-09-21) now remembers the complete destination:
>
> | | Source of truth | Why |
> |---|---|---|
> | **Filters** | **URL only.** Render *from* the query string, write *to* it, **no `useState` mirror.** | `FilterBar.tsx` documents this at length: one direction is the only thing that survives the back button, a deep link, and an external `navigate()`. A mirror desynchronises silently. |
> | **Sort** | **URL → per-field default.** | LibraryNavigation restores a validated complete destination before list reads on fresh bare-root entry or application return. Explicit query/history URLs win. The old direction-only session fallback is retired because it changed older history entries. Explicit field selection uses §5b's complete-order rule. |
>
> A navigation bookmark is not a second live filter model. **`T-UI-016`,
> `T-UX-115` and `T-LIB-001` guard URL, history and return behavior.**

Also invariant: `applyFilters` must preserve `sort`, `dir` and `cursor`.
Changing a filter must not silently reset the owner's ordering.

Under **Filter by**, **Services, Type, Genre and Runtime** dropdown fields
show external category labels, selected/default values and chevrons. Their
triggers open labelled,
nonmodal checkbox disclosures. Genre options come from the real list facets;
there is no invented genre or provider. Services is searchable over
`SERVICES` / `SERVICE_LABELS` (**the eight services approved in US-061**); no phantom "All"
checkbox. Picker search filters options, never the title rows. OR within each
dimension and AND across dimensions remain unchanged.

Active filters are always visible as **native 44 px removable buttons**,
not only in the zero-match state. Each removes only its dimension/value;
labels use service display names, Movies/TV series and the runtime bucket
labels. A submitted `q` has its own search chip, removing only `q`.
**Clear filters removes the four dimensions and `q`, preserving sort, view
and unrelated parameters.** Escape/Done close the disclosure and restore
trigger focus; outside clicks dismiss, Tab is not trapped, and generated
`useId` associations remain unique. `T-UX-139` supplements `T-UI-016` and
the existing zero-match/count/runtime-hidden tests; counts remain server facts.

### REQ-114 (`must`) — the sort control states what pressing it does

> Each sort button names a **complete order**. The selected button is marked
> with `aria-pressed` and its accessible name identifies both current state
> and the reverse action; an inactive button names the order it will apply.

Today it is a button labelled **"Newest first"** *while the list is already
newest-first*, and pressing it makes the list oldest-first. Both readings —
"this is the state" and "this is what you'll get" — are defensible, which is
precisely the defect.

⚠ **REQ-038's oldest-first reverse is `must`, not optional** (promoted at
`A47`). It is the sole escape hatch for the knowingly-accepted
newest-first-vs-SUC-003 trade-off, and OQ-029's revisit path depends on it
shipping. **Whatever shape the new control takes, oldest-first stays reachable
in one action.** A redesign that buries it in a menu has deleted a `must`
while every behavioural test still passes.

**The owner approved the replacement wording and one-click behavior on
2026-09-16.** §5b defines the six complete-order controls; the former
separate direction segment is not part of this design.

### REQ-115 (`should`) — the list can be ordered by more than date added

> Available orderings: **date added** (default, newest-first), **name**,
> **release year**, **runtime**, **IMDb rating**.

The row already displays a name and a year that the owner can read and cannot
order by. **Runtime joins that list at `A48`** — it is the same defect in a
sharper form, because until REQ-119 the owner could not even *read* the
runtime, and ordering by it is `must`, not `should`, since it is carried by
**REQ-037**, a requirement that has existed since the phase 4 lock and was
deferred to v1.1 rather than dropped. Promoting REQ-037 does not widen this
document's remit; it satisfies a requirement already on the books.

> ### ⚠ THIS BLOCK IS SUPERSEDED — THE OWNER REVERSED IT AT `A53`. IT IS
> ### RETAINED BECAUSE IT IS *WHY* THE REVERSAL WAS DONE PROPERLY.
>
> **REQ-095** — *"The IMDb rating is **display-only**. It is not a sort key,
> and no sort option for it exists"* — was decided by the owner at **`A51`**,
> resolving ADR-0011's OQ-A. The rating is the most tempting sort key on the
> row precisely **because** it is rendered there, so an agent designing a sort
> menu will reach for it, find it on screen, and add it without ever seeing
> REQ-095. ~~**It is a standing `must`-shaped negative and this document does
> not get to reverse it.**~~ If the owner wants it, that is a reversal of `A51`
> and it belongs in ADR-0011 as a new revision — see §9, OQ-3.
>
> ✅ **That is exactly what happened, and this paragraph is why.** The owner
> was asked (OQ-3b) rather than the sort being added as a menu item, answered
> on **2026-09-14 (`A53`)**, and the reversal was written as **ADR-0011
> Revision 1** — not as a line here. **Rating IS now a sort key.** ⚠ **Read
> §7a.1 before implementing it:** the reopening found that `specs/api.md` had
> since made REQ-095 load-bearing for **REQ-041** compliance, so the reversal
> required the rating refresh to become **synchronous**, not merely a struck
> sentence.

⚠ **Year is nullable and the null case is the design problem.** A year sort
must decide where undated titles go — **not** first by accident of `NULL`
collation. Ordering must be stable and specified server-side; this needs an API
change, which is why it is `should` and why §9 asks before it is built.
**`A48` settles the general rule** rather than leaving each nullable key to
decide for itself: **`NULL`s sort LAST in BOTH directions**, explicitly in the
SQL (`specs/api.md` §6.2). SQL Server sorts `NULL` first ascending by default,
so "Shortest first" would otherwise open with every title whose runtime is
unknown — an absence of data rendered as a claim about the works. Year follows
the same rule when it is built.

| Test id | Asserts |
|---|---|
| `T-UX-113` | The bar renders filters and sort in one group. |
| `T-UX-114` | Changing a filter preserves `sort`, `dir`. |
| `T-UX-115` | A session direction with **no `dir` in the URL** is reconciled into the URL when it differs from that field's default, and the label matches the request. |
| `T-UX-116` | Oldest-first is reachable in one action from the default view. |
| `T-UX-119` | The complete-order buttons include IMDb rating. ~~Original REQ-095 guard prohibited rating; reversed at A53.~~ The pre-sort refresh contract in §7a remains mandatory. |
| `T-UX-120` | Runtime uses **Longest runtime / Shortest runtime**, never date-shaped labels; its inactive default is longest-first. |

---

## 5a. Design — runtime (`A48`, the owner's *"see run time as well and filter and sort by it"*)

### REQ-119 (`must`) — the runtime is on the row, and an unknown runtime says so

> The row's meta line reads `Year · type · runtime · genres`. Film renders
> `1h 55m`; TV renders `45m/ep`; a title with no runtime renders the words
> **"Runtime unknown"**.

**This requirement exists because the data was already there and nobody could
see it.** `runtimeMinutes` is fetched from TMDB, stored on `Title`, returned by
`GET /api/titles` and **declared on `TitleRow`'s props** — and never rendered.
`specs/ui.md` §11 asserted the opposite ("`runtimeMinutes` is displayed but not
filterable") for the whole life of the list, which is why the gap survived: the
spec told every reader it was done.

⚠ **The `/ep` suffix on TV is the requirement, not a flourish.** TMDB gives
series an `episode_run_time` array and `tmdbClient.readRuntime` takes its first
element when usable. When absent, the owner-approved 2026-09-16 fallback
uses the median runtime of aired regular episodes in the latest aired season,
rounded to whole minutes (`specs/ai.md` §4.1, `T-TMDB-022`).
Thus **the stored number represents a typical episode**, not a total. Rendered bare beside a
nine-season series, `45m` is a false statement about the work — and it is
false in the direction that matters, because the owner is choosing what to
watch tonight. Total-series runtime is not available without summing every
season, so per-episode is the only semantic the stored data supports; naming it
in the label is what makes that honest.

⚠ **The unknown case is NAMED, not omitted** — unlike an empty genre list
(US-019 AC-6), and like a missing rating (REQ-091). The two precedents differ
for a reason, and runtime follows the rating one: **runtime is filterable**
(REQ-035), so whether a row has one decides whether it can appear at all. An
owner who cannot see that a title has no runtime cannot understand why it
vanished when they filtered.

### REQ-035 / REQ-037 (`must`, promoted at `A48`) — filter and sort by runtime

Both were deferred to v1.1 under decision **D2** at the phase 4 lock, with the
revisit trigger *"once the owner reports that service/type/genre filtering is
insufficient to narrow a real list"*. **The owner reported it.** The blocker
recorded against D2 — *"a decision on TV runtime semantics"* — is settled by
REQ-119 above: per-episode, labelled as such.

No migration and no new column: `Title.tmdbRuntimeMinutes` has been stored
since v1 precisely so this would be additive.

The filter is **bucketed** (*Under 30m*, *30m–1h*, *1h–1h 30m*,
*1h 30m–2h*, *Over 2h*), with
half-open `[lower, upper)` boundaries, and is operated by a **two-handle range
slider whose stops are those bucket edges** (owner-approved 2026-09-23, #366)
— see `specs/ui.md` §2.1 item 2 for how it meets the accessibility floor.
~~Superseded: "and **not a range slider** — see `specs/ui.md` §2.1 item 2 for
why a slider fails the accessibility floor."~~

The owner split the old *1h–2h* option on 2026-09-16. Canonical tokens are
`60-90` and `90-120`; 90 belongs only in the second and 120 remains in
`over120`. Legacy `60-120` input expands to both replacements without
remaining a visible option. Removing one derived chip retains only the other
canonical bucket, rather than allowing the legacy alias to reselect it.

⚠ **The one way this requirement can silently lose titles**, and the mitigation
that is part of it: a `null` runtime satisfies no bucket, so activating a
runtime filter hides every title whose runtime TMDB never supplied. The list
shortens and nothing says why. `GET /api/titles` therefore returns
**`runtimeUnknownHidden`**, computed server-side over the whole filtered set
(never the page, never the client), and the bar renders *"3 titles have no
runtime and are hidden"* while a runtime filter is active. This is product
invariant 2's rule — nothing disappears without telling the owner — in a new
place.

| Test id | Asserts |
|---|---|
| `T-UX-121` | The row renders `1h 55m` for film and `45m/ep` for TV; the `/ep` suffix is absent for film and present for every TV row. |
| `T-UX-122` | A `null` runtime renders the words `Runtime unknown` — never `0m`, never an empty slot. |
| `T-UX-123` | Selecting a bucket sets `runtime` in the query string; half-open boundaries place 60 in `60-90`, 90 in `90-120`, and 120 in `over120`. Legacy input expands and deduplicates without becoming a canonical option. |
| `T-UX-124` | While a runtime filter is active, the hidden-unknown disclosure renders with the server's count; with no runtime filter it does not render at all. |
| `T-API-019` | `sort=runtime` orders by runtime with `NULL`s last in **both** directions, tie-broken by `title.id`. |
| `T-API-020` | `runtimeUnknownHidden` counts the whole filtered set rather than the returned page, and is `null` when no runtime filter is active. |
| `T-API-021` | An unrecognised `runtime` bucket is a **400**, per the §3 enum rule. |

---

## 5b. Design — six one-click complete orders (approved 2026-09-16)

> **REQ-121 (`must`) — six visible native buttons, no separate direction segment.**
> Activating an inactive field applies its default order in one navigation;
> activating the selected field reverses that field in one action.

| Field | Default | `desc` label | `asc` label |
|---|---|---|---|
| Date added *(default field)* | `desc` | Recently added | Oldest additions |
| Name | `asc` | Name Z-A | Name A-Z |
| Release year | `desc` | Newest releases | Oldest releases |
| Runtime | `desc` | Longest runtime | Shortest runtime |
| IMDb rating | `desc` | Highest rated | Lowest rated |
| Watch priority (REQ-126) | `asc` | Lower priority first | Watch priority |

These twelve strings are centralized in **`SORT_ORDER_LABELS`** in
`apps/web/src/copy.ts`; `SortControl` imports that map rather than maintaining
a second literal vocabulary.

Exactly one field is `aria-pressed="true"`. Its accessible name states its
current complete order, that it is selected, and the reverse order pressing it
will apply. Inactive fields show their default orders. Button positions never
reorder. Name and Watch priority default to `asc`; the other four default to `desc`, matching
the API. Date-added labels refer to nextup's earliest active-listing date,
not the streaming service's save date.

**Oldest additions is one press on the selected Recently added button from
the default view**, without opening a menu. Sort controls may wrap at narrow
widths but must remain visible; no sheet or collapsed selector adds a press.
The URL owns field and direction. Missing direction means the field default;
#328 restores complete saved destinations before list reads, never over an
explicit query/history URL. Explicit inactive-field clicks choose the field
default instead of carrying the previous field's direction. Both `sort` and
`dir` change atomically while filters, `q` and unrelated parameters survive.
The route resets its paging state, never locally sorts loaded titles.

~~Historical OQ-5 shape: field selector plus two direction segments, preserving
`dir` when changing field. Replaced by the owner-approved complete-order
buttons above.~~

| Test id | Asserts |
|---|---|
| `T-UX-128` | Six complete-order buttons remain visible in fixed field order with exactly one marked; no separate direction radio segment. |
| `T-UX-129` | Each field uses the approved complete-order labels; URL/session/default precedence agrees with the API's per-field defaults. |
| `T-UX-130` | Inactive field selection applies its default, active selection reverses; filters and `q` survive while route paging restarts. |
| `T-UX-131` | With the default field selected, oldest-first is reachable in exactly **one** interaction. |
| `T-UX-138` | All six complete-order choices, active reversals, state/next-action accessibility, query preservation and back/forward/session synchronization. |

### 5c. Submitted title search (approved 2026-09-16)

The labelled title-search form submits explicitly (button or Enter) to URL
`q`. Typing alone changes only the draft, not the request. The server searches
the owner's eligible titles before filter composition, ordering, paging and
runtime-hidden counting; `api.md` §6.2c defines validation and matching.
There is **no client-side search of loaded rows**. Submission preserves
filters, sort and local Grid/Compact preference and starts paging afresh.
The `q` chip removes only search; Clear filters also clears `q`.
The zero-match message explains that the query/filters matched nothing rather
than implying deleted titles. Real loading, retry and offline states remain.
Named coverage: `T-UX-140`, `T-API-030`.

---

## 6. Design — navigation (the owner's "better navigation")

### REQ-116 (`must`) — the current destination is indicated, and not by colour alone

`components/AppShell.tsx` renders six `<NavLink>`s as bare `.tap-target`s.
React Router supplies `isActive`; **nothing consumes it**. There is no way to
tell which page you are on from the navigation.

⚠ **Not colour alone** — `specs/ui.md` §10.2. The indicator must carry a
non-colour cue (weight plus a rule/underline) and `aria-current="page"`.

⚠ **`matchPath` AND `<NavLink>` DISAGREE ABOUT `/` BY DEFAULT** *(finding,
TASK-211)*. `matchPath({ path: '/', end: false })` compiles to a prefix that
matches **every** path in the application, while `<NavLink to="/">` requires
the following character to be a `/` and is therefore already exact. Anything
deriving the active class from `matchPath` while letting `NavLink` own
`aria-current` must pass **the same `end` to both**, or the class and the ARIA
state diverge — the List destination renders highlighted on all eleven routes
while assistive technology is told nothing. `T-UX-117b` asserts both land on
the same element; `T-UX-117d` asserts the `/` case directly.

### REQ-117 (`should`) — a hybrid header with a Menu drawer

> ✅ **CURRENT — the sidebar lists everything (owner decision 2026-09-25,
> after issue 369).** At and above `--bp-lg` (1024 px) the header is a
> sidebar with room for every destination, so it lists **all of them
> directly**, in route-table order, each with a decorative icon beside its
> visible label: Library `ListIcon`, Import `UploadIcon`, Review `CheckIcon`,
> Removal history `HistoryIcon`, Not interested `SuppressedIcon`, Waiting to
> stream `ClockIcon`, About `InfoIcon`, Rating lookup `RatingIcon`. **There is
> no Menu button and no drawer at this width.** Widening past `--bp-lg` while
> the drawer is open closes it. The sidebar and the page share **one framed
> panel** (a `--color-border-soft` border and `--radius-card` corners, with
> the frame's gutter as its margin). A 1px `--color-border-soft` hairline on
> the content's inline-start edge separates the nav from the page. Below
> `--bp-lg` the issue-369 design in the next box is unchanged, except that
> "at every width" now means "below `--bp-lg`". `BP_LG` and
> `SIDEBAR_VIEWPORT_QUERY` in `breakpoints.ts` must agree with `--bp-lg` and
> the `@media` prelude (`T-UX-167e`). `useSidebarViewport` falls back to the
> sidebar when `matchMedia` is unavailable, for the same "everything visible"
> reason as `useWideViewport`. Tests: `T-UX-167`, `T-NAV-003`.
>
> ✅ **CURRENT below `--bp-lg` — issue 369, owner decision 2026-09-25 (ADR-0013 Revision 4).**
> From `--bp-sm` up, the one header `<nav>` shows **Library (`/`), Import
> (`/upload`) and Review (`/batches`)** inline, plus a **Menu** button. Below
> `--bp-sm`, it shows **only the Menu button**. At every width below `--bp-lg`, Menu
> (`aria-expanded`, `aria-controls="nav-drawer"`, `aria-haspopup="dialog"`,
> visible label *Menu*) opens a modal drawer on the `Dialog` primitive,
> pinned to the inline-start edge. The drawer lists **every** nav route
> directly, in route-table order: Library, Import, Review, Removal history,
> Not interested, Waiting to stream, About, Rating lookup. It has no nested
> disclosure and no *More*. The current page is marked `aria-current="page"`
> with the non-colour active style (REQ-116). The drawer opens closed, even
> on a deep link.
>
> - **Keyboard and focus:** focus moves into the drawer and is trapped
>   there. This holds in WebKit too, whose default Tab order skips links.
>   Escape, the backdrop and the labelled *Close menu* button all close the
>   drawer and return focus to Menu. Following a link closes the drawer and
>   then navigates. Changing location (including Back/Forward) closes it.
> - **Layout:** the drawer is `min(20rem, 100%)` wide, fills the viewport
>   height and scrolls itself (`overflow-y: auto`,
>   `overscroll-behavior: contain`), so on a short viewport every
>   destination stays reachable. It honours `env(safe-area-inset-bottom)`.
> - **The bottom-fixed phone bar is withdrawn**, together with
>   `--nav-bar-height`, the shell's bar clearance, `scroll-padding-bottom` and
>   the sticky review bar's bar offset. A sticky footer control now clears
>   only the home-indicator inset.
> - **Unchanged:** URLs, deep links, Back/Forward, persisted library state
>   and drafts. There is still exactly one `<nav>` (`T-A11Y-004`). `/upload`
>   stays reachable from every width (REQ-039).
>
> Everything below this box, down to the test table, is the superseded
> TASK-211 design. It is kept as history; **do not build it**.

~~### REQ-117 (`should`) — the phone gets a primary destination bar~~

**Approved desktop refinement (2026-09-16):** at and above `--bp-sm`, the
single header navigation contains **List, Upload, Batches, More**. All other
destinations remain real links in More. Below `--bp-sm`, Batches joins the
overflow, leaving **List, Upload, More**. Do not duplicate the nav landmark.

> ⚠ **RESOLVED IN PLACE 2026-09-14 (OQ-2).** Below `--bp-sm`, the bar presents
> **three slots: the list (`/`), `/upload`, and `More`.** **Everything else
> moves behind `More`** — at the time of writing that was `/removed`,
> `/not-interested` and `/batches`; Epic L added `/waiting` and Epic M added
> `/rating`, and they are behind `More` too.
>
> ⚠ **THE OVERFLOW IS DEFINED BY SUBTRACTION, NOT BY A SECOND LIST**
> *(corrected in place, TASK-211)*. This paragraph named three routes because
> three was all there were. Read as a closed enumeration it says nothing about
> `/waiting`, `/about` or `/rating` — and a bar of exactly three slots plus an
> overflow that omits them leaves those destinations **absent from the phone
> entirely**, which is the one outcome §6 exists to prevent. `AppShell.tsx`
> therefore derives the overflow as *every nav route that is not `/` or
> `/upload`*, and `T-UX-132b` asserts all six.
>
> ~~Below `--bp-sm`, the bar presents three slots: the list (`/`), `/upload`,
> and `More`. `/removed`, `/not-interested` and `/batches` all move behind
> **More**.~~
>
> ~~the three destinations the owner moves between most are presented as a
> persistent bar; the rest move behind a "More" destination.~~ *(The shape was
> right; the owner has now named the contents.)*

> ⚠ **THE BAR IS FIXED TO THE BOTTOM OF THE VIEWPORT** *(resolved in place
> 2026-09-15, owner decision)*. Below `--bp-sm` the nav leaves the top of the
> page and sits against the bottom edge, always visible, both real
> destinations in thumb reach. It was first built inside the `<header>`, where
> it scrolled away with the page — a reading this paragraph permitted, because
> it said what the bar **contains** and never said where it **is**.
>
> ⚠ **THERE IS STILL EXACTLY ONE `<nav>`, AND THAT IS WHY THIS IS A CSS
> CHANGE.** The idiomatic bottom bar is a second `<nav>` rendered only on
> phones, and it fails `T-A11Y-004` / `T-UI-023c` — which require `<header>`,
> `<nav>`, `<main>` and `<footer>` exactly once per page — on every route at
> once. The single `<nav>` is **repositioned**, never duplicated.
>
> ⚠ **THE CONTENT CLEARANCE IS PART OF THE REQUIREMENT, NOT A POLISH STEP.** A
> fixed bar is out of flow, so without matching bottom padding on the shell it
> covers the last row of every list — and the rows it hides are the ones at
> the end of the scroll, which is exactly where the owner stops looking. The
> `More` panel opens **upward** for the same reason: anchored below its
> trigger it would open off-screen.
>
> ⚠ **`env(safe-area-inset-bottom)` NEEDS `viewport-fit=cover` IN THE VIEWPORT
> META TAG OR IT IS ALWAYS `0`.** Without it the inset resolves to zero on
> every device including the ones that need it, so the bar renders *under* the
> iPhone home indicator while the stylesheet looks entirely correct. This is
> the half that cannot be seen in the CSS.

Six wrapped links above every page is most of the phone's first screen, at the
cost of the content.

⚠ **THE OWNER CHOSE ONLY TWO REAL DESTINATIONS PLUS OVERFLOW, AND THAT IS NOT
AN OMISSION TO BE HELPFULLY CORRECTED.** The temptation is to promote
`/removed` or `/batches` into the spare-looking third slot. Don't: the two
chosen destinations are the value loop (*see the list*, *feed the list*) and
everything else is a place the owner visits deliberately, not repeatedly. A bar
of three where one is `More` is a deliberate choice.

⚠ **`More` IS A DESTINATION, NOT A HAMBURGER MENU.** It is reachable, has a
focusable control with an accessible name, and the routes behind it keep their
own URLs — so a deep link to `/removed` still works and is still marked current
when open (REQ-116). The bar renders **icon over label** (§7c); an icon-only
bar would fail REQ-116's not-by-colour-alone sibling rule for the same reason.

⚠ **`/upload` reachability is load-bearing and is not merely a nav item.**
REQ-039's `FreshnessStrip` uses a **Service updates** nonmodal disclosure
containing every service's factual last-updated link to `/upload` **with that
service pre-selected**. Never-updated remains a named fact. When dates are
unavailable, the degradation notice stays **visible outside the disclosure**;
the service-labelled upload links remain inside. No staleness threshold, nag
or reminder is introduced. Reuse `FilterDisclosure`'s Escape/outside dismissal,
focus restoration and untrapped Tab behavior.

| Test id | Asserts |
|---|---|
| `T-UX-117` | The active destination carries `aria-current="page"` and a non-colour cue, in the wide bar and in the Menu drawer; `/` is exact and a child route keeps its parent (Review) marked. |
| `T-UX-118` | Opening Service updates exposes every factual service link to `/upload` with that service pre-selected, including when dates are unavailable; `/upload` is reachable exactly once from the phone Menu drawer. ~~…and `/upload` is a phone bar slot.~~ |
| `T-UX-132` | *(Redefined in place, issue 369.)* Below `--bp-sm` the header renders only the Menu button; at or above it, Library, Import and Review plus Menu. The Menu is a disclosure (`aria-expanded`, `aria-haspopup="dialog"`) opening a modal drawer that lists every destination directly, with no nested *More*. <br />~~Below `--bp-sm` the bar renders exactly `/`, `/upload` and `More`; **every other nav route** — `/batches`, `/removed`, `/not-interested`, `/waiting`, `/about`, `/rating` — is reachable only via `More`. ⚠ *Corrected in place at TASK-211; this row named only the first three, which were all that existed when it was written.*~~ |
| `T-UX-133` | *(Redefined in place, issue 369.)* A drawer-only route is reachable by direct URL, opens with the drawer closed, and is marked `aria-current="page"` inside the drawer. Every drawer link has its own href. Escape and *Close menu* return focus to Menu. Following a link closes the drawer. <br />~~A route behind `More` is still marked `aria-current="page"` when it is open, and is still reachable by direct URL.~~ |
| `T-UX-137` | *(Redefined in place, issue 369.)* No rule at any width fixes the nav to the viewport. `--nav-bar-height` and `scroll-padding-bottom` are gone. The shell and the drawer honour the safe-area inset. The drawer scrolls within the viewport, pinned to the inline-start edge. `viewport-fit=cover` stays. The wide shell padding stays the shorthand. The Menu is present on every destination at phone width. Asserted against `index.css` and `index.html` as files. <br />~~Below `--bp-sm` the nav is fixed to the bottom of the viewport, the shell reserves matching bottom clearance, the `More` panel opens upward, the safe-area inset is honoured, and **all four are reset at or above `--bp-sm`** so the desktop nav returns to the header. ⚠ Asserted against `index.css` and `index.html` **as files** — jsdom performs no layout and applies no stylesheet, so every rendered assertion about position passes vacuously.~~ |
| `T-NAV-001` | Issue 369: the route table carries the owner's names (Library, Import, Review, Rating lookup) and no retired one; Library, Review and Rating lookup open on a heading with that name; no owner-facing copy constant says *your list*, *this batch*, *Batch history* or *Check a rating*; the Review page shows imports with a next step under *Needs review* and everything else under *Import history*, with no *Needs review* heading when nothing is pending. |
| `T-NAV-002` | Issue 369, in Chromium and Mobile Safari at 320, 390, 640 and 1280 px: the header shows the hybrid bar and the drawer lists every destination with its href and the current page; the drawer fits the viewport with no horizontal overflow; focus is trapped and Escape returns it to Menu; a drawer link navigates, closes the drawer and marks the new page; at 320 px height the drawer scrolls so the last destination is usable; the open drawer has no serious or critical axe violation. |
| `T-UX-167` | Sidebar (`--bp-lg` and up): every destination listed directly with an icon, route order, hrefs and current-page marking; no Menu or drawer; the drawer closes on widening; `--bp-lg` agrees across `:root`, `@media` and `SIDEBAR_VIEWPORT_QUERY`; one framed panel with a content-side hairline. |
| `T-NAV-003` | Sidebar in Chromium and Mobile Safari at 1280 px: all destinations visible, no Menu, no overflow, nav before content inside the frame with a 1px divider, link navigation moves the marking, axe clean. |

### 6b. Destination names (issue 369, owner decision 2026-09-25)

**This mapping applies to all owner-facing copy.** Where older specs quote
copy with a retired name (for example *"Already on your list (N)"* in
`ux-states.md` §6.6 or `ai.md`), read it through this table. The behaviour
those specs describe is unchanged.

| Destination | URL | Name | Page heading | In copy |
|---|---|---|---|---|
| the combined list | `/` | **Library** | *Library* | "your library", "in your library", "out of your library" |
| capture | `/upload` | **Import** | *Import screenshots* | a capture is "an import": "this import", "Undo this import", "Review this import" |
| capture history | `/batches` | **Review** | *Review*, with sections *Needs review* (a draft, a read in progress, a review to finish or an extraction to resolve) and *Import history* (applied, undone or discarded) | "Back to Review", "Check Review" |
| IMDb lookup | `/rating` | **Rating lookup** | *Rating lookup* | — |

- *Upload* stays only as the verb for sending selected files ("Upload
  selected screenshots").
- *Batch* stays an internal term only: code, API paths, `data-testid`s and
  error codes.
- Removal history, Not interested, Waiting to stream and About keep their
  names.

~~No terminology section existed before issue 369. Nav labels were *List*,
*Upload*, *Batches* and *Check a rating*, over pages headed *Your list*,
*Upload screenshots* and *Batch history*.~~

---

## 6a. Design — the review screen (the owner's *"not smooth and confusing"*)

⚠ **THE OWNER SAID TWO SEPARATE THINGS ABOUT THIS SCREEN AND ONLY ONE OF THEM
IS ANSWERED ABOVE.** REQ-109 fixes the specific defect they could point at (the
card doesn't change). But their actual words were: *"the workflow on the upload
page was not smooth and it was confusing."* **That is a design complaint about
the flow, and REQ-109 does not resolve it** — a card that updates correctly can
still sit inside a confusing sequence.

⚠ **This document does not guess what confused them.** The review screen is the
product's confirmation step and its states are already specified in detail
(`specs/ux-states.md` §6.8, `specs/ui.md` §5.3); redesigning it from a
one-sentence report would mean re-deciding a carefully-reasoned safety surface
on an inference. **§9 OQ-6 asks.**

What is already known, and is worth putting in front of the owner when asking:

- The screen mixes **three candidate sections** (unmatched, additions,
  removals-in-a-full-update) whose cards look alike but mean different things.
- Each card offers **Confirm / Change match / Discard** and, per `A46`, a
  full-update review shows **all** extracted titles, not just new ones —
  correct and safety-critical, but it makes the list long, and a long list of
  mostly-fine rows is exactly where a confusing flow is felt.
- **Apply is a separate, later action** — the owner corrected, then clicked
  apply, and only then saw the result. The gap between "I fixed it" and "I can
  see it worked" is the thing REQ-109 narrows and the flow question is whether
  narrowing it is enough.

⚠ **Whatever the answer, the confirmation contract is not negotiable:** nothing
reaches the list until the owner has seen what was read and agreed. A
"smoother" flow that auto-applies, or that hides already-correct rows in a
full-update review, would **delete the product's core safety property** — the
second one is specifically forbidden, because a failed extraction of a known
title must never be readable as a removal.

### 6a.1 ✅ THE OWNER ANSWERED: (d) — the three sections looked alike

**OQ-6, resolved 2026-09-14.** Not the list's length, not the Apply wording:
**the three candidate sections look alike despite meaning different things.**

That is the best possible answer, because it is a **presentation** defect and
its fix does not touch the confirmation contract at all. The three sections
mean:

| Section | What agreeing to it does | Reversible? |
|---|---|---|
| **Unmatched** | Records a work this product could not identify | Yes — fix match, or discard |
| **Additions** | Puts a new title **into** the list | Yes — it can be removed later |
| **Removals** *(full-update only)* | Takes a title **out of** the list | ⚠ **This is the consequential one** |

> **REQ-122 (`must`) — the three review sections are visually distinct, and
> the removals section is the most distinct of them**
>
> Each section carries a persistent heading, its own surface treatment, and a
> count. The removals section is additionally marked as consequential, and its
> cards are visually distinguishable from an addition's card **when scrolled to
> in isolation**, not only when read against the heading above them.

⚠ **THE HEADING ALONE IS WHY THIS FAILED THE FIRST TIME.** A long full-update
review is scrolled, and by the time a removal card is on screen its heading is
off it. **A card must be identifiable without the heading in view** — that is
the specific property `T-UX-134` asserts, and it is the difference between this
fix and simply restyling the headings.

⚠ **NOT BY COLOUR ALONE** (`specs/ui.md` §10.2). The removal section pairs its
treatment with the **word** — the section heading and the card both say what
the action removes.

⚠ **DISTINCT DOES NOT MEAN COLLAPSED, REORDERED, OR FILTERED.** A full-update
review still shows **every** extracted title including the ones that are
already correct (`A46`). Making the sections distinguishable is explicitly
**not** licence to hide the boring one — that is the exact change that would
make a failed extraction readable as a removal.

| Test id | Asserts |
|---|---|
| `T-UX-134` | An addition card and a removal card are distinguishable from each other by their own rendered content, with no section heading in the accessible subtree. |
| `T-UX-135` | Each section renders a heading and a count, and the removals section carries a non-colour consequential marker. |
| `T-UX-136` | A full-update review still renders **all** extracted candidates, including already-correct ones — the section treatment hides nothing. |

---

## 7. Tokens (REQ-118, `must`)

**Owner-approved 2026-09-16 dark indigo palette**, applied in place to
`specs/ui.md` §13.2. Ratios below are against `--color-surface`.

| Token | Value | Surface contrast |
|---|---|---|
| `--color-bg` | `#121020` | Background |
| `--color-surface` | `#1e1932` | Surface |
| `--color-text` | `#f2efff` | **14.97:1** |
| `--color-text-muted` | `#bcb4d2` | **8.54:1** |
| `--color-border` | `#77678f` | **3.32:1** |
| `--color-accent` | `#b3a0ff` | **7.57:1** |
| `--color-danger` | `#ff9ba8` | **8.47:1** |

**Primary accent-filled buttons use `--color-surface` as foreground**, not
white or `--color-text`; that reversed pair is also **7.57:1**. Interactive
boundaries/focus rings use the contrast-proven border/accent, not a decorative
soft divider token. `--radius` is **10px**, `--radius-card` is **16px**.
The font stack is **`'Segoe UI', Aptos, Calibri, -apple-system,
BlinkMacSystemFont, sans-serif`**; system fonts only.

**`T-CSS-004` recomputes every pair from the token values**, so a substituted
shade fails CI rather than review. Any new token added by this refresh must be
added to that test's pair list in the same change.

This is the **default dark design**, not a theme toggle or a second palette.
**No web font, CSS framework, icon dependency or network request** is added.
`T-UX-142` pins the palette and visual language; `T-CSS-004` retains measured
contrast floors on both surfaces and `T-CSS-005` retains reduced-motion
behavior. Static literal class names remain governed by `T-CSS-001`.

---

## 7a. ⚠ REQ-095 IS REVERSED — the IMDb rating becomes a sort key (OQ-3b)

**The owner reversed their own `A51` decision on 2026-09-14.** §5 REQ-115's
warning block said this could only happen as a revision to ADR-0011 rather than
a line in this document, and that is what it is.

| | |
|---|---|
| **Was** | **REQ-095** — *"The IMDb rating is **display-only**. It is not a sort key, and no sort option for it exists."* Decided by the owner at `A51`, resolving ADR-0011's OQ-A |
| **Now** | The IMDb rating **is** an available ordering. REQ-095's prohibition is struck |
| **Mechanism** | ✅ **DONE.** `docs/adr/ADR-0011-imdb-ratings-via-omdb.md` **Revision 1** records the reversal, its date, its reason and the REQ-041 mechanism that pays for it. REQ-095 is corrected **in place** everywhere it appears — struck, not deleted — in `ADR-0011`, `adr/README.md`, `specs/api.md` §6.2/§6.2a/§6.11, `specs/ui.md` §7a, `specs/testing.md` §35, and `docs/PRD.md` US-036 AC-2 / §7.4 |

⚠ **THE RATING IS NULLABLE AND NOT EVERY TITLE HAS ONE.** `A48`'s general rule
governs and is **not** re-decided here: **`NULL`s sort LAST in BOTH
directions**, written explicitly in the SQL. SQL Server sorts `NULL` first
ascending by default, so "Lowest first" would otherwise open with every
unrated title — an **absence of data rendered as a claim about the works**,
which is the same defect `A48` identified for runtime.

⚠ **THE DISPLAY RULES FOR THE RATING ARE UNCHANGED.** ADR-0011's provenance
line (`specs/ui.md` §8a) and its absent-rating presentation still apply exactly
as specified. What was reversed is *sortability*, and nothing else — in
particular this is **not** licence to render a rating the product does not
have.

⚠ **`T-UX-119` ASSERTED THE PROHIBITION AND MUST BE REPLACED, NOT DELETED.**
§8's at-risk table lists REQ-095 with `T-UX-119` as its guard. A test that
asserts "no rating sort option exists" will now **fail correctly**, and the
temptation is to delete it quietly. It is rewritten to assert the new
behaviour, so the ledger row keeps a live guard rather than an empty cell.

| Test id | Asserts |
|---|---|
| `T-UX-119` | The rating complete-order button is present and selecting it issues `sort=rating`; its mutable-key refresh rules remain mandatory. |
| `T-API-023` | `sort=rating` orders by rating with `NULL`s **last in both directions**, tie-broken by `title.id`. |
| `T-API-024` | ⚠ **The REQ-041 guard.** Under `sort=rating` the rating sweep is **awaited before the `ORDER BY` is applied**, and **no rating write occurs after the response has been sent**. |
| `T-API-025` | A sweep that exhausts its request cap or time budget still returns **200**; unrefreshed titles keep their cached-or-absent value and are ordered on it. |
| `T-API-026` | An unrecognised `sort` value is **400 `INVALID_QUERY`**, never a silent fall back to `dateAdded`. |
| `T-API-027` | `sort=name` and `sort=releaseYear` order correctly in both directions. ⚠ **The name case must pin case-insensitive, human ordering explicitly** — the database collation is `Latin1_General_100_BIN2`, which is **binary**, so an unqualified `ORDER BY` puts every lower-case title after every upper-case one and `apple` sorts after `Zebra`. |
| `T-IMDB-005` | ⚠ **`b` rewritten.** It asserted the service module exports no sort helper; it now asserts the sweep is awaited before ordering. **Rewritten, not deleted** — see §8. |

### 7a.1 ⚠ Reversing REQ-095 is NOT a one-line strike — RESOLVED at `A53`

The reopening surfaced something neither `A51` nor this section originally
knew: **`specs/api.md` had since made REQ-095 load-bearing for REQ-041
compliance**, in terms:

> *"That is precisely what keeps the refresh legal under REQ-041 — a background
> write that changed the list's ORDER would not be."*

The two lazy refreshes in this repo are **not alike**. The TMDB metadata
refresh writes *synchronously inside the request* (`specs/api.md` §6.4), which
is explicitly why it satisfies REQ-041. The **rating** refresh writes *after the
response* — *"ratings appear on the next render"* — which was legal only
because a display-only field cannot change ordering. **Striking REQ-095 and
stopping would therefore have shipped a background write that silently
reorders the owner's list between renders, breaching product invariant 5.**

**The owner resolved this at `A53`, from four options, with the cost stated:**

| | Decision (`A53`) |
|---|---|
| **REQ-041** | Untouched. **Not** reworded, not widened. |
| **Mechanism** | Under `sort=rating` the rating sweep moves **inside the request, before the ordering** — adopting §6.4's proven shape. |
| **Scope of sweep** | The **sortable set**, not the page. ⚠ Refreshing only the page renders new values in an order computed from old ones — an `8.4` below a `7.1`. |
| **Bound** | A **request cap and a time budget**; anything unrefreshed keeps its cached-or-absent value and sorts on it. Mirrors §6.4's existing 5-second budget. |
| **ADR-0011 D-6** | **Amended**, not contradicted — its *"never for the whole table"* rule gains this one exception and holds everywhere else. |
| **Process count** | **Unchanged.** Synchrony moves the write *further inside* owner-initiated work; do not increment `T-CI-005`. |

⚠ **Known residual, accepted at `A53`.** Because the sweep covers the whole
sortable set it is self-limiting — after the first page nothing is stale, so
later pages write nothing and the ordering cannot drift under the cursor. The
one exception is a **budget-exhausted** sweep, where a keyset cursor over a
*mutable* key can step past a row that moved. The recorded remedy, if it is
ever observed, is to suppress the sweep whenever a `cursor` is present; **it is
not built in v1**. See ADR-0011 Revision 1 §R1-6.

⚠ **Rating is the ONLY mutable sort key.** Date-added is owner-supplied and
immutable once captured; name, release year and runtime are properties of the
work. **Do not generalise this hazard — or its remedy — to the other four
orderings.**

---

## 7b. Type — a scale, because "one size" is what unstyled looks like (OQ-8)

This document specified an accent and a radius and **no type scale at all**.
Every piece of text on every screen renders at one size, which is the single
loudest signal that a page was never designed.

> **REQ-123 (`must`) — a closed typographic scale, declared in `:root`**

| Token | Value | Used for |
|---|---|---|
| `--text-xs` | `0.75rem` | Uppercase, letter-spaced metadata labels **only** |
| `--text-sm` | `0.875rem` | Secondary and helper copy, genre chips |
| `--text-base` | `1rem` | Body. **Never below this for primary content** |
| `--text-lg` | `1.125rem` | The title-row name, card headings |
| `--text-xl` | `1.5rem` | Section headings |
| `--text-2xl` | `2rem` | Page heading |
| `--leading-tight` | `1.2` | Headings |
| `--leading-normal` | `1.55` | Body |
| `--weight-normal` / `--weight-medium` / `--weight-bold` | `400` / `600` / `700` | |

⚠ **NO WEB FONT. `--font-stack` USES THE SEGOE UI/APTOS SYSTEM STACK IN §7** (NFR-005,
`T-CI-007`'s egress rule). The owner was offered the scale on the existing
stack and accepted it on that basis. A scale is about **size, weight and
rhythm** — none of which needs a downloaded typeface, and all of which is
missing today.

⚠ **`--text-xs` IS FOR UPPERCASE TRACKED LABELS, NOT FOR SHRINKING BODY COPY
TO WIN DENSITY.** REQ-112's density is found in layout and in the compact genre
presentation, **not** by making content smaller than `--text-sm`. NFR-006 is
the floor and `T-CSS-003` already forbids a raw `px` size in a rule body.

| Test id | Asserts |
|---|---|
| `T-CSS-006` | `:root` declares every token above, and no rule body contains a raw font-size literal. |
| `T-CSS-007` | No rendered primary content computes to a font size below `--text-sm`. |

---

## 7c. Icons — inline SVG, no font, no network, no dependency (OQ-8)

The shipped inline set is extended by five owner-approved library sort-category
icons for the 2026-09-17 controls redesign and one Filters mark for the
2026-09-24 toolbar restyle (issue 370), in addition to the play/next brand and
Grid/Compact affordances, without importing an icon package.

~~The shipped inline set is extended by five owner-approved library sort-category
icons for the 2026-09-17 controls redesign, in addition to the play/next brand
and Grid/Compact affordances, without importing an icon package.~~

~~The shipped inline set is extended by the approved play/next brand and
Grid/Compact affordances, without importing an icon package.~~

> **REQ-124 (`must`) — icons are hand-authored inline SVG components**

- They live in `apps/web/src/components/icons/`, one component per icon, drawn
  on a **24 px grid** with `stroke="currentColor"` and `stroke-width="1.5"` —
  so an icon inherits its colour from context and needs **no token of its
  own**, and `T-CSS-003` is never tempted.
- **No icon font, no sprite URL, and no icon package.** Each would add either a
  network request or a runtime dependency; the owner accepted icons explicitly
  on the basis that neither is incurred. NFR-004's small-tree preference and
  `T-CI-007`'s egress rule both stay intact.
- The set is **closed at 23**: `list`, `upload`, `more`, `history`, `suppressed`,
  `rating`, `close`, `check`, `chevron`, `info`, `warning`, `search`, `image`,
  **`brand`, `grid`, `compact`**, the library sort-category icons
  **`alphabet`, `bookmark`, `calendar`, `clock`, `flag`**, the library
  toolbar **`filter`** mark (ADR-0013 Revision 3, issue 370), and the header
  **`menu`** mark (ADR-0013 Revision 4, issue 369) (`BrandIcon`,
  `GridIcon`, `CompactIcon`, `AlphabetIcon`, `BookmarkIcon`, `CalendarIcon`,
  `ClockIcon`, `FlagIcon`, `FilterIcon`, `MenuIcon`).

  ~~The set is **closed at 22**: `list`, `upload`, `more`, `history`, `suppressed`,
  `rating`, `close`, `check`, `chevron`, `info`, `warning`, `search`, `image`,
  **`brand`, `grid`, `compact`**, the library sort-category icons
  **`alphabet`, `bookmark`, `calendar`, `clock`, `flag`**, and the library
  toolbar **`filter`** mark (ADR-0013 Revision 3, issue 370) (`BrandIcon`,
  `GridIcon`, `CompactIcon`, `AlphabetIcon`, `BookmarkIcon`, `CalendarIcon`,
  `ClockIcon`, `FlagIcon`, `FilterIcon`).~~

  ~~The set is **closed at 21**: `list`, `upload`, `more`, `history`, `suppressed`,
  `rating`, `close`, `check`, `chevron`, `info`, `warning`, `search`, `image`,
  **`brand`, `grid`, `compact`**, and the library sort-category icons
  **`alphabet`, `bookmark`, `calendar`, `clock`, `flag`** (`BrandIcon`,
  `GridIcon`, `CompactIcon`, `AlphabetIcon`, `BookmarkIcon`, `CalendarIcon`,
  `ClockIcon`, `FlagIcon`).~~

  ~~The set is **closed at 16**: `list`, `upload`, `more`, `history`,
  `suppressed`, `rating`, `close`, `check`, `chevron`, `info`, `warning`,
  `search`, `image`, **`brand`, `grid`, `compact`** (`BrandIcon`, `GridIcon`,
  `CompactIcon`).~~

⚠ **AN ICON IS NEVER THE SOLE LABEL.** Every icon-only control carries an
`aria-label`, and REQ-117's bar renders **icon over label**. An undecorated
`<svg>` inside a button produces a control whose accessible name is **empty** —
`axe-core` reports that as `button-name`, and in a diff it reads as a styling
change rather than as the accessibility regression it is.

| Test id | Asserts |
|---|---|
| `T-A11Y-016` | No `<svg>` is exposed to the accessibility tree without a name, and every icon-only control has a non-empty accessible name. |

⚠ **THIS ID WAS CORRECTED IN PLACE, 2026-09-14.** It was written as
~~`T-A11Y-014`~~, which `specs/testing.md` L1247 **already defines** for the
US-033 refusal enumeration at 320 px. `check:test-ids` only asks whether a
cited id is defined *somewhere*, so the collision passes every gate while**
two unrelated behaviours answer to one name** — and TASK-209 would have
reported **done** off a passing refusal test with no icon assertion anywhere.
The family was enumerated at the point of naming; `016` and `017` were free.
| `T-UI-030` | Every icon component renders `stroke="currentColor"` and declares no hard-coded colour. |

---

## 7d. Component primitives — build once, then reuse (OQ-8)

There are **no** shared UI primitives: every button is a bare `<button>`, every
grouping a native `<fieldset>`, and each screen re-solves the same problem
slightly differently. That is why the screens look unrelated to each other even
where each is individually correct.

> **REQ-125 (`must`) — controls are built from named primitives**

These live in `apps/web/src/components/ui/`:

| Primitive | Class root | Notes |
|---|---|---|
| `Button` | `btn` | `btn--primary` (accent fill), `btn--secondary`, `btn--ghost`, `btn--danger`. Always `.tap-target` |
| `Card` | `card` | The default container |
| `Badge` | `badge` | Service badges and status chips. Tint **plus** label, never colour alone |
| `Chip` | `chip` | The compact genre presentation of §4.3, including its `+n` overflow |
| `SegmentedControl` | `segmented` | Exclusive mode/service choices such as `/upload`; **not** the revised sort controls. Keeps `role="radiogroup"` semantics |
| `Field` | `field` | Label + control + description + error, so the four cannot drift apart |
| `EmptyState` | `empty-state` | Icon + title + body + optional action |
| `Skeleton` | `skeleton` | Shaped like the content it replaces, so nothing jumps |
| `Dialog` | `dialog` | Focus trap, `Esc` to dismiss |

`components/FilterDisclosure.tsx` is reusable outside `FilterBar`, including
Service updates. Its props are `label: string`, `children`, and optional
`value: string`. All filter pickers supply `value`, rendering an external
category label, current/default value and decorative chevron; accessible
names include both category and value. Without `value`, Service updates
retains its standalone disclosure presentation.
It uses native `Button` and a labelled nonmodal group, generated IDs,
first-control/link focus, Escape/Done restoration and outside dismissal.
It **does not trap Tab or claim `aria-modal`**. Its classes are
`filter-disclosure` / `filter-disclosure__panel`, with
`filter-disclosure__label` / `filter-disclosure__value` for fields;
`[hidden]` remains hidden. **Filter by** groups two columns on phones and
three from 640 px and six from 1024 px. An empty field reads **Any** in the panel; in the wide
quick-filter row an empty pill reads only its dimension name, and an active one adds its value as an
accent tag (`filter-disclosure__name`, `data-active`; TASK-254). ~~Empty values read All services /
All types / All genres / Any runtime / All titles / All priorities.~~ One selection shows its name,
multiple distinct selections show N selected. Individual removable chips remain (`T-UX-144`).

⚠ **A VARIANT IS A STATIC CLASS LOOKUP, NOT A COMPUTED STRING.** `T-CSS-001c`
forbids `className={…}` so that `T-CSS-001`'s two directions remain an exact
static scan. A primitive satisfies this with a **lookup from a literal map**
keyed by the variant prop, whose values are string literals. A template literal
stays banned: it makes the vocabulary unscannable, and an unscannable
vocabulary is how the stylesheet and the components drift apart unnoticed.
**`T-CSS-001c` is widened to permit that one form and nothing else.**

⚠ **`.tap-target`'s 44 px FLOOR IS NOT RENEGOTIATED BY THESE.** §8 already
flags REQ-107 as reading like licence to shrink a target. A primitive is the
easiest place to lose it for every control at once.

| Test id | Asserts |
|---|---|
| `T-UI-031` | Every interactive control in `apps/web/src/**` is rendered by a primitive, not by a bare `<button>` or `<fieldset>`. |
| `T-UI-032` | Every primitive variant resolves to a static class present in the stylesheet, and no primitive uses a template-literal `className`. |
| `T-A11Y-017` | Every `Button` meets the `--tap-target-min` floor at 320 px. ~~`T-A11Y-015`~~ — see §7c; `015` is the 280 px degradation test. |

---

## 8. ⚠ The behavioural `must`s this refresh can silently delete

**A visual refresh is the easiest place in this codebase to lose a `must` with
a fully green suite**, because the tests that guard these assert *behaviour*,
not *placement* — a control moved into a collapsed menu still answers to
`click()`. **Check this list explicitly at review time.**

| At risk | Why it is easy to lose | Guard |
|---|---|---|
| **Three ingest affordances** — clipboard paste, **file selection**, drag-and-drop (REQ-001/004, ADR-0009) | A tidy upload screen looks like it should have *one* input. Paste was **added, not swapped in**; file selection is the laptop path *and* the iOS Photos path. | `T-PASTE-010` — **must not be displaced** |
| **The iOS paste button** | Looks redundant next to a document-level `paste` listener. It is not: iOS needs a visible button calling `navigator.clipboard.read()` **synchronously inside the click handler**. | ADR-0009 |
| **REQ-038 oldest-first reverse** | Looks like an optional extra in a menu. It is `must` (A47). | `T-UX-116` |
| **REQ-039 per-service last-updated** | A tidy header wants to drop it. ⚠ It is the **mandatory** mitigation for RSK-007 and is `must`. **Show the fact; never nag** (`A46`). There is **no** staleness nudge and none may be added. | `T-UX-118` |
| **`--tap-target-min: 44px`** | REQ-107 narrows the `⋮` box and reads like licence to shrink the target. It is not. | `T-A11Y-001b` |
| **REQ-095 rating is display-only** | The rating is **rendered on the row**, so a sort menu designed from the screen will include it without ever seeing the requirement that forbids it. ~~Decided by the owner at `A51`.~~ ⚠ **REVERSED by the owner on 2026-09-14 (`A53`, OQ-3b) — rating IS now a sort key.** The risk **inverts**: the danger is no longer adding the sort, it is **deleting `T-UX-119` instead of rewriting it** when it correctly starts failing. See §7a | ~~`T-UX-119`~~ **`T-UX-119` rewritten, plus `T-API-023`** |
| **The rating refresh's SYNCHRONY** *(new, `A53`)* | ⚠ **This is the load-bearing half of the REQ-095 reversal and the easiest to lose.** REQ-090's refresh fires **after the response**; that was legal only while the rating could not change ordering. Under `sort=rating` it must run **inside the request, before the `ORDER BY`**. The failure mode is invisible in a unit test and invisible on screen — the list simply reorders itself between renders — and "move the await out of the hot path" reads like a performance fix. ⚠ **`T-IMDB-005b` asserted the module exports no sort helper; it will fail correctly and must be REWRITTEN, not deleted** | `T-API-024`, `T-IMDB-005` |
| **The rating sweep's SCOPE** *(new, `A53`)* | Sweeping only the **page** instead of the **sortable set** looks like a faithful reading of ADR-0011 D-6 and produces a page ordered by pre-refresh values but rendered with post-refresh ones — an `8.4` sitting below a `7.1`. It passes any test that checks "ratings were refreshed" | `T-API-024`, `T-API-025` |
| **`sort=name` under a BINARY collation** *(new, `A53`)* | The database collation is `Latin1_General_100_BIN2`. An unqualified `ORDER BY title` is therefore **byte order**: every lower-case title sorts after every upper-case one, and `apple` follows `Zebra`. It looks alphabetical at a glance on a list that happens to be title-cased | `T-API-027` |
| **The genre filter's completeness** *(new, 2026-09-14)* | §4.4's normalisation is one-to-many and must be applied to **both** the display and the filter. Doing only one produces a screen that looks fixed while the facet still under-returns — and the symptom the owner reported (redundant chips) **disappears** after a display-only fix, which is exactly what makes it convincing | `T-UX-125`, `T-UX-126`, `T-API-028` |
| **The review sections' completeness** *(new, 2026-09-14)* | REQ-122 makes three sections distinguishable. The neighbouring idea — collapsing or hiding the already-correct rows to shorten the list — **deletes the product's core safety property** and looks like the same kind of tidy-up | `T-UX-136` |
| **Oldest-first in one action** *(revised 2026-09-16)* | Hiding the selected Recently added button behind a menu adds a press and deletes the one-action reverse, even if URL helper tests pass | `T-UX-131`, `T-UX-138` |
| **Removed/suppressed distinction** | Two similar-looking screens invite a merge. Suppression is keyed on **canonical work identity**, removal on the listing — different mechanisms, different meanings. | REQ-071 |

Everything in `specs/ui.md` §9's copy strings is owner-facing wording; changing
one is a product decision, not a styling one.

---

## 9. Open questions — ✅ ALL RESOLVED BY THE OWNER, 2026-09-14

⚠ **EVERY QUESTION IN THIS SECTION IS ANSWERED.** The answers were given by the
owner directly, one question at a time, and are recorded verbatim below. Nothing
in §4 – §7 is blocked any longer; **Epic P builds the §3 defects and the visual
refresh together**, which is a change from OQ-4's original sequencing and is the
owner's own instruction.

⚠ **TWO ANSWERS DID MORE THAN ANSWER.** OQ-3b **reverses a decision the owner
previously made at `A51`**, and OQ-7 surfaced a **filter-correctness bug** that
no question in this document had asked about. Both are called out below and
neither is a styling change.

| | Question | ✅ The owner's answer |
|---|---|---|
| **OQ-1** | §4.3 trims the added-date off the compact row, but the **default sort orders by it**. Show it, or accept an unexplained order? | **Keep the added-date on the row.** The density REQ-112 wants is found elsewhere. REQ-112 is amended in place: the added-date is **not** trimmed |
| **OQ-2** | §6 — **which three destinations** belong in the phone bar? Five candidates for three slots | **List, Upload, More.** Only two real destinations plus overflow; `/removed`, `/not-interested` and `/batches` all sit behind **More** |
| **OQ-3** | §5 REQ-115 — sort by **name/year** needs an API change. Worth it? | **Yes — add both name and release year.** The API change is accepted. Null ordering is already settled by `A48` (NULLs **last in both directions**) and is not re-decided here |
| **OQ-3b** | **Sort by IMDb rating is currently forbidden by REQ-095**, decided at `A51` | ⚠ **REVERSED at `A53` (2026-09-14). The owner now wants to sort by IMDb rating.** REQ-095's display-only rule is overturned, and the reversal is written as **ADR-0011 Revision 1** — see §7a and **§7a.1**. ⚠ **It was NOT a one-line strike:** `specs/api.md` had made REQ-095 load-bearing for **REQ-041**, so the rating refresh becomes **synchronous, sweeping the sortable set before the ordering, under a request + time budget**. The rating is nullable, so `A48`'s NULLs-last rule applies and unrated titles never lead "Highest first" |
| **OQ-4** | ✅ **RESOLVED 2026-09-10 — "ship all five defects now, as their own task, before the visual work."** | ⚠ **SUPERSEDED 2026-09-14 by the owner**, who directed that the defects and the visual refresh ship **together as one Epic P**. §3 remains an independently buildable unit and is built **first within** that epic, so the original property — that a fixed menu is distinguishable from a moved one — is preserved by task ordering rather than by a separate release. ~~See §11.~~ *(There is no §11; the document ends at §10. Dangling reference corrected in place.)* |
| **OQ-5** | §5 REQ-114 — the sort control's wording and shape | **Revised 2026-09-16:** five visible complete-order buttons; inactive selects its default and active reverses with state/next action named. ~~Original 2026-09-14 answer: show both directions in a segment.~~ See §5b |
| **OQ-6** | §6a — **what exactly was confusing on the review screen?** | **(d) — the three sections looked alike despite meaning different things.** Not the list length, not the Apply wording. See §6a |
| **OQ-7** | §4.3 / REQ-112 — trim genres from the phone row, or keep them? | **Keep the genres on the row, but make them take less room** — *"use another ux to make it compact but still list the genres."* ⚠ **And a second, separate finding:** *"some of the genres are redundant, for example, there is action, action & adventure, and adventure… would it not be easier just to click action and adventure separately?"* — see §4.4 |

### 9.1 Two further answers, not previously asked as an OQ

| | Question put to the owner | ✅ Answer |
|---|---|---|
| **OQ-8** | This document specifies **no typographic scale** and **zero icons**, yet REQ-117's phone bar needs icons and a single text size is the loudest signal that a page was never designed. Add both? | **Yes to both.** A type scale on the **existing system font stack** — **no web font**, so NFR-005 and `T-CI-007`'s egress rule are untouched — and **hand-drawn inline SVG** icons, so **no dependency and no network request**. See §7b and §7c |
| **OQ-9** | §4.4's genre collision — normalise **on read** or **on write**? | **On read.** TV genre names are mapped onto the film vocabulary at query and display time. **No migration, no change to stored data, fully reversible** — which also keeps `T-MIG-001` out of the picture entirely |

---

## 10. Proposed stories — reserved ids, NOT yet in the PRD

⚠ **Do not paste these into `docs/PRD.md` on their own** — see §1. They move
there **with** their `specs/testing.md` §9 rows and their tests, in one change.

| Story | Covers |
|---|---|
| **US-049** *(promoted by TASK-218)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-105, REQ-107. |
| **US-050** *(promoted by TASK-218)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-106, REQ-108, REQ-112. |
| **US-051** *(promoted by TASK-218)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-109. |
| **US-052** *(promoted by TASK-218)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-110, REQ-111, REQ-118. |
| ~~**US-053**~~ **superseded by US-057** | ~~*As the owner, I can find and order titles without guessing what a control does.* → REQ-113, REQ-114, REQ-115~~ ⚠ **Not promoted, and must not be.** US-057 (promoted by TASK-217) already owns REQ-113, REQ-114 and REQ-115 in `docs/PRD.md` §6. Promoting this row as well would give the PRD two stories owning the same three requirements, and a coverage table that reads as agreement while nothing decides which one is authoritative when they drift. |
| **US-054** *(promoted by TASK-218)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-116, REQ-117. |
| **US-055** *(new, `A48`; promoted by TASK-218)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-119, and the promoted **REQ-035** / **REQ-037**. |
| **US-056** *(promoted by TASK-213)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-120, REQ-112. |
| **US-057** *(promoted by TASK-217)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-113, REQ-114, REQ-115, REQ-121, and the reversal in §7a. |
| **US-058** *(promoted by TASK-218)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-122. |
| **US-059** *(promoted by TASK-210)* | See `docs/PRD.md` §6, Epic P, and `specs/testing.md` §9. REQ-123, REQ-124, REQ-125. |

**Reserved ranges** ~~(collision-checked against the whole tree; ceilings at
time of writing REQ-104, US-048, ADR-0012, `T-UX-099`): **REQ-105 – REQ-119**,
**US-049 – US-055**, **`T-UX-100` – `T-UX-124`**, **`T-API-019` – `T-API-021`**,
**`T-UI-029`**, **ADR-0013**.~~

⚠ **Extended through 2026-09-16** to cover the requirements the owner's answers added.
The full reserved set is now:

| Family | Reserved | Added by |
|---|---|---|
| `REQ-` | **REQ-105 – REQ-125** | REQ-120 (§4.4), REQ-121 (§5b), REQ-122 (§6a.1), REQ-123 – REQ-125 (§7b – §7d) |
| `US-` | **US-049 – US-059** | US-056 – US-059 above |
| `T-UX-` | **`T-UX-100` – `T-UX-143`** | `T-UX-138`–`143` map the approved sort, filters, search, layout, palette and shell refinement; existing ids retain their coverage with revised expectations |
| `T-API-` | **`T-API-019` – `T-API-030`** | `T-API-028` is genre normalization; `T-API-029` is stored-name ordering; `T-API-030` is submitted title search. `T-API-022` remains the corrected-review projection test, not a reusable slot. |
| `T-UI-` | **`T-UI-029` – `T-UI-032`** | `T-UI-030` – `T-UI-032` (§7c, §7d) |
| `T-CSS-` | **`T-CSS-006` – `T-CSS-007`** | §7b |
| `T-A11Y-` | **`T-A11Y-016` – `T-A11Y-017`** ~~`014` – `015`, both already taken~~ | §7c, §7d |
| ADR | **ADR-0013**, plus a **revision to ADR-0011** | §7a |

⚠ **CONSUMED — DO NOT RE-ISSUE THESE.** `T-UX-100` – `T-UX-108` and
**`T-API-022`** (REQ-105 – REQ-109, shipped); **`T-UX-120` – `T-UX-124`** and
**`T-API-019` – `T-API-021`** (REQ-119 / REQ-035 / REQ-037, the §5a runtime
work, shipped in `4137666`). ⚠ `T-API-022` sits **out of numeric order**
relative to `T-API-019` – `T-API-021` deliberately — REQ-109 shipped first — so
do **not** "correct" the gap by renumbering a live test id.

Existing implemented IDs remain owned by their tests; do not reissue them.
`T-UX-119` now guards the **presence** of rating sort following the A53
reversal, not its absence. Read §7a.1 before changing the rating contract.

⚠ **The ids added on 2026-09-14 ARE now registered** in `specs/testing.md` §39,
in the same commit that wrote their owning tasks (TASK-208 – TASK-218).
~~Superseded: "NONE OF THESE IDS IS REGISTERED IN `specs/testing.md` YET… a
search of `specs/testing.md` for the whole reserved `T-UX-1nn` range returns
zero rows."~~ That had to be one commit, not two: `check:test-ids` fails on a
**cited** id that is not defined, and `check:orphans` fails on a **defined** id
that no task cites — registering the 44 ids alone failed the second gate with
44 orphans. The two gates are a vice, and §1's sequencing rule is what it is
because of them.
⚠ **`T-API` ids run in the teens and twenties, not the sixties.** The `A48` rows
were first written as `T-API-062`–`064` by analogy with the `T-UX-1xx` range and
corrected before they reached a test: the whole tree's ceiling is **`T-API-027`**
as of 2026-09-14. ~~"the whole tree's ceiling is `T-API-018`" — true when
written, stale once REQ-109 and the runtime work shipped 019–022~~. ⚠ The
**lesson is not the number** — enumerate the family for a free id every time
rather than quoting this sentence's ceiling, which goes out of date on every
merge. An id
invented ahead of its sequence is not a harmless label — `T-META-009b` matches
on the base number, so a plausible-looking id can acquire a defining row and a
green gate while belonging to no series at all.

⚠ **Web tests for this work belong in `apps/web/test/`, never `tests/web/`**
(`specs/testing.md` §11, `T-CI-008`). A `.spec.tsx` outside a collected path
never executes and its assertions "pass" by never running — that has already
happened in this repository. Run `npm run check:test-locations` before pushing.
