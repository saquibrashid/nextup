# `specs/ui-refresh.md` — the UI refresh: requirements and design

> ## ⚠ STATUS: SPECIFICATION ONLY. NOT YET IMPLEMENTED. NOT YET SCHEDULED.
>
> The owner asked for *"the reqs and design for an updated UX"* and said
> explicitly **"don't need to implement yet."** Nothing in this document is
> built. There is no backlog task, and **`docs/backlog.md` has deliberately not
> been touched** — a task row is a scheduling claim and the owner has not made
> one.
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

1. **Now** — the requirement text lives here, marked *proposed*, with `REQ-1nn`
   and `US-0nn` ids **reserved** (checked for collisions: the tree's ceilings
   at time of writing are REQ-104, US-048, NFR-020, ADR-0012).
2. **When the owner says build** — each story moves into `docs/PRD.md`, its
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
| Row layout | **Hybrid** — poster grid on desktop, compact list on phone |
| Density | **Balanced** — ~6 titles visible on a phone, metadata trimmed |
| Accent | **Deeper — indigo/violet** |
| Posters | **Larger and uniform** |
| Pain points | *"better navigation. improve the filter/ordering ux"* |

Plus five defects the owner hit while using the app, in §3.

**Traceability rule for anyone extending this document: every requirement below
cites either a row of this table or a defect in §3.** One that cites neither is
an agent's taste wearing a `must`, and it should be deleted.

---

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

> The metadata line renders as **`Year · type · genres`** with a visible
> separator between each fact.

