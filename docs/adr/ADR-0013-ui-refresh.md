# ADR-0013 — The UI refresh: a hybrid grid/list, an indigo accent, and a filter/sort bar that is one control

| | |
|---|---|
| **Status** | **Accepted — SPEC ONLY, NOT YET BUILT.** No backlog task exists yet; the owner asked for requirements and design ahead of implementation. |
| **Date** | 2026-09-10 |
| **Deciders** | the owner (visual direction, given explicitly — see "The direction, and who gave it"), coordinator (mechanics) |
| **Forced by** | The owner using the running app on 2026-09-10 and reporting six things: a row menu that opens at the bottom of the page, metadata rendered as `Movie2026Action, Crime, Thriller`, a row-menu button rendered as a full-height grey column, row text *"scrunched together"*, a fix-match correction that produced **no visible change on the review screen**, and *"the website looks very bare with no styling whatsoever."* |
| **Supersedes** | Nothing. **Extends** ADR-0004 Rev 2 and `specs/ui.md` §13. It does **not** reopen the no-Tailwind or no-dark-mode decisions. |

---

## 1. What was actually found, before any taste was applied

The owner's report bundled six complaints as one. They are not one problem,
and separating them is the whole value of this ADR — **five are defects with a
right answer, and only the sixth is a matter of direction.**

### 1.1 The row menu opens at the bottom of the page — a mounting defect

`apps/web/src/pages/ListPage.tsx` renders `<RowMenu>` as a **sibling of
`<TitleList>`**, after the load-more sentinel:

```tsx
<TitleList items={visible} … />
{onLoadMore !== undefined && <LoadMoreSentinel … />}
{menuFor !== null && <RowMenu item={menuFor} … />}
```

So the menu is a block in the page's normal flow, below every row. Tapping `⋮`
on the first of fifteen titles scrolls-worth of content away from where it
appears.

⚠ **`apps/web/src/index.css` already contains `.title-row__menu { position:
relative }`** — a containing block, declared for a positioned child that is
never inside it. The CSS was written for the correct structure and the JSX was
not. **This is why "add more CSS" is the wrong instinct here:** no rule applied
to `.row-menu` can anchor it to a row it is not a descendant of, and a
`position: fixed` overlay would merely relocate the same detachment.

The fix is **where it mounts**, and it is specified in `specs/ui-refresh.md`
§3 as REQ-105.

### 1.2 `Movie2026Action, Crime, Thriller` — a rendering defect against an existing spec

`components/TitleRow.tsx` emits three adjacent `<span>`s inside
`<p className="title-row__meta">` with no separator element, and
`.title-row__meta` sets only colour and font-size — no `display: flex`, no
`gap`. The three facts run together.

⚠ **`specs/ui.md` §2.2 already specifies this row as "Year · type · genres".**
The separator is in the spec and absent from the code, so this is not a design
question at all: it is an unimplemented line. It gets a REQ (REQ-106) rather
than a style rule because **a rendering that concatenates independent facts is
a correctness failure** — `Movie2026Action` is not a thing, and the owner
cannot tell a missing separator from a missing genre.

### 1.3 The `⋮` trigger is a full-height column — a flex defect

`.title-row` is `display: flex` (`index.css:373`) with the default
**`align-items: stretch`**, so `.title-row__menu` is stretched to the row's
height, and `.tap-target`'s `min-height: 44px` is a **floor, not a ceiling**.
The result is the tall bordered grey rectangle in the owner's screenshot, which
reads as a structural panel rather than a button.

⚠ **The 44 px target stays** (`T-A11Y-001b`, NFR-006). REQ-107 narrows the box;
it does not shrink the target. These are easy to conflate, and conflating them
regresses a passing accessibility gate to fix an appearance.

### 1.4 "Scrunched together" — a spacing defect with a trap in the obvious fix

`.title-row__body` separates five stacked lines with `gap: var(--space-1)` —
**4 px**. Five lines at 4 px is a paragraph, not a list of facts.

