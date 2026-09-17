# ADR-0014 — Bundled service marks: five CC0 logos, three word marks, and no request to anyone

| | |
|---|---|
| **Status** | **Accepted (2026-09-17). Revised the same day — Revision 2, §5.** Requested by the owner in issue #288, expanded by the owner to cover the upload wizard, then revised after the owner reviewed the result on the live list. |
| **Date** | 2026-09-17 |
| **Deciders** | the owner (wants the logos), coordinator (terms, mechanics) |
| **Forced by** | Issue #288: *"A row can carry several badges. Word marks in identical chips are slow to scan; the logos are what the owner actually recognises at a glance."* ADR-0013 declares a **closed icon register with no external assets**, so service logos could not simply be added to it. |
| **Supersedes** | Nothing. ADR-0013's icon register is **unchanged** — this ADR opens a *second*, separate register beside it. |

## 1. The problem, stated precisely

Every service badge on a library row renders the same way: a word in a chip.
With four badges on a row they are four near-identical rectangles, and reading
them is a sequential task. Logos are recognised, not read.

The same is true, and matters more, on `/upload`: the service step is where a
whole capture is attributed to a list. Picking the wrong one there attributes
every title in the batch to a service the owner never captured — and in
full-update mode that is a step away from proposing removals from the wrong
list.

## 2. Why this needed an ADR at all

ADR-0013 §7c closed the icon register deliberately: no icon package, no
sprite, no font, no network request, and a strict exported-set test so the set
cannot grow one file at a time. Service logos break three of that decision's
assumptions at once:

1. They are **not ours to draw**. They are third-party trademarks with their
   own terms.
2. They are **filled glyphs**, not 1.5-weight line art. `T-UI-030a/d` require
   `stroke="currentColor"` at `stroke-width="1.5"` on a 24-grid. Stroking a
   logo does not render the logo — it renders an outline of it.
3. They are **per-service data**, not UI vocabulary: the set is determined by
   which services this product supports, not by what the interface needs to
   express.

Adding them to `icons/` would have forced ADR-0013's gate to be weakened. That
is the gate that exists to stop the register becoming a library with extra
steps, so the answer is a second register with its own equally strict gate, not
a hole in the first one.

## 3. Decision D-1 — A second, separate closed register

`apps/web/src/components/brands/` holds the marks, with `BrandMarkBase`
carrying the shared contract: 24-grid, `fill="currentColor"`, decorative by
default, `role="img"` + `aria-label` when named.

`T-A11Y-016d` — "no `<svg>` in `apps/web/src` outside the icons directory" —
gains an exclusion for this directory **and `T-BRAND-001` applies an equivalent
contract to it**: closed exported set, no colour literal, no package, no URL,
no `fetch`, both a11y modes. The exclusion moves the assertions; it does not
drop them. Any other `<svg>` anywhere else in `apps/web/src` still fails.

## 4. Decision D-2 — The marks come from Simple Icons (CC0), not from press kits