**Observed, from the owner's screenshot:** `TV2004Animation, Sci-Fi & Fantasy,
Action & Adventure, Kids`.

**Root cause:** `components/TitleRow.tsx` lines 196–205 emit three bare
`<span>`s inside `.title-row__meta`, and `index.css:444–448` sets colour and
font-size only — no `display: flex`, no `gap`, no `::before`.

⚠ **`specs/ui.md` §2.2 ALREADY SPECIFIES "Year · type · genres".** This is not
a design decision; it is a specified line that was never implemented. It is a
`must` and not a style tweak because **`TV2004Animation` is a correctness
failure, not an aesthetic one** — the owner cannot distinguish a missing
separator from a missing field, and `Movie2026Action` reads as a title.

The separator must be a **CSS-generated `·`** (or a gap), not a literal `·`
concatenated into the text node: it is decoration, and a screen reader should
not announce "middot" between every fact.

| Test id | Asserts |
|---|---|
| `T-UX-102` | The rendered metadata line's text content matches `/2004\s*·\s*TV/`-shaped separation — i.e. the facts are not adjacent. |
| `T-UX-103` | The accessible name of the row does **not** contain the literal `·`. |

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

⚠ **The manual-add path already does this correctly** — `addCandidate`
(`batchCandidates.ts:429-441`) writes a one-entry `matchCandidates` array from
the chosen work. The correction path is the outlier.

**The scope question, which is an owner/design call and NOT settled here.**
`applyCorrection` is deliberately **network-free**: its header states *"a TMDB
outage must not stop the owner fixing a wrong match"*. It therefore has the
`tmdbId` and `mediaType` but **not** the name, year or poster. Three ways out,
with different costs:

1. **The client sends the display fields it already has.** `TmdbSearchResult`
   carries `name`, `releaseYear` and `posterPath` at correction time. Cheapest,
   keeps the no-network property — but it takes display data from the request
   body, and `specs/api.md`'s patch schema would have to widen to admit it.
2. **The server fetches TMDB detail during the correction.** Authoritative, and
   it matches what `addCandidate` does — but it **reverses the explicit outage
   decision** recorded in that function's header comment.
3. **The server resolves lazily on the review read**, from the metadata cache,
   falling back to the raw identity on a miss. No schema change and no outage
   coupling, but it adds a lookup to the hottest read on the review page.

**Do not pick one silently.** Option 2 contradicts a decision already written
down; option 1 changes a published request contract. ⚠ A fourth option —
**keeping the corrected name only in client state** — is the one to reject
outright: it would look correct in the click path and break on exactly the
re-render this requirement exists to fix, which is the present bug rebuilt.

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

> Below `--bp-lg` the list renders as a **compact vertical list**. At and above
> `--bp-lg` it renders as a **poster grid**. Both render the same data and
> offer the same actions.

⚠ **The phone list is the base rule; the grid is a `min-width` addition.**
`specs/ui.md` §13.3 mandates mobile-first, and writing it the other way makes
the 320 px case — the one NFR-006 requires and `T-A11Y-001` tests — the case
reached by subtraction.

⚠ **The grid and the list are ONE component at two densities, selected by a
media query.** Not two components chosen in JS: a JS width branch cannot be
server-consistent, breaks on resize, and would double every list test.

**Every action available on a list row is available on a grid tile** — remove,
suppress, restore, `⋮`. A grid that drops actions has made desktop the weaker
client.

| Test id | Asserts |
|---|---|
| `T-UX-110` | At 320 px the list layout renders and there is no horizontal scroll *(extends `T-A11Y-001`)*. |
| `T-UX-111` | At 1280 px the grid layout renders. |
| `T-UX-112` | The `⋮` menu offers the **same item set** in both layouts. |

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

> The compact list shows, per title: **poster, name, `Year · type`, service
> badge(s)**. The genre list and the IMDb rating move to the expanded/grid
> presentation. Approximately six titles are visible at 375 × 667 px.

> ### ⚠ THIS REQUIREMENT CONTRADICTS TWO THINGS THAT ARE CURRENTLY SPECIFIED,
> ### AND IT MAY NOT BE BUILT UNTIL THE OWNER RESOLVES BOTH.
>
> 1. **`specs/ui.md` §2.2 line 154 puts genres ON the row**, and ties it to a
>    PRD acceptance criterion: *"`genres: []` renders **nothing at all**, never
>    'Unknown' (**US-019 AC-6**)."* Trimming genres is therefore a **change to
>    a tested AC**, not a styling choice.
> 2. **REQ-106 above requires the `Year · type · genres` separators that §2.2
>    already specifies.** Read together with this section, REQ-106 asks for a
>    separator on a field REQ-112 removes. **That is not an oversight — it is
>    the correct sequencing.** REQ-106 is a defect fix that can ship today
>    against the row as specified; REQ-112 is a proposal that needs the owner.
>    If REQ-112 is accepted, REQ-106's rule becomes `Year · type` and the test
>    changes with it. **Build REQ-106 first and do not wait for REQ-112.**
>
> ⚠ **And the reason genres looked safe to cut is wrong.** The tempting
> argument — *"nothing filters or sorts by genre"* — **is false**:
> `specs/ui.md` §2.1 item 2 lists **genre as one of the three filter
> dimensions**, with `?genre=Drama` in the query string. Cutting the row's
> genres removes the only on-screen explanation of why a genre filter returned
> what it returned. **Any trim proposal must be checked against the filter
> dimensions before it is written, not after.**

⚠ **"Trimmed" means moved, not deleted, and one line may not move at all.** The
added-date is the field the **default sort orders by** (REQ-038, newest-first),
and its label is rendered **verbatim from the API** (REQ-061 — the component
must not construct it). Hiding the sort key makes the order inexplicable. See
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
> refresh**, because the two controls look like siblings and have deliberately
> opposite persistence models:
>
> | | Source of truth | Why |
> |---|---|---|
> | **Filters** | **URL only.** Render *from* the query string, write *to* it, **no `useState` mirror.** | `FilterBar.tsx` documents this at length: one direction is the only thing that survives the back button, a deep link, and an external `navigate()`. A mirror desynchronises silently. |
> | **Sort** | **URL → `localStorage` → default `desc`.** | The owner's chosen direction must persist across sessions, and the remembered value must be reconciled **into the URL** or the button label and the API request disagree without any visible symptom. |
>
> A refactor that "tidies" these into one shared hook will produce a green
> suite and a broken back button. **`T-UI-016` guards the filter side; the sort
> side needs `T-UX-115` below.**

Also invariant: `applyFilters` must preserve `sort`, `dir` and `cursor`.
Changing a filter must not silently reset the owner's ordering.

### REQ-114 (`must`) — the sort control states what pressing it does

> The sort control does not present the current ordering as its own label.

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

⚠ **THIS REQUIREMENT CHANGES OWNER-FACING COPY, WHICH §8 SAYS IS A PRODUCT
DECISION AND NOT A STYLING ONE.** The two strings are real and named —
`SORT_NEWEST_LABEL = 'Newest first'` and `SORT_OLDEST_LABEL = 'Oldest first'`
(`apps/web/src/copy.ts:307,309`) — and `specs/ui.md` §9 governs them. This
document must not silently rewrite them. **The replacement wording is §9 OQ-5,
for the owner.** Note the plain relabel does not work: swapping the button to
say what pressing it *does* makes it read "Oldest first" while the list is
newest-first, which is the same ambiguity mirrored. The likely answer is a
control that shows **both** options with the current one marked, rather than a
toggle — but that is a decision, not a deduction.

### REQ-115 (`should`) — the list can be ordered by more than date added

> Available orderings: **date added** (default, newest-first), **name**,
> **release year**.

The row already displays a name and a year that the owner can read and cannot
order by.

> ### ⚠ RATING IS DELIBERATELY ABSENT FROM THAT LIST, AND ADDING IT WOULD
> ### CONTRADICT A DECISION THE OWNER ALREADY MADE.
>
> **REQ-095** — *"The IMDb rating is **display-only**. It is not a sort key,
> and no sort option for it exists"* — was decided by the owner at **`A51`**,
> resolving ADR-0011's OQ-A. The rating is the most tempting sort key on the
> row precisely **because** it is rendered there, so an agent designing a sort
> menu will reach for it, find it on screen, and add it without ever seeing
> REQ-095. **It is a standing `must`-shaped negative and this document does not
> get to reverse it.** If the owner wants it, that is a reversal of `A51` and
> it belongs in ADR-0011 as a new revision — see §9, OQ-3.

⚠ **Year is nullable and the null case is the design problem.** A year sort
must decide where undated titles go — **not** first by accident of `NULL`
collation. Ordering must be stable and specified server-side; this needs an API
change, which is why it is `should` and why §9 asks before it is built.

| Test id | Asserts |
|---|---|
| `T-UX-113` | The bar renders filters and sort in one group. |
| `T-UX-114` | Changing a filter preserves `sort`, `dir`. |
| `T-UX-115` | A `localStorage` direction with **no `dir` in the URL** is reconciled into the URL, and the label matches the request that was issued. |
| `T-UX-116` | Oldest-first is reachable in one action from the default view. |
| `T-UX-119` | *(REQ-095 regression guard)* **No sort option exposes the IMDb rating.** |

---

## 6. Design — navigation (the owner's "better navigation")

### REQ-116 (`must`) — the current destination is indicated, and not by colour alone

`components/AppShell.tsx` renders six `<NavLink>`s as bare `.tap-target`s.
React Router supplies `isActive`; **nothing consumes it**. There is no way to
tell which page you are on from the navigation.

⚠ **Not colour alone** — `specs/ui.md` §10.2. The indicator must carry a
non-colour cue (weight plus a rule/underline) and `aria-current="page"`.

### REQ-117 (`should`) — the phone gets a primary destination bar

> Below `--bp-sm`, the three destinations the owner moves between most are
> presented as a persistent bar; the rest move behind a "More" destination.

Six wrapped links above every page is most of the phone's first screen, at the
cost of the content. **Which three is the owner's call** — see §9, OQ-2. This
document must not quietly pick them.

⚠ **`/upload` reachability is load-bearing and is not merely a nav item.**
REQ-039's `FreshnessStrip` is tappable and opens `/upload` **with that service
pre-selected**. Any nav rework must keep that path intact, and must not
introduce a second, differently-behaved route to upload.

| Test id | Asserts |
|---|---|
| `T-UX-117` | The active destination carries `aria-current="page"` and a non-colour cue. |
| `T-UX-118` | The freshness strip still deep-links to `/upload` with the service pre-selected. |

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

---

## 7. Tokens (REQ-118, `must`)

Replaces `--color-accent` in `specs/ui.md` §13.2. **Every ratio below was
computed from the token values, not estimated.**

| Token | Value | On `#ffffff` | On `--color-bg` `#f9fafb` |
|---|---|---|---|
| `--color-accent` | `#4338ca` | **7.90:1** | **7.56:1** |
| `--color-accent-strong` | `#3730a3` | **9.93:1** | 9.51:1 |
| `--color-accent-subtle` | `#eef2ff` | *background only* | — |
| `--color-accent` **on** `--color-accent-subtle` | — | **7.07:1** | — |
| `#ffffff` **on** `--color-accent` | — | **7.90:1** | — |