⚠ **The obvious fix is to delete a line, and that is the wrong fix.** The
density direction below is *"metadata trimmed"*, so removing a row of text
creates whitespace **and** satisfies a stated preference — which makes it very
easy to do accidentally. In a diff, deleting a line because it is unused and
deleting a line to manufacture spacing are indistinguishable. Spacing is
REQ-108; **what gets trimmed is a separate decision** with its own reasoning in
`specs/ui-refresh.md` §4.3, and it has a live hazard: the added-date is the
field the default sort orders by.

### 1.5 A correction with no visible effect — the serious one

The owner corrected a wrong TMDB match on the review screen, and **nothing on
the card changed**: *"the image on the upload page stayed the same. I couldn't
tell if my change had been applied. I figured it had and went ahead with
clicking apply."*

⚠ **THIS IS THE MOST SERIOUS ITEM HERE, AND ITS SEVERITY IS NOT VISIBLE FROM
THE SYMPTOM.** The review screen **is** the confirmation step. The whole safety
model of this product is that nothing reaches the list until the owner has seen
what was read and agreed to it. A confirmation screen that does not show the
result of the owner's own correction has broken that contract — it asked for
agreement and withheld the thing being agreed to. **The owner proceeded on a
guess.** The guess was right this time; the failure mode is that the screen
looks exactly the same when it is wrong.

Root cause is two faults in `components/UnmatchedActions.tsx` — the card's
poster and heading are never rebuilt from the correction, and `outcomeFor`
(line 137) maps a server-side `'corrected'` disposition to `name: null`, so any
re-render degrades a named confirmation into a generic one. ⚠ **The `null` is
not itself the bug** — the server's disposition genuinely carries no name — so
the fix is to carry the corrected identity back to the card, **not** to patch
the fallback string, which would make the screen assert a name it does not
have. Full detail and test ids: `specs/ui-refresh.md` §3, REQ-109.

### 1.6 "Bare with no styling whatsoever" — the part that is real but is NOT what it looks like

Taken literally this reads as ADR-0012's discovery repeating: a stylesheet that
exists but was never imported. **It is not that, and the check was made before
any work was planned:**