The files are vendored from [Simple Icons](https://github.com/simple-icons/simple-icons),
released under CC0 1.0, at the pinned commit recorded in
`apps/web/src/components/brands/ATTRIBUTION.md`. Path data is copied verbatim.

⚠ The per-brand upstream `source` URLs are **described rather than linked** in
that file: three of the five are streaming-service domains, and `T-SEC-001`
fails on a streaming-service host anywhere in the tree. That gate is the one
keeping this product from ever addressing a streaming service, so it is not
given an exception for a comment.

Why not the brands' own press kits, which is what issue #288 first proposed:

- A press-kit asset is published under the brand's own terms, which typically
  restrict alteration, colour and context. Monochrome rendering at 24 px — what
  this UI needs — is the first thing most of those guidelines forbid.
- A CC0 source gives an unambiguous position on the **copyright in the file**,
  which is the part that is actually being copied into this repository.
- The CC0 project has a published removal process that brands use. That makes
  its coverage a meaningful signal about which marks are safe to carry — see
  D-3, which is a direct consequence.

> ⚠ **The upstream `max` slug is Cycling '74 Max, the music software.** The
> slug matching this product's `max` service is **`hbomax`**. The titles collide
> exactly where a careless vendoring would not look twice, and the wrong glyph
> would have shipped looking entirely deliberate.

## 5. Decision D-3 — All eight services get a mark; three of them are drawn here

> **Revision 2 — 2026-09-17, owner-directed.** The owner reviewed the mixed
> presentation on the live list and asked for the missing three to be drawn.
> This section is corrected **in place**; the superseded decision is struck
> through beneath it, because its reasoning still explains why those three
> differ in kind.

| Service | Rendering | Origin |
|---|---|---|
| Netflix, Max, Apple TV+, Paramount+, Starz | Mark + visually hidden name | **Vendored**, CC0, verbatim |
| Prime Video, Disney+, Peacock | Mark + visually hidden name | **Drawn here**, original geometry |

The three have no CC0 artwork — Amazon and Disney are among the brands removed
from that source through its published removal process — so they are
**hand-authored approximations**: a curved arrow for Prime Video, a `D+`
monogram for Disney+, a six-feather fan for Peacock. They are **not traces**,
and no press-kit asset was obtained to make them. Two reasons, both binding:

1. The **artwork** is the part carrying a brand's protection. An approximation
   that identifies the service without reproducing its artwork is a materially
   different act from copying the logo.
2. Fetching anything from a streaming service's own domain is forbidden here
   outright (product invariant 10). `T-SEC-001` already failed this branch once
   for a brand URL in a code comment, which is the gate doing its job.

⚠ **The owner accepted a weaker position knowingly.** A CC0 file has an
unambiguous copyright story; an approximation of a protected mark does not.
The remedy, if one is ever wanted, is **deletion** — a more faithful drawing is
a worse position, not a better one.

⚠ **`T-BRAND-001g` pins the two origins apart in the source files**, because
nothing at render time distinguishes them and a future contributor "improving"
a drawn mark by tracing the real logo would change the legal position without
changing a single test. `T-BRAND-002c` keeps the word-mark fallback — the
removal path this whole section depends on — alive and asserted even though no
service reaches it any more.

~~**Superseded (Revision 1).** "Three services get a word mark, and that is the
decision. Prime Video, Disney+ and Peacock have no mark in the CC0 source …
Re-drawing them from a press kit would take on precisely the risk that source
declined to carry, for three logos out of eight, in a private single-owner
watchlist. Issue #288's own acceptance criterion already anticipated this — *'a
service with no usable mark falls back to its word mark rather than rendering
nothing'* — so the mixed presentation is the accepted outcome, not a gap to
close later. `T-BRAND-002c` asserts the three gaps are still gaps."~~

## 6. Decision D-4 — Monochrome, inherited, and never the sole carrier of meaning

- Marks render `fill="currentColor"`. No brand colour is reproduced anywhere.
  A brand-coloured mark would put a hex literal in a `.tsx` file — outside
  `:root`, outside the stylesheet contrast gate's reach — and Netflix red on
  the dark theme's surface is a real contrast failure, not a hypothetical one.
- **The service name is always in the DOM.** In a row badge it is visually
  hidden; in the upload chooser it stays visible, because that control is
  labelled and the mark is decorative beside it. A logo-only badge is
  unreadable to a screen reader *and* unfindable by the browser's own in-page
  text search, and neither failure shows up in a screenshot. `T-BRAND-002a/b`
  assert the accessible name across all eight services and assert it does not
  change between the two branches.

## 7. Terms, stated plainly

CC0 covers the **SVG files** taken from the vendored source. It does not, and
cannot, transfer any rights in the underlying **trademarks**, which remain the
property of their owners. It says nothing about the three marks drawn here
(§5), which are original artwork depicting marks this project does not own. The
marks are used **nominatively** — to identify which service a title is saved on
— in a private, single-owner, non-commercial watchlist. No affiliation,
sponsorship or endorsement is claimed or implied.

Should a brand object, deleting its component and its `SERVICE_MARKS` entry is
sufficient: the word-mark fallback then renders and nothing else changes. That
is a deliberate property of D-3's design, not a coincidence.

**This is a record of the terms relied upon, not legal advice.**

## 8. What this ADR explicitly does NOT do

- It does **not** add a runtime dependency. `T-BRAND-001d` fails on one.
- It does **not** fetch anything, at build time or run time. Product invariant
  10 forbids any automated request to a streaming service, and a logo request
  to a streaming service's CDN would be exactly that — while also leaking that
  the owner is running this app.
- It does **not** reopen ADR-0013's icon register. That set remains 21 icons
  and still requires an ADR revision to change.
- It does **not** introduce brand colour, a second colour scale, or any
  per-service theming.
- It does **not** change what a badge *means*, what the list contains, or any
  ordering.

## 9. Consequences

- Rows and the upload chooser are faster to scan for **all eight** services.
- Adding a ninth service means checking the CC0 source for a mark first, and
  drawing an approximation only if there is none — never tracing one, and never
  fetching artwork from the service itself.
- Refreshing a **vendored** mark is a **re-vendor** from a newly pinned commit,
  recorded in `ATTRIBUTION.md`. Editing path data in place is altering a
  trademark and is forbidden. A **drawn** mark may be redrawn for legibility,
  but never redrawn *closer* to the real logo — see §5.
- The upstream project may remove a brand at its owner's request. For a
  vendored mark that is the signal to remove it here.

~~Superseded 2026-09-17: "Rows and the upload chooser are faster to scan for
five of eight services and unchanged for three. The owner should expect a mixed
presentation." and "Adding a ninth service means checking the CC0 source for a
mark, and shipping without one if there is none — never drawing a
substitute."~~