⚠ **THE TRAP, COMPUTED AND NAMED SO IT IS NOT REDISCOVERED THE EXPENSIVE WAY:
`indigo-400 #818cf8` IS 2.98:1 ON WHITE AND FAILS THE 3:1 NON-TEXT FLOOR.** It
is the exact shade one reaches for for a "soft indigo border" or a gentle focus
ring, and it looks entirely adequate. `#a5b4fc` is 1.99:1 and `#c7d2fe` is
1.49:1. This is `specs/ui.md` §13.2's existing `#d1d5db` lesson recurring in a
new hue. **Borders and focus rings use `--color-border` (3.33:1) or
`--color-accent`. Never a light indigo.**

`--color-border`, `--color-text`, `--color-text-muted` and `--color-danger` are
**unchanged** — they pass, and churning passing tokens is how the shade above
gets substituted in.

**`T-CSS-004` recomputes every pair from the token values**, so a substituted
shade fails CI rather than review. Any new token added by this refresh must be
added to that test's pair list in the same change.

**No dark mode** (`specs/ui.md` §13.3 — unchanged; the owner asked for a deeper
accent, not a dark UI). **No web font** (NFR-005; `--font-stack` stays a system
stack). **No CSS framework** (ADR-0004 Rev 2). **No class renamed**
(`T-CSS-001`).

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
| **REQ-095 rating is display-only** | The rating is **rendered on the row**, so a sort menu designed from the screen will include it without ever seeing the requirement that forbids it. Decided by the owner at `A51`. | `T-UX-119` |
| **Removed/suppressed distinction** | Two similar-looking screens invite a merge. Suppression is keyed on **canonical work identity**, removal on the listing — different mechanisms, different meanings. | REQ-071 |