| Evidence | Result |
|---|---|
| `apps/web/src/index.css` | 1,516 lines, **171 rules** |
| `T-CSS-002` (`main.tsx` imports the stylesheet) | passing |
| `T-CSS-004` (every token pair's computed WCAG ratio) | passing |
| `T-A11Y-012c` (axe-core, **every route**, 320 px, zero serious/critical) | passing |
| `T-A11Y-001b` (every interactive control ≥ 44 px) | passing |

So the page is styled, contrast-safe and accessible. What it lacks is **visual
hierarchy and density**: every element sits at the same weight on the same
white card, the accent colour appears almost nowhere, and the tap-target floor
inflates the `⋮` button into a full-height grey column that reads as a
structural panel rather than a button.

⚠ **This distinction bounds what the refresh may claim.** It is not permitted
to justify itself as an accessibility fix, and it must not regress the four
gates above — they are the floor it builds on, not a problem it solves.

---

## 2. The direction, and who gave it

⚠ **THE OWNER WAS ASKED AND THE OWNER ANSWERED. THIS SECTION IS A RECORD, NOT
A PROPOSAL,** and it exists because "the app looks bare" is a taste judgement
while everything else in this repository is an executable instruction. Speccing
an agent's own visual preference as a `must` would make it indistinguishable
from a requirement the owner actually holds.

| Question | The owner's answer |
|---|---|
| Row layout | **Hybrid** — a poster grid on desktop, a compact list on the phone |
| Density | **Balanced** — about six titles on a phone screen, metadata trimmed to what is actually used |
| Accent | **Deeper — indigo/violet** |
| Posters | **Larger and uniform** — artwork is how the owner recognises a title |
| Pain points | *"better navigation. improve the filter/ordering ux"* |

Everything in `specs/ui-refresh.md` traces to a row of this table or to §1's
two defects. A design decision that traces to neither does not belong in the
refresh.

---

## 3. Decision D-1 — The layout is responsive-hybrid, and the phone is the base case

**A poster grid at and above `--bp-lg` (1024 px); a compact list below it.**

The two are **one component rendering one data set at two densities**, selected
by a media query, not two components chosen in JavaScript.

⚠ **The phone list is the base rule and the grid is the `min-width` addition**,
per `specs/ui.md` §13.3. Written the other way round, the 320 px floor — the
width NFR-006 mandates and `T-A11Y-001` actually tests — becomes the case
reached by subtraction, and it is the case the owner uses most.

**Rejected — a grid at every width.** At 320 px a two-column poster grid gives
each tile ~140 px. The owner's list holds titles like *Ramy Youssef: In Love*
and *Stranger Things VHS Special Edition*; those truncate to uselessness, and
the service badge — the single most important fact on the row, because this
product exists to answer *where is it* — has nowhere to go.

**Rejected — a list at every width.** At 1024 px a full-width row is ~900 px of
whitespace holding a 120 px poster and four short lines. That is what the
current screen does and it is a large part of why it reads as unfinished.

## 4. Decision D-2 — Indigo-700 `#4338ca`, and every value in the palette is computed

| Token | Value | Ratio on `#ffffff` | Ratio on `--color-bg` `#f9fafb` | Role |
|---|---|---|---|---|
| `--color-accent` | `#4338ca` | **7.90:1** | **7.56:1** | links, primary actions, active nav |
| `--color-accent-strong` | `#3730a3` | **9.93:1** | 9.51:1 | hover / pressed / focus ring |
| `--color-accent-subtle` | `#eef2ff` | 1.12:1 *(a background, never text)* | — | chip and active-filter fills |
| accent **on** `--color-accent-subtle` | `#4338ca` on `#eef2ff` | **7.07:1** | — | chip label |
| white **on** `--color-accent` | `#ffffff` on `#4338ca` | **7.90:1** | — | primary button label |

⚠ **THE TRAP IN THIS PALETTE, COMPUTED AND NAMED SO NOBODY REDISCOVERS IT THE
EXPENSIVE WAY: `indigo-400 #818cf8` is 2.98:1 on white and FAILS the 3:1
non-text floor.** It is the shade a designer reaches for first for a "soft
indigo border" or a gentle focus ring, and it looks entirely reasonable. So do
`#c7d2fe` (1.49:1) and `#a5b4fc` (1.99:1). This is `specs/ui.md` §13.2's
existing lesson recurring in a new hue — a boundary can look obviously visible
and still be less than half the required ratio. **`T-CSS-004` recomputes every
pair from the token values, so a substituted shade fails CI rather than
review.**

`--color-danger` stays `#b91c1c` (6.47:1). `--color-border`, `--color-text` and
`--color-text-muted` are unchanged: they pass, and churning passing tokens
invites exactly the substitution above.

**Rejected — dark mode.** The owner chose "deeper indigo", not "dark UI", and
`specs/ui.md` §13.3 refuses dark mode because it doubles every contrast
obligation for a single-owner app. Nothing in the direction reopens that.

## 5. Decision D-3 — Filters and sort become ONE bar, and sort gains a dimension

The owner asked to *"improve the filter/ordering ux"*. Three concrete faults
exist today, and each is separately fixable:

1. **The sort control is a button labelled with its CURRENT state.** It reads
   *"Newest first"* while the list is newest-first, and clicking it makes the
   list oldest-first. A control whose label describes the present rather than
   the consequence of pressing it is ambiguous in both readings, and no amount
   of styling resolves it.
2. **Sorting has exactly one dimension** — date added — while the row now
   displays an IMDb rating, a name and a release year, all of which the owner
   can see and none of which they can order by.
3. **Filters and sort are separated.** `specs/ui.md` §2.1 item 2 already
   co-locates them; `components/FilterBar.tsx` says so in a comment and does
   not, because the sort control shipped later as TASK-166.

⚠ **THE PERSISTENCE MODELS OF THE TWO ARE DIFFERENT AND MUST STAY DIFFERENT,
AND THIS IS THE ONE PLACE A "TIDY-UP" WILL DESTROY WORKING BEHAVIOUR.** Filters
render **from** the URL and write **to** it, with no `useState` mirror —
`FilterBar.tsx` explains at length that one direction is the only way to
survive the back button, a deep link and an external `navigate()`. Sort is URL
→ `localStorage` → default `desc`, because a remembered direction must be
reconciled *into* the URL or the label and the API disagree silently. **Merging
them visually must not merge them mechanically.** REQ-113 states this and
`specs/ui-refresh.md` §5 carries the reasoning at the point of use.

⚠ **REQ-038's oldest-first control is `must`, not optional** (promoted at A47).
It is the sole escape hatch for the knowingly-accepted newest-first-vs-SUC-003
trade-off. Whatever shape the new bar takes, **oldest-first must remain
reachable in one action.** A redesign that buries it inside a menu has removed
a `must`.

## 6. Decision D-4 — Navigation gets a current-location indicator and a phone treatment

`components/AppShell.tsx` renders six `<NavLink>`s in a `<nav aria-label=
"Primary">` with `className="tap-target"` and **no active styling** — React
Router's `NavLink` supplies an `isActive` flag that nothing consumes. On a
320 px screen six labels wrap into a block of undifferentiated links above
every page.

The refresh gives the current route a visible indicator (**not colour alone** —
`specs/ui.md` §10.2) and gives the phone a bottom tab bar for the three
destinations the owner actually moves between, with the rest behind a "More"
route. Which three is stated in `specs/ui-refresh.md` §6 and is a **decision
the owner should confirm**, not one this ADR should quietly make.

## 7. What this ADR explicitly does NOT do

- **It does not add a CSS framework.** ADR-0004 Rev 2 dropped Tailwind and this
  changes none of its reasoning. The refresh is hand-written CSS against the
  existing token scale.
- **It does not add a web font.** `--font-stack` stays a system stack: no
  third-party request (NFR-005), no layout shift.
- **It does not rename a single class.** `specs/ui.md` §13.1 fixes the
  vocabulary and `T-CSS-001` asserts it. New elements get new names in the same
  BEM shape; **nothing existing is renamed**, because a rename is a diff across
  every component and every test for zero owner-visible gain.
- **It does not change any API response, route or data shape.** The refresh is
  presentational. If a design here appears to need a new field, that is a
  finding to report, not a licence to add one.
- **It does not touch `docs/backlog.md`.** The owner said *"don't need to
  implement yet."* The task rows come when they say go.

## 8. Consequences

**Good.** The product finally looks like the thing it is; artwork becomes the
recognition cue the owner said it is; two real defects get fixed with test ids
rather than being absorbed into a restyle where nobody could tell whether they
were fixed.

**Bad.** `apps/web/src/index.css` grows materially, and every new colour costs
a computed ratio. The grid adds a second layout to every list-page test that
asserts row structure.

**Risk — the one to watch.** A visual refresh is the single easiest place to
lose a behavioural `must` while every test still passes, because the tests that
guard those `must`s assert *behaviour*, not *placement*: a control moved into a
collapsed menu still responds to `click()`. The three at risk are **REQ-038's
oldest-first reverse**, **REQ-039's per-service last-updated strip** (show the
fact, never nag — `A46`), and the **three ingest affordances** of REQ-001/004
(paste, file selection, drag-and-drop — ADR-0009; `T-PASTE-010` is the
regression guard and it must not be displaced). `specs/ui-refresh.md` §8 lists
each one with the reason it is easy to lose.
