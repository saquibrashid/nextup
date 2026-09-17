# Bundled service marks — attribution and terms

The marks in this directory have **two different origins, and the difference
matters more than anything visible on screen**:

- **Five are vendored** — CC0, copied verbatim, re-derivable from a pinned
  commit.
- **Three are drawn here** — Prime Video, Disney+ and Peacock, authored at the
  owner's direction on 2026-09-17 because no CC0 artwork exists for them.

Nothing is fetched at runtime. See `docs/adr/ADR-0014-service-marks.md` for the
decision; this file is the record of _what_ was taken, _from where_, and _what
was not taken_.

## Vendored (five)

## Source

|                            |                                                                           |
| -------------------------- | ------------------------------------------------------------------------- |
| **Project**                | [Simple Icons](https://github.com/simple-icons/simple-icons)              |
| **Licence of the project** | CC0 1.0 Universal (public domain dedication)                              |
| **Pinned commit**          | `f2365d33171bd1897a41aaae6c0b6e795bcc0483` (2026-09-17)                   |
| **Taken**                  | `icons/<slug>.svg` path data only, verbatim                               |
| **Disclaimer read**        | <https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md> |

## What is bundled

| Component           | Slug            | Title upstream | Brand source recorded upstream         |
| ------------------- | --------------- | -------------- | -------------------------------------- |
| `NetflixMark`       | `netflix`       | Netflix        | the Netflix brand-assets site          |
| `HboMaxMark`        | `hbomax`        | HBO Max        | the Max 2025 logo on Wikimedia Commons |
| `AppleTvMark`       | `appletv`       | Apple TV       | the Apple TV logo file on Wikipedia    |
| `ParamountPlusMark` | `paramountplus` | Paramount+     | the Paramount brand site               |
| `StarzMark`         | `starz`         | STARZ          | the STARZ site                         |

⚠ **The upstream `source` URLs are described, not linked, on purpose.** Three of
the five point at a streaming service's own domain, and `T-SEC-001` fails the
build on a streaming-service host appearing anywhere in the tree — the gate that
keeps this product from ever addressing a streaming service (NFR-010, product
invariant 10). The exact URLs live in the pinned upstream `_data/simple-icons.json`
and are recoverable from the commit above; putting them back here trips the gate
and, worse, teaches the next reader that the rule has exceptions.

> ⚠ **The `max` slug upstream is Cycling '74 Max, the music software — not HBO
> Max.** The slug that matches this product's `max` service is **`hbomax`**.
> The names collide exactly where a careless vendoring would not notice, and
> the wrong glyph would have shipped looking perfectly deliberate.

## Drawn here (three)

**Owner-directed 2026-09-17.** Having seen the mixed presentation on the live
list, the owner asked for the three remaining services to get a mark too.

| Component        | Service     | What it is                                            |
| ---------------- | ----------- | ----------------------------------------------------- |
| `PrimeVideoMark` | Prime Video | A curved arrow, in the spirit of the Amazon smile     |
| `DisneyPlusMark` | Disney+     | A `D+` monogram — **not** the Disney script or castle |
| `PeacockMark`    | Peacock     | A six-feather fan of rotated ellipses                 |

These are **geometric approximations, drawn from scratch to be recognisable at
16 px** — they are not traces, and no press-kit asset, SVG or image file was
obtained from any brand to make them. That is deliberate on two counts: the
artwork is the part carrying the brands' protection, and fetching anything from
a streaming service's own domain is forbidden outright here (product invariant
10, enforced by `T-SEC-001`).

⚠ **Their position is weaker than the vendored five, and the owner accepted
that knowingly.** A CC0 file has an unambiguous copyright story; an
approximation of a protected mark does not. If tightening this is ever wanted,
the fix is **deletion**, not improvement — a more faithful drawing is a worse
position, not a better one.

⚠ **Do not "upgrade" a drawn mark by tracing the real logo.** It reproduces
precisely what the approximation avoids, and every test in this repository
would stay green.

~~Superseded 2026-09-17: "**Prime Video, Disney+ and Peacock have no mark**,
and that is a decision. … Those three services render their **word mark**,
which is what all eight rendered before this change."~~ Retained because it
still explains why these three differ in kind from the other five.

## Terms, stated plainly

- **CC0 covers the SVG files** taken from the vendored source. It does not, and
  cannot, transfer any rights in the underlying trademarks. It says nothing at
  all about the three marks drawn here, which are original artwork owned by
  this project but depict marks that are not.
- **The marks remain the property of their respective owners.** They are used
  here **nominatively** — to identify which streaming service a title is saved
  on, in a private single-owner watchlist. No affiliation, sponsorship or
  endorsement is claimed or implied.
- **Rendering is monochrome and inherits `currentColor`.** No brand colour is
  reproduced, and the marks are never used as a logo of this product.
- **Nothing is ever fetched from a streaming service** (product invariant 10).
  The paths are compiled into the bundle; the app makes no request for them, at
  build time or at run time.
- Should a brand ask for its mark not to be used here, deleting its component
  and its `SERVICE_MARKS` entry is sufficient — the word-mark fallback then
  renders, and nothing else changes.