Everything in `specs/ui.md` §9's copy strings is owner-facing wording; changing
one is a product decision, not a styling one.

---

## 9. Open questions — for the owner, not for an agent to settle

| | Question |
|---|---|
| **OQ-1** | §4.3 trims the added-date off the compact row, but the **default sort orders by it**. Show it, or accept an unexplained order? |
| **OQ-2** | §6 — **which three destinations** belong in the phone bar? `specs/ui.md` §2 names four navigation-out targets from the list: `/upload`, `/removed`, `/not-interested`, `/batches`. With the list itself that is five for three slots. |
| **OQ-3** | §5 REQ-115 — sort by **name/year** needs an API change and a decision on where **null years** sort. Worth it, or is date-added enough? |
| **OQ-3b** | **Sort by IMDb rating is currently forbidden by REQ-095**, which you decided at `A51` (display-only). Do you still want that? If you'd now like to sort by rating, say so and it becomes a **revision to ADR-0011**, not a line in this document. |
| **OQ-4** | ✅ **RESOLVED 2026-09-10 — the owner chose "ship all five defects now, as their own task, before the visual work."** §3 is therefore a **buildable unit** that does not wait on any remaining question here. See §11. |
| **OQ-5** | §5 REQ-114 — the sort control's wording. `'Newest first'` / `'Oldest first'` are governed copy (`specs/ui.md` §9). A toggle is ambiguous in either direction; showing both options with the current one marked probably isn't. **Your call on the wording and the shape.** |
| **OQ-6** | §6a — **what exactly was confusing on the review screen?** Was it (a) not seeing your correction take effect *(REQ-109 fixes this)*, (b) the length of the list, (c) not knowing what "Apply" was about to do, (d) the three sections looking alike, or (e) something else? Everything except (a) needs your answer before anything is designed. |
| **OQ-7** | §4.3 / REQ-112 — genres are on the row **and** are a filter dimension **and** are tied to US-019 AC-6. Trim them from the phone row anyway, or keep the row as specified and find the density elsewhere? |

---

## 10. Proposed stories — reserved ids, NOT yet in the PRD

⚠ **Do not paste these into `docs/PRD.md` on their own** — see §1. They move
there **with** their `specs/testing.md` §9 rows and their tests, in one change.

| Story | Covers |
|---|---|
| **US-049** | *As the owner, I can act on a title from the row I'm looking at.* → REQ-105, REQ-107 |
| **US-050** | *As the owner, I can read a row's facts at a glance.* → REQ-106, REQ-108, REQ-112 |
| **US-051** | *As the owner, I can see my correction took effect before I apply the batch.* → REQ-109 |
| **US-052** | *As the owner, I can browse my list with artwork at a comfortable density.* → REQ-110, REQ-111, REQ-118 |
| **US-053** | *As the owner, I can find and order titles without guessing what a control does.* → REQ-113, REQ-114, REQ-115 |
| **US-054** | *As the owner, I can tell where I am and reach where I'm going.* → REQ-116, REQ-117 |

**Reserved ranges** (collision-checked against the whole tree; ceilings at time
of writing REQ-104, US-048, ADR-0012, `T-UX-099`): **REQ-105 – REQ-118**,
**US-049 – US-054**, **`T-UX-100` – `T-UX-119`**, **ADR-0013**.

⚠ **Web tests for this work belong in `apps/web/test/`, never `tests/web/`**
(`specs/testing.md` §11, `T-CI-008`). A `.spec.tsx` outside a collected path
never executes and its assertions "pass" by never running — that has already
happened in this repository. Run `npm run check:test-locations` before pushing.
